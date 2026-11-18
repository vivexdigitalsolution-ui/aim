// invite-customer: staff press "Send invitation" on the Walk-in customers page.
// 1. checks the caller is active staff, 2. sends Supabase's invitation email to the customer, 3. turns the new account into a customer account (attach_customer).
// Deploy:  supabase functions deploy invite-customer   (project: Japan Auction).  The service key never leaves this function.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const authHeader = req.headers.get('Authorization') || ''
    // who is calling? only active staff may send invitations
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const staff = await caller.rpc('is_staff')
    if (staff.error || staff.data !== true) return reply(403, { error: 'Staff only' })

    const { pass_id, redirect_to } = await req.json()
    if (!pass_id || !redirect_to) return reply(400, { error: 'pass_id and redirect_to are needed' })
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

    const { data: pass, error: pe } = await admin.from('customer_passes').select('id,label,email,revoked,redeemed_by').eq('id', pass_id).maybeSingle()
    if (pe || !pass) return reply(404, { error: 'Pass not found' })
    if (pass.revoked) return reply(400, { error: 'This pass was cancelled' })
    if (!pass.email) return reply(400, { error: 'This pass has no email address' })

    const inv = await admin.auth.admin.inviteUserByEmail(pass.email, { data: { contact_name: pass.label }, redirectTo: redirect_to })
    if (inv.error || !inv.data?.user) {
      const msg = inv.error?.message || 'The invitation could not be sent'
      return reply(400, { error: /already|registered|exists/i.test(msg) ? 'That email already has an account. Use another email, or ask the customer to sign in.' : msg })
    }
    const att = await admin.rpc('attach_customer', { p_pass: pass.id, p_user: inv.data.user.id })
    if (att.error) return reply(400, { error: att.error.message })
    return reply(200, { ok: true, email: pass.email })
  } catch (e) {
    return reply(500, { error: (e as Error).message })
  }
})

// create-user: staff add an AP holder (or an admin adds a staff member) from AP holders > Add user.
// 1. checks the caller is active staff (only an admin may create staff or admins), 2. sends Supabase's invitation email,
// 3. makes the new profile active with the chosen role, plan and bid limit.
// Deploy:  supabase functions deploy create-user   (project: Japan Auction).  The service key never leaves this function.
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
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
    const staff = await caller.rpc('is_staff')
    if (staff.error || staff.data !== true) return reply(403, { error: 'Staff only' })

    const b = await req.json()
    const email = String(b.email || '').trim().toLowerCase()
    const role = ['ap_holder', 'staff', 'admin'].includes(b.role) ? b.role : 'ap_holder'
    const tier = ['free', 'member', 'partner'].includes(b.tier) ? b.tier : 'free'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { error: 'Type a valid email address' })
    if (!b.redirect_to) return reply(400, { error: 'redirect_to is needed' })
    if (role !== 'ap_holder') {
      const adm = await caller.rpc('is_admin')
      if (adm.error || adm.data !== true) return reply(403, { error: 'Only an admin can add staff or admins' })
    }

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const inv = await admin.auth.admin.inviteUserByEmail(email, {
      data: { company_name: b.company_name || null, contact_name: b.contact_name || null, phone: b.phone || null, whatsapp: b.whatsapp || null },
      redirectTo: b.redirect_to,
    })
    if (inv.error || !inv.data?.user) {
      const msg = inv.error?.message || 'The invitation could not be sent'
      return reply(400, { error: /already|registered|exists/i.test(msg) ? 'That email already has an account.' : msg })
    }
    const patch: Record<string, unknown> = { role, status: 'active' }
    if (role === 'ap_holder') {
      patch.tier = tier
      if (Number(b.bid_limit_jpy) > 0) patch.bid_limit_jpy = Number(b.bid_limit_jpy)
      if (b.fee_rule_id) patch.fee_rule_id = b.fee_rule_id
    }
    const up = await admin.from('profiles').update(patch).eq('id', inv.data.user.id)
    if (up.error) return reply(400, { error: 'The invitation was sent but the account could not be set up: ' + up.error.message })
    return reply(200, { ok: true, email })
  } catch (e) {
    return reply(500, { error: (e as Error).message })
  }
})

'use strict'

/**
 * test-sourcing.js — sourcing requests with real logins: the 2-request limit of the Free plan, who can read and change what, and the alerts.
 * Temporary users and requests, all DELETED at the end. Needs migration 31.
 *
 *   node test-sourcing.js
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const admin = require('./lib/db')

const envFile = fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'aim', '.env'), 'utf8')
const anonKey = (envFile.match(/^NUXT_PUBLIC_SUPABASE_KEY=(.+)$/m) || [])[1]?.trim()
let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

async function makeUser(label, patch) {
  const email = `aim-test-${label}-${Date.now()}@example.invalid`, password = 'T' + Math.random().toString(36).slice(2) + 'x9Q!'
  const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { company_name: 'AIM TEST ' + label + ' (auto-deleted)' } })
  if (r.error) throw new Error(r.error.message)
  await new Promise((s) => setTimeout(s, 800))
  const u = await admin.from('profiles').update(patch).eq('id', r.data.user.id)
  if (u.error) throw new Error(u.error.message)
  const c = createClient(process.env.SUPABASE_URL, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const si = await c.auth.signInWithPassword({ email, password })
  if (si.error) throw new Error(si.error.message)
  return { id: r.data.user.id, c }
}

async function main() {
  const made = []
  try {
    const probe = await admin.from('sourcing_requests').select('id').limit(1)
    if (probe.error) throw new Error('migration 31 is not applied yet (' + probe.error.message + ')')

    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)
    const free = await makeUser('free', { role: 'ap_holder', status: 'active', tier: 'free' }); made.push(free.id)
    const mem = await makeUser('member', { role: 'ap_holder', status: 'active', tier: 'member' }); made.push(mem.id)
    const req = (u, model, extra = {}) => u.c.from('sourcing_requests').insert({ ap_id: u.id, model, ...extra }).select('id').single()

    console.log('\n-- the Free plan: 2 requests in total --')
    const f1 = await req(free, 'AIM TEST ALPHARD', { budget_myr: 250000 })
    ok(!f1.error, 'a Free dealer sends request 1')
    const f2 = await req(free, 'AIM TEST HARRIER')
    ok(!f2.error, 'a Free dealer sends request 2')
    const f3 = await req(free, 'AIM TEST VELLFIRE')
    ok(!!f3.error && /2 sourcing requests/.test(f3.error.message), 'request 3 is refused with a clear message' + (f3.error ? ' (' + f3.error.message + ')' : ''))
    await free.c.from('sourcing_requests').update({ status: 'closed' }).eq('id', f1.data.id)
    const f4 = await req(free, 'AIM TEST AGAIN')
    ok(!!f4.error, 'closing a request does not give the free request back (2 in total)')

    console.log('\n-- Member: no limit --')
    let allOk = true
    const m = []
    for (let i = 0; i < 4; i++) { const r = await req(mem, 'AIM TEST CAR ' + i); if (r.error) allOk = false; else m.push(r.data.id) }
    ok(allOk, 'a Member sends 4 requests')

    console.log('\n-- who can do what --')
    ok(((await free.c.from('sourcing_requests').select('id')).data || []).length === 2, 'a dealer sees only their own requests')
    ok(((await staff.c.from('sourcing_requests').select('id').like('model', 'AIM TEST%')).data || []).length === 6, 'staff see everyone\'s')
    const forged = await free.c.from('sourcing_requests').insert({ ap_id: mem.id, model: 'AIM TEST FORGED' })
    ok(!!forged.error, 'a dealer CANNOT send a request in another dealer\'s name')
    const preset = await mem.c.from('sourcing_requests').insert({ ap_id: mem.id, model: 'AIM TEST X', status: 'found' })
    ok(!!preset.error, 'a dealer CANNOT create a request that is already "found"')
    const fakeReply = await mem.c.from('sourcing_requests').update({ staff_reply: 'I found it, send money' }).eq('id', m[0])
    ok(!!fakeReply.error || !(await admin.from('sourcing_requests').select('staff_reply').eq('id', m[0]).single()).data.staff_reply, 'a dealer CANNOT write the staff reply')
    const reopen = await mem.c.from('sourcing_requests').update({ status: 'found' }).eq('id', m[0])
    ok(!!reopen.error || (await admin.from('sourcing_requests').select('status').eq('id', m[0]).single()).data.status === 'open', 'a dealer CANNOT mark their own request found')
    const closeOwn = await mem.c.from('sourcing_requests').update({ status: 'closed' }).eq('id', m[1])
    ok(!closeOwn.error && (await admin.from('sourcing_requests').select('status').eq('id', m[1]).single()).data.status === 'closed', 'a dealer can close their own request')
    const closeOther = await free.c.from('sourcing_requests').update({ status: 'closed' }).eq('id', m[2])
    ok((await admin.from('sourcing_requests').select('status').eq('id', m[2]).single()).data.status === 'open', 'a dealer CANNOT close someone else\'s request')

    console.log('\n-- staff answer --')
    const ans = await staff.c.from('sourcing_requests').update({ status: 'found', staff_reply: 'Found one, 2021 model, closes tomorrow' }).eq('id', m[0])
    ok(!ans.error, 'staff reply and mark it found' + (ans.error ? ': ' + ans.error.message : ''))
    const al = await mem.c.from('notifications').select('title,body').eq('kind', 'sourcing_update')
    ok(al.data?.some((n) => n.title.startsWith('We found a car for you') && n.body === 'Found one, 2021 model, closes tomorrow'), 'the dealer gets an alert with the reply')
    const sal = await staff.c.from('notifications').select('title').eq('kind', 'sourcing_new')
    ok((sal.data || []).some((n) => n.title.includes('AIM TEST')), 'staff got an alert for each new request')
    ok((await mem.c.from('sourcing_requests').select('staff_reply,status').eq('id', m[0]).single()).data.staff_reply?.startsWith('Found one'), 'the dealer reads the reply')
  } finally {
    for (const id of made) { await admin.from('sourcing_requests').delete().eq('ap_id', id) }
    await admin.from('notifications').delete().like('title', '%AIM TEST%')
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log('\ntest users, requests and alerts deleted')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

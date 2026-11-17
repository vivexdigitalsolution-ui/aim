'use strict'

/**
 * test-account.js — my account and password reset with a real temporary login. No e-mail is sent: the recovery link is made with the admin API.
 * The test user is DELETED at the end.
 *
 *   node test-account.js
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
const client = () => createClient(process.env.SUPABASE_URL, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  const email = `aim-test-acct-${Date.now()}@example.invalid`, pw1 = 'T' + Math.random().toString(36).slice(2) + 'x9Q!', pw2 = 'N' + Math.random().toString(36).slice(2) + 'z7R!', pw3 = 'R' + Math.random().toString(36).slice(2) + 'k4W!'
  const made = await admin.auth.admin.createUser({ email, password: pw1, email_confirm: true, user_metadata: { company_name: 'AIM TEST acct (auto-deleted)' } })
  if (made.error) throw new Error(made.error.message)
  const uid = made.data.user.id
  try {
    await new Promise((s) => setTimeout(s, 800))
    await admin.from('profiles').update({ role: 'ap_holder', status: 'active', tier: 'member' }).eq('id', uid)
    const me = client()
    const si = await me.auth.signInWithPassword({ email, password: pw1 })
    ok(!si.error, 'the test user signs in')

    console.log('\n-- my details --')
    const up = await me.from('profiles').update({ company_name: 'AIM TEST renamed', contact_name: 'Test Person', phone: '0123456789', whatsapp: '0123456789', address: '1 Test Road' }).eq('id', uid)
    const row = (await admin.from('profiles').select('company_name,contact_name,phone,address,tier,status,role').eq('id', uid)).data[0]
    ok(!up.error && row.company_name === 'AIM TEST renamed' && row.address === '1 Test Road', 'a user changes their own company, name, phone, WhatsApp and address')
    const sneaky = await me.from('profiles').update({ tier: 'partner' }).eq('id', uid)
    const row2 = (await admin.from('profiles').select('tier').eq('id', uid)).data[0]
    ok(row2.tier === 'member', 'the same user still CANNOT change their plan' + (sneaky.error ? ' (' + sneaky.error.message + ')' : ''))
    const role = await me.from('profiles').update({ role: 'admin' }).eq('id', uid)
    ok((await admin.from('profiles').select('role').eq('id', uid)).data[0].role === 'ap_holder', 'nor their role' + (role.error ? ' (' + role.error.message + ')' : ''))

    console.log('\n-- change password (signed in) --')
    const wrong = await client().auth.signInWithPassword({ email, password: 'not-the-password' })
    ok(!!wrong.error, 'a wrong current password is refused (the page checks it before changing)')
    const ch = await me.auth.updateUser({ password: pw2 })
    ok(!ch.error, 'the new password is saved' + (ch.error ? ': ' + ch.error.message : ''))
    ok(!(await client().auth.signInWithPassword({ email, password: pw2 })).error, 'sign-in works with the new password')
    ok(!!(await client().auth.signInWithPassword({ email, password: pw1 })).error, 'the old password no longer works')

    console.log('\n-- forgot password: the e-mail link --')
    const link = await admin.auth.admin.generateLink({ type: 'recovery', email })
    ok(!link.error && link.data?.properties?.hashed_token, 'a recovery link is made' + (link.error ? ': ' + link.error.message : ''))
    const rec = client()
    const v = await rec.auth.verifyOtp({ type: 'recovery', token_hash: link.data.properties.hashed_token })
    ok(!v.error && v.data.session, 'opening the link signs the person in with a recovery session')
    const set = await rec.auth.updateUser({ password: pw3 })
    ok(!set.error, 'they choose a new password' + (set.error ? ': ' + set.error.message : ''))
    ok(!(await client().auth.signInWithPassword({ email, password: pw3 })).error, 'sign-in works with the password chosen from the link')
    const again = await client().auth.verifyOtp({ type: 'recovery', token_hash: link.data.properties.hashed_token })
    ok(!!again.error, 'the same link cannot be used twice')
    const short = await client().auth.signInWithPassword({ email, password: pw2 })
    ok(!!short.error, 'the password before the reset is gone')
  } finally {
    await admin.auth.admin.deleteUser(uid)
    console.log('\ntest user deleted')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

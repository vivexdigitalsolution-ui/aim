'use strict'

/**
 * test-ap-admin.js — the AP holders screen with real logins: a temporary staff user, a temporary admin and a pending dealer.
 * Checks approve / plan / limits / contacts (staff), and that fee rules and settings are admin-only. Everything is DELETED or restored at the end.
 *
 *   node test-ap-admin.js
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
  if (patch) { const u = await admin.from('profiles').update(patch).eq('id', r.data.user.id); if (u.error) throw new Error(u.error.message) }
  const c = createClient(process.env.SUPABASE_URL, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const si = await c.auth.signInWithPassword({ email, password })
  if (si.error) throw new Error(si.error.message)
  return { id: r.data.user.id, c }
}

async function main() {
  const made = []
  const before = (await admin.from('app_settings').select('*').maybeSingle()).data
  let ruleId = null
  try {
    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)
    const boss = await makeUser('admin', { role: 'admin', status: 'active' }); made.push(boss.id)
    const dealer = await makeUser('dealer', null); made.push(dealer.id)       // a fresh sign-up: pending

    console.log('\n-- a new sign-up --')
    const p0 = (await admin.from('profiles').select('status,tier,role').eq('id', dealer.id).single()).data
    ok(p0.status === 'pending' && p0.role === 'ap_holder', 'a new sign-up is a pending AP holder')
    console.log('   (default plan of a new sign-up: ' + p0.tier + (p0.tier === 'free' ? '' : ' - run migration 23 to make it free') + ')')

    console.log('\n-- staff: the AP holders screen --')
    const list = await staff.c.from('profiles').select('*').eq('role', 'ap_holder').order('created_at', { ascending: false })
    ok(!list.error && list.data.some((a) => a.id === dealer.id), 'staff see the AP holder list including the new sign-up')
    const appr = await staff.c.from('profiles').update({ status: 'active', tier: 'member' }).eq('id', dealer.id)
    const p1 = (await admin.from('profiles').select('status,tier').eq('id', dealer.id).single()).data
    ok(!appr.error && p1.status === 'active' && p1.tier === 'member', 'staff approve the dealer and set the plan to member')
    const lim = await staff.c.from('profiles').update({ bid_limit_jpy: 5000000, open_limit_jpy: 12000000, history_until: '2030-01-01' }).eq('id', dealer.id)
    const nt = await staff.c.from('ap_notes').upsert({ ap_id: dealer.id, notes: 'test note' }, { onConflict: 'ap_id' })
    const p2 = (await admin.from('profiles').select('bid_limit_jpy,open_limit_jpy,history_until').eq('id', dealer.id).single()).data
    const n2 = (await staff.c.from('ap_notes').select('notes').eq('ap_id', dealer.id).single()).data
    ok(!lim.error && !nt.error && Number(p2.bid_limit_jpy) === 5000000 && Number(p2.open_limit_jpy) === 12000000 && n2?.notes === 'test note', 'staff set the limits, history date and a private note')
    const ins = await staff.c.from('ap_contacts').insert({ ap_id: dealer.id, name: 'Test Contact', position: 'Sales', phone: '0123456789' })
    const cl = await staff.c.from('ap_contacts').select('id').eq('ap_id', dealer.id)
    ok(!ins.error && cl.data.length === 1, 'staff add an extra contact')
    await staff.c.from('ap_contacts').delete().eq('ap_id', dealer.id)
    const sus = await staff.c.from('profiles').update({ status: 'suspended', suspended_reason: 'test' }).eq('id', dealer.id)
    ok(!sus.error && (await admin.from('profiles').select('status').eq('id', dealer.id).single()).data.status === 'suspended', 'staff can suspend')
    const stats = await staff.c.from('bids').select('ap_id,status,max_bid_jpy').limit(5)
    ok(!stats.error, 'staff can read the bids for the order counts')

    console.log('\n-- the dealer after approval --')
    const mine = await dealer.c.from('profiles').select('notes').eq('id', dealer.id).single()
    ok(!mine.data?.notes, 'the dealer finds no internal note on their own profile row')
    const theirs = await dealer.c.from('ap_notes').select('notes').eq('ap_id', dealer.id)
    ok((theirs.data || []).length === 0, 'the dealer CANNOT read the staff notes table')

    console.log('\n-- fee rules and settings: admin only --')
    const rs = await staff.c.from('fee_rules').insert({ name: 'AIM TEST RULE', fee_type: 'flat_jpy', fee_value: 1, is_default: false, active: false })
    ok(!!rs.error, 'staff CANNOT create a fee rule' + (rs.error ? ' (' + rs.error.message + ')' : ''))
    const ra = await boss.c.from('fee_rules').insert({ name: 'AIM TEST RULE', fee_type: 'flat_jpy', fee_value: 1, is_default: false, active: false }).select('id').single()
    ruleId = ra.data?.id
    ok(!ra.error && ruleId, 'an admin can create a fee rule')
    const ru = await boss.c.from('fee_rules').update({ fee_value: 2 }).eq('id', ruleId)
    ok(!ru.error, 'an admin can edit it')
    const ss = await staff.c.from('app_settings').update({ history_weeks: (before.history_weeks || 4) + 1 }).eq('id', true)
    const afterStaff = (await admin.from('app_settings').select('history_weeks').maybeSingle()).data
    ok(afterStaff.history_weeks === before.history_weeks, 'staff CANNOT change the settings' + (ss.error ? ' (' + ss.error.message + ')' : ' (silently ignored)'))
    const sa = await boss.c.from('app_settings').update({ history_weeks: (before.history_weeks || 4) + 1 }).eq('id', true)
    const afterBoss = (await admin.from('app_settings').select('history_weeks').maybeSingle()).data
    ok(!sa.error && afterBoss.history_weeks === (before.history_weeks || 4) + 1, 'an admin can change the settings')
  } finally {
    if (ruleId) await admin.from('fee_rules').delete().eq('id', ruleId)
    await admin.from('fee_rules').delete().eq('name', 'AIM TEST RULE')
    if (before) await admin.from('app_settings').update({ max_car_age_years: before.max_car_age_years, inactive_suspend_days: before.inactive_suspend_days, history_weeks: before.history_weeks }).eq('id', true)
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log('\ntest users deleted, test fee rule removed, settings restored')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

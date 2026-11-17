'use strict'

/**
 * test-dealer-list.js — buy list + personal link + tracking with real logins and a visitor with NO login.
 * Temporary users: staff, dealer A (member), dealer B (member). Everything is DELETED at the end. Needs migration 26.
 *
 *   node test-dealer-list.js
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
const newClient = () => createClient(process.env.SUPABASE_URL, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })

async function makeUser(label, patch) {
  const email = `aim-test-${label}-${Date.now()}@example.invalid`, password = 'T' + Math.random().toString(36).slice(2) + 'x9Q!'
  const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { company_name: 'AIM TEST ' + label + ' (auto-deleted)' } })
  if (r.error) throw new Error(r.error.message)
  await new Promise((s) => setTimeout(s, 800))
  const u = await admin.from('profiles').update(patch).eq('id', r.data.user.id)
  if (u.error) throw new Error(u.error.message)
  const c = newClient()
  const si = await c.auth.signInWithPassword({ email, password })
  if (si.error) throw new Error(si.error.message)
  return { id: r.data.user.id, c }
}

async function main() {
  const made = []
  try {
    const probe = await admin.from('dealer_lists').select('id').limit(1)
    if (probe.error) throw new Error('migration 26 is not applied yet (' + probe.error.message + ')')
    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)
    const a = await makeUser('dealerA', { role: 'ap_holder', status: 'active', tier: 'member' }); made.push(a.id)
    const b = await makeUser('dealerB', { role: 'ap_holder', status: 'active', tier: 'member' }); made.push(b.id)
    const { data: lots } = await admin.from('lots').select('id,brand,model').gt('bid_deadline', new Date(Date.now() + 3600_000).toISOString()).eq('my_eligible', true).limit(2)
    if (!lots?.length) throw new Error('no open lot to test with')

    console.log('\n-- buy list --')
    const bl = await a.c.from('buy_lists').upsert({ ap_id: a.id, brands: ['TOYOTA'], models: ['ALPHARD'], year_from: 2021, budget_myr: 300000, min_margin_pct: 12, aps_left: 3, speed: 'fast' }, { onConflict: 'ap_id' })
    ok(!bl.error, 'a dealer saves their own buy list' + (bl.error ? ': ' + bl.error.message : ''))
    const blOther = await b.c.from('buy_lists').select('ap_id').eq('ap_id', a.id)
    ok((blOther.data || []).length === 0, 'another dealer CANNOT read it')
    const blWrite = await b.c.from('buy_lists').upsert({ ap_id: a.id, brands: ['HACK'] }, { onConflict: 'ap_id' })
    ok(!!blWrite.error, 'another dealer CANNOT change it')
    const blStaff = await staff.c.from('buy_lists').select('brands,min_margin_pct').eq('ap_id', a.id).single()
    ok(blStaff.data?.brands?.[0] === 'TOYOTA' && Number(blStaff.data.min_margin_pct) === 12, 'staff read it')
    const blStaffEdit = await staff.c.from('buy_lists').update({ min_margin_pct: 15 }).eq('ap_id', a.id)
    ok(!blStaffEdit.error, 'staff can edit it')

    console.log('\n-- staff make a list --')
    const item = (lot) => ({ lot_id: lot.id, title: lot.brand + ' ' + lot.model, margin_pct: 14, target_pct: 12, jpy_rate: 0.027 })
    const mk = await staff.c.from('dealer_lists').insert({ ap_id: a.id, message: 'Hi test', items: [item(lots[0]), { lot_id: '00000000-0000-0000-0000-000000000000', title: 'ghost car' }] }).select('id,token').single()
    ok(!mk.error && mk.data.token?.length >= 60, 'staff create a list; the token is long and random (' + (mk.data?.token || '').length + ' characters)')
    const token = mk.data.token, listId = mk.data.id

    console.log('\n-- a visitor with NO login opens the link --')
    const visitor = newClient()
    const direct = await visitor.from('dealer_lists').select('id').limit(1)
    ok((direct.data || []).length === 0, 'a visitor CANNOT read the lists table')
    const got = await visitor.rpc('dealer_list_get', { p_token: token })
    ok(!got.error && got.data?.items?.length === 1 && got.data.items[0].lot_id === lots[0].id, 'the link returns the list; a car that no longer exists is left out')
    ok(!JSON.stringify(got.data).includes('duty') && !JSON.stringify(got.data).includes('docket'), 'the list holds no duty or docket')
    const bad = await visitor.rpc('dealer_list_get', { p_token: 'not-a-real-token' })
    ok(!bad.error && bad.data === null, 'a wrong token returns nothing')
    await visitor.rpc('dealer_list_event', { p_token: token, p_event: 'bid_click', p_lot: lots[0].id })
    await visitor.rpc('dealer_list_event', { p_token: token, p_event: 'request_sheet', p_lot: lots[0].id })
    await visitor.rpc('dealer_list_event', { p_token: token, p_event: 'delete_everything', p_lot: null })
    await visitor.rpc('dealer_list_event', { p_token: 'wrong', p_event: 'bid_click', p_lot: null })
    const ev = await admin.from('dealer_list_events').select('event').eq('list_id', listId)
    const kinds = (ev.data || []).map((e) => e.event).sort().join()
    ok(kinds === 'bid_click,open,request_sheet', 'tracking recorded: open, bid click, sheet request (an unknown event and a wrong token are ignored): ' + kinds)

    console.log('\n-- who can see the tracking --')
    const sEv = await staff.c.from('dealer_list_events').select('event').eq('list_id', listId)
    ok(!sEv.error && sEv.data.length === 3, 'staff see the events')
    const aEv = await a.c.from('dealer_list_events').select('event').eq('list_id', listId)
    ok((aEv.data || []).length === 0, 'the dealer CANNOT read the tracking of their own list')
    const aList = await a.c.from('dealer_lists').select('id').eq('id', listId)
    ok((aList.data || []).length === 1, 'the dealer can see that a list was made for them')
    const bList = await b.c.from('dealer_lists').select('id').eq('id', listId)
    ok((bList.data || []).length === 0, 'another dealer CANNOT see it')
    const aWrite = await a.c.from('dealer_lists').insert({ ap_id: a.id, items: [] })
    ok(!!aWrite.error, 'a dealer CANNOT make a list for themselves')

    console.log('\n-- revoke and expiry --')
    await staff.c.from('dealer_lists').update({ revoked: true }).eq('id', listId)
    const rev = await visitor.rpc('dealer_list_get', { p_token: token })
    ok(rev.data === null, 'a revoked link stops working')
    await staff.c.from('dealer_lists').update({ revoked: false, expires_at: new Date(Date.now() - 1000).toISOString() }).eq('id', listId)
    const exp = await visitor.rpc('dealer_list_get', { p_token: token })
    ok(exp.data === null, 'an expired link stops working')
  } finally {
    for (const id of made) { await admin.from('dealer_lists').delete().eq('ap_id', id); await admin.from('buy_lists').delete().eq('ap_id', id) }
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log('\ntest users, lists and tracking deleted')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

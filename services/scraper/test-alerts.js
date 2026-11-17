'use strict'

/**
 * test-alerts.js — the alerts with real logins: instant alerts from bid triggers, the inbox rules, the 15-minute "place before it closes" job
 * (with a temporary car that closes in 1 hour) and that it never alerts twice. Temporary users, car, bids and alerts are DELETED at the end.
 * Needs migration 27.
 *
 *   node test-alerts.js
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
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
const mine = (u, kind) => u.c.from('notifications').select('id,kind,title,body,read_at').eq('kind', kind)

async function main() {
  const made = []
  let lotId = null
  try {
    const probe = await admin.from('notifications').select('id').limit(1)
    if (probe.error) throw new Error('migration 27 is not applied yet (' + probe.error.message + ')')
    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)
    const a = await makeUser('dealerA', { role: 'ap_holder', status: 'active', tier: 'member', bid_limit_jpy: 20000000 }); made.push(a.id)
    const b = await makeUser('dealerB', { role: 'ap_holder', status: 'active', tier: 'member', bid_limit_jpy: 20000000 }); made.push(b.id)

    // a temporary car that closes in one hour
    const lot = await admin.from('lots').insert({ venue: 'AIMTEST', auction_date: new Date().toISOString().slice(0, 10), lot_no: 'T' + Date.now(), bid_deadline: new Date(Date.now() + 3600_000).toISOString(), brand: 'TESTBRAND', model: 'TEST CAR', mfg_year: new Date().getFullYear() - 1 }).select('id,my_eligible').single()
    if (lot.error) throw new Error('could not make the test car: ' + lot.error.message)
    lotId = lot.data.id
    if (!lot.data.my_eligible) throw new Error('the test car is not eligible (check the age rule)')

    console.log('\n-- instant alerts from bids --')
    const pb = await a.c.rpc('place_bid', { p_lot: lotId, p_max: 3000000 })
    ok(!pb.error, 'dealer A places a bid order' + (pb.error ? ': ' + pb.error.message : ''))
    const bidId = pb.data
    const sNew = await mine(staff, 'new_bid')
    ok(sNew.data?.some((n) => n.title.includes('TESTBRAND') && n.body.includes('AIM TEST dealerA')), 'staff get "New bid order" with the dealer and the amount')
    await a.c.rpc('place_bid', { p_lot: lotId, p_max: 3500000 })
    ok((await mine(staff, 'bid_changed')).data?.some((n) => n.body.includes('3,500,000')), 'staff get "Bid order changed" with the new amount')

    console.log('\n-- the inbox rules --')
    const bSee = await b.c.from('notifications').select('id')
    ok((bSee.data || []).length === 0, 'dealer B sees none of the staff alerts')
    const aStaffAlerts = await a.c.from('notifications').select('id').in('kind', ['new_bid', 'bid_changed'])
    ok((aStaffAlerts.data || []).length === 0, 'dealer A does not see the staff alerts either')
    const forge = await a.c.from('notifications').insert({ user_id: a.id, kind: 'bid_won', title: 'You won a Ferrari' })
    ok(!!forge.error, 'a dealer CANNOT write an alert for themselves')
    const target = sNew.data[0]
    const edit = await staff.c.from('notifications').update({ title: 'hacked' }).eq('id', target.id)
    const still = await admin.from('notifications').select('title').eq('id', target.id).single()
    ok(still.data.title !== 'hacked', 'a user CANNOT change the text of an alert' + (edit.error ? ' (' + edit.error.message + ')' : ''))
    const rd = await staff.c.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', target.id)
    const rd2 = await admin.from('notifications').select('read_at').eq('id', target.id).single()
    ok(!rd.error && rd2.data.read_at, 'a user can mark their own alert as read')
    const rdOther = await b.c.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', target.id)
    void rdOther

    console.log('\n-- results to the dealer --')
    await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'placed' })
    ok((await mine(a, 'bid_placed')).data?.length === 1, 'dealer A is told the order was placed')
    await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'won', p_final: 3400000 })
    const won = await mine(a, 'bid_won')
    ok(won.data?.length === 1 && won.data[0].body.includes('3,400,000'), 'dealer A is told they won, with the price')
    await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'pending' })

    console.log('\n-- the 15-minute job: place before it closes --')
    const run = () => spawnSync(process.execPath, ['alerts.js', '--only', 'close'], { cwd: __dirname, encoding: 'utf8' })
    const r1 = run()
    ok(r1.status === 0, 'alerts.js --only close runs' + (r1.status ? ': ' + (r1.stderr || r1.stdout).slice(0, 200) : ''))
    const c1 = await mine(staff, 'closing_soon')
    ok(c1.data?.length === 1 && c1.data[0].title.includes('TESTBRAND') && c1.data[0].body.includes('AIM TEST dealerA'), 'staff get "Place before it closes" for the unplaced order')
    run()
    const c2 = await mine(staff, 'closing_soon')
    ok(c2.data?.length === 1, 'running it again does NOT alert twice')
    await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'placed' })
    await admin.from('notifications').delete().eq('user_id', staff.id).eq('kind', 'closing_soon')
    run()
    ok(((await mine(staff, 'closing_soon')).data || []).length === 0, 'once the order is placed there is no "place before it closes" alert')

    console.log('\n-- cancel --')
    await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'pending' })
    await a.c.rpc('cancel_bid', { p_bid: bidId })
    ok((await mine(staff, 'bid_cancelled')).data?.length === 1, 'staff are told when a dealer cancels')
  } finally {
    if (lotId) await admin.from('bids').delete().eq('lot_id', lotId)
    for (const id of made) await admin.from('bids').delete().eq('ap_id', id)
    if (lotId) await admin.from('lots').delete().eq('id', lotId)
    // alerts that went to REAL staff because of the test bids
    await admin.from('notifications').delete().or('body.ilike.%AIM TEST%,title.ilike.%TESTBRAND%')
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log('\ntest users, car, bids and alerts deleted')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

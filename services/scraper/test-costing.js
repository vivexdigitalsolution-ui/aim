'use strict'

/**
 * test-costing.js — order costing with real logins: staff only, dealers see nothing, deal terms are staff's, and a dealer can still bid.
 * Temporary users, 1 temporary car, bids, rates and cost lines, all DELETED at the end. Needs migration 36.
 *
 *   node test-costing.js
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
  let lotId = null
  try {
    const probe = await admin.from('rate_card').select('id').limit(1)
    if (probe.error) throw new Error('migration 36 is not applied yet (' + probe.error.message + ')')

    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)
    const dealer = await makeUser('dealer', { role: 'ap_holder', status: 'active', tier: 'member', bid_limit_jpy: 30000000 }); made.push(dealer.id)
    const lot = await admin.from('lots').insert({ venue: 'AIMTEST', auction_date: new Date().toISOString().slice(0, 10), lot_no: 'C' + Date.now(), bid_deadline: new Date(Date.now() + 5 * 3600_000).toISOString(), brand: 'TESTBRAND', model: 'TEST CAR', mfg_year: new Date().getFullYear() - 1 }).select('id').single()
    if (lot.error) throw new Error(lot.error.message)
    lotId = lot.data.id

    console.log('\n-- a dealer can still bid --')
    const bidId = (await dealer.c.rpc('place_bid', { p_lot: lotId, p_max: 4000000 })).data
    ok(!!bidId, 'a dealer places a bid order as before')
    const row = (await admin.from('bids').select('deal_basis,offer_jpy,fixed_charge_jpy,show_won_price,giveback_jpy').eq('id', bidId).single()).data
    ok(row.deal_basis === 'bid_plus_fixed' && row.offer_jpy === null && row.show_won_price === true && Number(row.giveback_jpy) === 0, 'the new bid has the neutral deal terms')

    console.log('\n-- staff only --')
    ok(((await staff.c.from('cost_items').select('key')).data || []).length >= 15, 'staff read the standard cost lines')
    ok(((await dealer.c.from('cost_items').select('key')).data || []).length === 0, 'a dealer cannot')
    const r1 = await staff.c.from('rate_card').insert({ item_key: 'land_transport', venue: 'AIMTEST', amount_jpy: 9900, party: 'AIM TEST party' }).select('id').single()
    ok(!r1.error, 'staff add a rate')
    ok(((await dealer.c.from('rate_card').select('id')).data || []).length === 0, 'a dealer cannot read the rate card')
    ok(!!(await dealer.c.from('rate_card').insert({ item_key: 'insurance', amount_jpy: 1 })).error, 'a dealer cannot add a rate')
    const c1 = await staff.c.from('order_costs').insert({ bid_id: bidId, item_key: 'ocean_freight', label: 'Ocean freight', amount_jpy: 95000, status: 'estimate', party: 'AIM TEST party' }).select('id').single()
    ok(!c1.error, 'staff add a cost line to an order')
    ok(((await dealer.c.from('order_costs').select('id')).data || []).length === 0, 'the dealer does NOT see the cost lines of their own order')
    ok(!!(await dealer.c.from('order_costs').insert({ bid_id: bidId, label: 'x', amount_jpy: 1 })).error, 'a dealer cannot add a cost line')

    console.log('\n-- deal terms --')
    const set = await staff.c.from('bids').update({ deal_basis: 'cif', offer_jpy: 7200000, show_won_price: false, giveback_jpy: 50000, fixed_charge_jpy: 250000 }).eq('id', bidId)
    ok(!set.error, 'staff set the deal terms')
    const mine = await dealer.c.from('bids').update({ giveback_jpy: 999999 }).eq('id', bidId)
    ok((await admin.from('bids').select('giveback_jpy').eq('id', bidId).single()).data.giveback_jpy == 50000 && (!!mine.error || true), 'a dealer cannot change the deal terms of their own order')
    await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'won', p_final: 6700000 })
    const after = (await admin.from('bids').select('deal_basis,offer_jpy,giveback_jpy,status').eq('id', bidId).single()).data
    ok(after.status === 'won' && after.deal_basis === 'cif' && after.offer_jpy == 7200000, 'winning the car keeps the deal terms')
  } finally {
    if (lotId) { await admin.from('order_costs').delete().in('bid_id', (await admin.from('bids').select('id').eq('lot_id', lotId)).data?.map((b) => b.id) || []) }
    for (const id of made) await admin.from('bids').delete().eq('ap_id', id)
    if (lotId) await admin.from('lots').delete().eq('id', lotId)
    await admin.from('rate_card').delete().like('party', 'AIM TEST%')
    await admin.from('notifications').delete().or('body.ilike.%AIM TEST%,title.ilike.%TESTBRAND%,title.ilike.%TEST CAR%')
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log('\ntest users, car, bids, rates and cost lines deleted')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

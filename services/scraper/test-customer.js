'use strict'

/**
 * test-customer.js — the walk-in customer role with real logins: a viewing pass, sign-up with a code, the filtered cars, the time limit, and what a customer can NOT reach.
 * Temporary users, 4 temporary cars, passes and picks, all DELETED at the end. Needs migration 33.
 *
 *   node test-customer.js
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
  const made = [], lots = []
  try {
    const probe = await admin.from('customer_passes').select('id').limit(1)
    if (probe.error) throw new Error('migration 33 is not applied yet (' + probe.error.message + ')')

    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)
    const dealer = await makeUser('dealer', { role: 'ap_holder', status: 'active', tier: 'member' }); made.push(dealer.id)
    const cust = await makeUser('customer', null); made.push(cust.id)        // a brand-new sign-up: role ap_holder, status pending
    const cust2 = await makeUser('customer2', null); made.push(cust2.id)

    const Y = new Date().getFullYear(), day = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 5 * 3600_000).toISOString()
    const mk = async (model, year, km, brand = 'TESTBRAND') => {
      const l = await admin.from('lots').insert({ venue: 'AIMTEST', auction_date: day, lot_no: model.replace(/\s/g, '') + year + Date.now(), bid_deadline: soon, brand, model, mfg_year: year, mileage_km: km }).select('id').single()
      if (l.error) throw new Error(l.error.message)
      lots.push(l.data.id); return l.data.id
    }
    const A = await mk('ZZVELL 2.5 Z', Y - 1, 20000)          // fits
    const B = await mk('ZZVELL 2.5 X', Y - 4, 30000)          // too old for the pass
    const C = await mk('ZZHARR PREMIUM', Y - 1, 15000)        // other model
    const D = await mk('ZZVELL 3.5 ZG', Y - 1, 90000)         // too many km
    await admin.from('lot_features').insert([{ lot_id: A, key: 'jbl', label: 'JBL audio', source: 'factory' }])

    console.log('\n-- pass and sign-up --')
    const pass = await staff.c.from('customer_passes').insert({ label: 'AIM TEST Mr Tan', phone: '000', hours: 2, filters: { brands: ['TESTBRAND'], models: ['ZZVELL'], year_from: Y - 2, max_mileage: 60000 } }).select('id,code').single()
    ok(!pass.error && pass.data.code?.length === 10, 'staff create a viewing pass with a code')
    ok(((await dealer.c.from('customer_passes').select('id')).data || []).length === 0, 'a dealer cannot see passes')
    const early = await cust.c.rpc('customer_cars')
    ok(Array.isArray(early.data) && early.data.length === 0, 'before the code is used the account sees no cars')
    const bad = await cust.c.rpc('redeem_customer_pass', { p_code: 'WRONGCODE1' })
    ok(!!bad.error, 'a wrong code is refused')
    const dealerTry = await dealer.c.rpc('redeem_customer_pass', { p_code: pass.data.code })
    ok(!!dealerTry.error, 'an active dealer CANNOT turn themselves into a customer with a code')
    const good = await cust.c.rpc('redeem_customer_pass', { p_code: pass.data.code.toLowerCase() })
    ok(!good.error, 'the customer uses the code (lower case is fine)' + (good.error ? ': ' + good.error.message : ''))
    const prof = (await admin.from('profiles').select('role,status,expires_at,contact_name').eq('id', cust.id).single()).data
    const hrs = (new Date(prof.expires_at) - Date.now()) / 3600_000
    ok(prof.role === 'customer' && prof.status === 'active' && hrs > 1.9 && hrs <= 2.01, 'the account is now a customer account for 2 hours (' + hrs.toFixed(2) + ' h left)')
    const again = await cust2.c.rpc('redeem_customer_pass', { p_code: pass.data.code })
    ok(!!again.error, 'the code works only once')
    const sal = await staff.c.from('notifications').select('title').eq('kind', 'customer_started')
    ok((sal.data || []).some((n) => n.title.includes('AIM TEST Mr Tan')), 'staff are told the customer started')

    console.log('\n-- what the customer sees --')
    const cars = (await cust.c.rpc('customer_cars')).data || []
    const ids = cars.map((c) => c.id)
    ok(ids.includes(A) && !ids.includes(B) && !ids.includes(C) && !ids.includes(D), 'only the car that fits every filter (model, year, mileage): ' + cars.length + ' car(s)')
    const one = cars.find((c) => c.id === A) || {}
    ok(!('start_price_jpy' in one) && !('venue' in one) && !('lot_no' in one) && !('sheet_url' in one) && !('model_code' in one), 'no price, venue, lot number, auction sheet or chassis code in what is sent')
    ok(one.features?.some((x) => x.key === 'jbl'), 'the car comes with its features')
    ok((await cust.c.rpc('customer_car', { p_id: A })).data?.id === A, 'the customer opens the car that fits')
    ok((await cust.c.rpc('customer_car', { p_id: C })).data == null, 'the customer CANNOT open a car outside the filters, even with its id')
    ok(((await cust.c.from('lots').select('id').in('id', [A, B, C, D])).data || []).length === 0, 'the customer CANNOT read the cars table directly')
    ok(((await cust.c.from('lot_history').select('id').limit(1)).data || []).length === 0, 'no sold history')
    ok(((await cust.c.from('market_stats').select('as_of').limit(1)).data || []).length === 0, 'no market prices')
    ok(((await cust.c.from('profiles').select('id').neq('id', cust.id)).data || []).length === 0, 'no other accounts')
    ok(((await cust.c.from('bids').select('id').limit(1)).data || []).length === 0, 'no bid orders')
    const bidTry = await cust.c.rpc('place_bid', { p_lot: A, p_max: 5000000 })
    ok(!!bidTry.error || !bidTry.data, 'the customer CANNOT place a bid' + (bidTry.error ? ' (' + bidTry.error.message + ')' : ''))
    const ext = await cust.c.from('profiles').update({ expires_at: new Date(Date.now() + 99 * 3600_000).toISOString() }).eq('id', cust.id)
    const hrs2 = (new Date((await admin.from('profiles').select('expires_at').eq('id', cust.id).single()).data.expires_at) - Date.now()) / 3600_000
    ok(!!ext.error && hrs2 < 2.01, 'the customer CANNOT extend their own time')
    const widen = await cust.c.from('profiles').update({ customer_filters: {} }).eq('id', cust.id)
    ok(!!widen.error, 'the customer CANNOT widen their own filters')
    const roleUp = await cust.c.from('profiles').update({ role: 'staff' }).eq('id', cust.id)
    ok(!!roleUp.error, 'the customer CANNOT change their role')

    console.log('\n-- likes --')
    ok(!(await cust.c.from('customer_picks').insert({ customer_id: cust.id, lot_id: A })).error, 'the customer likes a car')
    ok((await staff.c.from('notifications').select('title').eq('kind', 'customer_pick')).data?.some((n) => n.title.includes('ZZVELL')), 'staff get an alert about it')
    ok(((await staff.c.from('customer_picks').select('lot_id').eq('customer_id', cust.id)).data || []).length === 1, 'staff see what the customer liked')
    ok(((await cust2.c.from('customer_picks').select('lot_id')).data || []).length === 0, 'another account does not')

    console.log('\n-- staff preview and extend --')
    const prev = await staff.c.rpc('customer_cars', { p_filters: { brands: ['TESTBRAND'], models: ['ZZHARR'] } })
    ok((prev.data || []).length === 1 && prev.data[0].id === C, 'staff can preview the cars of a filter before making the pass')
    const dealerPrev = await dealer.c.rpc('customer_cars', { p_filters: { brands: ['TESTBRAND'] } })
    ok((dealerPrev.data || []).length === 0, 'a dealer cannot use the preview')
    const ext2 = await staff.c.from('profiles').update({ expires_at: new Date(Date.now() + 30 * 3600_000).toISOString() }).eq('id', cust.id)
    ok(!ext2.error, 'staff extend the access')

    console.log('\n-- time is up --')
    await admin.from('profiles').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', cust.id)
    ok(((await cust.c.rpc('customer_cars')).data || []).length === 0, 'after the time the cars are gone at once')
    ok((await cust.c.rpc('customer_car', { p_id: A })).data == null, 'and the car page too')
    ok(!!(await cust.c.from('customer_picks').insert({ customer_id: cust.id, lot_id: D })).error, 'and the customer cannot like more cars')
    const late = await cust2.c.rpc('redeem_customer_pass', { p_code: pass.data.code })
    ok(!!late.error, 'an expired customer\'s code cannot be reused by someone else')
  } finally {
    await admin.from('customer_picks').delete().in('lot_id', lots.length ? lots : ['00000000-0000-0000-0000-000000000000'])
    for (const id of lots) await admin.from('lots').delete().eq('id', id)
    await admin.from('customer_passes').delete().like('label', 'AIM TEST%')
    await admin.from('notifications').delete().or('title.ilike.%AIM TEST%,title.ilike.%ZZVELL%')
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log('\ntest users, cars, passes, picks and alerts deleted')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

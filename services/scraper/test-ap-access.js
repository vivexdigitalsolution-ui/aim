'use strict'

/**
 * test-ap-access.js — proves what an AP holder can and cannot see, with a real temporary AP login.
 * Creates a throw-away user (service key), signs in as that user with the public key, runs the checks, then DELETES the user.
 * Nothing else is changed. The public key is read from apps/aim/.env (NUXT_PUBLIC_SUPABASE_KEY).
 *
 *   node test-ap-access.js
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')
const admin = require('./lib/db')

const envFile = fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'aim', '.env'), 'utf8')
const anonKey = (envFile.match(/^NUXT_PUBLIC_SUPABASE_KEY=(.+)$/m) || [])[1]?.trim()
if (!anonKey) { console.error('NUXT_PUBLIC_SUPABASE_KEY not found in apps/aim/.env'); process.exit(1) }

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

async function main() {
  const email = `aim-test-ap-${Date.now()}@example.invalid`, password = 'T' + Math.random().toString(36).slice(2) + 'x9Q!'
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { company_name: 'AIM TEST (auto-deleted)' } })
  if (made.error) throw new Error('could not create the test user: ' + made.error.message)
  const uid = made.data.user.id
  try {
    const setProfile = async (patch) => { const { error } = await admin.from('profiles').update(patch).eq('id', uid); if (error) throw new Error(error.message) }
    await new Promise((r) => setTimeout(r, 800))   // the sign-up trigger makes the profile
    await setProfile({ role: 'ap_holder', status: 'active', tier: 'member' })

    const ap = createClient(process.env.SUPABASE_URL, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const si = await ap.auth.signInWithPassword({ email, password })
    if (si.error) throw new Error('test sign-in failed: ' + si.error.message)

    // a few open lots that have a cost row, and what staff know about them
    const { data: staffCosts } = await admin.from('lot_costs').select('lot_id,duty_myr,lots!inner(bid_deadline,my_eligible)').gt('lots.bid_deadline', new Date().toISOString()).eq('lots.my_eligible', true).limit(5)
    const ids = (staffCosts || []).map((r) => r.lot_id)
    const { data: pre } = await admin.from('calc_presets').select('preset_key,amount').in('preset_key', ['offer_port_myr', 'offer_inland_myr', 'fx_jpy_myr'])
    const pv = (k, d) => { const r = (pre || []).find((x) => x.preset_key === k); return r ? Number(r.amount) : d }
    console.log(`(test data: ${ids.length} open lots with a cost row)`)

    console.log('\n-- member tier --')
    const lots = await ap.from('lots').select('id').limit(3)
    ok(!lots.error && lots.data.length > 0, 'member can read the open auction lots')
    const direct = await ap.from('lot_costs').select('lot_id,duty_myr').limit(5)
    ok((direct.data || []).length === 0, 'member CANNOT read lot_costs directly (no duty rows)')
    const dock = await ap.from('custom_dockets').select('id').limit(3)
    ok((dock.data || []).length === 0, 'member CANNOT read the docket book')
    const rc = await ap.rpc('ap_lot_costs', { p_lot_ids: ids })
    ok(!rc.error && rc.data.length === ids.length, 'ap_lot_costs returns a cost for each lot' + (rc.error ? ' (' + rc.error.message + ')' : ''))
    if (!rc.error) {
      ok(rc.data.every((r) => Object.keys(r).sort().join() === 'fixed_myr,lot_id'), 'ap_lot_costs exposes only lot_id and fixed_myr (no duty, no docket)')
      const exact = (staffCosts || []).every((s) => { const r = rc.data.find((x) => x.lot_id === s.lot_id); return r && Math.abs(Number(r.fixed_myr) - Math.round(Number(s.duty_myr) + pv('offer_port_myr', 2500) + pv('offer_inland_myr', 250))) <= 1 })
      ok(exact, 'fixed_myr = duty + port + inland (matches the staff numbers)')
    }
    const rate = await ap.rpc('ap_jpy_rate')
    ok(!rate.error && Number(rate.data) > 0, 'ap_jpy_rate gives a yen rate: ' + rate.data)
    const ms = await ap.from('market_stats').select('ref_id').limit(1)
    ok(!ms.error, 'member can read market_stats (rows: ' + (ms.data || []).length + ')')
    const lc = await ap.from('lot_catalog').select('lot_id').limit(1)
    ok(!lc.error && (lc.data || []).length > 0, 'member can read lot_catalog')
    const wr = await ap.from('lot_catalog').insert({ lot_id: ids[0], level: 'none' })
    ok(!!wr.error, 'member CANNOT write lot_catalog')

    console.log('\n-- an AP changing their own tier --')
    const up = await ap.from('profiles').update({ tier: 'partner' }).eq('id', uid)
    const after = (await admin.from('profiles').select('tier').eq('id', uid).single()).data.tier
    ok(after === 'member', 'AP CANNOT raise their own tier (still ' + after + '; ' + (up.error ? up.error.message : 'no error') + ')')

    console.log('\n-- free tier --')
    await setProfile({ tier: 'free' })
    const rcFree = await ap.rpc('ap_lot_costs', { p_lot_ids: ids })
    ok(!!rcFree.error, 'free tier: ap_lot_costs refused')
    const rateFree = await ap.rpc('ap_jpy_rate')
    ok(!!rateFree.error, 'free tier: ap_jpy_rate refused')
    const msFree = await ap.from('market_stats').select('ref_id').limit(1)
    ok((msFree.data || []).length === 0, 'free tier: market_stats shows nothing')
    const lcFree = await ap.from('lot_catalog').select('lot_id').limit(1)
    ok((lcFree.data || []).length === 0, 'free tier: lot_catalog shows nothing')
    const featFree = await ap.from('lot_features').select('lot_id').limit(1)
    ok(!featFree.error && (featFree.data || []).length > 0, 'free tier: Find by feature data still readable')

    console.log('\n-- not approved / suspended --')
    await setProfile({ tier: 'member', status: 'pending' })
    const rcPend = await ap.rpc('ap_lot_costs', { p_lot_ids: ids })
    ok(!!rcPend.error, 'pending account: ap_lot_costs refused')
    await setProfile({ status: 'suspended' })
    const rcSus = await ap.rpc('ap_lot_costs', { p_lot_ids: ids })
    ok(!!rcSus.error, 'suspended account: ap_lot_costs refused')
  } finally {
    const del = await admin.auth.admin.deleteUser(uid)
    console.log('\ntest user ' + (del.error ? 'NOT deleted: ' + del.error.message + ' (' + email + ')' : 'deleted'))
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

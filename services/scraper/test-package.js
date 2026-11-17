'use strict'

/**
 * test-package.js — service levels, volume rebate and the order steps after a win, with real logins.
 * Temporary users, 2 temporary cars, levels, rebate steps, bids and alerts. Real rebate steps are saved first and put back. Everything else is DELETED at the end.
 * Needs migration 29.
 *
 *   node test-package.js
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
const bidFee = async (id) => (await admin.from('bids').select('status,final_price_jpy,agent_fee_jpy,rebate_pct,rebate_jpy,fee_type,fee_value').eq('id', id).single()).data

async function main() {
  const made = [], lots = [], levelIds = []
  let savedRebates = null, ruleId = null
  try {
    const probe = await admin.from('service_levels').select('id').limit(1)
    if (probe.error) throw new Error('migration 29 is not applied yet (' + probe.error.message + ')')
    savedRebates = (await admin.from('volume_rebates').select('*')).data || []
    await admin.from('volume_rebates').delete().gte('min_units', 0)

    const boss = await makeUser('admin', { role: 'admin', status: 'active' }); made.push(boss.id)
    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)
    const a = await makeUser('dealerA', { role: 'ap_holder', status: 'active', tier: 'member', bid_limit_jpy: 30000000 }); made.push(a.id)
    const b = await makeUser('dealerB', { role: 'ap_holder', status: 'active', tier: 'member', bid_limit_jpy: 30000000 }); made.push(b.id)
    for (let i = 0; i < 2; i++) {
      const l = await admin.from('lots').insert({ venue: 'AIMTEST', auction_date: new Date().toISOString().slice(0, 10), lot_no: 'P' + i + Date.now(), bid_deadline: new Date(Date.now() + 5 * 3600_000).toISOString(), brand: 'TESTBRAND', model: 'TEST CAR ' + i, mfg_year: new Date().getFullYear() - 1 }).select('id').single()
      if (l.error) throw new Error(l.error.message)
      lots.push(l.data.id)
    }
    const bid = async (who, lot, max) => (await who.c.rpc('place_bid', { p_lot: lot, p_max: max })).data
    const win = (id, price) => staff.c.rpc('staff_set_bid', { p_bid: id, p_status: 'won', p_final: price })

    console.log('\n-- service levels --')
    const sStaff = await staff.c.from('service_levels').insert({ name: 'AIM TEST L', fee_type: 'flat_jpy', fee_value: 1 })
    ok(!!sStaff.error, 'staff CANNOT create a service level (admin only)')
    const lv = await boss.c.from('service_levels').insert({ name: 'AIM TEST Premium', fee_type: 'flat_jpy', fee_value: 111111 }).select('id').single()
    ok(!lv.error && lv.data.id, 'an admin creates a service level')
    levelIds.push(lv.data.id)
    const own = await a.c.from('profiles').update({ service_level_id: lv.data.id }).eq('id', a.id)
    ok(!!own.error && !(await admin.from('profiles').select('service_level_id').eq('id', a.id).single()).data.service_level_id, 'a dealer CANNOT give themselves a service level' + (own.error ? ' (' + own.error.message + ')' : ''))

    const b0 = await bid(a, lots[0], 4000000)
    await win(b0, 3000000)
    const noLevel = await bidFee(b0)
    const defFee = (await admin.rpc('agent_fee_for', { p_ap: a.id, p_price: 3000000 })).data?.[0]
    ok(Number(noLevel.agent_fee_jpy) === Number(defFee?.fee_jpy), 'no level: the fee is the default rule for the winning price, as before (¥' + Number(noLevel.agent_fee_jpy).toLocaleString('en-US') + ')')
    await staff.c.rpc('staff_set_bid', { p_bid: b0, p_status: 'pending' })

    const set = await staff.c.from('profiles').update({ service_level_id: lv.data.id }).eq('id', a.id)
    ok(!set.error, 'staff give dealer A the Premium level')
    await win(b0, 3000000)
    ok(Number((await bidFee(b0)).agent_fee_jpy) === 111111, 'with the level the fee is the level fee: ¥111,111')
    const rule = await boss.c.from('fee_rules').insert({ name: 'AIM TEST pinned', fee_type: 'flat_jpy', fee_value: 77777, is_default: false, active: true }).select('id').single()
    ruleId = rule.data?.id
    await admin.from('profiles').update({ fee_rule_id: ruleId }).eq('id', a.id)
    await staff.c.rpc('staff_set_bid', { p_bid: b0, p_status: 'pending' })
    await win(b0, 3000000)
    ok(Number((await bidFee(b0)).agent_fee_jpy) === 77777, 'a fee rule pinned to the dealer beats the service level')
    await admin.from('profiles').update({ fee_rule_id: null }).eq('id', a.id)

    console.log('\n-- volume rebate --')
    const rb = await boss.c.from('volume_rebates').insert({ min_units: 2, rebate_pct: 50 })
    ok(!rb.error, 'an admin adds a step: from 2 cars a month, 50% off')
    const rbStaff = await staff.c.from('volume_rebates').insert({ min_units: 3, rebate_pct: 60 })
    ok(!!rbStaff.error, 'staff CANNOT add a rebate step')
    await staff.c.rpc('staff_set_bid', { p_bid: b0, p_status: 'pending' })
    await win(b0, 3000000)
    const first = await bidFee(b0)
    ok(Number(first.agent_fee_jpy) === 111111 && !first.rebate_pct, 'the first car of the month: full fee, no rebate')
    const b1 = await bid(a, lots[1], 4000000)
    await win(b1, 3200000)
    const second = await bidFee(b1)
    ok(Number(second.agent_fee_jpy) === 55556 && Number(second.rebate_pct) === 50 && Number(second.rebate_jpy) === 55555, 'the second car in the month: 50% off (fee ¥' + Number(second.agent_fee_jpy).toLocaleString('en-US') + ', rebate ¥' + Number(second.rebate_jpy).toLocaleString('en-US') + ')')
    await staff.c.rpc('staff_set_bid', { p_bid: b1, p_status: 'pending' })
    const cleared = await bidFee(b1)
    ok(cleared.agent_fee_jpy === null && cleared.rebate_pct === null && cleared.rebate_jpy === null, 'back to waiting clears the fee and the rebate')
    const bB = await bid(b, lots[1], 4000000)
    await win(bB, 3200000)
    ok(!(await bidFee(bB)).rebate_pct, 'dealer B (first car this month) gets no rebate: the count is per dealer')

    console.log('\n-- order steps after a win --')
    const st = await staff.c.from('order_updates').insert({ bid_id: b0, stage: 'paid', note: 'Received, thank you' })
    ok(!st.error, 'staff add the step "payment received"' + (st.error ? ': ' + st.error.message : ''))
    const al = await a.c.from('notifications').select('title,body').eq('kind', 'order_stage')
    ok(al.data?.some((n) => n.title.startsWith('Payment received') && n.body === 'Received, thank you'), 'the dealer gets an alert with the step and the note')
    ok(((await a.c.from('order_updates').select('id').eq('bid_id', b0)).data || []).length === 1, 'the dealer sees the timeline of their own car')
    ok(((await b.c.from('order_updates').select('id').eq('bid_id', b0)).data || []).length === 0, 'another dealer does NOT')
    const forge = await a.c.from('order_updates').insert({ bid_id: b0, stage: 'delivered' })
    ok(!!forge.error, 'a dealer CANNOT add a step to their own order')
    const badStage = await staff.c.from('order_updates').insert({ bid_id: b0, stage: 'teleported' })
    ok(!!badStage.error, 'an unknown step is refused')
  } finally {
    for (const id of made) await admin.from('bids').delete().eq('ap_id', id)
    for (const id of lots) await admin.from('lots').delete().eq('id', id)
    await admin.from('profiles').update({ service_level_id: null, fee_rule_id: null }).in('id', made)
    for (const id of levelIds) await admin.from('service_levels').delete().eq('id', id)
    await admin.from('service_levels').delete().like('name', 'AIM TEST%')
    await admin.from('fee_rules').delete().like('name', 'AIM TEST%')
    await admin.from('volume_rebates').delete().gte('min_units', 0)
    if (savedRebates?.length) await admin.from('volume_rebates').insert(savedRebates)
    await admin.from('notifications').delete().or('body.ilike.%AIM TEST%,title.ilike.%TESTBRAND%,title.ilike.%TEST CAR%')
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log('\ntest users, cars, bids, levels and alerts deleted; real rebate steps put back (' + (savedRebates?.length || 0) + ')')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

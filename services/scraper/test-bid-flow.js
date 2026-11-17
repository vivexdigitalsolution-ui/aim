'use strict'

/**
 * test-bid-flow.js — the whole bid pipeline with real logins: a temporary dealer places / changes a bid order in the lite way,
 * a temporary staff user works it in the pipeline way (placed, won), and the dealer sees the result. Both users and their bids are DELETED at the end.
 *
 *   node test-bid-flow.js
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

async function makeUser(label, patch) {
  const email = `aim-test-${label}-${Date.now()}@example.invalid`, password = 'T' + Math.random().toString(36).slice(2) + 'x9Q!'
  const r = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { company_name: 'AIM TEST ' + label + ' (auto-deleted)' } })
  if (r.error) throw new Error(r.error.message)
  await new Promise((s) => setTimeout(s, 800))
  const u = await admin.from('profiles').update(patch).eq('id', r.data.user.id)
  if (u.error) throw new Error(u.error.message)
  const c = client()
  const si = await c.auth.signInWithPassword({ email, password })
  if (si.error) throw new Error(si.error.message)
  return { id: r.data.user.id, c }
}

async function main() {
  const made = []
  try {
    const dealer = await makeUser('dealer', { role: 'ap_holder', status: 'active', tier: 'free', bid_limit_jpy: 20000000, open_limit_jpy: 30000000 }); made.push(dealer.id)
    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)

    const { data: lots } = await admin.from('lots').select('id,brand,model,start_price_jpy').gt('bid_deadline', new Date(Date.now() + 3600_000).toISOString()).eq('my_eligible', true).order('bid_deadline').limit(1)
    if (!lots?.length) throw new Error('no open lot to test with')
    const lot = lots[0]
    console.log(`(test car: ${lot.brand} ${lot.model})`)

    console.log('\n-- the dealer (lite app) --')
    const rate = await dealer.c.rpc('lite_jpy_rate')
    ok(!rate.error && Number(rate.data) > 0, 'lite_jpy_rate works for a free-tier dealer: ' + (rate.error ? rate.error.message : rate.data) + '  (needs migration 22)')
    const placed = await dealer.c.rpc('place_bid', { p_lot: lot.id, p_max: 3500000, p_note: 'test order' })
    ok(!placed.error && placed.data, 'dealer places a bid order' + (placed.error ? ': ' + placed.error.message : ''))
    const bidId = placed.data
    const again = await dealer.c.rpc('place_bid', { p_lot: lot.id, p_max: 3600000 })
    ok(!again.error && again.data === bidId, 'placing again changes the same order (one open order per car)')
    const tooBig = await dealer.c.rpc('place_bid', { p_lot: lot.id, p_max: 99000000 })
    ok(!!tooBig.error, 'a bid above the dealer limit is refused: ' + (tooBig.error?.message || ''))
    const mine = await dealer.c.from('bids').select('id,max_bid_jpy,status').eq('lot_id', lot.id)
    ok(mine.data?.length === 1 && Number(mine.data[0].max_bid_jpy) === 3600000 && mine.data[0].status === 'pending', 'dealer sees one pending order of ¥3,600,000')
    const sneaky = await dealer.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'won', p_final: 1 })
    ok(!!sneaky.error, 'a dealer CANNOT mark their own bid as won: ' + (sneaky.error?.message || ''))
    const direct = await dealer.c.from('bids').update({ status: 'won' }).eq('id', bidId)
    const chk = await admin.from('bids').select('status').eq('id', bidId).single()
    ok(chk.data.status === 'pending', 'a dealer CANNOT write the bids table directly' + (direct.error ? ' (' + direct.error.message + ')' : ''))

    console.log('\n-- staff (bid pipeline) --')
    const q = await staff.c.from('bids').select('id,max_bid_jpy,status,ap:profiles!ap_id(company_name,open_limit_jpy),lots(brand,model,venue,lot_no,bid_deadline)').eq('id', bidId).single()
    ok(!q.error && q.data.ap?.company_name?.includes('AIM TEST dealer') && q.data.lots?.lot_no, 'staff see the order with the dealer and the car (the pipeline query)' + (q.error ? ': ' + q.error.message : ''))
    const pl = await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'placed', p_note: 'placed at 10:00' })
    ok(!pl.error, 'staff mark it placed' + (pl.error ? ': ' + pl.error.message : ''))
    const cancel = await dealer.c.rpc('cancel_bid', { p_bid: bidId })
    ok(!!cancel.error, 'once placed, the dealer CANNOT cancel: ' + (cancel.error?.message || ''))
    const change = await dealer.c.rpc('place_bid', { p_lot: lot.id, p_max: 1 })
    ok(!!change.error, 'once placed, the dealer CANNOT change it: ' + (change.error?.message || ''))
    const noPrice = await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'won' })
    ok(!!noPrice.error, 'a win needs the winning price: ' + (noPrice.error?.message || ''))
    const won = await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'won', p_final: 3400000, p_note: 'Congratulations' })
    ok(!won.error, 'staff record the win at ¥3,400,000' + (won.error ? ': ' + won.error.message : ''))

    console.log('\n-- the dealer sees the result --')
    const res = await dealer.c.from('bids').select('status,final_price_jpy,team_note,agent_fee_jpy').eq('id', bidId).single()
    ok(res.data?.status === 'won' && Number(res.data.final_price_jpy) === 3400000 && res.data.team_note === 'Congratulations', 'dealer sees: won at ¥3,400,000 with the team note')
    console.log('   (agent fee recorded: ¥' + Number(res.data?.agent_fee_jpy || 0).toLocaleString('en-US') + ')')
    const back = await staff.c.rpc('staff_set_bid', { p_bid: bidId, p_status: 'pending' })
    const after = await admin.from('bids').select('status,final_price_jpy,agent_fee_jpy').eq('id', bidId).single()
    ok(!back.error && after.data.status === 'pending' && after.data.final_price_jpy === null && after.data.agent_fee_jpy === null, 'back to waiting clears the price and the fee')
  } finally {
    for (const id of made) { await admin.from('bids').delete().eq('ap_id', id) }
    await admin.from('notifications').delete().ilike('body', '%AIM TEST%')    // alerts the test bids sent to real staff (migration 27 triggers)
    for (const id of made) { const d = await admin.auth.admin.deleteUser(id); if (d.error) console.log('NOT deleted:', id, d.error.message) }
    console.log('\ntest users and their bids deleted')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

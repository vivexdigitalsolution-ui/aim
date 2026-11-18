'use strict'

/**
 * test-extras.js — history price access, segments, watchlist and draft personal lists, with real logins.
 * Temporary users, 1 temporary car, 1 temporary history row, 1 temporary segment. Everything is DELETED at the end.
 * Needs migration 30.
 *
 *   node test-extras.js
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
  let lotId = null, histId = null
  try {
    const probe = await admin.from('watchlist').select('ap_id').limit(1)
    if (probe.error) throw new Error('migration 30 is not applied yet (' + probe.error.message + ')')

    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)
    const mem = await makeUser('member', { role: 'ap_holder', status: 'active', tier: 'member' }); made.push(mem.id)
    const other = await makeUser('member2', { role: 'ap_holder', status: 'active', tier: 'member' }); made.push(other.id)
    const free = await makeUser('free', { role: 'ap_holder', status: 'active', tier: 'free' }); made.push(free.id)

    const lot = await admin.from('lots').insert({ venue: 'AIMTEST', auction_date: new Date().toISOString().slice(0, 10), lot_no: 'X' + Date.now(), bid_deadline: new Date(Date.now() + 2 * 3600_000).toISOString(), brand: 'TESTBRAND', model: 'TEST CAR', mfg_year: new Date().getFullYear() - 1 }).select('id').single()
    if (lot.error) throw new Error(lot.error.message)
    lotId = lot.data.id
    const h = await admin.from('lot_history').insert({ venue: 'AIMTEST', auction_date: new Date().toISOString().slice(0, 10), lot_no: 'H' + Date.now(), brand: 'TESTBRAND', model: 'TEST CAR', grade: '4.5', result: 'sold', sold_price_jpy: 1234000 }).select('id').single()
    if (h.error) throw new Error(h.error.message)
    histId = h.data.id

    console.log('\n-- history price --')
    ok(((await mem.c.from('lot_history').select('id').eq('id', histId)).data || []).length === 1, 'a Member dealer can read the sold history')
    ok(((await staff.c.from('lot_history').select('id').eq('id', histId)).data || []).length === 1, 'staff can read it')
    ok(((await free.c.from('lot_history').select('id').eq('id', histId)).data || []).length === 0, 'a Free dealer cannot')

    console.log('\n-- segments --')
    const seg = await staff.c.from('segments').insert({ key: 'aimtest', label: 'AIM TEST', sort: 99 })
    ok(!seg.error, 'staff create a segment')
    const memSeg = await mem.c.from('segments').insert({ key: 'aimtest2', label: 'HACK', sort: 99 })
    ok(!!memSeg.error, 'a dealer CANNOT create a segment')
    const ent = await staff.c.from('segment_models').insert({ segment_key: 'aimtest', brand: 'TESTBRAND', model: '' })
    ok(!ent.error, 'staff add a car to it')
    ok(((await mem.c.from('segment_models').select('id').eq('segment_key', 'aimtest')).data || []).length === 1, 'a dealer can read the segments (to pick them)')
    const memEnt = await mem.c.from('segment_models').insert({ segment_key: 'aimtest', brand: 'HACK', model: '' })
    ok(!!memEnt.error, 'a dealer CANNOT change what is in a segment')
    const bl = await mem.c.from('buy_lists').upsert({ ap_id: mem.id, segments: ['aimtest'], min_margin_pct: 10 }, { onConflict: 'ap_id' })
    ok(!bl.error && (await admin.from('buy_lists').select('segments').eq('ap_id', mem.id).single()).data.segments[0] === 'aimtest', 'a Member saves a buy list with a segment')

    console.log('\n-- watchlist --')
    const w1 = await mem.c.from('watchlist').insert({ ap_id: mem.id, lot_id: lotId })
    ok(!w1.error, 'a dealer stars a car')
    const w2 = await free.c.from('watchlist').insert({ ap_id: free.id, lot_id: lotId })
    ok(!w2.error, 'a Free dealer can star a car too')
    ok(((await other.c.from('watchlist').select('lot_id').eq('lot_id', lotId)).data || []).length === 0, 'another dealer does NOT see it')
    const forge = await other.c.from('watchlist').insert({ ap_id: mem.id, lot_id: lotId })
    ok(!!forge.error, 'a dealer CANNOT star a car on someone else\'s list')
    const un = await mem.c.from('watchlist').delete().eq('lot_id', lotId)
    ok(!un.error && ((await admin.from('watchlist').select('lot_id').eq('ap_id', mem.id)).data || []).length === 0, 'the dealer removes the star')

    console.log('\n-- draft personal lists --')
    const dr = await staff.c.from('dealer_lists').insert({ ap_id: mem.id, draft: true, auto: true, items: [{ lot_id: lotId, title: 'TEST' }] }).select('id,token').single()
    ok(!dr.error, 'staff save a draft list')
    ok(((await mem.c.from('dealer_lists').select('id').eq('id', dr.data.id)).data || []).length === 0, 'the dealer does NOT see a draft')
    const anon = createClient(process.env.SUPABASE_URL, anonKey, { auth: { persistSession: false } })
    ok((await anon.rpc('dealer_list_get', { p_token: dr.data.token })).data == null, 'the link of a draft does not open')
    const send = await staff.c.from('dealer_lists').update({ draft: false }).eq('id', dr.data.id)
    ok(!send.error, 'staff press Send')
    ok(((await mem.c.from('dealer_lists').select('id').eq('id', dr.data.id)).data || []).length === 1, 'now the dealer sees the list')
    ok((await anon.rpc('dealer_list_get', { p_token: dr.data.token })).data?.items?.length === 1, 'and the link opens')
    const memDraft = await mem.c.from('dealer_lists').insert({ ap_id: mem.id, draft: false, items: [] })
    ok(!!memDraft.error, 'a dealer CANNOT write a list for themselves')
  } finally {
    if (lotId) await admin.from('lots').delete().eq('id', lotId)
    if (histId) await admin.from('lot_history').delete().eq('id', histId)
    await admin.from('segments').delete().like('key', 'aimtest%')
    for (const id of made) { await admin.from('dealer_lists').delete().eq('ap_id', id); await admin.from('buy_lists').delete().eq('ap_id', id); await admin.from('watchlist').delete().eq('ap_id', id) }
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log('\ntest users, car, history row, segment, lists deleted')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

'use strict'

/**
 * test-market-manual.js — hand-entered market prices with real logins: a temporary staff user enters prices, a member dealer reads them,
 * a free dealer and a member dealer cannot write. Test rows and users are DELETED at the end. Needs migration 25 and `node link-lots.js --write`.
 *
 *   node test-market-manual.js
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
  let refId = null
  try {
    const idx = await admin.from('catalog_index').select('*').eq('level', 'variant').limit(1)
    if (idx.error) throw new Error('catalog_index is not ready: run migration 25 and  node link-lots.js --write  (' + idx.error.message + ')')
    if (!idx.data.length) throw new Error('catalog_index is empty: run  node link-lots.js --write')
    const pick = idx.data[0]; refId = pick.ref_id
    console.log(`(test car: ${pick.brand} ${pick.model} ${pick.variant})`)
    const staff = await makeUser('staff', { role: 'staff', status: 'active' }); made.push(staff.id)
    const member = await makeUser('member', { role: 'ap_holder', status: 'active', tier: 'member' }); made.push(member.id)
    const free = await makeUser('free', { role: 'ap_holder', status: 'active', tier: 'free' }); made.push(free.id)

    const row = (year, mid) => ({ level: 'variant', ref_id: refId, brand_id: pick.brand_id, model_id: pick.model_id, variant_id: refId, brand: pick.brand, model_key: pick.model, variant_name: pick.variant, year_from: year - 1, year_to: year + 1, n: 4, sellers: 1, min_myr: 180000, p25_myr: 180000, median_myr: mid, p75_myr: 230000, max_myr: 230000, avg_km: null, as_of: new Date().toISOString().slice(0, 10), source: 'manual', note: 'AIM TEST' })

    console.log('\n-- staff enter prices --')
    const ins = await staff.c.from('market_stats').insert([row(2022, 200000), row(2023, 210000)])
    ok(!ins.error, 'staff save hand-checked prices for two years' + (ins.error ? ': ' + ins.error.message : ''))
    const del = await staff.c.from('market_stats').delete().eq('source', 'manual').eq('ref_id', refId).eq('year_from', 2021)
    const left = await admin.from('market_stats').select('year_from').eq('source', 'manual').eq('ref_id', refId)
    ok(!del.error && left.data.length === 1, 'staff delete one of them (the replace step of the page)')
    const upd = await staff.c.from('market_stats').insert(row(2022, 205000))
    ok(!upd.error, 'staff save the replacement')

    console.log('\n-- dealers --')
    const mRead = await member.c.from('market_stats').select('median_myr,note').eq('source', 'manual').eq('ref_id', refId)
    ok(!mRead.error && mRead.data.length === 2 && mRead.data.some((r) => Number(r.median_myr) === 205000), 'a member dealer reads the hand-checked prices')
    const mIdx = await member.c.from('catalog_index').select('ref_id').limit(1)
    ok(!mIdx.error && mIdx.data.length === 1, 'a member dealer can read the catalog names')
    const mWrite = await member.c.from('market_stats').insert(row(2024, 999999))
    ok(!!mWrite.error, 'a member dealer CANNOT enter a price' + (mWrite.error ? ' (' + mWrite.error.message + ')' : ''))
    const mDel = await member.c.from('market_stats').delete().eq('ref_id', refId)
    const still = await admin.from('market_stats').select('year_from').eq('source', 'manual').eq('ref_id', refId)
    ok(still.data.length === 2, 'a member dealer CANNOT delete prices')
    const fRead = await free.c.from('market_stats').select('median_myr').eq('ref_id', refId)
    ok((fRead.data || []).length === 0, 'a free dealer sees no market prices at all')
    const fIdx = await free.c.from('catalog_index').select('ref_id').limit(1)
    ok((fIdx.data || []).length === 0, 'a free dealer sees no catalog index')
    void mDel
  } finally {
    if (refId) await admin.from('market_stats').delete().eq('source', 'manual').eq('ref_id', refId).eq('note', 'AIM TEST')
    for (const id of made) await admin.auth.admin.deleteUser(id)
    console.log('\ntest prices removed, test users deleted')
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

'use strict'

/**
 * link-lots.js — links every open auction lot to the CarzNexus catalog (brand_id / model_id / variant_id) into public.lot_catalog.
 * Matching is by chassis code + grade words only (core linkLot); anything it cannot say for sure stays at model level or unlinked. No guessing.
 * The catalog is read through the read-only views aim.catalog_variants / aim.catalog_aliases (CARZNEXUS_DB_URL).
 *
 *   node link-lots.js            show the result (nothing written)
 *   node link-lots.js --write    save to lot_catalog
 *   node link-lots.js --all      every lot, not only the open ones
 */

require('dotenv').config()
const path = require('path')
const { pathToFileURL } = require('url')
const supabase = require('./lib/db')
const WRITE = process.argv.includes('--write')
const ALL = process.argv.includes('--all')

async function main() {
  const url = process.env.CARZNEXUS_DB_URL
  if (!url) { console.log('CARZNEXUS_DB_URL is empty in .env'); process.exit(1) }
  const { Client } = require('pg')
  const core = await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'index.ts')).href)
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()
  await db.query('set default_transaction_read_only = on')
  const cat = (await db.query('select brand_id, model_id, model, model_code, variant_id, variant, variant_ja from aim.catalog_variants')).rows
  const ali = (await db.query('select variant_id, name from aim.catalog_aliases')).rows
  await db.end()
  console.log(`catalog: ${cat.length} variants, ${ali.length} alternate spellings`)

  // the database hands out 1000 rows at a time: read page after page
  const lots = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from('lots').select('id, brand, model, model_code, bid_deadline').order('bid_deadline').order('id')
    if (!ALL) q = q.gt('bid_deadline', new Date().toISOString())
    const { data, error } = await q.range(from, from + 999)
    if (error) throw new Error(error.message)
    lots.push(...data)
    if (data.length < 1000) break
  }

  const out = [], tally = { variant: 0, model: 0, none: 0 }, why = {}
  for (const l of lots) {
    const r = core.linkLot(cat, ali, l)
    tally[r.level]++
    if (r.level !== 'variant') why[r.how] = (why[r.how] || 0) + 1
    out.push({ lot_id: l.id, brand_id: r.brandId, model_id: r.modelId, variant_id: r.variantId, level: r.level, how: r.how })
  }
  console.log(`${lots.length} lots: ${tally.variant} linked to a variant, ${tally.model} to a model only, ${tally.none} not linked`)
  Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([k, n]) => console.log(`  ${n}  ${k}`))

  if (!WRITE) { console.log('\nDry run: nothing written. Run with --write to save.'); return }
  for (let i = 0; i < out.length; i += 500) {
    const { error: e } = await supabase.from('lot_catalog').upsert(out.slice(i, i + 500), { onConflict: 'lot_id' })
    if (e) throw new Error(/lot_catalog/.test(e.message) ? 'lot_catalog does not exist yet: run supabase/migrations/20_catalog_links.sql first.' : e.message)
  }
  console.log(`\nSaved ${out.length} links to lot_catalog.`)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

'use strict'

/**
 * market-snapshot.js — builds the Malaysian market statistics (public.market_stats) from CarzNexus listings, BY CATALOG IDS.
 * READ-ONLY on CarzNexus (SELECTs on the aim.* views); writes only aggregated numbers to the AIM database:
 * count, dealers, min / quartiles / median / max of the ASKING (customer) price and average mileage, per variant (or model) and year window.
 * A listing counts only when CarzNexus has linked it (variant_id / model_id). No link = no price yet. Every dealer counts, no minimum.
 * Dealer ids are counted and never stored.
 *
 *   node market-snapshot.js            show what would be written (nothing is written)
 *   node market-snapshot.js --write    replace today's snapshot in market_stats
 *
 * Needs CARZNEXUS_DB_URL in .env (read-only user, see docs/carznexus-readonly-catalog.sql) and migration 20_catalog_links.sql.
 */

require('dotenv').config()
const path = require('path')
const { pathToFileURL } = require('url')
const supabase = require('./lib/db')
const WRITE = process.argv.includes('--write')

async function main() {
  const url = process.env.CARZNEXUS_DB_URL
  if (!url) { console.log('CARZNEXUS_DB_URL is empty in .env'); process.exit(1) }
  const { Client } = require('pg')
  const core = await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'index.ts')).href)
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()
  await db.query('set default_transaction_read_only = on')
  // listed_at (days on market) needs the updated view in docs/carznexus-readonly-catalog.sql; without it the days stay empty
  let rows, hasListed = true
  try { rows = (await db.query('select manufacture_year, asking_price, mileage, seller_tenant_id, brand_id, model_id, variant_id, listed_at from aim.market_source')).rows } catch (e) {
    if (!/listed_at/.test(e.message)) throw e
    hasListed = false; rows = (await db.query('select manufacture_year, asking_price, mileage, seller_tenant_id, brand_id, model_id, variant_id from aim.market_source')).rows
    console.log('  (days on market: re-run docs/carznexus-readonly-catalog.sql in CarzNexus to add the listing date)')
  }
  const cat = (await db.query('select brand_id, brand, model_id, model, variant_id, variant from aim.catalog_variants')).rows
  await db.end()

  const brand = new Map(), model = new Map(), variant = new Map()
  for (const c of cat) { brand.set(c.brand_id, c.brand); model.set(c.model_id, c.model); variant.set(c.variant_id, c.variant) }
  const linked = rows.filter((r) => r.variant_id || r.model_id)
  console.log(`${rows.length} active CarzNexus listings read, ${linked.length} linked to the catalog (${rows.filter((r) => r.variant_id).length} to a variant)`)
  if (!linked.length) console.log('  No listing is linked yet: no market price can be made. Prices appear as soon as CarzNexus links its listings.')

  const raw = linked.map((r) => ({ price: Number(r.asking_price), year: r.manufacture_year, km: r.mileage, seller: String(r.seller_tenant_id || ''), brandId: r.brand_id, modelId: r.model_id, variantId: r.variant_id, listedAt: hasListed ? r.listed_at : null }))
  const today = new Date().toISOString().slice(0, 10)
  const out = core.buildIdMarketRows(raw, today, { brand: (id) => brand.get(id) || '', model: (id) => model.get(id) || '', variant: (id) => variant.get(id) || null })
  const comps = core.buildComps(raw, new Date().toISOString().slice(0, 10))
  console.log(`${out.length} market rows (${out.filter((r) => r.level === 'variant').length} by variant, ${out.filter((r) => r.level === 'model').length} by model)`)
  out.sort((a, b) => b.n - a.n).slice(0, 15).forEach((r) => console.log(`  ${r.brand} ${r.model_key}${r.variant_name ? ' / ' + r.variant_name : ''} ${r.year_from + 1}: ${r.n} listings / ${r.sellers} dealer${r.sellers === 1 ? '' : 's'}, median RM ${r.median_myr.toLocaleString('en-US')}`))

  if (!WRITE) { console.log('\nDry run: nothing written. Run with --write to save.'); return }
  const del = await supabase.from('market_stats').delete().eq('as_of', today).eq('source', 'carznexus')
  if (del.error) throw new Error(del.error.message)
  for (let i = 0; i < out.length; i += 500) {
    const { error } = await supabase.from('market_stats').insert(out.slice(i, i + 500))
    if (error) throw new Error(/ref_id|level/.test(error.message) ? 'market_stats is not ready: run supabase/migrations/20_catalog_links.sql first.' : error.message)
  }
  console.log(`\nSaved ${out.length} rows to market_stats (as of ${today}).`)

  // the individual comparable listings (no dealer): today's set replaces today's; anything older than 14 days is dropped
  const dc = await supabase.from('market_comps').delete().eq('source', 'carznexus').eq('as_of', today)
  if (dc.error) throw new Error(/market_comps/.test(dc.error.message) ? 'market_comps does not exist yet: run supabase/migrations/28_market_comps.sql first.' : dc.error.message)
  await supabase.from('market_comps').delete().lt('as_of', new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10))
  for (let i = 0; i < comps.length; i += 500) {
    const { error } = await supabase.from('market_comps').insert(comps.slice(i, i + 500))
    if (error) throw new Error(error.message)
  }
  console.log(`Saved ${comps.length} comparable listings to market_comps.`)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

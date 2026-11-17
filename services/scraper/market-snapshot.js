'use strict'

/**
 * market-snapshot.js — builds the Malaysian market statistics (public.market_stats) from the CarzNexus marketplace listings.
 * READ-ONLY on CarzNexus (one SELECT); writes only to the AIM database, and only aggregated numbers:
 * count, min / quartiles / median / max of the ASKING (customer) price and the average mileage per brand + model + year window.
 * A row exists only when >= 3 listings from >= 2 different sellers stand behind it; seller names and ids are never stored.
 *
 *   node market-snapshot.js            show what would be written (nothing is written)
 *   node market-snapshot.js --write    replace today's snapshot in market_stats
 *
 * Needs CARZNEXUS_DB_URL in .env: a Postgres connection string of a READ-ONLY database user that can SELECT marketplace.listings.
 * Create that user yourself in the CarzNexus project (see the note in .env.example); the app's own keys are never used for this.
 */

require('dotenv').config()
const path = require('path')
const { pathToFileURL } = require('url')
const supabase = require('./lib/db')

const WRITE = process.argv.includes('--write')

async function main() {
  const url = process.env.CARZNEXUS_DB_URL
  if (!url) { console.log('CARZNEXUS_DB_URL is empty in .env (a read-only Postgres connection string for the CarzNexus database).'); process.exit(1) }
  const { Client } = require('pg')
  const core = await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'index.ts')).href)

  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await db.connect()
  await db.query('set default_transaction_read_only = on')
  // customer price (asking_price) of live used / recon cars priced in MYR. seller_tenant_id is only used to count different sellers.
  const { rows } = await db.query(`select brand_name, model_name, manufacture_year, asking_price, mileage, seller_tenant_id
                                   from marketplace.listings
                                   where status = 'active' and condition in ('used', 'recon') and currency_code = 'MYR' and asking_price > 0`)
  await db.end()
  console.log(`${rows.length} active CarzNexus listings read`)

  const raw = rows.map((r) => ({ brand: r.brand_name, model: r.model_name, year: r.manufacture_year, price: Number(r.asking_price), km: r.mileage, seller: String(r.seller_tenant_id || '') }))
  const today = new Date().toISOString().slice(0, 10)
  const out = core.buildMarketRows(raw, today)
  const models = new Set(out.map((r) => r.brand + ' ' + r.model_key))
  console.log(`${out.length} market rows for ${models.size} models (rows with fewer than 3 listings / 2 sellers are left out)`)
  out.sort((a, b) => b.n - a.n).slice(0, 15).forEach((r) => console.log(`  ${r.brand} ${r.model_key} ${r.year_from + 1}: ${r.n} listings, RM ${r.min_myr.toLocaleString('en-US')} - ${r.max_myr.toLocaleString('en-US')}, median RM ${r.median_myr.toLocaleString('en-US')}`))

  if (!WRITE) { console.log('\nDry run: nothing written. Run with --write to save.'); return }
  const del = await supabase.from('market_stats').delete().eq('as_of', today).eq('source', 'carznexus')
  if (del.error) throw new Error(del.error.message)
  for (let i = 0; i < out.length; i += 500) {
    const { error } = await supabase.from('market_stats').insert(out.slice(i, i + 500))
    if (error) throw new Error(error.message)
  }
  console.log(`\nSaved ${out.length} rows to market_stats (as of ${today}).`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })

'use strict'
// probe-catalog.js: counts only (read-only). How filled is the CarzNexus catalog, and how many listings carry a variant link?
require('dotenv').config()
const { Client } = require('pg')
;(async () => {
  const db = new Client({ connectionString: process.env.CARZNEXUS_DB_URL, ssl: { rejectUnauthorized: false } })
  await db.connect()
  await db.query('set default_transaction_read_only = on')
  const q = async (sql) => (await db.query(sql)).rows
  console.log('catalog variants:', (await q('select count(*)::int n, count(distinct brand)::int brands, count(distinct model_id)::int models, count(model_code)::int with_code, count(engine_cc)::int with_cc, count(seats)::int with_seats from aim.catalog_variants'))[0])
  console.log('listings:', (await q('select count(*)::int n, count(variant_id)::int with_variant, count(model_id)::int with_model, count(variant_name)::int with_variant_name, count(engine_cc)::int with_cc, count(seats)::int with_seats from aim.market_source'))[0])
  console.log('catalog models for the hot families:')
  for (const r of await q("select brand, model, count(*)::int variants, count(distinct model_code)::int codes from aim.catalog_variants where model ilike any (array['alphard','vellfire','harrier','rx','nx','civic','stepwgn%','land cruiser%']) group by 1,2 order by 3 desc")) console.log(' ', r)
  console.log('sample listings:')
  for (const r of await q('select brand_name, model_name, variant_name, manufacture_year y, engine_cc, seats, variant_id is not null linked from aim.market_source order by random() limit 12')) console.log(' ', JSON.stringify(r))
  console.log('Alphard catalog variants:')
  for (const r of await q("select model_code, variant, variant_ja, engine_cc, seats, fuel from aim.catalog_variants where model ilike 'alphard' order by model_code, variant limit 25")) console.log(' ', JSON.stringify(r))
  await db.end()
})().catch((e) => { console.error(e.message); process.exit(1) })

// Copies the import-cost reference data (price guide, duty rates, currencies, exchange rates) from the source project
// into this project's database. Run once, then again after a new price guide edition or to refresh the exchange rates.
//
//   node scripts/copy-reference.mjs            copy everything
//   node scripts/copy-reference.mjs --rates    exchange rates only (quick refresh)
//   node scripts/copy-reference.mjs --codes    only the model codes (source = 'uss') for the offer report
//
// Needs scripts/.env  (never committed):
//   SOURCE_URL=https://xxxx.supabase.co          the source project (read only is enough)
//   SOURCE_SERVICE_KEY=...
//   TARGET_URL=https://yyyy.supabase.co          this project
//   TARGET_SERVICE_KEY=...
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envFile = new URL('./.env', import.meta.url)
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const need = ['SOURCE_URL', 'SOURCE_SERVICE_KEY', 'TARGET_URL', 'TARGET_SERVICE_KEY']
const missing = need.filter((k) => !process.env[k])
if (missing.length) { console.log('Missing in scripts/.env: ' + missing.join(', ')); process.exit(1) }

const src = createClient(process.env.SOURCE_URL, process.env.SOURCE_SERVICE_KEY, { db: { schema: 'reference' }, auth: { persistSession: false } })
const dst = createClient(process.env.TARGET_URL, process.env.TARGET_SERVICE_KEY, { auth: { persistSession: false } })
const ratesOnly = process.argv.includes('--rates')
const codesOnly = process.argv.includes('--codes')

async function readAll(table, cols) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await src.from(table).select(cols).order('created_at', { ascending: true }).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}
async function copy(table, cols, target, conflict) {
  const rows = await readAll(table, cols)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await dst.from(target).upsert(rows.slice(i, i + 500), { onConflict: conflict })
    if (error) throw new Error(`${target}: ${error.message}`)
  }
  console.log(`${target}: ${rows.length} rows`)
}

// Model codes: reference.vehicle_model_codes_lookup (source 'uss') -> its model (vehicle_models_lookup.lookup_code = the site's car code)
// -> its brand (vehicle_brands_lookup.lookup_code = the site's maker code) -> public.scraper_model_codes here.
async function copyModelCodes() {
  const brands = await readAll('vehicle_brands_lookup', 'id,lookup_name,lookup_code')
  const models = await readAll('vehicle_models_lookup', 'id,brand_lookup_id,lookup_name,lookup_code')
  const codes = (await readAll('vehicle_model_codes_lookup', 'model_lookup_id,lookup_name,lookup_code,source,is_active')).filter((c) => c.source === 'uss' && c.is_active !== false)
  const brandById = new Map(brands.map((b) => [b.id, b])), modelById = new Map(models.map((m) => [m.id, m]))
  const out = new Map(), skipped = []
  for (const c of codes) {
    const m = modelById.get(c.model_lookup_id), b = m && brandById.get(m.brand_lookup_id)
    const code = String(c.lookup_code || c.lookup_name || '').trim()
    if (!m || !b || !m.lookup_code || !b.lookup_code || !code) { skipped.push(c.lookup_name); continue }
    out.set(`${b.lookup_code}|${m.lookup_code}|${code}`, { maker_code: b.lookup_code, car_code: m.lookup_code, code, brand_name: b.lookup_name, model_name: m.lookup_name, updated_at: new Date().toISOString() })
  }
  const rows = [...out.values()]
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await dst.from('scraper_model_codes').upsert(rows.slice(i, i + 500), { onConflict: 'maker_code,car_code,code' })
    if (error) throw new Error('scraper_model_codes: ' + error.message)
  }
  console.log(`scraper_model_codes: ${rows.length} rows (${codes.length} uss codes read, ${skipped.length} skipped for a missing brand / model code)`)
  // how many of those models do the scraper's own targets know?
  const { data: tg } = await dst.from('scrape_targets').select('maker_code,car_code').eq('lot_type', 'bid').limit(5000)
  const known = new Set((tg || []).map((t) => t.maker_code + '|' + t.car_code))
  const models2 = new Set(rows.map((r) => r.maker_code + '|' + r.car_code))
  const match = [...models2].filter((k) => known.has(k)).length
  console.log(`${match} of ${models2.size} models with codes match a scrape target here${(tg || []).length ? '' : ' (no scrape targets yet: run make-targets.js)'}`)
}

if (codesOnly) { await copyModelCodes(); console.log('Done.'); process.exit(0) }
if (!ratesOnly) {
  await copy('custom_dockets', 'id,bil,year,brand,model,cc,currency_code,amt_12m_24m,amt_24m_36m,amt_36m_48m,amt_48m_60m,amt_60m_plus', 'custom_dockets', 'id')
  await copy('duties_and_taxes', 'id,vehicle_type,cc_range,cc_min,cc_max,multiplier,is_active', 'duty_rates', 'id')
  await copy('currencies', 'code,name,rate_unit,standard_fare_myr,standard_fare_label', 'currencies', 'code')
}
await copy('currency_rates', 'id,from_currency,to_currency,rate,rate_date', 'currency_rates', 'id')
if (!ratesOnly) await copyModelCodes()
console.log('Done.')

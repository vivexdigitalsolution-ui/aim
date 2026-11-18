'use strict'

/**
 * make-targets.js — create the scrape_targets (what the scraper will visit) from the brands/models found by
 * `node brand-model-scraper.js`.
 *
 *   node make-targets.js --list-brands                       show every brand code + name
 *   node make-targets.js --brands "TOYOTA,BMW"               targets for ALL models of those brands (bid on; history only on for models in scraped_models)
 *   node make-targets.js --all                               every brand
 *   node make-targets.js --brands "BMW" --types bid          only bidding targets (default: bid,history)
 *   node make-targets.js --brands "BMW" --age 5              car age limit in years (default: 5)
 *   node make-targets.js --disable "BMW"                     switch off the targets of a brand
 *
 * Safe to run again: existing targets are left alone, only missing ones are added.
 * Brand matching ignores case and punctuation ("mercedes-benz" = "MERCEDES BENZ").
 * Year range and score come from scraper/.env (YEAR_FROM, YEAR_TO, SCORE_MIN) when scrape.js runs; --age is only the fallback year.
 * Brands on the skip list (.env SKIP_BRAND_CODES, see lib/config.js) never get targets.
 */

const supabase = require('./lib/db')
const config   = require('./lib/config')

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(`--${name}`); return i === -1 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) }
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

async function loadAll(table, cols) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

async function main() {
  const brands = await loadAll('scraper_brands', 'code, name, country')
  if (opt('list-brands')) {
    brands.sort((a, b) => a.name.localeCompare(b.name)).forEach((b) => console.log(`${b.code.padEnd(8)} ${b.name}  ${b.country || ''}`))
    console.log(`\n${brands.length} brands`)
    return
  }
  if (!brands.length) { console.log('No brands yet — run:  node brand-model-scraper.js en'); process.exit(1) }

  const wanted = opt('all') ? null : String(opt('brands') || opt('disable') || '').split(',').map(norm).filter(Boolean)
  if (wanted && !wanted.length) { console.log('Use --brands "TOYOTA,BMW", --all or --list-brands'); process.exit(1) }
  let picked = brands.filter((b) => !wanted || wanted.includes(norm(b.name)) || wanted.includes(norm(b.code)))
  // brands we never scrape (.env SKIP_BRAND_CODES — trucks, American-market, Korea/China/Others ...)
  const skipped = picked.filter((b) => config.skipBrandCodes.has(String(b.code).toUpperCase()))
  if (skipped.length && !opt('disable')) {
    console.log(`Skipping ${skipped.length} brand(s) on the skip list: ${skipped.map((b) => b.name).join(', ')}`)
    picked = picked.filter((b) => !skipped.includes(b))
  }
  const missing = (wanted || []).filter((w) => !picked.some((b) => norm(b.name) === w || norm(b.code) === w))
  if (missing.length) console.log(`Not found (check spelling with --list-brands): ${missing.join(', ')}`)
  if (!picked.length) process.exit(1)

  if (opt('disable')) {
    for (const b of picked) {
      const { error } = await supabase.from('scrape_targets').update({ enabled: false }).eq('maker_code', b.code)
      console.log(error ? `${b.name}: ${error.message}` : `${b.name}: targets disabled`)
    }
    return
  }

  const types = String(opt('types') || 'bid,history').split(',').map((s) => s.trim()).filter((t) => t === 'bid' || t === 'history')
  const age = parseInt(opt('age') || '5', 10)
  const year = new Date().getFullYear()
  const models = (await loadAll('scraper_models', 'brand_code, code, name')).filter((m) => picked.some((b) => b.code === m.brand_code))
  const byCode = new Map(picked.map((b) => [b.code, b]))

  // History is only scraped for models we have seen a car for (table scraped_models, filled by `scrape.js bid`):
  // a new history target starts switched OFF unless its model is already there.
  const seen = new Set((await loadAll('scraped_models', 'maker_code, car_code')).map((m) => `${m.maker_code}|${m.car_code}`))

  const rows = []
  for (const m of models) {
    const b = byCode.get(m.brand_code)
    for (const t of types) {
      rows.push({
        label: `${b.name} / ${m.name} (${t})`, lot_type: t, maker_code: b.code, car_code: m.code,
        brand_name: b.name, model_name: m.name, year_from: config.yearFrom ?? year - age, year_to: config.yearTo ?? year,
        enabled: t === 'bid' || seen.has(`${b.code}|${m.code}`),
      })
    }
  }
  if (!rows.length) { console.log('No models found for those brands.'); return }

  let added = 0
  for (let i = 0; i < rows.length; i += 500) {
    // ignoreDuplicates: a target that already exists keeps its run history and its enabled flag
    const { data, error } = await supabase.from('scrape_targets')
      .upsert(rows.slice(i, i + 500), { onConflict: 'source,lot_type,maker_code,car_code', ignoreDuplicates: true }).select('id')
    if (error) { console.log(`Error: ${error.message}`); process.exit(1) }
    added += (data || []).length
  }
  console.log(`${picked.length} brand(s), ${models.length} model(s): ${added} new target(s) added, ${rows.length - added} already existed.`)
}

main().catch((e) => { console.log(e.message); process.exit(1) })

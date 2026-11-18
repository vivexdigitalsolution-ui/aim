'use strict'

/**
 * asnet.js — the ASNET list as a second source of cars for the `lots` table (the USS scrape stays as it is).
 * Built from the proven CarzNexus asnet-scraper (login, search form, list extract: lib/asnet/*). Setup and first run: docs/asnet-setup.md.
 *
 *   node asnet.js --probe                     list the ASNET brands and models of the models we already scrape (writes out/asnet-codes.json)
 *   node asnet.js --probe --all               the same for EVERY ASNET brand (slow)
 *   node asnet.js --maker 1010 --car 12345    DRY RUN: read one brand/model, print what would be saved, save nothing   (add --pages 2, --year-from 2021, --score-min 3.5)
 *   node asnet.js --from-codes                DRY RUN for every model in out/asnet-codes.json
 *   ... add --write to really save (cars, photos, the lots table). Without --write NOTHING is written and no photo is downloaded.
 *
 * Duplicates: a car that came from another source the same auction day (same make, year, mileage, chassis code) is skipped, so a car never shows twice.
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const sharp = require('sharp')
const supabase = require('./lib/db')
const { login } = require('./lib/asnet/auth')
const { goToSearchPage, applyFilters } = require('./lib/asnet/filters')
const { goToNextPage, getPagingInfo } = require('./lib/asnet/page')
const { extractRows } = require('./lib/asnet/extract')
const { rowToLot, isDuplicate, nameKey } = require('./lib/asnet/map')

const has = (n) => process.argv.includes(n)
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const WRITE = has('--write')
const MAX_PAGES = Number(arg('--pages') || 50)
const MAX_PHOTOS = Math.max(1, parseInt(process.env.MAX_PHOTOS || '5', 10))
const OUT = path.join(__dirname, 'out')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── probe: ASNET brand / model codes ────────────────────────────────────────────

async function options(page, sel) {
  return page.$$eval(sel + ' option', (os) => os.map((o) => ({ code: o.value, name: (o.textContent || '').trim() })).filter((o) => o.code && o.code !== '0' && o.name))
}

async function probe() {
  const ours = new Map()   // nameKey(brand) -> Set(nameKey(model)) of the models the USS scrape already knows
  if (!has('--all')) {
    const { data, error } = await supabase.from('scraped_models').select('brand_name,model_name').limit(5000)
    if (error) throw new Error(error.message)
    for (const r of data || []) { const k = nameKey(r.brand_name); (ours.get(k) || ours.set(k, new Set()).get(k)).add(nameKey(r.model_name)) }
    console.log(`probe: ${ours.size} brand(s) and ${[...ours.values()].reduce((a, s) => a + s.size, 0)} model(s) already scraped from the other source`)
  }
  const { browser, page } = await open()
  try {
    await goToSearchPage(page)
    const makers = await options(page, '#IppatsuSearch_MultiForm_0__MakerCode')
    console.log(`ASNET lists ${makers.length} brands`)
    const out = []
    for (const m of makers) {
      if (!has('--all') && !ours.has(nameKey(m.name))) continue
      await page.selectOption('#IppatsuSearch_MultiForm_0__MakerCode', m.code)
      await sleep(2500)
      const cars = await options(page, '#IppatsuSearch_MultiForm_0__CarCode')
      const want = ours.get(nameKey(m.name))
      const keep = has('--all') ? cars : cars.filter((c) => want?.has(nameKey(c.name)))
      console.log(`  ${m.name} (${m.code}): ${cars.length} models on ASNET, ${keep.length} we want${want && !has('--all') ? ` of ${want.size}` : ''}`)
      out.push({ maker_code: m.code, maker: m.name, cars: keep })
    }
    fs.mkdirSync(OUT, { recursive: true })
    const file = path.join(OUT, 'asnet-codes.json')
    fs.writeFileSync(file, JSON.stringify({ made_at: new Date().toISOString(), makers: out }, null, 2))
    console.log(`saved ${file}`)
  } finally { await browser.close() }
}

// ── scrape ───────────────────────────────────────────────────────────────────────

async function open() {
  const browser = await chromium.launch({ headless: false, slowMo: 80 })
  const page = await browser.newPage()
  page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000)
  if (!process.env.ASNET_USER || !process.env.ASNET_PASS) { await browser.close(); throw new Error('Put ASNET_USER and ASNET_PASS in .env first (see docs/asnet-setup.md)') }
  await login(page)
  return { browser, page }
}

async function fetchImg(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', Referer: 'https://www.asnet.jp/' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return Buffer.from(await res.arrayBuffer())
}

/** Photos of one ASNET car: f front, r rear, i interior, then extras z..a; o = the auction sheet. Same URL pattern the old scraper confirmed. */
async function photosFor(thumbUrl, lotNo) {
  const { uploadImage, deleteObjects, buildR2Key } = require('./lib/r2')
  const m = String(thumbUrl || '').match(/^https:\/\/img[ms]\.asnet2\.com\/ASDATA\/(\w+)\/[MS]\/(\w+)\/(\w+)[a-zA-Z]\.jpg$/)
  if (!m) return { photos: [], sheet: null, error: 'cannot read the photo link: ' + thumbUrl }
  const base = `https://imgl.asnet2.com/ASDATA/${m[1]}/L/${m[2]}/${m[3]}`
  const keys = [], photos = []
  let sheet = null
  const shrink = (b, w, q) => sharp(b).rotate().resize({ width: w, withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toBuffer()
  try {
    for (const s of ['o', 'f', 'r', 'i', ...'zyxwvutsrqpnmlkjhgedcba'.split('')]) {
      if (s !== 'o' && photos.length >= MAX_PHOTOS) break
      const buf = await fetchImg(`${base}${s}.jpg`)
      if (!buf) continue
      const key = buildR2Key('asnet' + lotNo, s === 'o' ? 'sheet' : s)
      const up = await uploadImage(key, await shrink(buf, s === 'o' ? 1600 : 1280, s === 'o' ? 80 : 72))
      keys.push(key)
      if (s === 'o') sheet = up.url; else photos.push(up.url)
    }
  } catch (e) { await deleteObjects(keys); return { photos: [], sheet: null, error: e.message } }
  return { photos, sheet, error: photos.length ? null : 'no photos found' }
}

async function scrapeTarget(page, target, counters) {
  console.log(`\n=== ${target.label} ===`)
  await goToSearchPage(page)
  await applyFilters(page, target)
  let offset = 0
  for (let p = 1; p <= MAX_PAGES; p++) {
    const { current, total } = await getPagingInfo(page)
    const rows = await extractRows(page, null, offset)
    offset += rows.length
    console.log(`\n[page ${current}/${total}] ${rows.length} rows`)
    for (const row of rows) {
      counters.seen++
      const lot = rowToLot(row)
      if (!lot) { counters.unusable++; console.log(`  skip: row without lot number, date or name`); continue }
      const line = `${lot.venue} ${lot.auction_date} #${lot.lot_no} | ${lot.brand} ${lot.model} | ${lot.model_code || '-'} | ${lot.mfg_year || '?'} | ${lot.mileage_km ?? '?'} km | grade ${lot.grade || '?'} | ¥${lot.start_price_jpy ?? '?'} | ${row.auction_method || 'method ?'}`
      // the same car from another source?
      const { data: others } = await supabase.from('lots').select('ex_key,auction_date,brand,model_code,mfg_year,mileage_km').eq('auction_date', lot.auction_date).eq('brand', lot.brand).eq('mfg_year', lot.mfg_year ?? -1).neq('source', 'asnet')
      if (isDuplicate(lot, others || [])) { counters.duplicate++; console.log(`  = ${line}   (already have it from the other source)`); continue }
      if (!WRITE) { counters.would++; console.log(`  + ${line}`); continue }
      const have = await supabase.from('lots').select('id,photos').eq('ex_key', lot.ex_key).eq('auction_date', lot.auction_date).maybeSingle()
      let photos = have.data?.photos, sheet = null
      if (!(Array.isArray(photos) && photos.length)) {
        const r = await photosFor(row.thumbnail_url, lot.lot_no)
        if (r.error) { counters.failed++; console.log(`  ! ${line}\n      photos: ${r.error}`); continue }
        photos = r.photos; sheet = r.sheet
      }
      const rec = { ...lot, photos, ...(sheet ? { sheet_url: sheet } : {}) }
      const { error } = await supabase.from('lots').upsert(rec, { onConflict: 'venue,auction_date,lot_no' })
      if (error) { counters.failed++; console.log(`  ! ${line}\n      database: ${error.message}`); continue }
      counters.saved++; console.log(`  ✓ ${line}`)
    }
    if (current >= total || !(await goToNextPage(page))) break
  }
}

async function main() {
  if (has('--probe')) return probe()
  let targets = []
  if (has('--from-codes')) {
    const file = path.join(OUT, 'asnet-codes.json')
    if (!fs.existsSync(file)) throw new Error('Run  node asnet.js --probe  first')
    for (const m of JSON.parse(fs.readFileSync(file, 'utf8')).makers) for (const c of m.cars) targets.push({ label: `${m.maker} ${c.name}`, maker_code: m.maker_code, car_code: c.code })
  } else if (has('--from-db')) {
    // the targets set on the staff page "Scrape targets" (source = asnet)
    const supabase = require('./lib/db')
    const { data, error } = await supabase.from('scrape_targets').select('*').eq('source', 'asnet').eq('lot_type', 'bid').eq('enabled', true).order('priority')
    if (error) throw new Error('targets: ' + error.message)
    for (const r of data || []) {
      const nums = (r.scores || []).map(Number).filter((n) => Number.isFinite(n))          // the ASNET form has one minimum score, so the lowest wanted score is used
      targets.push({ label: r.label, maker_code: r.maker_code, car_code: r.car_code, year_from: r.year_from, score_min: nums.length ? Math.min(...nums) : r.score_min })
    }
    console.log(`${targets.length} ASNET target(s) from the database`)
  } else if (arg('--maker')) {
    targets = [{ label: `maker ${arg('--maker')}${arg('--car') ? ' model ' + arg('--car') : ''}`, maker_code: arg('--maker'), car_code: arg('--car') || null, form_code: arg('--form') || null }]
  } else throw new Error('Say what to read: --probe, --maker <code> [--car <code>], or --from-codes')
  for (const t of targets) {
    t.lot_type_filter = 'bid'
    t.year_from = arg('--year-from') ? Number(arg('--year-from')) : (t.year_from ?? null)
    t.score_min = arg('--score-min') ? Number(arg('--score-min')) : (t.score_min ?? null)
  }
  console.log(WRITE ? 'WRITE mode: cars and photos will be saved' : 'DRY RUN: nothing is saved (add --write to save)')
  const { browser, page } = await open()
  const counters = { seen: 0, would: 0, saved: 0, duplicate: 0, unusable: 0, failed: 0 }
  try {
    for (const t of targets) {
      try { await scrapeTarget(page, t, counters) }
      catch (e) { if (e.isNoResults) console.log('  no results'); else { counters.failed++; console.log('  target failed: ' + e.message) } }
    }
  } finally { await browser.close() }
  console.log('\n' + JSON.stringify(counters))
}
main().catch((e) => { console.error(e.message); process.exit(1) })

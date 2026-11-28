'use strict'

/**
 * asnet.js — ASNET's AS-One Price cars, saved as One price cars (table one_price_lots, source = 'asnet'). The USS scrape stays as it is.
 * Built from the CarzNexus asnet-scraper (login, search form, list extract: lib/asnet/*). Setup and first run: docs/asnet-setup.md.
 *
 *   node asnet.js --probe                     list the ASNET brands and models of the models we already scrape (writes out/asnet-codes.json)
 *   node asnet.js --probe --all               the same for EVERY ASNET brand (slow)
 *   node asnet.js --maker 1010 --car 12345    DRY RUN: read one brand/model, print what would be saved, save nothing   (add --pages 2, --year-from 2021, --score-min 3.5)
 *   node asnet.js --from-db                   DRY RUN for the ASNET targets of the Scrape targets page
 *   ... add --write to really save (cars and photos). Without --write NOTHING is written and no photo is downloaded.
 *       --max-cars 3     save only the first 3 cars of each model (a small first test; nothing is removed)
 *       --remove-many    allow removing more than half of a model's saved cars in one run
 *   node asnet.js --inspect --maker 1010 --car 12345   record how the result page loads and what Next does (out/asnet-inspect/), saves no cars
 *
 * A fixed-price car has no end date. It stays until a later --from-db --write run reads the WHOLE list of its model and no longer finds it.
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
const { rowToCar, exKey, isAsOne, nameKey, matchModels, onAsnet } = require('./lib/asnet/map')
const { readAllPages } = require('./lib/asnet/read')
const { inspect } = require('./lib/asnet/inspect')
const { codeMatches } = require('./lib/filters')
const { saveCar, removeGone } = require('./lib/asnet/save')
const { findPhotos, withoutRepeats, inGroups } = require('./lib/asnet/photos')

const has = (n) => process.argv.includes(n)
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const WRITE = has('--write')
const MAX_PAGES = Number(arg('--pages') || 50)
const MAX_CARS = Number(arg('--max-cars') || 0)      // 0 = no limit
// sold cars are removed only in a run of the saved targets: a one-off search (--maker) may be narrower than what was saved before
const REMOVES = has('--from-db') && !MAX_CARS
// ASNET has its own limit (MAX_PHOTOS in .env is for the USS pictures): by default every picture of the car is kept
const MAX_PHOTOS = Math.max(1, parseInt(process.env.ASNET_MAX_PHOTOS || '60', 10))
const OUT = path.join(__dirname, 'out')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── probe: ASNET brand / model codes ────────────────────────────────────────────

async function options(page, sel) {
  return page.$$eval(sel + ' option', (os) => os.map((o) => ({ code: o.value, name: (o.textContent || '').trim() })).filter((o) => o.code && o.code !== '0' && o.name))
}

/** Every row of a query (the database gives at most 1000 at a time). */
async function readAll(query) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

/** Our models: every model switched on for USS, plus every model the USS scrape has found cars for. nameKey(brand) -> { brand, models } */
async function ourModels() {
  const targets = await readAll(() => supabase.from('scrape_targets').select('brand_name,model_name').eq('source', 'uss').eq('enabled', true).order('id'))
  const scraped = await readAll(() => supabase.from('scraped_models').select('brand_name,model_name').order('maker_code').order('car_code'))
  const out = new Map()
  for (const r of [...targets, ...scraped]) {
    const at = onAsnet(r.brand_name, r.model_name)
    const k = nameKey(at.brand)
    const b = out.get(k) || out.set(k, { brand: at.brand, models: new Map() }).get(k)
    b.models.set(nameKey(at.model), at.model)
  }
  for (const b of out.values()) b.models = [...b.models.values()]
  return out
}

async function probe() {
  let ours = new Map()
  if (!has('--all')) {
    ours = await ourModels()
    console.log(`probe: ${ours.size} brand(s) and ${[...ours.values()].reduce((a, b) => a + b.models.length, 0)} model(s) on the other source (switched on or already found)`)
  }
  const { browser, page } = await open()
  try {
    await goToSearchPage(page)
    const makers = await options(page, '#IppatsuSearch_MultiForm_0__MakerCode')
    console.log(`ASNET lists ${makers.length} brands`)
    const out = [], missing = []
    for (const m of makers) {
      if (!has('--all') && !ours.has(nameKey(m.name))) continue
      await page.selectOption('#IppatsuSearch_MultiForm_0__MakerCode', m.code)
      await sleep(2500)
      const cars = await options(page, '#IppatsuSearch_MultiForm_0__CarCode')
      const want = ours.get(nameKey(m.name))
      const match = has('--all') ? { keep: cars, missing: [] } : matchModels(m.name, want.models, cars)
      const keep = match.keep
      missing.push(...match.missing.map((n) => `${m.name} ${n}`))
      console.log(`  ${m.name} (${m.code}): ${cars.length} models on ASNET, ${has('--all') ? `${keep.length} listed` : `${want.models.length - match.missing.length} of our ${want.models.length} found`}`)
      out.push({ maker_code: m.code, maker: m.name, cars: keep, all_cars: cars })      // all_cars: every ASNET name, to compare the ones that did not match
    }
    if (!has('--all')) {
      const listed = new Set(makers.map((m) => nameKey(m.name)))
      for (const [k, b] of ours) if (!listed.has(k)) missing.push(...b.models.map((n) => `${b.brand} ${n}  (make name not on ASNET)`))
      console.log(`\n${missing.length} of our models not found on ASNET:${missing.map((n) => '\n  - ' + n).join('')}`)
    }
    fs.mkdirSync(OUT, { recursive: true })
    const file = path.join(OUT, 'asnet-codes.json')
    fs.writeFileSync(file, JSON.stringify({ made_at: new Date().toISOString(), all_makers: makers, makers: out, not_found: missing }, null, 2))
    // the same list goes to the database: the Scrape targets page offers it as a pick list
    const rows = out.flatMap((m) => m.cars.map((c) => ({ maker_code: m.maker_code, maker: m.maker, car_code: c.code, car: c.name })))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('asnet_catalog').upsert(rows.slice(i, i + 500), { onConflict: 'maker_code,car_code' })
      if (error) { console.log('asnet_catalog not saved (run migration 41 first): ' + error.message); break }
    }
    console.log(`asnet_catalog: ${rows.length} models saved`)
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

/** @returns the picture, or null when it does not exist; any other trouble is tried three times, then thrown */
async function fetchImg(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', Referer: 'https://www.asnet.jp/' }, signal: AbortSignal.timeout(30000) })
      if (res.status === 404) return null
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      if (attempt >= 3) throw e
      await sleep(2000 * attempt)
    }
  }
}

/** true only when the photo host clearly says "not found"; a network error or any other answer keeps the saved photos */
async function isGone(url) {
  try { return (await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })).status === 404 } catch { return false }
}

/** All pictures of one ASNET car, found from its cover's link (lib/asnet/photos.js says how they are named). */
async function photosFor(thumbUrl, lotKey, keepOnError) {
  const { uploadImage, deleteObjects, buildR2Key } = require('./lib/r2')
  const m = String(thumbUrl || '').match(/^https:\/\/img[ms]\.asnet2\.com\/ASDATA\/(\w+)\/[MS]\/(\w+)\/(\w+)[a-zA-Z]\.jpg$/)
  if (!m) return { photos: [], sheet: null, keys: [], error: 'cannot read the photo link: ' + thumbUrl }
  const base = `https://imgl.asnet2.com/ASDATA/${m[1]}/L/${m[2]}/${m[3]}`
  const keys = [], photos = []
  let sheet = null
  const shrink = (b, w, q) => sharp(b).rotate().resize({ width: w, withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toBuffer()
  const small = (b) => sharp(b).rotate().resize(32, 32, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer()
  const put = async (ending, data, width, quality) => {
    const key = buildR2Key(lotKey, ending === 'o' ? 'sheet' : ending)
    const up = await uploadImage(key, await shrink(data, width, quality))
    keys.push(key)
    return up.url
  }
  try {
    const sheetData = await fetchImg(`${base}o.jpg`)
    const found = (await withoutRepeats(await findPhotos((ending) => fetchImg(`${base}${ending}.jpg`)), small)).slice(0, MAX_PHOTOS)
    // everything is downloaded before the first upload, so a failed download leaves storage untouched
    if (sheetData) sheet = await put('o', sheetData, 1600, 80)
    photos.push(...await inGroups(found, (p) => put(p.ending, p.data, 1280, 72)))
  } catch (e) { if (!keepOnError) await deleteObjects(keys); return { photos: [], sheet: null, keys: [], error: e.message } }
  return { photos, sheet, keys, error: photos.length ? null : 'no photos found' }
}

/** When rows cannot be read: keep a few of them as the page shows them, so the reading rules can be corrected against the real page. */
async function saveSample(page, rows) {
  const html = await page.evaluate(() => ({
    url: location.href,
    pageSize: document.querySelector('#pageSizeSelect')?.outerHTML || null,
    rows: [...document.querySelectorAll('tr[data-key]')].slice(0, 4).map((r) => r.outerHTML),
  }))
  fs.mkdirSync(OUT, { recursive: true })
  const file = path.join(OUT, 'asnet-sample.json')
  fs.writeFileSync(file, JSON.stringify({ made_at: new Date().toISOString(), read_as: rows.slice(0, 4), ...html }, null, 2))
  return file
}

/** the staff page ticks scores: the site takes one lowest score, the list rows are then checked one by one */
const wantedScore = (target, grade) => !target.scores?.length || target.scores.includes(String(grade || '').trim().toUpperCase())

async function removeSold(target, seen, counters) {
  const r = await removeGone({ db: supabase, target, seen, write: WRITE, allowMany: has('--remove-many') })
  if (r.error) { counters.failed++; console.log('  sold cars not removed: ' + r.error); return }
  if (!r.gone.length) return
  if (r.blocked) { counters.removal_blocked++; console.log(`  NOT removed: ${r.gone.length} of ${r.saved} saved cars are missing, which looks wrong. Check the site; if they are really sold, run again with --remove-many`); return }
  if (!WRITE) { console.log(`  would remove ${r.gone.length} car(s) no longer listed`); return }
  counters.removed += r.removed
  console.log(`  removed ${r.removed} car(s) no longer listed`)
}

/**
 * When the next page does not show: keep what the page looks like (its paging buttons, how many rows) and what it asked the server for
 * after the button was pressed, so the page turn can be corrected against the real site. No cookie or login detail is saved.
 */
function watchPageTurn(page) {
  const asked = [], errors = []
  let on = false
  const note = (r) => { if (on && ['xhr', 'fetch', 'document'].includes(r.request().resourceType())) asked.push({ status: r.status(), method: r.request().method(), url: r.url().split('?')[0] }) }
  const broke = (e) => { if (on) errors.push(String(e.message || e).slice(0, 300)) }      // an error in the site's own script can stop its button working
  page.on?.('response', note)
  page.on?.('pageerror', broke)
  return {
    start: () => { on = true; asked.length = 0; errors.length = 0 },
    stop: () => { page.off?.('response', note); page.off?.('pageerror', broke) },
    async save(wanted) {
      try {
        const html = await page.evaluate(() => ({
          rows: document.querySelectorAll('tr[data-key]').length,
          firstRow: document.querySelector('tr[data-key]')?.getAttribute('data-key') || null,
          pageLinks: [...document.querySelectorAll('a[data-page]')].slice(0, 20).map((a) => {
            const box = a.getBoundingClientRect(), over = box.width ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null
            return { html: a.outerHTML.slice(0, 300), inside: a.parentElement?.className || '', visible: a.getClientRects().length > 0, onTop: over ? (over === a || a.contains(over) ? 'itself' : over.outerHTML.slice(0, 200)) : 'off screen' }
          }),
          paging: [...new Set([...document.querySelectorAll('a[data-page]')].map((a) => a.closest('nav') || a.closest('ul')))].slice(0, 3).map((e) => e?.outerHTML.slice(0, 4000)),
          pageSize: document.querySelector('#pageSizeSelect')?.value || null,
          unitsLine: (document.body.innerText.match(/.{0,20}units\s*found.{0,40}/i) || [null])[0],
        }))
        fs.mkdirSync(OUT, { recursive: true })
        const file = path.join(OUT, 'asnet-paging.json')
        fs.writeFileSync(file, JSON.stringify({ made_at: new Date().toISOString(), wanted_page: wanted, asked, errors, ...html }, null, 2))
        console.log('  what the page looked like is saved: ' + file)
      } catch (e) { console.log('  page details not saved: ' + e.message) }
    },
  }
}

/** Opens the search form and searches. ASNET sometimes answers "The search timed out": the same search is asked again, twice at most. */
async function search(page, target) {
  for (let attempt = 1; ; attempt++) {
    await goToSearchPage(page)
    try { return await applyFilters(page, target) }
    catch (e) {
      if (!e.isSearchTimeout || attempt >= 3) throw e
      console.log(`  ${e.message}: trying again in 20 seconds (${attempt + 1} of 3)`)
      await sleep(20000)
    }
  }
}

async function scrapeTarget(page, target, counters) {
  console.log(`\n=== ${target.label} ===`)
  try { await search(page, target) }
  catch (e) {
    // the site's own "no vehicle was found" page: the model has nothing listed
    if (!e.isNoResults) throw e
    console.log('  no results')
    if (REMOVES && target.car_code) await removeSold(target, new Set(), counters)
    return
  }
  const turn = watchPageTurn(page)
  let list
  try { list = await readAllPages({ page, site: { extractRows, getPagingInfo, goToNextPage }, maxPages: MAX_PAGES, log: (m) => console.log(m), onTurn: turn.start, onStuck: turn.save }) }
  finally { turn.stop() }

  const unread = list.rows.filter((r) => !rowToCar(r))
  if (unread.length && !counters.sample) {
    const gaps = ['lot_no', 'make', 'car_name'].map((k) => [k, unread.filter((r) => !r[k]).length]).filter(([, n]) => n)
    console.log(`  ${unread.length} row(s) cannot be used. Missing: ${gaps.map(([k, n]) => `${k} on ${n}`).join(', ')}`)
    try { counters.sample = await saveSample(page, unread); console.log(`  sample of these rows saved: ${counters.sample}`) } catch (e) { console.log('  sample not saved: ' + e.message) }
  }

  const seen = new Set()      // every car on the list, whether it is saved or not: it is still for sale
  let done_ = 0
  for (const row of list.rows) {
    counters.seen++
    const car = rowToCar(row)
    // a row that cannot be read is still a listed car: with its lot number on the page it must not count as sold
    if (!car) { counters.unusable++; if (row.lot_no) seen.add(exKey(row.lot_no)); continue }
    if (seen.has(car.ex_key)) continue
    seen.add(car.ex_key)
    const line = `${car.venue} #${row.lot_no} | ${car.brand} ${car.model} ${car.grade || ''} | ${car.model_code || '-'} | ${car.mfg_year || '?'} | ${car.mileage_km ?? '?'} km | score ${car.auction_grade || '?'} | ¥${car.price_jpy ?? '?'} | ${row.auction_method || 'method ?'}`
    if (!isAsOne(row.auction_method)) { counters.wrong_type++; console.log(`  x ${line}   (not AS-One Price: left out)`); continue }
    if (!codeMatches(target, car.model_code)) { counters.filtered++; console.log(`  - ${line}   (model code not on the target list)`); continue }
    if (!wantedScore(target, car.auction_grade)) { counters.filtered++; console.log(`  - ${line}   (score not ticked on the target)`); continue }
    if (MAX_CARS && done_ >= MAX_CARS) continue
    done_++
    if (WRITE && !target.car_code) throw new Error('--write needs one model: add --car <code>')
    const done = await saveCar({
      db: supabase, car: { ...car, maker_code: target.maker_code, car_code: target.car_code }, write: WRITE, isGone,
      fetchPhotos: (keepOnError) => photosFor(row.thumbnail_url, car.ex_key, keepOnError),
      removePhotos: (keys) => require('./lib/r2').deleteObjects(keys),
    })
    counters[done.status]++
    if (done.repaired) counters.repaired++
    const mark = { would: '+', saved: '✓', updated: '↻', taken: '=', failed: '!' }[done.status]
    console.log(`  ${mark} ${line}${done.repaired ? '   (missing photos fetched again)' : ''}${done.message ? `\n      ${done.message}` : ''}`)
  }

  console.log(list.complete ? `  whole list read: ${seen.size} car(s)` : `  list NOT fully read: ${list.why}`)
  if (!REMOVES || !target.car_code) return
  if (!list.complete) { counters.incomplete++; console.log('  no car is removed after an incomplete read'); return }
  await removeSold(target, seen, counters)
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
    const { data, error } = await supabase.from('scrape_targets').select('*').eq('source', 'asnet').eq('lot_type', 'one_price').eq('enabled', true).order('priority')
    if (error) throw new Error('targets: ' + error.message)
    for (const r of data || []) {
      // the ASNET form has one minimum score, so the lowest ticked number is set there. R (repaired) has no number: with R ticked the site filter is left open
      const nums = (r.scores || []).map(Number).filter((n) => Number.isFinite(n))
      const open = (r.scores || []).includes('R')
      targets.push({ label: r.label, maker_code: r.maker_code, car_code: r.car_code, model_codes: r.model_codes, year_from: r.year_from, scores: r.scores, score_min: open ? null : nums.length ? Math.min(...nums) : r.score_min })
    }
    console.log(`${targets.length} ASNET target(s) from the database`)
  } else if (arg('--maker')) {
    targets = [{ label: `maker ${arg('--maker')}${arg('--car') ? ' model ' + arg('--car') : ''}`, maker_code: arg('--maker'), car_code: arg('--car') || null, form_code: arg('--form') || null }]
  } else throw new Error('Say what to read: --probe, --maker <code> [--car <code>], or --from-codes')
  for (const t of targets) {
    t.year_from = arg('--year-from') ? Number(arg('--year-from')) : (t.year_from ?? null)
    t.score_min = arg('--score-min') ? Number(arg('--score-min')) : (t.score_min ?? null)
  }
  console.log(WRITE ? 'WRITE mode: cars and photos will be saved' : 'DRY RUN: nothing is saved (add --write to save)')
  if (WRITE) {
    const col = await supabase.from('one_price_lots').select('source').limit(1)
    if (col.error) throw new Error('Run supabase/migrations/63_one_price_source.sql in the Supabase SQL Editor first: ' + col.error.message)
  }
  if (has('--inspect')) {
    if (WRITE || !arg('--maker')) throw new Error('--inspect goes with --maker <code> [--car <code>] and never with --write')
    const { browser, page } = await open()
    try {
      await search(page, { ...targets[0], keepPageSize: true })
      await inspect(page, OUT)
    } finally { await browser.close() }
    return
  }
  const { browser, page } = await open()
  const counters = { seen: 0, would: 0, saved: 0, updated: 0, repaired: 0, taken: 0, filtered: 0, wrong_type: 0, unusable: 0, removed: 0, incomplete: 0, removal_blocked: 0, failed: 0 }
  try {
    for (const t of targets) {
      try { await scrapeTarget(page, t, counters) }
      catch (e) { counters.failed++; console.log('  target failed: ' + e.message) }
    }
  } finally { await browser.close() }
  console.log('\n' + JSON.stringify(counters))
}
main().catch((e) => { console.error(e.message); process.exit(1) })

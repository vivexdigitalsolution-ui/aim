'use strict'

/**
 * scrape.js — fills the Auction app.
 *
 *   node scrape.js bid [venue[,venue...]] [<N>days]   cars open for bidding  -> lots (photos go to R2)
 *   node scrape.js one_price [venue[,venue...]]       one-price cars (fixed price) -> one_price_lots   (Japanese site, its own login)
 *   node scrape.js history                            past SOLD prices        -> lot_history
 *
 * Day (bid only): node scrape.js bid tuesday | today | tomorrow - the venues of that weekday come from the table scrape_venue_days
 * (Tuesday = Yokohama only, Thursday = Tokyo only ... set in the database). A weekday with no row there falls back to the site's
 * own day list minus SKIP_VENUES in .env.
 *
 * Venue (optional): node scrape.js bid yokohama   — none = every venue. See lib/venues.js for the names.
 * "<N>days" (optional): pick targets by their LAST RUN date instead of "not finished today":
 *   node scrape.js bid yokohama 0day    — only targets that never ran
 *   node scrape.js bid yokohama 3days   — never run, or last run 3+ days ago
 *
 * Work comes from scrape_targets (one brand + model + year range each); create them with `node make-targets.js`.
 * Each target is claimed with a lock (lib/lock.js), so several PCs can run this at the same time.
 *
 * Ctrl+C once = finish the current car then stop cleanly. Ctrl+C twice = quit now.
 */

require('dotenv').config()
// `node scrape.js bid offer` = only the offer report models (Admin › Offer report), every venue
if (process.argv.slice(3).some((a) => a.toLowerCase() === 'offer')) process.env.OFFER_ONLY = '1'

const path         = require('path')
const { chromium } = require('playwright')
const config = require('./lib/config')
const { claimTarget, releaseTarget, completeTarget, INSTANCE_ID } = require('./lib/lock')
const { createRun, finalizeRun } = require('./lib/run')
const { login }                  = require('./lib/auth')
const { parseVenues }            = require('./lib/venues')
const {
  openMarketPriceFirstTime, goToMarketSearch, skipVenueStep, applyHistoryFilter, setAuctionTerm,
  openOneClickWizardFirstTime, goToSearchDirect, selectAllVenues, selectWeekdayVenues, selectBrand, selectModel, applyFilter, goToListingPage, goToNextListingPage,
} = require('./lib/nav')
const { extractBiddingListingRows, extractHistoryRows, extractOnePriceListingRows } = require('./lib/extract')
const { downloadAndUploadImages } = require('./lib/images')
const { firstAuctionDate } = require('./lib/cutoff')
const { isOthersGrade, cleanVenue, findExistingLot, updateLiveLot, upsertLot, recordScrapedModel, findExistingHistoryKeys, upsertHistory, recordGrades, findExistingOnePrice, updateOnePrice, upsertOnePrice } = require('./lib/writer')
const { whyLeftOut, gradeName, codeMatches } = require('./lib/filters')
const { jstWeekday, venuesForWeekday, NAMES: DAY_NAMES } = require('./lib/schedule')

/** Year and score limits come from .env (YEAR_FROM, YEAR_TO, SCORE_MIN), not from the target row. */
function withCriteria(target) {
  // a target with its own exact scores (set on the Scrape targets page) keeps its own years and scores
  if (Array.isArray(target.scores) && target.scores.length) return { ...target, year_from: target.year_from ?? config.yearFrom, year_to: target.year_to ?? config.yearTo }
  return { ...target, year_from: config.yearFrom ?? target.year_from, year_to: config.yearTo ?? target.year_to, score_min: config.scoreMin ?? target.score_min }
}

// ── Arguments ─────────────────────────────────────────────────────────────────

const ARG = (process.argv[2] || '').toLowerCase().replace(/[-\s]/g, '_')
if (!['bid', 'history', 'one_price', 'oneprice'].includes(ARG)) {
  console.log('Usage: node scrape.js bid|one_price|history [venue[,venue...] | monday..sunday | today | tomorrow] [<N>days]')
  process.exit(1)
}
const MODE     = ARG === 'oneprice' ? 'one_price' : ARG
const LANGMODE = MODE === 'one_price' ? 'jp' : 'en'      // the one-price site is Japanese only; bidding and history log in English

const WEEKDAYS = { today: 'today', tomorrow: 'tomorrow', monday: 1, mon: 1, tuesday: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7 }
const rest       = process.argv.slice(3).filter((a) => !a.startsWith('--'))      // --include-today is read by lib/cutoff.js
const DAYS_TOKEN = rest.find((a) => /^\d+\s*days?$/i.test(a))
const MIN_DAYS   = DAYS_TOKEN ? parseInt(DAYS_TOKEN, 10) : null
const DAY_TOKEN  = rest.find((a) => WEEKDAYS[a.toLowerCase()])
const DAYVAL     = DAY_TOKEN ? WEEKDAYS[DAY_TOKEN.toLowerCase()] : null
const WEEKDAY    = DAYVAL === 'today' ? jstWeekday(0) : DAYVAL === 'tomorrow' ? jstWeekday(1) : DAYVAL
let VENUES = { codes: [], names: [] }
try { VENUES = parseVenues(rest.filter((a) => a !== DAYS_TOKEN && a !== DAY_TOKEN && a.toLowerCase() !== 'offer')) } catch (e) { console.log(e.message); process.exit(1) }
if (MODE === 'history' && (VENUES.codes.length || WEEKDAY)) { console.log('History has no venue or day filter - run it without one.'); process.exit(1) }
if (MODE === 'one_price' && WEEKDAY) { console.log('One price has no day filter - use a venue (one_price yokohama) or none.'); process.exit(1) }
let DAY_VENUES = null      // the venues of the chosen weekday from scrape_venue_days (loaded in main)
if (WEEKDAY && VENUES.codes.length) { console.log('Use either a day (bid tuesday) or venues (bid tokyo), not both.'); process.exit(1) }

// Venues left unticked after a day is chosen (SKIP_VENUES in .env), as the source site's venue codes
let SKIP_CODES = []
try { SKIP_CODES = parseVenues(config.skipVenues).codes } catch (e) { console.log(`SKIP_VENUES: ${e.message}`); process.exit(1) }
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const SKIP_VENUE_NAMES = new Set(config.skipVenues.map(norm))

// History depth: a model's FIRST history run looks back HISTORY_AUCTION_TIMES (default 12) to build its price history;
// every later (daily) run only looks back HISTORY_DAILY_TIMES (default 2), which is enough to catch what sold since the last run.
const HISTORY_AUCTION_TIMES = parseInt(process.env.HISTORY_AUCTION_TIMES || '12', 10)
const HISTORY_DAILY_TIMES   = parseInt(process.env.HISTORY_DAILY_TIMES || '2', 10)

// ── Graceful shutdown ─────────────────────────────────────────────────────────

let shutdownRequested = false
let shutdownCount     = 0
process.on('SIGINT',  () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))
function handleShutdown(signal) {
  shutdownCount++
  if (shutdownCount === 1) {
    console.log(`\n[SHUTDOWN] ${signal} received — will stop after the current car. Press Ctrl+C again to force exit.`)
    shutdownRequested = true
  } else {
    console.log('\n[SHUTDOWN] Force exit.')
    process.exit(1)
  }
}

// ── Row shape ─────────────────────────────────────────────────────────────────

/** The bidding listing row in the shape lib/writer.js expects. */
function normalizeBidRow(r) {
  return {
    ex_key: r.ex_key, lot_number: r.lot_no, auction_date: r.auction_date, auction_time: r.schedule_time,
    manufacture_year: r.manufacture_year, mileage_km: r.mileage_km, color: r.color, model_code: r.model_code, grade: r.grade,
    transmission_raw: r.shift_type, engine_cc: r.displacement_cc, auction_grade: r.auction_grade, equipment_raw: r.equipment_raw,
    start_price: r.start_price, final_price: r.won_price, thumb_parsed: r.thumb_parsed, venue: r.venue_name,
    raw_extra: { score_letter: r.score_letter },
  }
}

/** Only lots that SOLD count as a price: "Sold" yes; "Unsold" / "Not sold" no. */
function isSoldResult(raw) {
  const t = String(raw || '').toLowerCase()
  return /\bsold\b/.test(t) && !/unsold|not\s+sold/.test(t)
}

// ── History: one target ───────────────────────────────────────────────────────

async function processHistoryTarget(page, target, counters) {
  await goToMarketSearch(page)
  await skipVenueStep(page)
  await selectBrand(page, target.maker_code)
  if (!(await selectModel(page, target.car_code))) { console.log(`\n[TARGET] No results at model step for: ${target.label}`); return 'No results at model step' }

  const hits = await applyHistoryFilter(page, target)
  if (hits === 0) { console.log(`\n[TARGET] No results after filter for: ${target.label}`); return 'No results after filter' }

  await goToListingPage(page)
  const times = target.run_count > 0 ? HISTORY_DAILY_TIMES : HISTORY_AUCTION_TIMES      // run_count 0 = never finished before = backfill
  const expected = await setAuctionTerm(page, times)
  console.log(`[HISTORY] ${expected ?? '?'} records in the past ${times} auction times (${target.run_count > 0 ? 'daily top-up' : 'first run: backfill'})`)

  let pageNum = 1
  while (true) {
    if (shutdownRequested) break
    const rawRows = await extractHistoryRows(page)
    console.log(`\n[PAGE ${pageNum}] rows on page: ${rawRows.length}`)
    if (rawRows.length === 0) break
    counters.records_scraped += rawRows.length

    const sold = rawRows.filter((r) => isSoldResult(r.auction_result_raw) && r.won_price > 0 && !isOthersGrade(r.grade))      // grade OTHERS is never saved
    const existing = await findExistingHistoryKeys(sold.map((r) => r.ex_key))
    const written = await upsertHistory(sold, target)
    if (written.ok) {
      const fresh = sold.filter((r) => !existing.has(r.ex_key)).length
      counters.records_inserted += fresh
      counters.records_updated  += sold.length - fresh
      console.log(`  Sold: ${sold.length} of ${rawRows.length} (new ${fresh})`)
    } else {
      counters.records_failed += sold.length
    }

    if (!(await goToNextListingPage(page, LANGMODE))) break
    pageNum++
  }
  return null
}

// ── Bid: one target ───────────────────────────────────────────────────────────

async function processBidTarget(page, target, counters) {
  await goToSearchDirect(page, 'bid')
  if (DAY_VENUES) await selectAllVenues(page, DAY_VENUES.codes)           // the venues set in the database for this weekday
  else if (WEEKDAY) await selectWeekdayVenues(page, WEEKDAY, SKIP_CODES)  // no row for this weekday: the site's own day list minus SKIP_VENUES
  else await selectAllVenues(page, VENUES.codes)
  await selectBrand(page, target.maker_code)
  if (!(await selectModel(page, target.car_code))) { console.log(`\n[TARGET] No results at model step for: ${target.label}`); return 'No results at model step' }

  const hits = await applyFilter(page, target, 'bid')
  if (hits === 0) { console.log(`\n[TARGET] No results after filter for: ${target.label}`); return 'No results after filter' }

  await goToListingPage(page)

  let pageNum = 1
  let modelRecorded = false
  while (true) {
    if (shutdownRequested) break
    console.log(`\n[PAGE ${pageNum}]`)
    const rawRows = await extractBiddingListingRows(page)
    console.log(`  Rows on page: ${rawRows.length}`)
    // this model has cars: remember it, and (first time only) switch its history scrape on
    if (!modelRecorded && rawRows.length) { await recordScrapedModel(target); modelRecorded = true }
    await recordGrades(target, rawRows.map((r) => gradeName(target.model_name, r.grade)))      // the variant pick list on the Scrape targets page

    for (let i = 0; i < rawRows.length; i++) {
      if (shutdownRequested) break
      const row = normalizeBidRow(rawRows[i])
      const logPrefix = `  ROW ${i + 1} [${row.ex_key}]:`
      counters.records_scraped++

      if (row.final_price) { console.log(`${logPrefix} already sold — skip`); continue }       // nothing left to bid on
      if (isOthersGrade(row.grade)) { console.log(`${logPrefix} grade is OTHERS — skip (never scraped)`); continue }
      // model codes or variants chosen on the Scrape targets page: keep only those cars (empty = every one)
      const left = whyLeftOut(target, row)
      if (left) { console.log(`${logPrefix} ${left} - skip`); continue }
      // safety net for the day mode: a venue on the skip list is never saved, even if the page still listed it
      if (WEEKDAY && !DAY_VENUES && SKIP_VENUE_NAMES.has(norm(cleanVenue(row.venue)))) { console.log(`${logPrefix} venue ${cleanVenue(row.venue)} is skipped`); continue }
      if (!row.auction_date) { console.log(`${logPrefix} no auction date — skip`); counters.records_failed++; continue }
      // a scrape takes hours: a car of today's auction may be over before the offer goes out (--include-today turns this off)
      if (row.auction_date < firstAuctionDate()) { counters.records_skipped_today = (counters.records_skipped_today || 0) + 1; console.log(`${logPrefix} auction ${row.auction_date} is before ${firstAuctionDate()} (today / past) — skip`); continue }

      try {
        // photos never change: a car already saved with photos only gets its price / deadline refreshed
        const existing = await findExistingLot(row.ex_key, row.auction_date)
        if (existing) {
          await updateLiveLot(existing.id, row, target)
          counters.records_updated++
          console.log(`${logPrefix} already saved — refreshed`)
          continue
        }

        const img = await downloadAndUploadImages(page, row.thumb_parsed, row.ex_key, logPrefix)
        if (!img.success) {
          console.log(`${logPrefix} images failed: ${img.error}`)
          counters.images_failed++
          counters.records_failed++
          continue
        }
        counters.images_uploaded += img.images.length

        const saved = await upsertLot(row, target, img.images)
        if (!saved) { counters.records_failed++; continue }
        if (saved.isNew) counters.records_inserted++; else counters.records_updated++
        console.log(`${logPrefix} ✓ saved (${img.images.length} images)`)
      } catch (rowErr) {
        console.log(`${logPrefix} ROW ERROR: ${rowErr.message}`)
        counters.records_failed++
      }
    }

    if (shutdownRequested) break
    if (!(await goToNextListingPage(page, LANGMODE))) { console.log('\n[PAGE] Last page reached'); break }
    pageNum++
  }
  return null
}

// ── One price: one target ─────────────────────────────────────────────────────

/** The one-price listing row in the shape lib/writer.js expects (same mapping as the CarzNexus scraper). */
function normalizeOnePriceRow(r) {
  return {
    ex_key: r.ex_key, lot_number: r.ex_key, auction_date: r.deadline_date, auction_time: r.deadline_time,
    manufacture_year: r.manufacture_year, mileage_km: r.mileage_km, color: r.color_ja, model_code: r.model_code, grade: r.grade_ja,
    transmission_raw: r.shift_type, engine_cc: r.displacement_cc, auction_grade: r.auction_grade, equipment_raw: r.equipment_raw,
    wholesale_price: r.price_jpy, thumb_parsed: r.thumb_parsed,
    venue: r.venue_name_ja ? (r.counter_no != null ? `${r.venue_name_ja}-Counter-${r.counter_no}` : r.venue_name_ja) : null,
    raw_extra: { price_masked: r.price_masked, price_reveal_date: r.price_reveal_date, price_reveal_time: r.price_reveal_time, score_letter: r.score_letter },
  }
}

async function processOnePriceTarget(page, target, counters) {
  await goToSearchDirect(page, 'one_price')
  await selectAllVenues(page, VENUES.codes)
  await selectBrand(page, target.maker_code)
  if (!(await selectModel(page, target.car_code))) { console.log(`\n[TARGET] No results at model step for: ${target.label}`); return 'No results at model step' }

  const hits = await applyFilter(page, target, 'one_price')
  if (hits === 0) { console.log(`\n[TARGET] No results after filter for: ${target.label}`); return 'No results after filter' }
  await goToListingPage(page)

  let pageNum = 1
  while (true) {
    if (shutdownRequested) break
    console.log(`\n[PAGE ${pageNum}]`)
    const rawRows = await extractOnePriceListingRows(page)
    console.log(`  Rows on page: ${rawRows.length}`)
    for (let i = 0; i < rawRows.length; i++) {
      if (shutdownRequested) break
      const row = normalizeOnePriceRow(rawRows[i])
      const logPrefix = `  ROW ${i + 1} [${row.ex_key}]:`
      counters.records_scraped++
      if (isOthersGrade(row.grade)) { console.log(`${logPrefix} grade is OTHERS - skip (never scraped)`); continue }
      // the one-price site is Japanese: its variant names are Japanese too, so only the model codes can narrow it
      if (!codeMatches(target, row.model_code)) { console.log(`${logPrefix} model code ${row.model_code || '?'} is not on the target list - skip`); continue }
      try {
        const existing = await findExistingOnePrice(row.ex_key)
        if (existing) { await updateOnePrice(existing.id, row); counters.records_updated++; console.log(`${logPrefix} already saved - refreshed`); continue }
        const img = await downloadAndUploadImages(page, row.thumb_parsed, row.ex_key, logPrefix)
        if (!img.success) { console.log(`${logPrefix} images failed: ${img.error}`); counters.images_failed++; counters.records_failed++; continue }
        counters.images_uploaded += img.images.length
        const saved = await upsertOnePrice(row, target, img.images)
        if (!saved) { counters.records_failed++; continue }
        if (saved.isNew) counters.records_inserted++; else counters.records_updated++
        console.log(`${logPrefix} saved (${img.images.length} images)`)
      } catch (rowErr) { console.log(`${logPrefix} ROW ERROR: ${rowErr.message}`); counters.records_failed++ }
    }
    if (shutdownRequested) break
    if (!(await goToNextListingPage(page, LANGMODE))) { console.log('\n[PAGE] Last page reached'); break }
    pageNum++
  }
  return null
}

// ── Session ───────────────────────────────────────────────────────────────────

async function enterAfterLogin(page) {
  if (MODE === 'history') await openMarketPriceFirstTime(page)
  else if (MODE === 'one_price') await openOneClickWizardFirstTime(page)
}

async function bringUpSession() {
  const userDataDir = path.join(__dirname, '.chrome-profile')
  const context = await chromium.launchPersistentContext(userDataDir, { headless: false, slowMo: 80 })
  const page = context.pages()[0] || (await context.newPage())
  page.setDefaultTimeout(60000)
  page.setDefaultNavigationTimeout(120000)
  // Do NOT accept()/dismiss(): the source site shows a prompt that must be clicked by a person, once.
  page.on('dialog', (d) => console.log(`\n>>> Browser dialog: "${d.message()}" — click it manually in the browser window.\n`))
  await login(page, LANGMODE)
  await enterAfterLogin(page)
  return { context, page }
}

async function recoverSession(page) {
  console.log('[RECOVER] Trying to log in again...')
  for (const wait of [0, 30000]) {
    if (wait) { console.log('[RECOVER] Waiting 30 s before the last try...'); await new Promise((r) => setTimeout(r, wait)) }
    try {
      await page.goto('about:blank', { timeout: 10000 }).catch(() => {})
      await login(page, LANGMODE)
      await enterAfterLogin(page)
      console.log('[RECOVER] Session recovered')
      return true
    } catch (e) { console.log(`[RECOVER] failed: ${e.message}`) }
  }
  return false
}

// ── Main ──────────────────────────────────────────────────────────────────────

const failedThisRun = new Set()

async function main() {
  console.log('═'.repeat(60))
  console.log(`  Scraper — mode: ${MODE}`)
  console.log(`  Instance: ${INSTANCE_ID}`)
  if (MODE === 'bid' || MODE === 'one_price') console.log(`  ${WEEKDAY ? `Day: ${DAY_TOKEN} (skipping ${config.skipVenues.join(', ') || 'none'})` : `Venue: ${VENUES.codes.length ? VENUES.names.join(', ') : 'ALL'}`}`)
  console.log(`  Years: ${config.yearFrom || 'any'}${config.yearTo ? '–' + config.yearTo : '+'}   Score: ${config.scoreMin || 'any'}+   Skipped brands: ${config.skipBrandCodes.size}`)
  console.log('  Ctrl+C once to stop cleanly after the current car.')
  if (MODE === 'bid' && WEEKDAY) {
    DAY_VENUES = await venuesForWeekday(WEEKDAY)
    console.log(DAY_VENUES ? `  ${DAY_NAMES[WEEKDAY]} venues (from the database): ${DAY_VENUES.names.join(', ')}` : `  ${DAY_NAMES[WEEKDAY]}: no venues set in the database - using the site's day list minus SKIP_VENUES`)
  }
  console.log('═'.repeat(60))

  let context, page
  try { ;({ context, page } = await bringUpSession()) } catch (err) { console.log(`[MAIN] Login failed: ${err.message}`); process.exit(1) }

  let processed = 0
  while (!shutdownRequested) {
    const claimed = await claimTarget(MODE, MIN_DAYS, failedThisRun)
    const target = claimed && withCriteria(claimed)
    if (!target) { console.log(`\n[MAIN] No more "${MODE}" targets to run.`); break }

    console.log('\n' + '═'.repeat(60))
    console.log(`[TARGET] ${target.label}   (maker ${target.maker_code}, model ${target.car_code}, years ${target.year_from || '?'}–${target.year_to || '?'})`)

    const runId = await createRun(target)
    const counters = { _startedAt: new Date(), records_scraped: 0, records_inserted: 0, records_updated: 0, records_failed: 0, images_uploaded: 0, images_failed: 0 }
    try {
      const note = MODE === 'history' ? await processHistoryTarget(page, target, counters) : MODE === 'one_price' ? await processOnePriceTarget(page, target, counters) : await processBidTarget(page, target, counters)
      await finalizeRun(runId, 'complete', counters, note)
      await completeTarget(target.id, runId)
      if (config.offerOnly) failedThisRun.add(target.id)      // offer mode ignores "done today", so remember what this run already did
      processed++
      console.log(`[TARGET DONE] ${target.label} — scraped ${counters.records_scraped}, new ${counters.records_inserted}, refreshed ${counters.records_updated}, failed ${counters.records_failed}, images ${counters.images_uploaded}`)
    } catch (err) {
      console.log(`\n[TARGET] Fatal error: ${err.message}`)
      await finalizeRun(runId, 'failed', counters, err.message)
      failedThisRun.add(target.id)
      await releaseTarget(target.id)
      processed++
      if (!(await recoverSession(page))) { console.log('[RECOVER] Cannot recover — exiting'); break }
    }
  }

  await context.close()
  console.log(`\n[ALL DONE] targets processed: ${processed}`)
  process.exit(0)
}

main().catch((err) => { console.log('[FATAL]', err); process.exit(1) })

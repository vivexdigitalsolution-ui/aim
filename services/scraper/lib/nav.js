'use strict'

/**
 * lib/nav.js
 * USS wizard navigation — shared by both scrape modes:
 *   'one_price' — One-Price (ワンクリック), JP-only, entered via the top.aspx
 *                 popup once per session then a direct search URL after that.
 *   'bid'       — Bidding / Preliminary Inspection, EN or JP, entered by
 *                 direct URL every time (no popup at all).
 *
 * Confirmed selectors:
 *   - Step ids (#StepHeadKaijo / #StepHeadBrand / #StepHeadModel / #StepHeadMore)
 *     are shared by both wizards — confirmed working for one_price via v1's
 *     uss-one-price-scraper.js, and separately confirmed working for the
 *     Preliminary Inspection page via uss-brand-model-scraper.js's live runs.
 *   - #ModelYearFromOption / #ModelYearToOption / ScoreOption checkboxes /
 *     #StepHeadMore / #ResultCount / a[href="javascript:toList();"] come from
 *     live HTML captures of modelMore.aspx (JP for one-price, EN for bidding —
 *     ids are identical across languages, only text differs).
 *   - #MaxRow / pagination come from live HTML captures of modelThumb.aspx.
 *     Pagination link TEXT differs by language: "次へ" (JP) vs "[Next]" (EN) —
 *     this is the one place language actually changes a selector value.
 *
 * "Restart point": per direct instruction, if anything fails mid-target, or
 * when moving to the next target, navigate straight back to the search URL
 * rather than re-doing any popup dance — for one_price, the ワンクリック popup
 * is only needed once, right after login; bidding never needs it at all.
 */

const ONE_CLICK_TOP_URL     = 'https://ssl.cis6200.jp/cis/y5816001/jp/top.aspx'
const ONE_CLICK_SEARCH_URL  = 'https://ssl.cis6200.jp/cis/y5816001/jp/oneClick/model/modelSch.aspx'
const PRELIM_SEARCH_URL_EN  = 'https://ssl.cis6200.jp/cis/y5816001/en/prelim/model/modelSch.aspx'
const TOP_URL_EN            = 'https://ssl.cis6200.jp/cis/y5816001/en/top.aspx'
const MARKET_SEARCH_URL_EN  = 'https://ssl.cis6200.jp/cis/y5816001/en/market/model/modelSch.aspx'

// Fixed score policies per direct instruction — different set per mode.
// Skip whichever are disabled (0 available) rather than treating that as an
// error. Values confirmed from live modelMore.aspx captures (both languages
// share the same ScoreOption values — name="ScoreOption").
const SCORE_CHECKBOX_VALUES = {
  one_price: { S: '1', '6': '10', '5': '4', '4.5': '11', '4': '5' },
  bid:       { S: '1', '6': '10', '5': '4', '4.5': '11', '4': '5', '3.5': '12' },
}

// Market Price (history) score checkboxes, best first, with a numeric rank so a target's
// score_min can pick "everything at or above it" (score_min 4.0 -> S,6,5,4.5,4 — NOT 3.5).
// Values are the same ScoreOption values as the other wizards.
const HISTORY_SCORES = [
  { label: 'S',   value: '1',  rank: 7   },
  { label: '6',   value: '10', rank: 6   },
  { label: '5',   value: '4',  rank: 5   },
  { label: '4.5', value: '11', rank: 4.5 },
  { label: '4',   value: '5',  rank: 4   },
  { label: '3.5', value: '12', rank: 3.5 },
]

// Pagination "next" link text per language.
const NEXT_LINK_TEXT = { jp: '次へ', en: '[Next]' }

// ── One-time entry for One-Price: top.aspx -> ワンクリック popup -> 検索する ──

async function openOneClickWizardFirstTime(page) {
  console.log('[NAV] Opening One-Click wizard via top.aspx popup (first entry this session)...')
  await page.goto(ONE_CLICK_TOP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(1000)

  const [popup] = await Promise.all([
    page.context().waitForEvent('page', { timeout: 60000 }),
    page.locator('div.btnAddTitle').click(),
  ])
  await popup.waitForLoadState('domcontentloaded')

  await popup.locator('a[href="javascript:toBuy();"]').click()
  await page.waitForTimeout(800)
  try { if (!popup.isClosed()) await popup.close() } catch {}

  await page.waitForSelector('input[name="UssOption"]', { timeout: 60000 })
  console.log('[NAV] One-Click wizard ready (Site step)')
}

// ── Restart point / direct entry for every target — mode-aware ──────────────

async function goToSearchDirect(page, mode) {
  const url = mode === 'bid' ? PRELIM_SEARCH_URL_EN : ONE_CLICK_SEARCH_URL
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('input[name="UssOption"]', { timeout: 60000 })
}

// ── Step 1: Site (ALL USS pre-checked) — shared ──────────────────────────────

// venueCodes empty = ALL USS (default). Otherwise tick only those venues (codes from lib/venues.js) and make sure ALL USS is off.
async function selectAllVenues(page, venueCodes = []) {
  const cb = page.locator('input[name="UssOption"][value="@U"]')
  if (venueCodes.length === 0) {
    if (!(await cb.isChecked())) await cb.click()
  } else {
    for (const code of venueCodes) {
      const v = page.locator(`input[name="UssOption"][value="${code}"]`)
      if (await v.count() === 0) throw new Error(`Venue checkbox not found for code=${code}`)
      if (!(await v.isChecked())) await v.click()
    }
    if (await cb.isChecked()) await cb.click()   // the page may untick ALL USS by itself; if not, do it
    // ticking/unticking can toggle the others (ALL USS ↔ single venues) — confirm the final state is exactly what was asked
    for (const code of venueCodes) {
      const v = page.locator(`input[name="UssOption"][value="${code}"]`)
      if (!(await v.isChecked())) await v.click()
    }
    if (await cb.isChecked()) throw new Error('ALL USS is still ticked — cannot limit the run to the chosen venue(s)')
    for (const code of venueCodes) {
      if (!(await page.locator(`input[name="UssOption"][value="${code}"]`).isChecked())) throw new Error(`Venue ${code} could not be ticked`)
    }
    console.log(`[NAV] Venue step: ${venueCodes.join(', ')} only`)
  }
  await page.locator('#StepHeadKaijo').click()
  await page.waitForSelector('input[name="BrandCodeOption"]', { timeout: 60000 })
  await page.waitForTimeout(400)
}

// Weekday entry: pick a day in the "a day" list (the page then ticks that day's venues), then untick the venues we don't want.
// weekday: 1 = Monday ... 7 = Sunday.  skipCodes: venue codes (lib/venues.js) to untick afterwards.
async function selectWeekdayVenues(page, weekday, skipCodes = []) {
  await page.waitForSelector('#UssWeekOption', { timeout: 60000 })
  await page.selectOption('#UssWeekOption', String(weekday))   // fires the page's own setUssWeek()
  await page.waitForTimeout(800)

  const boxes = page.locator('input[name="UssOption"]:not([value="@U"])')
  const tickedNow = async () => page.evaluate(() =>
    [...document.querySelectorAll('input[name="UssOption"]')].filter((c) => c.checked && c.value !== '@U')
      .map((c) => ({ code: c.value, name: (c.closest('label')?.textContent || '').trim() })))

  console.log(`[NAV] Day ${weekday} ticked: ${(await tickedNow()).map((v) => `${v.name} (${v.code})`).join(', ') || 'none'}`)

  for (const code of skipCodes) {
    const v = page.locator(`input[name="UssOption"][value="${code}"]`)
    if (await v.count() === 0) continue                      // that venue has no auction on this day
    if (await v.isChecked()) await v.click()
  }
  await page.waitForTimeout(300)

  // unticking can toggle the others: confirm the final state is exactly what was asked
  const final = await tickedNow()
  const wrong = final.filter((v) => skipCodes.includes(v.code))
  if (wrong.length) throw new Error(`Could not untick: ${wrong.map((v) => v.name).join(', ')}`)
  if (final.length === 0) throw new Error('No venue left ticked for this day after the skip list — nothing to scrape')
  if (await page.locator('input[name="UssOption"][value="@U"]').isChecked()) throw new Error('ALL USS is still ticked — cannot limit the run to the chosen venues')
  console.log(`[NAV] Venues to scrape: ${final.map((v) => `${v.name} (${v.code})`).join(', ')}`)

  await page.locator('#StepHeadKaijo').click()
  await page.waitForSelector('input[name="BrandCodeOption"]', { timeout: 60000 })
  await page.waitForTimeout(400)
  return final
}

// ── Step 2: Manufacturer (from target.maker_code) — shared ──────────────────

async function selectBrand(page, makerCode) {
  const cb = page.locator(`input[name="BrandCodeOption"][value="${makerCode}"]`)
  if (await cb.count() === 0) throw new Error(`Brand checkbox not found for maker_code=${makerCode}`)
  if (!(await cb.isChecked())) await cb.click()
  await page.locator('#StepHeadBrand').click()
  await page.waitForSelector('input[name="CarCategoryNoOption"]', { timeout: 60000 })
  await page.waitForTimeout(300)
}

// ── Step 3: Model (from target.car_code) — shared, returns whether results exist

async function selectModel(page, carCode) {
  const cb = page.locator(`input[name="CarCategoryNoOption"][value="${carCode}"]`)
  // USS only lists the models that have stock in this search today. A model that is not in the list simply has nothing to scrape
  // right now: report "no results" (the caller completes the target) instead of failing it, which made the same target fail and be
  // claimed again in an endless loop.
  if (await cb.count() === 0) {
    console.log(`[NAV] Model car_code=${carCode} is not in USS's list today (no stock) — nothing to scrape for this target`)
    return false
  }
  if (!(await cb.isChecked())) await cb.click()
  await page.locator('#StepHeadModel').click()

  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(1500) // buffer for USS server rendering, matches v1

  return (await page.locator('a[href="javascript:toMore();"]').count()) > 0
}

// ── Step 4: Year + Score filter -> hit count — mode-aware score set ─────────

async function applyFilter(page, target, mode) {
  const scoreValues = SCORE_CHECKBOX_VALUES[mode]
  if (!scoreValues) throw new Error(`Unknown mode: ${mode}`)

  console.log('[FILTER] Opening detailed criteria...')
  await page.locator('a[href="javascript:toMore();"]').click()
  await page.waitForSelector('#ModelYearFromOption', { timeout: 60000 })
  await page.waitForTimeout(300)

  if (target.year_from) {
    await page.selectOption('#ModelYearFromOption', String(target.year_from)).catch(() => {})
    console.log(`[FILTER] Year From = ${target.year_from}`)
  }
  if (target.year_to) {
    await page.selectOption('#ModelYearToOption', String(target.year_to)).catch(() => {})
    console.log(`[FILTER] Year To = ${target.year_to}`)
  }

  // score_min (from .env SCORE_MIN): tick the scores at or above it, make sure the lower ones are off. S counts as the best score.
  const rank = (label) => (label === 'S' ? 99 : Number(label))
  const minScore = target.score_min == null ? null : Number(target.score_min)
  for (const [label, value] of Object.entries(scoreValues)) {
    const cb = page.locator(`input[name="ScoreOption"][value="${value}"]`)
    if (await cb.count() === 0) continue
    const wanted = minScore == null || rank(label) >= minScore
    const isDisabled = await cb.isDisabled().catch(() => true)
    if (isDisabled) {
      console.log(`[FILTER] Score ${label} disabled (0 available) — skip`)
      continue
    }
    if (wanted && !(await cb.isChecked())) await cb.check()
    if (!wanted && (await cb.isChecked())) await cb.uncheck()
  }
  if (minScore != null) console.log(`[FILTER] Score ${minScore} and above`)

  await page.locator('#StepHeadMore').click()
  await page.waitForSelector('#ResultCount', { timeout: 60000 })
  await page.waitForTimeout(800)

  const raw = (await page.locator('#ResultCount').textContent()) || '0'
  const hitCount = parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0
  console.log(`[FILTER] Hits: ${hitCount}`)
  return hitCount
}

// ── Step 5: Listing page, 100 rows/page — shared ─────────────────────────────

async function goToListingPage(page) {
  console.log('[RESULTS] Opening listing page...')
  await page.locator('a[href="javascript:toList();"]').click()
  await page.waitForSelector('#MainContents_Exhibit_TopResultCount', { timeout: 60000 })
  await page.waitForTimeout(500)

  const curMaxRow = await page.locator('#MaxRow').inputValue().catch(() => '10')
  if (curMaxRow !== '100') {
    await page.selectOption('#MaxRow', '100')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('#MainContents_Exhibit_TopResultCount', { timeout: 60000 })
    await page.waitForTimeout(500)
  }
}

// ── Pagination — link text differs by language ("次へ" vs "[Next]") ─────────

async function goToNextListingPage(page, langMode) {
  const nextText = NEXT_LINK_TEXT[langMode]
  const links = page.locator('li.pager a')
  const count = await links.count()
  for (let i = 0; i < count; i++) {
    const text = ((await links.nth(i).textContent()) || '').trim()
    if (text === nextText) {
      await links.nth(i).click()
      await page.waitForSelector('#MainContents_Exhibit_TopResultCount', { timeout: 60000 })
      await page.waitForTimeout(500)
      return true
    }
  }
  return false
}

// ── Market Price (history) ───────────────────────────────────────────────────
//   top.aspx -> "Market Price" -> venue step (skipped) -> brand -> model ->
//   Add Criteria (years + scores) -> results -> listing (100 rows, past 12 auction times)

/** Entry: English top page, then the Market Price image link. Once per session. */
async function openMarketPriceFirstTime(page) {
  console.log('[NAV] Opening Market Price via top.aspx (first entry this session)...')
  await page.goto(TOP_URL_EN, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(1000)
  try {
    await page.locator('a[href="en/market/model/modelSch.aspx"]').first().click({ timeout: 20000 })
  } catch {
    // the link is not on the page (a notice / pop-up in the way, or a different page): save a picture and go straight to the wizard's address
    console.log(`[NAV] Market Price link not found on ${page.url()} — trying the wizard address directly (picture: scraper/nav-fail.png)`)
    await page.screenshot({ path: require('path').join(__dirname, '..', 'nav-fail.png') }).catch(() => {})
    await page.goto(MARKET_SEARCH_URL_EN, { waitUntil: 'domcontentloaded', timeout: 120000 })
  }
  await page.waitForSelector('#StepHeadKaijo', { timeout: 60000 })
  console.log('[NAV] Market Price wizard ready (Site step)')
}

/** Restart point for every target: the wizard's own URL, falling back to the top-page entry. */
async function goToMarketSearch(page) {
  try {
    await page.goto(MARKET_SEARCH_URL_EN, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForSelector('#StepHeadKaijo', { timeout: 30000 })
  } catch {
    console.log('[NAV] Direct Market Price URL did not open the wizard — going in through top.aspx')
    await openMarketPriceFirstTime(page)
  }
}

/** Step 1: no venue filter for history — straight to the next step. */
async function skipVenueStep(page) {
  await page.locator('#StepHeadKaijo').click()
  await page.waitForSelector('input[name="BrandCodeOption"]', { timeout: 60000 })
  await page.waitForTimeout(400)
}

/** Criteria step for history: years from the target, scores >= target.score_min. Returns the hit count. */
async function applyHistoryFilter(page, target) {
  console.log('[FILTER] Opening detailed criteria...')
  await page.locator('a[href="javascript:toMore();"]').click()
  await page.waitForSelector('#ModelYearFromOption', { timeout: 60000 })
  await page.waitForTimeout(300)

  if (target.year_from) {
    await page.selectOption('#ModelYearFromOption', String(target.year_from))
      .catch(() => console.log(`[FILTER] Year From ${target.year_from} is not offered — leaving "no lower limit"`))
    console.log(`[FILTER] Year From = ${target.year_from}`)
  }
  if (target.year_to) {
    await page.selectOption('#ModelYearToOption', String(target.year_to))
      .catch(() => console.log(`[FILTER] Year To ${target.year_to} is not offered — leaving "no upper limit"`))
    console.log(`[FILTER] Year To = ${target.year_to}`)
  }

  const min = target.score_min == null ? null : Number(target.score_min)
  const wanted = HISTORY_SCORES.filter(s => min == null || s.rank >= min)
  const wantedValues = new Set(wanted.map(s => s.value))
  let checkedCount = 0

  // Set every score box explicitly: tick the wanted ones, untick anything else that's ticked.
  const boxes = page.locator('input[name="ScoreOption"]')
  const n = await boxes.count()
  for (let i = 0; i < n; i++) {
    const cb = boxes.nth(i)
    const value = await cb.getAttribute('value')
    const disabled = await cb.isDisabled().catch(() => true)
    if (wantedValues.has(value)) {
      if (disabled) { console.log(`[FILTER] Score ${HISTORY_SCORES.find(s => s.value === value)?.label} disabled (0 available) — skip`); continue }
      if (!(await cb.isChecked())) await cb.check()
      checkedCount++
    } else if (await cb.isChecked().catch(() => false)) {
      await cb.uncheck().catch(() => {})
    }
  }
  console.log(`[FILTER] Scores >= ${min ?? 'any'}: ${wanted.map(s => s.label).join(', ')} (${checkedCount} ticked)`)
  if (checkedCount === 0) return 0

  await page.locator('#StepHeadMore').click()
  await page.waitForSelector('#ResultCount', { timeout: 60000 })
  await page.waitForTimeout(800)

  const raw = (await page.locator('#ResultCount').textContent()) || '0'
  const hitCount = parseInt(raw.replace(/[^0-9]/g, ''), 10) || 0
  console.log(`[FILTER] Hits: ${hitCount}`)
  return hitCount
}

/** Total shown at the top of the listing page (changes when the auction-time window changes). */
async function readTotalResultCount(page) {
  const raw = (await page.locator('#MainContents_Exhibit_TopResultCount').first().textContent({ timeout: 5000 })) || ''
  const n = parseInt(raw.replace(/[^0-9]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}

/**
 * Listing page: pick "Past N Auction Times" and WAIT until the table has really reloaded —
 * widening the window reloads the results and can take a while, and scraping too early would
 * read the old (smaller) table. Done when the radio is ticked and the total has settled
 * (changed from before, or — if the window adds nothing — unchanged for a while) for 3 checks.
 * Also re-asserts 100 rows/page, which a reload can reset.
 * @returns {number|null} the settled total
 */
async function setAuctionTerm(page, term = 12) {
  // the site only offers some values: if the wanted one is not there, take the smallest offered value that is at least as wide
  const offered = (await page.locator('input[name="AuctionTermOption"]').evaluateAll((els) => els.map((e) => parseInt(e.value, 10)))).filter(Number.isFinite).sort((a, b) => a - b)
  if (offered.length && !offered.includes(term)) {
    const wider = offered.find((v) => v >= term) ?? offered[offered.length - 1]
    console.log(`[RESULTS] Past ${term} auction times is not offered (options: ${offered.join(', ')}): using ${wider}`)
    term = wider
  }
  const radio = page.locator(`input[name="AuctionTermOption"][value="${term}"]`)
  if ((await radio.count()) === 0) throw new Error(`Auction time option ${term} not found on the listing page`)

  const before = await readTotalResultCount(page).catch(() => null)
  if (await radio.isChecked().catch(() => false)) {
    console.log(`[RESULTS] Past ${term} auction times already selected (${before ?? '?'} records)`)
  } else {
    console.log(`[RESULTS] Selecting past ${term} auction times (was ${before ?? '?'} records) — waiting for the reload...`)
    await radio.click()
  }

  const started = Date.now()
  let last = null
  let stable = 0
  let total = before
  while (Date.now() - started < 120000) {
    await page.waitForTimeout(1000)
    let cur = null
    try { cur = await readTotalResultCount(page) } catch { stable = 0; continue }   // page is mid-reload
    const ticked = await radio.isChecked().catch(() => false)
    const moved  = cur !== before || Date.now() - started > 8000      // changed, or nothing more to load
    if (ticked && cur != null && moved) {
      if (cur === last) stable++
      else { last = cur; stable = 1 }
      if (stable >= 3) { total = cur; break }
    } else {
      last = cur
      stable = 0
    }
  }
  if (stable < 3) throw new Error(`Timed out waiting for the past-${term}-auction-times table to reload`)

  // A reload can drop back to a smaller page size
  const maxRow = await page.locator('#MaxRow').inputValue().catch(() => '100')
  if (maxRow !== '100') {
    await page.selectOption('#MaxRow', '100')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('#MainContents_Exhibit_TopResultCount', { timeout: 60000 })
    await page.waitForTimeout(1500)
  }

  console.log(`[RESULTS] Past ${term} auction times loaded: ${total ?? '?'} records`)
  return total
}

module.exports = {
  openOneClickWizardFirstTime,
  goToSearchDirect,
  selectAllVenues,
  selectWeekdayVenues,
  selectBrand,
  selectModel,
  applyFilter,
  goToListingPage,
  goToNextListingPage,
  // Market Price (history)
  openMarketPriceFirstTime,
  goToMarketSearch,
  skipVenueStep,
  applyHistoryFilter,
  readTotalResultCount,
  setAuctionTerm,
  HISTORY_SCORES,
}

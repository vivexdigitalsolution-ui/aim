'use strict'

/**
 * lib/filters.js
 * Apply ASNET search filters.
 * Based directly on v1 applyFilter() which is proven to work.
 *
 * Key points from v1:
 *   - waitForSelector for MakerCode before starting
 *   - selectOption for maker — no wait after, AJAX loads CarCode
 *   - waitForFunction checking if specific car_code value EXISTS in CarCode options
 *   - selectOption for car_code
 *   - waitForFunction checking if specific form_code value EXISTS in CarFormCode options
 *   - selectOption for form_code
 *   - year, score, price, mileage, transmission — direct selectOption, no wait
 *   - waitForTimeout(3000) before clicking search
 *   - page.click('.searchList') then waitForList() — NOT waitForNavigation
 *
 * Lot type checkboxes (AA-Bid / AA-One Price):
 *   These are hidden inputs with styled labels. Use JavaScript click via
 *   page.evaluate() to avoid Playwright's visibility check which times out.
 */

const { waitForList, loadsNewPage, NoResultsError } = require('./page')

// ── Navigate to search page ───────────────────────────────────────────────────

async function goToSearchPage(page) {
  await page.goto('https://www.asnet.jp/asnet/search/ippatsusearchlist', {
    waitUntil: 'domcontentloaded',
    timeout:   120000,
  })
  await page.waitForSelector('#IppatsuSearch_MultiForm_0__MakerCode', { timeout: 120000 })
  console.log('[FILTER] Search page loaded')
}

// ── Apply all filters ─────────────────────────────────────────────────────────

async function applyFilters(page, target) {
  console.log('========================')
  console.log('APPLY FILTER:', target.label)
  console.log('========================')

  await page.waitForSelector('#IppatsuSearch_MultiForm_0__MakerCode', { timeout: 120000 })

  // ── Sale type: AS-One Price only (AS-One Price and AS-One Price 3stars/5stars stay ticked) ──
  await uncheckAuctionTypes(page)

  // ── Make (required) ────────────────────────────────────────────────────────
  console.log('SET MAKER:', target.maker_code)
  await page.selectOption('#IppatsuSearch_MultiForm_0__MakerCode', String(target.maker_code))

  // ── Car Name (optional) — wait for specific value to appear ───────────────
  if (target.car_code) {
    await page.waitForFunction(
      (carCode) => {
        const select = document.querySelector('#IppatsuSearch_MultiForm_0__CarCode')
        return select && Array.from(select.options).some(o => o.value === String(carCode))
      },
      String(target.car_code),
      { timeout: 120000 }
    )
    console.log('SET CAR NAME:', target.car_code)
    await page.selectOption('#IppatsuSearch_MultiForm_0__CarCode', String(target.car_code))
  }

  // ── Model Code (optional) — wait for specific value to appear ─────────────
  if (target.form_code) {
    await page.waitForFunction(
      (formCode) => {
        const select = document.querySelector('#IppatsuSearch_MultiForm_0__CarFormCode')
        return select && Array.from(select.options).some(o => o.value === String(formCode))
      },
      String(target.form_code),
      { timeout: 120000 }
    )
    console.log('SET FORM CODE:', target.form_code)
    await page.selectOption('#IppatsuSearch_MultiForm_0__CarFormCode', String(target.form_code))
  }

  // ── Year From ──────────────────────────────────────────────────────────────
  if (target.year_from) {
    console.log('SET YEAR FROM:', target.year_from)
    await page.selectOption('#IppatsuSearch_ModelYearFrom', String(target.year_from))
  }

  // ── Score ──────────────────────────────────────────────────────────────────
  // Values: "S","6","5","4.5","4","3.5","3","2","1"
  // score_min stored as numeric: 4 → "4", 4.5 → "4.5"
  if (target.score_min != null) {
    const scoreValue = Number(target.score_min) % 1 === 0
      ? String(Math.round(target.score_min))
      : String(target.score_min)
    console.log('SET SCORE:', scoreValue)
    await page.selectOption('#IppatsuSearch_SearchPointTotal', scoreValue)
  }

  // ── Max price ──────────────────────────────────────────────────────────────
  if (target.max_price) {
    console.log('SET MAX PRICE:', target.max_price)
    try { await page.selectOption('#IppatsuSearch_PublishPriceTo', String(target.max_price)) }
    catch (err) { console.log('MAX PRICE SELECT FAILED:', err.message) }
  }

  // ── Max mileage ────────────────────────────────────────────────────────────
  if (target.max_mileage) {
    console.log('SET MAX MILEAGE:', target.max_mileage)
    try { await page.selectOption('#IppatsuSearch_MileageTo', String(target.max_mileage)) }
    catch (err) { console.log('MAX MILEAGE SELECT FAILED:', err.message) }
  }

  // ── Transmission ───────────────────────────────────────────────────────────
  if (target.transmission) {
    const shiftMap = { 'MT': '1', 'AT': '2' }
    const shiftVal = shiftMap[target.transmission?.toUpperCase()]
    if (shiftVal) {
      console.log('SET TRANSMISSION:', target.transmission)
      try { await page.selectOption('#IppatsuSearch_ShiftKbn', shiftVal) }
      catch (err) { console.log('TRANSMISSION SELECT FAILED:', err.message) }
    }
  }

  // Fixed wait before clicking search — same as v1
  await page.waitForTimeout(3000)

  // checked again right before the search: the form may tick a box back while it loads the model lists
  await assertAuctionTypesOff(page)

  // ── Click search — same pattern as v1 ─────────────────────────────────────
  console.log('CLICK SEARCH')
  await page.click('.searchList')
  await waitForList(page)
  console.log('SEARCH DONE')

  // ── Set page size to 100 ───────────────────────────────────────────────────
  // (--inspect leaves the page as the site gives it)
  if (!target.keepPageSize) await setPageSize(page)

  console.log('FILTER COMPLETE')
}

// ── Sale type checkboxes ─────────────────────────────────────────────────────
// The checkboxes are hidden inputs styled with labels.
// Playwright .check()/.uncheck() timeout on hidden elements.
// Use JS to click the label, which is always visible and triggers the toggle.

/** The two sale types that are NOT wanted. */
const AUCTION_TYPES = { checkboxUseAA: 'AA-Bid', checkboxUseAAOneprice: 'AA-One Price' }

async function uncheckAuctionTypes(page) {
  await page.evaluate((ids) => {
    for (const id of ids) {
      const checkbox = document.getElementById(id)
      if (!checkbox || !checkbox.checked) continue
      const label = document.querySelector(`label[for="${id}"]`)
      if (label) label.click()
      else checkbox.click()
    }
  }, Object.keys(AUCTION_TYPES))
  await assertAuctionTypesOff(page)
  console.log('SALE TYPE: AA-Bid and AA-One Price are off')
}

/** Stops the search when a box is missing or still ticked: searching anyway would mix in cars of the wrong sale type. */
async function assertAuctionTypesOff(page) {
  const states = await page.evaluate((ids) => ids.map((id) => { const c = document.getElementById(id); return [id, c ? c.checked : null] }), Object.keys(AUCTION_TYPES))
  const bad = states.filter(([, checked]) => checked !== false)
  if (bad.length) throw new Error('sale type not set, search stopped: ' + bad.map(([id, checked]) => `${AUCTION_TYPES[id]} ${checked === null ? 'box not found' : 'is still ticked'}`).join(', '))
}

// ── Set page size to 100 ─────────────────────────────────────────────────────

async function setPageSize(page) {
  console.log('SET PAGE SIZE 100')
  try {
    await page.waitForSelector('#pageSizeSelect', { timeout: 30000 })

    // Check if already 100 — no need to change
    const current = await page.$eval('#pageSizeSelect', el => el.value)
    if (current === '100') {
      console.log('PAGE SIZE ALREADY 100')
      return
    }

    // The page is complete here, so a shorter list means every car is already on it
    const rows = await page.$$eval('tr[data-key]', (r) => r.length)
    if (rows < 50) { console.log('PAGE SIZE: everything fits on one page'); return }
    // choosing 100 sends the search again as a new page
    await loadsNewPage(page, () => page.selectOption('#pageSizeSelect', '100'))
    console.log('PAGE SIZE SET TO 100')
  } catch (err) {
    console.log('PAGE SIZE not changed:', err.message.split('\n')[0])
  }
}

module.exports = { goToSearchPage, applyFilters }

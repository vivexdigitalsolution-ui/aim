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

const { waitForList, NoResultsError } = require('./page')

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

  // ── Lot type: uncheck AA-Bid and AA-One Price ──────────────────────────────
  // These checkboxes are hidden inputs — use JS click on the label element
  // to avoid Playwright visibility timeout. Only uncheck if lot_type = one_price.
  if (!target.lot_type_filter || target.lot_type_filter === 'one_price') {
    await uncheckLotTypeViaJS(page, 'checkboxUseAA',         'AA-Bid')
    await uncheckLotTypeViaJS(page, 'checkboxUseAAOneprice', 'AA-One Price')
  }

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

  // ── Click search — same pattern as v1 ─────────────────────────────────────
  console.log('CLICK SEARCH')
  await page.click('.searchList')
  await waitForList(page)
  console.log('SEARCH DONE')

  // ── Set page size to 100 ───────────────────────────────────────────────────
  await setPageSize(page)

  console.log('FILTER COMPLETE')
}

// ── Uncheck lot type checkbox via JavaScript ──────────────────────────────────
// The checkboxes are hidden inputs styled with labels.
// Playwright .check()/.uncheck() timeout on hidden elements.
// Use JS to click the label, which is always visible and triggers the toggle.

async function uncheckLotTypeViaJS(page, checkboxId, name) {
  const wasUnchecked = await page.evaluate((id) => {
    const checkbox = document.getElementById(id)
    if (!checkbox) return false
    if (!checkbox.checked) return true  // Already unchecked — nothing to do

    // Click the label to toggle the checkbox
    const label = document.querySelector(`label[for="${id}"]`)
    if (label) {
      label.click()
    } else {
      checkbox.click()
    }
    return true
  }, checkboxId)

  if (wasUnchecked) {
    console.log(`UNCHECKED: ${name}`)
  } else {
    console.log(`NOT FOUND: ${name} checkbox`)
  }
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

    // Changing page size triggers a full page navigation — same as search button
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }),
      page.selectOption('#pageSizeSelect', '100'),
    ])
    await waitForList(page)
    console.log('PAGE SIZE SET TO 100')
  } catch (err) {
    console.log('PAGE SIZE SELECT NOT FOUND — skipping:', err.message)
  }
}

module.exports = { goToSearchPage, applyFilters }

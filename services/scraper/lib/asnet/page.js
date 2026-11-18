'use strict'

/**
 * lib/page.js
 * Shared ASNET page navigation helpers.
 */

const MAX_WAIT_RETRIES = 5

// Thrown when ASNET returns a no-results page
class NoResultsError extends Error {
  constructor() { super('NO_RESULTS'); this.isNoResults = true }
}

/**
 * Check if the current page is the ASNET no-results page.
 * HTML: <div class="noItems"><h3>The vehicle with the desired conditions was not found</h3>
 * @param {import('playwright').Page} page
 * @returns {boolean}
 */
async function isNoResultsPage(page) {
  try {
    return await page.evaluate(() => {
      return !!document.querySelector('section.searchResult div.noItems')
    })
  } catch { return false }
}

/**
 * Wait for the results list to be present and stable.
 * Throws NoResultsError if ASNET shows the no-results page.
 * Retries up to MAX_WAIT_RETRIES times on other errors.
 * @param {import('playwright').Page} page
 */
async function waitForList(page) {
  for (let attempt = 1; attempt <= MAX_WAIT_RETRIES; attempt++) {
    try {
      // Wait for EITHER a result row OR the no-results div — whichever appears first
      await page.waitForSelector(
        'tr:has(td.cornerType_cornerPlace_auctionDay), section.searchResult div.noItems',
        { timeout: 60000 }
      )

      if (await isErrorPage(page)) throw new Error('ASNET_500')
      if (await isNoResultsPage(page)) throw new NoResultsError()

      await page.waitForTimeout(2000)
      return

    } catch (err) {
      if (err.isNoResults) throw err  // Propagate no-results immediately — no retry
      console.log(`[PAGE] waitForList attempt ${attempt}/${MAX_WAIT_RETRIES}: ${err.message}`)
      if (attempt >= MAX_WAIT_RETRIES) throw err
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.waitForTimeout(5000)
    }
  }
}

/**
 * Check if the current page is an ASNET system error page.
 * @param {import('playwright').Page} page
 * @returns {boolean}
 */
async function isErrorPage(page) {
  try {
    const body = await page.textContent('body')
    if (!body) return false
    return (
      body.includes('1CM001SE') ||
      body.includes('[500]') ||
      body.includes('System Error') ||
      body.includes('error occurred')
    )
  } catch {
    return false
  }
}

/**
 * Navigate to the next page of results.
 * @param {import('playwright').Page} page
 * @returns {boolean} true if navigated, false if no next page
 */
async function goToNextPage(page) {
  const nextBtn = page.locator('li.next a[data-page]')
  if (await nextBtn.count() === 0) return false

  await nextBtn.click({ force: true })
  await waitForList(page)
  return true
}

/**
 * Get current page number and total pages from pagination nav.
 * @param {import('playwright').Page} page
 * @returns {{ current: number, total: number }}
 */
async function getPagingInfo(page) {
  return await page.evaluate(() => {
    const nav = document.querySelector('li.paging nav')
    if (!nav) return { current: 1, total: 1 }

    const spanEl  = nav.querySelector('span')
    const current = spanEl ? parseInt(spanEl.textContent.trim(), 10) : 1

    const endLink = nav.querySelector('li.end a')
    if (endLink) {
      const total = parseInt(endLink.getAttribute('data-page'), 10)
      return { current, total: isNaN(total) ? current : total }
    }

    const links = nav.querySelectorAll('a[data-page]')
    let max = current
    for (const a of links) {
      const n = parseInt(a.getAttribute('data-page'), 10)
      if (!isNaN(n) && n > max) max = n
    }
    return { current, total: max }
  })
}

module.exports = { waitForList, isNoResultsPage, isErrorPage, goToNextPage, getPagingInfo, NoResultsError }

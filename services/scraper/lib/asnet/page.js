'use strict'

/**
 * lib/page.js
 * Shared ASNET page navigation helpers.
 */

const MAX_WAIT_RETRIES = 5

// How the result page behaves (seen with "node asnet.js --inspect"): it arrives slowly, a few rows at a time (about 20 seconds for 50), and
// the site's script, which makes Next and the per-page box work, only starts once all of it is there. Both of them send a form, which loads
// a whole new page. So: nothing is read or pressed before the page is COMPLETE, and a press waits for the new page.
const LOAD_TIMEOUT = 180000

// Thrown when ASNET answers a search with its "The search timed out" page: the same search is simply asked again
class SearchTimedOutError extends Error {
  constructor() { super('ASNET says the search timed out'); this.isSearchTimeout = true }
}

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
      // Wait until the list (or the no-results box) is there AND the whole page has arrived; the time-out page is noticed at once
      const state = await page.waitForFunction(
        () => {
          if (document.querySelector('tr:has(td.cornerType_cornerPlace_auctionDay), section.searchResult div.noItems')) return document.readyState === 'complete' ? 'list' : false
          return /The search timed out|タイムアウトしました/.test(document.title + ' ' + (document.body?.innerText || '')) ? 'timeout' : false
        },
        null,
        { timeout: LOAD_TIMEOUT, polling: 1000 },
      )
      if ((await state.jsonValue()) === 'timeout') throw new SearchTimedOutError()

      if (await isErrorPage(page)) throw new Error('ASNET_500')
      if (await isNoResultsPage(page)) throw new NoResultsError()

      await page.waitForTimeout(2000)
      return

    } catch (err) {
      if (err.isNoResults || err.isSearchTimeout) throw err  // no point reloading: no results is an answer, a timed-out search is asked again from the start
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
  if (!(await page.evaluate(() => !!document.querySelector('li.next a[data-page]')))) return false
  // The click is given to the link itself: a forced mouse click goes to a screen position, where something else may lie over the button
  await loadsNewPage(page, () => page.evaluate(() => {
    const links = [...document.querySelectorAll('li.next a[data-page]')]
    const link = links.find((a) => a.getClientRects().length > 0) || links[0]
    link.scrollIntoView({ block: 'center' })
    link.click()
  }))
  return true
}

/** Does something that makes the site load a new page, and returns once that new page is completely there. */
async function loadsNewPage(page, action) {
  const arrived = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT })
  arrived.catch(() => {})      // handled by the await below; without this a failed action would leave it unhandled
  // the page may already be leaving when the action reports back: that is not a failure
  await action().catch((e) => { if (!/context was destroyed|navigation/i.test(e.message)) throw e })
  await arrived
  await waitForList(page)
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

module.exports = { loadsNewPage, SearchTimedOutError, waitForList, isNoResultsPage, isErrorPage, goToNextPage, getPagingInfo, NoResultsError }

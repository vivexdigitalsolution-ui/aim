'use strict'

/**
 * lib/asnet/read.js — reads EVERY result page of one search, quickly, before anything is saved. Saving (with photo downloads) takes long,
 * and the list moves while cars are sold; reading it all first keeps that window small.
 * `complete` is true only when it is certain that no listed car was missed. Removing sold cars depends on it.
 */

/** The number in "819 units found"; null when the page does not say. */
async function unitsFound(page) {
  const text = await page.evaluate(() => document.body.innerText)
  const m = String(text || '').match(/([\d,]+)\s*units\s*found/i)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

/**
 * @param {object} o
 * @param {object} o.page
 * @param {{extractRows:Function, getPagingInfo:Function, goToNextPage:Function}} o.site
 * @param {number} o.maxPages
 * @param {(msg:string) => void} [o.log]
 * @param {() => void} [o.onTurn]            called just before the next page is asked for
 * @param {(page:number) => Promise<void>} [o.onStuck]   called when that page does not show
 * @returns {Promise<{rows:object[], complete:boolean, why:string|null, units:number|null}>}
 */
async function readAllPages({ page, site, maxPages, log = () => {}, onTurn, onStuck }) {
  const rows = [], totals = new Set()
  let offset = 0, why = null
  for (let p = 1; ; p++) {
    const { current, total } = await site.getPagingInfo(page)
    const units = await unitsFound(page)
    totals.add(units)
    const here = await site.extractRows(page, null, offset)
    offset += here.length
    rows.push(...here)
    log(`[page ${current}/${total}] ${here.length} rows${units != null ? ` (${units} units found)` : ''}`)
    if (current >= total) break
    if (p >= maxPages) { why = `stopped at the page limit (${maxPages})`; break }
    const first = here[0]?.lot_no
    onTurn?.()
    if (!(await site.goToNextPage(page))) { why = 'there was no button for the next page'; break }
    // the list is swapped in place: wait until it really shows other cars, or the same page would be read twice
    let moved = false
    for (let i = 0; i < 30 && !moved; i++) {
      const now = await site.extractRows(page, null, offset)
      moved = now.length > 0 && now[0].lot_no !== first
      if (!moved) await page.waitForTimeout(2000)
    }
    if (!moved) { why = `page ${current + 1} did not load`; await onStuck?.(current + 1); break }
  }
  const units = [...totals][0] ?? null
  const lots = new Set(rows.map((r) => r.lot_no).filter(Boolean))
  if (!why) {
    if (rows.some((r) => !r.lot_no)) why = 'some rows had no lot number'
    else if (totals.has(null)) why = 'the number of units found could not be read'
    else if (totals.size > 1) why = 'the list changed while it was being read'
    else if (lots.size !== units) why = `${lots.size} different cars read, but the site says ${units}`
  }
  return { rows, complete: !why, why, units }
}

module.exports = { unitsFound, readAllPages }

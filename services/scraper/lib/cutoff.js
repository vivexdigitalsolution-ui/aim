'use strict'

/**
 * SCRAPE rule (scrape.js): a car is taken only when its auction / deadline is at least 10 hours away (MIN_GAP_HOURS in .env), whatever the day.
 * So a car of today's auction is taken when there is still 10 hours or more, and a long run that passes midnight in Japan does not lose the next morning's cars.
 *
 * OFFER rule (offer.js): the first auction day that is recommended is TOMORROW (Japan time).
 * A scrape takes hours, so a car of today's auction may be over before the offer reaches the customer.
 *   --include-today   (on scrape.js / offer.js / enrich.js) turns this off: today's auctions are used again.
 */
const INCLUDE_TODAY = process.argv.includes('--include-today') || process.env.INCLUDE_TODAY === '1'
if (INCLUDE_TODAY) process.env.INCLUDE_TODAY = '1'      // the scrape that offer.js starts inherits it

const jstDay = (offsetDays) => new Date(Date.now() + 9 * 3600000 + offsetDays * 86400000).toISOString().slice(0, 10)

/** 'YYYY-MM-DD': lots with an auction_date before this are not scraped and not recommended. */
const firstAuctionDate = () => jstDay(INCLUDE_TODAY ? 0 : 1)

/** ISO time of 00:00 today in Japan: batches made from this moment on are "today's" batches. */
const todayStart = () => new Date(jstDay(0) + 'T00:00:00+09:00').toISOString()

const MIN_GAP_HOURS = Number(process.env.MIN_GAP_HOURS || 10)
/** true = the auction of this date ('YYYY-MM-DD') and time ('HH:MM', Japan; unknown = 09:00, the earliest an auction starts) is less than MIN_GAP_HOURS away (or over). */
function startsTooSoon(date, time) {
  if (INCLUDE_TODAY || !date) return false
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || '').trim())
  const at = Date.parse(`${date}T${m ? m[1].padStart(2, '0') + ':' + m[2] : '09:00'}:00+09:00`)
  return Number.isFinite(at) && at - Date.now() < MIN_GAP_HOURS * 3600000
}
/** today's date in Japan */
const jstToday = () => jstDay(0)

module.exports = { firstAuctionDate, todayStart, startsTooSoon, jstToday, MIN_GAP_HOURS, INCLUDE_TODAY }

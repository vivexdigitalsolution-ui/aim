'use strict'

/**
 * The first auction day that is scraped and recommended: TOMORROW (Japan time).
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

module.exports = { firstAuctionDate, todayStart, INCLUDE_TODAY }

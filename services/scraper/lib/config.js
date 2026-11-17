'use strict'

/**
 * lib/config.js — run settings read from scraper/.env (no database needed). Every key has a default, so a missing key is fine.
 *
 *   YEAR_FROM=2022            only cars made in this year or later
 *   YEAR_TO=                  (optional) newest year
 *   SCORE_MIN=4               only auction scores at or above this (S and 6 / 5 / 4.5 / 4 count; 3.5 and below do not)
 *   SKIP_VENUES=yokohama,rnagoya   venues unticked after a weekday is chosen (names from lib/venues.js)
 *   SKIP_BRAND_CODES=...      brands never scraped (codes from the source site's brand list)
 */

require('dotenv').config()

const list = (v, fallback) => String(v === undefined || v === '' ? fallback : v).split(',').map((s) => s.trim()).filter(Boolean)
const num  = (v, fallback) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback }

// Japan: Isuzu, Hino, Mitsubishi Fuso, UD Trucks
// US: America Toyota / Nissan / Honda / Mazda / Subaru, U.S.A. Other, Tesla
// Whole groups: Korea, South-Africa, Thailand, Construction/farm machines, Others, China, Overseas Others
const DEFAULT_SKIP_BRAND_CODES =
  '17,18,1A,1B,' +
  '3K,3L,3M,3N,3T,3Y,3S,' +
  'B0,C0,H0,I1,I3,J0,J1,J2,J3,J4,J5,JY,U0,X0,X1,X2,X6'

module.exports = {
  offerOnly: process.env.OFFER_ONLY === '1',      // set by offer.js: scrape only the offer report models, every venue, even if already done today
  yearFrom:  num(process.env.YEAR_FROM, 2022),
  yearTo:    num(process.env.YEAR_TO, null),
  scoreMin:  num(process.env.SCORE_MIN, 4),
  skipVenues:     list(process.env.SKIP_VENUES, 'yokohama,rnagoya'),
  skipBrandCodes: new Set(list(process.env.SKIP_BRAND_CODES, DEFAULT_SKIP_BRAND_CODES).map((c) => c.toUpperCase())),
}

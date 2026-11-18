'use strict'

/**
 * lib/asnet/map.js — turns one extracted ASNET list row (lib/asnet/extract.js) into a row of the `lots` table. Pure: no browser, no database.
 * What is certain (from the old CarzNexus scraper): the field names. What a real run still has to confirm is listed in docs/asnet-setup.md.
 */

const { cleanVenue, mapTransmission, toDeadline, fullModel } = require('../writer')

/** "2026-11-19" or "2026-11-19T10:30:00" -> { date, time } (time only when the page gives one) */
function splitDateTime(raw) {
  const m = String(raw || '').match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/)
  return m ? { date: m[1], time: m[2] || null } : { date: null, time: null }
}

/** The key that tells an ASNET car apart from every other source ("asnet:" + the ASNET exhibition number). */
const exKey = (lotNo) => 'asnet:' + String(lotNo).replace(/\s+/g, '')

/**
 * @param {object} row  from extractRows()
 * @returns {object|null} the lots record without photos (null when the row cannot be used)
 */
function rowToLot(row) {
  const { date, time } = splitDateTime(row.auction_date)
  if (!row.lot_no || !date || !row.make || !row.car_name) return null
  return {
    ex_key: exKey(row.lot_no),
    venue: cleanVenue(row.location),
    auction_date: date,
    lot_no: String(row.lot_no),
    bid_deadline: toDeadline(date, time),
    brand: row.make.toUpperCase(),
    model: fullModel(row.car_name.toUpperCase(), (row.grade || '').toUpperCase()),
    model_code: row.model_code_raw && row.model_code_raw !== '-1' ? row.model_code_raw.toUpperCase() : null,
    grade: row.score_grade || null,
    mfg_year: row.mfg_year_western ?? null,
    mileage_km: row.mileage ?? null,
    engine_cc: row.engine_cc ?? null,
    transmission: mapTransmission(row.gear),
    color: row.color || null,
    start_price_jpy: row.wholesale_price ?? null,       // ASNET's "publish price": to be confirmed on a real run (is it the auction start price?)
    source: 'asnet',
  }
}

/** The base of a chassis code without its emission prefix: "3BA-AGH40W" -> "AGH40W". */
const baseCode = (c) => String(c || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')

/**
 * Is this ASNET car probably the same physical car as one we already have from another source?
 * Same auction day, same make, same year, same mileage (within 1 km), and chassis codes that do not disagree.
 * @param {object} lot       the ASNET lots record
 * @param {object[]} others  lots of the same auction day that came from another source
 */
function isDuplicate(lot, others) {
  const code = baseCode(lot.model_code)
  return others.some((o) => o.ex_key !== lot.ex_key
    && o.auction_date === lot.auction_date
    && String(o.brand || '').toUpperCase() === lot.brand
    && o.mfg_year != null && lot.mfg_year != null && o.mfg_year === lot.mfg_year
    && o.mileage_km != null && lot.mileage_km != null && Math.abs(o.mileage_km - lot.mileage_km) <= 1
    && (!code || !o.model_code || baseCode(o.model_code) === code))
}

/** Normalised name for matching an ASNET dropdown entry to a name we already know: letters and digits only. */
const nameKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

module.exports = { splitDateTime, exKey, rowToLot, isDuplicate, baseCode, nameKey }

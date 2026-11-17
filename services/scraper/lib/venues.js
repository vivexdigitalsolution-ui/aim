'use strict'

/**
 * lib/venues.js
 * USS auction venues for the optional venue argument:
 *
 *   node uss-scraper.js bidding tokyo
 *   node uss-scraper.js one_price yokohama,osaka
 *   node uss-scraper.js bidding "haa kobe" jaa
 *
 * Codes are the `value` of the UssOption checkboxes on the Site step (modelSch.aspx) — the labels on the
 * page are auto-translated and unreliable (e.g. "Start" is Kobe, the second "Tohoku" is Kyushu), so the
 * codes are what the scraper clicks. No argument = ALL USS (the previous behaviour).
 */

const VENUES = {
  sapporo:   'SP',
  tohoku:    'TH',
  gunma:     'GM',
  tokyo:     'TK',
  jaa:       'JT',
  saitama:   'WT',
  yokohama:  'YK',
  niigata:   'NT',
  shizuoka:  'SZ',
  nagoya:    'NG',   // "Nagoya & Hokuriku"
  rnagoya:   'NR',   // "R-Nagoya"
  osaka:     'OS',
  kobe:      'KB',
  haakobe:   'HA',
  okayama:   'OK',
  fukuoka:   'KF',
  kyushu:    'KG',
}

// "HAA Kobe" / "haa-kobe" / "R-Nagoya" -> haakobe / rnagoya
const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * @param {string[]} args  CLI words after the mode — names or raw codes, space or comma separated
 * @returns {{ codes: string[], names: string[] }}  empty arrays = ALL USS
 * @throws on an unknown venue (message lists the valid names)
 */
function parseVenues(args) {
  const words = args.join(',').split(',').map(s => s.trim()).filter(Boolean)
  const codes = []
  const names = []
  for (const w of words) {
    const k = key(w)
    if (k === 'all' || k === 'alluss') return { codes: [], names: [] }
    let name = VENUES[k] ? k : Object.keys(VENUES).find(n => VENUES[n].toLowerCase() === k)
    if (!name) {
      throw new Error(`Unknown venue "${w}". Use one of: ${Object.keys(VENUES).join(', ')} (or a code like TK).`)
    }
    if (!codes.includes(VENUES[name])) { codes.push(VENUES[name]); names.push(name) }
  }
  return { codes, names }
}

module.exports = { VENUES, parseVenues }

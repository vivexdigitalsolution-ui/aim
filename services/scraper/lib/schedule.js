'use strict'

/**
 * lib/schedule.js — which USS venues are scraped on which weekday. The list lives in the database (scrape_venue_days + scrape_venues),
 * so staff change it in the table editor when USS adds or closes a venue or moves a day. No rows for a weekday = null (the caller
 * then uses the old way: the site's own day list minus SKIP_VENUES in .env).
 */

const supabase = require('./db')

const NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** weekday of a Japan date (1 = Monday ... 7 = Sunday) */
function jstWeekday(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3)
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay()
}

/** @returns {Promise<{codes:string[], names:string[]}|null>} the active venues of that weekday, or null when none are set */
async function venuesForWeekday(weekday) {
  const { data, error } = await supabase.from('scrape_venue_days').select('venue_code, scrape_venues(code, name, active)').eq('weekday', weekday)
  if (error) { console.log(`[SCHEDULE] cannot read scrape_venue_days (${error.message}) — using the old day rule`); return null }
  const on = (data || []).map((r) => r.scrape_venues).filter((v) => v && v.active)
  if (!on.length) return null
  return { codes: on.map((v) => v.code), names: on.map((v) => v.name) }
}

module.exports = { NAMES, jstWeekday, venuesForWeekday }

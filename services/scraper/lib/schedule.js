'use strict'

/**
 * lib/schedule.js — what to leave out when a weekday is scraped. USS has a "day" list on its search page: choosing a weekday ticks that
 * day's venues. The database then says which of those to UNTICK (e.g. Tuesday = Yokohama + R-Nagoya, R-Nagoya unticked because we do
 * not import its R-score cars): table scrape_day_skips (weekday, venue_code), plus every venue marked active = false in scrape_venues
 * (a closed venue). A new USS venue needs no entry here: it simply appears in the site's own day list.
 */

const supabase = require('./db')

const NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** weekday of a Japan date (1 = Monday ... 7 = Sunday) */
function jstWeekday(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600e3 + offsetDays * 86400e3)
  return d.getUTCDay() === 0 ? 7 : d.getUTCDay()
}

/** @returns {Promise<{codes:string[], names:string[]}|null>} venues to untick for that weekday; null when the tables cannot be read (caller uses .env SKIP_VENUES) */
async function skipsForWeekday(weekday) {
  const [days, venues] = await Promise.all([
    supabase.from('scrape_day_skips').select('venue_code').eq('weekday', weekday),
    supabase.from('scrape_venues').select('code, name, active'),
  ])
  if (days.error || venues.error) { console.log(`[SCHEDULE] cannot read the skip tables (${(days.error || venues.error).message}) - using SKIP_VENUES from .env`); return null }
  const byCode = new Map((venues.data || []).map((v) => [v.code, v]))
  const codes = new Set((days.data || []).map((r) => r.venue_code))
  for (const v of venues.data || []) if (!v.active) codes.add(v.code)
  return { codes: [...codes], names: [...codes].map((c) => byCode.get(c)?.name || c) }
}

module.exports = { NAMES, jstWeekday, skipsForWeekday }

// The hard rules for the offer report: when a car must NOT be recommended. One copy, used by the scraper (offer.js picks) and by the
// report page (hides any older car that breaks them), so the two can never disagree.
//
//   1. grade name OTHERS            the auction did not name the grade: trim unknown (never scraped either)
//   2. mileage over 10,000 km a year  that is high mileage for us
//   3. under 9 months old           (a car may be at most 3 months short of one year)
//   4. the auction sheet was not read, or nothing on it could be read (handwriting)
//      -> no first registration month, chassis no., inspection date, doors or seats were filled
//   5. first registration month not readable (decided 13 Nov 2026): never recommended, whatever the year; another car takes its place
//   6. left-hand drive              (read from the sheet: the market wants right-hand drive only)
// A car that breaks one is replaced by another car. Returns the reason text, or null when the car is fine.

export const MAX_KM_PER_YEAR = 10000
export const MIN_AGE_MONTHS = 9

export interface RuleLot {
  model?: string | null; mfg_year?: number | null; mfg_month?: number | null; first_reg_month?: number | null; mileage_km?: number | null
  steering?: string | null; enriched_at?: string | null; chassis_no?: string | null; inspection_until?: string | null; doors?: number | null; seats?: number | null
}

const monthOf = (l: RuleLot) => l.mfg_month ?? l.first_reg_month ?? null

/** Age in years for the mileage rule: from the first registration month when known (at least 1 year), else the calendar years + 1. */
export function ageYears(l: RuleLot, now: Date = new Date()): number | null {
  const y = l.mfg_year
  if (!y) return null
  const m = monthOf(l)
  if (m) return Math.max(1, ((now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)) / 12)
  return Math.max(1, now.getFullYear() - y + 1)
}

/** Kilometres a year (null when the mileage or the year is unknown). */
export function kmPerYear(l: RuleLot, now: Date = new Date()): number | null {
  const a = ageYears(l, now)
  return l.mileage_km == null || a == null ? null : l.mileage_km / a
}

/** Nothing on the sheet could be read: the reading ran, but no sheet-only field was filled. */
export const sheetUnreadable = (l: RuleLot): boolean => !!l.enriched_at && !l.first_reg_month && !l.chassis_no && !l.inspection_until && !l.doors && !l.seats

/**
 * @param afterReading  true once the cars of the short list were read (the final pick, and the report); false for the short list itself,
 *                      where a car that is not read yet is still fine (it is read next)
 */
export function recommendBlock(l: RuleLot, { now = new Date(), afterReading = true }: { now?: Date; afterReading?: boolean } = {}): string | null {
  if (/(^|\s)(others?|その他)$/i.test(String(l.model || '').trim())) return 'grade name is OTHERS'
  if (String(l.steering || '').toUpperCase() === 'LHD') return 'left-hand drive'
  const kpy = kmPerYear(l, now)
  if (kpy != null && kpy > MAX_KM_PER_YEAR) return `mileage ${Math.round(kpy).toLocaleString('en-US')} km a year (over ${MAX_KM_PER_YEAR.toLocaleString('en-US')})`
  const y = l.mfg_year, m = monthOf(l)
  if (y && m) {
    const months = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m)
    if (months < MIN_AGE_MONTHS) return `only ${Math.max(0, months)} months old (first registered ${y}/${m})`
  }
  if (l.enriched_at) {
    if (sheetUnreadable(l)) return 'the auction sheet could not be read'
  } else if (afterReading) return 'the auction sheet was not read'
  // the first registration month could not be read (the sheet is blurred or handwritten): the age and the duty cannot be trusted, so the car is skipped
  if (afterReading && y && !m) return 'first registration month not readable'
  return null
}

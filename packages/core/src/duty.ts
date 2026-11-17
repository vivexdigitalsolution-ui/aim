// Import cost maths (Malaysia). Pure functions, no database and no server: the page, the scraper's enrich step and the
// offer report all call these. Ported from the Nexus duty calculator, same formula and numbers:
//   customs value = docket amount in MYR x 1.015 + standard fare (default RM 1,200)
//   duty          = customs value x duty multiplier (by engine size and car / non-car)
//   import price  = CIF (body + freight [+ margin]) + duty + AP fee + port clearance + carrier fee

export const r2 = (n: unknown): number => Math.round((parseFloat(String(n)) || 0) * 100) / 100
export const DEFAULT_STANDARD_FARE = 1200
export const INSURANCE_LOADING = 1.015

export interface Docket {
  id: string; brand: string; model: string; cc: number | null; currency_code: string | null; bil?: number | null; year?: number | null
  amt_12m_24m: number | null; amt_24m_36m: number | null; amt_36m_48m: number | null; amt_48m_60m: number | null; amt_60m_plus: number | null
}
export interface DutyRate { vehicle_type: 'car' | 'non_car'; cc_min: number | null; cc_max: number | null; multiplier: number; is_active?: boolean }
export type AgeField = 'amt_12m_24m' | 'amt_24m_36m' | 'amt_36m_48m' | 'amt_48m_60m' | 'amt_60m_plus'

/** Age in whole months at `today` from the first register year / month (/ day). */
export function ageMonths(year: number, month: number, day: number | null = null, today = new Date()): number {
  if (day != null && day >= 1 && day <= 31) {
    const d = new Date(year, month - 1, day)
    let m = (today.getFullYear() - d.getFullYear()) * 12 + (today.getMonth() - d.getMonth())
    if (today.getDate() < d.getDate()) m -= 1
    return Math.max(0, m)
  }
  return Math.max(0, (today.getFullYear() - year) * 12 + (today.getMonth() + 1 - month))
}

/** Which docket column applies. Under 12 months has no column of its own: the 12-24 month figure is used as an estimate. */
export function ageBand(months: number): { band: string; field: AgeField; under12: boolean } {
  if (months < 12) return { band: '12m-24m', field: 'amt_12m_24m', under12: true }
  if (months < 24) return { band: '12m-24m', field: 'amt_12m_24m', under12: false }
  if (months < 36) return { band: '24m-36m', field: 'amt_24m_36m', under12: false }
  if (months < 48) return { band: '36m-48m', field: 'amt_36m_48m', under12: false }
  if (months < 60) return { band: '48m-60m', field: 'amt_48m_60m', under12: false }
  return { band: '60m+', field: 'amt_60m_plus', under12: false }
}

export function dutyRateFor(rates: DutyRate[], cc: number, type: 'car' | 'non_car'): DutyRate | null {
  return rates.find((r) => r.vehicle_type === type && r.is_active !== false && (r.cc_min == null || cc >= r.cc_min) && (r.cc_max == null || cc < r.cc_max)) || null
}

export interface DutyInput {
  docket: Docket; mfgYear: number; mfgMonth: number; mfgDay?: number | null
  cc?: number | null; vehicleType?: 'car' | 'non_car'
  rate: number                       // MYR per single unit of the docket's currency (JPY 0.0272)
  rates: DutyRate[]
  standardFare?: number
  today?: Date
}
export interface DutyResult {
  ageMonths: number; band: string; under12: boolean
  docketAmountForeign: number | null; docketAmountMyr: number | null
  insuranceMyr: number | null; standardFare: number; customsValueMyr: number | null
  multiplier: number | null; dutyMyr: number | null
  warnings: string[]
}

export function calcDuty(i: DutyInput): DutyResult {
  const months = ageMonths(i.mfgYear, i.mfgMonth, i.mfgDay ?? null, i.today)
  const b = ageBand(months)
  const amount = i.docket[b.field]
  const cc = i.cc ?? i.docket.cc ?? 0
  const fare = i.standardFare ?? DEFAULT_STANDARD_FARE
  const warnings: string[] = []
  const rate = dutyRateFor(i.rates, cc, i.vehicleType || 'car')
  if (amount == null) warnings.push(`Docket amount missing for age band ${b.band}.`)
  if (!(i.rate > 0)) warnings.push('No exchange rate.')
  if (!rate) warnings.push(`No duty rate for ${cc} cc.`)
  const amountMyr = amount != null && i.rate > 0 ? r2(Number(amount) * i.rate) : null
  const customs = amountMyr != null ? r2(amountMyr * INSURANCE_LOADING + fare) : null
  const duty = customs != null && rate ? r2(customs * Number(rate.multiplier)) : null
  return {
    ageMonths: months, band: b.band, under12: b.under12,
    docketAmountForeign: amount != null ? Number(amount) : null, docketAmountMyr: amountMyr,
    insuranceMyr: amountMyr != null ? r2(amountMyr * (INSURANCE_LOADING - 1)) : null, standardFare: r2(fare), customsValueMyr: customs,
    multiplier: rate ? Number(rate.multiplier) : null, dutyMyr: duty, warnings,
  }
}

/** The month to work the duty out with. A known month is used as it is. When the month is not readable but the year is, and every month of that year
 *  gives the same docket column (a 2025 car seen in Nov 2026 is 11-22 months old: the 12-24 column either way), December is used: the duty is exact.
 *  null = the month matters (the car could fall in two columns) or the year is unknown. */
export function dutyMonth(year: number | null | undefined, month: number | null | undefined, today = new Date()): number | null {
  if (!year) return null
  if (month) return month
  return ageBand(ageMonths(year, 1, null, today)).field === ageBand(ageMonths(year, 12, null, today)).field ? 12 : null
}

/** The first month the next docket band applies, e.g. first registered 2025/07 and seen in 2026/11 (16 months old): 2027/08. */
export function matangFrom(mfgYear: number, mfgMonth: number, today = new Date()): { year: number; month: number } {
  const age = ageMonths(mfgYear, mfgMonth, null, today)
  const total = mfgYear * 12 + (mfgMonth - 1) + (Math.floor(age / 12) + 1) * 12 + 1
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

/** Duty as it will be from `from` on: same car, worked out with today moved to the first day of that month. */
export function calcDutyAt(i: DutyInput, from: { year: number; month: number }): DutyResult {
  return calcDuty({ ...i, today: new Date(from.year, from.month - 1, 1) })
}

export interface CostInput {
  duty: DutyResult
  rate: number                       // MYR per single unit of the price's currency
  price: number | null               // body price in the docket's currency
  freight?: number | null            // freight in the docket's currency
  marginPct?: number; marginMode?: 'cif' | 'import_price'
  apFeeMyr?: number | null; portClearanceMyr?: number | null; carrierFeeMyr?: number | null
}
export interface CostResult {
  bodyMyr: number; freightMyr: number; marginForeign: number; marginMyr: number; cifMyr: number
  dutyMyr: number; cifPlusDutyMyr: number; feesMyr: number; importPriceMyr: number
}

/** CIF, duty and fees added up. In "cif" mode the margin is part of the CIF (and so of the duty base's cost); in "import_price" mode it is added on top. */
export function calcCost(i: CostInput): CostResult {
  const price = i.price || 0
  const freight = i.freight || 0
  const pct = (i.marginPct ?? 0) / 100
  const marginForeign = (i.marginMode ?? 'cif') === 'cif' && price ? r2((price + freight) * pct) : 0
  const cifMyr = r2((price + freight + marginForeign) * i.rate)
  const duty = i.duty.dutyMyr || 0
  const cifPlusDuty = r2(cifMyr + duty)
  const fees = r2((i.apFeeMyr || 0) + (i.portClearanceMyr || 0) + (i.carrierFeeMyr || 0))
  const importPrice = r2(cifPlusDuty + fees)
  const marginMyr = (i.marginMode ?? 'cif') === 'cif' ? r2(marginForeign * i.rate) : r2(importPrice * pct)
  return {
    bodyMyr: r2(price * i.rate), freightMyr: r2(freight * i.rate), marginForeign, marginMyr, cifMyr,
    dutyMyr: duty, cifPlusDutyMyr: cifPlusDuty, feesMyr: fees, importPriceMyr: importPrice,
  }
}

/** Reverse mode: the highest body price (docket currency) that still lands at `targetMyr`. */
export function maxBodyPrice(targetMyr: number, duty: DutyResult, rate: number, freight: number, feesMyr: number, marginPct: number, marginMode: 'cif' | 'import_price'): number | null {
  const budgetMyr = targetMyr - (duty.dutyMyr || 0) - feesMyr
  if (budgetMyr <= 0 || rate <= 0) return null
  const budgetForeign = budgetMyr / rate
  // forward adds the margin on (price + freight), so reverse divides the whole budget by (1 + margin) before taking the freight off
  const body = marginMode === 'cif' ? budgetForeign / (1 + marginPct / 100) - freight : budgetForeign - freight
  return body > 0 ? r2(body) : null
}

// ── Finding the docket for a car ──────────────────────────────────────────────
// STRICT rule (decided 6 Nov 2026): a car gets a docket only when the chassis code AND the trim name both match the docket.
// Anything less is "no docket" and no duty is shown: never an estimate from a near docket, never an AI pick.
//   The steps, in this order (guessDocket):
//     1. brand (MERCEDES AMG = MERCEDES BENZ ...), JPY dockets only, latest guide edition only
//     2. the chassis code (without its emission prefix: 6AA-ZWR90W -> ZWR90W) appears in the docket's model text
//     3. the engine is within 60 cc
//     4. the trim name: every word of the car's name is in the docket's name (trimMatches); the site's own model label (4 SERIES, 3HB) is dropped
//        when nothing fits; a docket whose name is exactly the car's name beats longer ones
//     5. LAST, the transmission: the AT / MT written at the end of a docket name must be the car's (AT/MT fits both; CVT and DCT are AT).
//        Never swapped for a longer trim name: an exact-name docket of the other transmission means no docket.
//        Transmission not known and both an AT and an MT docket fit: no docket.
//   If more than one docket still fits, they must be within 1.5x of each other (then the highest is taken), otherwise no docket.

// The auction lists some makes as a brand of their own; the Customs list files them under the parent make.
// (MERCEDES AMG GLA35 is in the Customs list as MERCEDES BENZ "AMG GLA35 4MATIC"; the Jeep Grand Cherokee as JEEP.)
const BRAND_ALIAS: Record<string, string> = { 'MERCEDES AMG': 'MERCEDES BENZ', 'MERCEDES-AMG': 'MERCEDES BENZ', 'MERCEDES MAYBACH': 'MERCEDES BENZ', 'CHRYSLER JEEP': 'JEEP' }
/** The brand name a car's dockets are filed under. */
export const docketBrand = (brand: unknown): string => { const b = String(brand ?? '').toUpperCase().trim(); return BRAND_ALIAS[b] || b }

// HEV: the auction writes it after the grade (CROWN SPORT Z (HEV)); the Customs line is just CROWN SPORT Z (the chassis code already tells the hybrid)
const STOP_WORDS = new Set(['CLASS', 'HEV'])
// trim packages that change the car (and its duty): a docket that has one is only for a car whose name has it too
const PACKAGES = ['MSPORT', 'AMGLINE', 'SLINE', 'SHOOTINGBRAKE']      // compared as whole words joined (M SPORT, M-SPORT, AMG LINE, S LINE, SHOOTING BRAKE: a body style of its own, a plain Arteon is not the Shooting Brake)
const hasPackage = (ws: string[], p: string) => ws.some((_, i) => [1, 2, 3].some((n) => ws.slice(i, i + n).join('') === p))

// The Customs list ends many names with the transmission: "GR COROLLA RZ (4BA-GZEA14H) AT" and "... MT" are two dockets with different values
// ("AT/MT" = both). The lot's own transmission (AT / MT; CVT and DCT are automatic) picks the right one.
const TRANS_TAIL = /\s+(AT\/MT|MT\/AT|AT|MT)\s*$/i
/** The transmission a docket is for: 'AT', 'MT', 'BOTH' (written AT/MT) or null (not stated). */
export function docketTransmission(model: string): 'AT' | 'MT' | 'BOTH' | null {
  const m = String(model).match(TRANS_TAIL)
  if (!m) return null
  const t = m[1].toUpperCase()
  return t === 'AT' || t === 'MT' ? t : 'BOTH'
}
/** A lot's transmission as AT / MT, or null when unknown. */
export function lotTransmission(t: string | null | undefined): 'AT' | 'MT' | null {
  const u = String(t || '').toUpperCase().trim()
  if (!u) return null
  if (u.includes('MT') || u === 'MANUAL') return 'MT'
  if (u.includes('AT') || u.includes('CVT') || u.includes('DCT') || u.includes('AUTO')) return 'AT'
  return null
}   // words an auction listing adds that a Customs line never has (GLA-CLASS -> GLA)

/** True when every word of the car's name is found in the docket's name (the chassis code in brackets is ignored).
 *  "GLA-CLASS GLA200D 4MATIC AMG LINE" fits "GLA 200D 4MATIC AMG LINE"; "XF R-DYNAMIC BLACK P250" does not fit "XF R-DYNAMIC HSE P250". */
export function trimMatches(docketModel: string, lotModel: string): boolean {
  const words = (s: string) => s.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
  const dWords = words(String(docketModel).replace(/\([^)]*\)/g, ' '))
  const dJoined = dWords.join('')
  const lWords = words(String(lotModel)).filter((w) => !STOP_WORDS.has(w))
  if (!lWords.length || !dWords.length) return false
  // A trim package written in the docket must be in the car's name too: a plain 420i GRAN COUPE is not the "420i GRAN COUPE M SPORT" docket
  if (PACKAGES.some((p) => hasPackage(dWords, p) && !hasPackage(lWords, p))) return false
  const found = (w: string) => dWords.includes(w) || (w.length >= 4 && dJoined.includes(w))
  // a hyphenated word may be written joined in the docket: the listing's GT-R is the docket's GTR
  const tokenOk = (t: string) => {
    const parts = words(t).filter((w) => !STOP_WORDS.has(w))
    const joined = t.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return parts.every(found) || (joined.length >= 3 && found(joined))
  }
  // two neighbouring words of the car's name may be one word in the docket: the listing's "110 SE" is the docket's "110SE"
  const raw = String(lotModel).toUpperCase().split(/\s+/).filter(Boolean)
  const lTokens: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const pair = i + 1 < raw.length ? (raw[i] + raw[i + 1]).replace(/[^A-Z0-9]/g, '') : ''
    if (pair && dWords.includes(pair) && !dWords.includes(raw[i].replace(/[^A-Z0-9]/g, ''))) { lTokens.push(pair); i++ } else lTokens.push(raw[i])
  }
  return lTokens.every(tokenOk)
}

/** The seat counts a docket name states: "5 SEATER", "7S", "5@7 SEATER" (= 5 or 7). null when it says nothing about seats. */
export function docketSeats(model: string): number[] | null {
  const u = String(model).toUpperCase().replace(/\([^)]*\)/g, ' ')
  const s = new Set<number>()
  for (const x of u.matchAll(/(?<![0-9])([2-9])\s*@\s*([2-9])/g)) { s.add(+x[1]); s.add(+x[2]) }
  for (const x of u.matchAll(/(?<![0-9])([2-9])\s*SEATER/g)) s.add(+x[1])
  for (const x of u.matchAll(/(?<![0-9A-Z])([2-9])S\b/g)) s.add(+x[1])
  return s.size ? [...s] : null
}

/**
 * The dockets that fit by brand + newest edition + chassis code (+ emission prefix) + engine size, BEFORE the trim name is looked at.
 * guessDocket narrows this pool by the trim name; the AI docket check (scraper/lib/docketai.js) picks from this same pool.
 */
export function docketPool(dockets: Docket[], lot: { brand: string; model_code?: string | null; engine_cc?: number | null }): { pool: Docket[]; reason: string | null } {
  const base = String(lot.model_code || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')
  if (base.length < 3) return { pool: [], reason: 'no usable chassis code' }
  const brand = docketBrand(lot.brand)
  const edition = Math.max(0, ...dockets.map((d) => d.year || 0))
  // Japan auctions: JPY dockets only (the GBP lines are for UK cars and carry no chassis code anyway)
  // a docket can list two codes: "(6AA-AAHH40W/6AA-AAHH45W)"
  let c = dockets.filter((d) => docketBrand(d.brand) === brand && (!d.currency_code || d.currency_code === 'JPY') && (!edition || d.year === edition) && ['-' + base + ')', '(' + base + ')', '(' + base + ' ', ' ' + base + ')', '-' + base + '/', '/' + base + ')'].some((k) => d.model.toUpperCase().includes(k)))
  if (!c.length) return { pool: [], reason: 'no docket carries this code' }
  // The emission prefix (4BA-ZC33S vs CBA-ZC33S are two different generations with different dockets): when the lot has one, the docket must have the same.
  // A lot that carries only the tail (ZC33S) keeps every generation.
  const lotPrefix = String(lot.model_code || '').toUpperCase().match(/^([0-9A-Z]{2,4})-/)?.[1]
  if (lotPrefix) {
    const samePrefix = c.filter((d) => { const p = d.model.toUpperCase().match(/\(([0-9A-Z]{2,4})-[0-9A-Z]+\)/)?.[1]; return !p || p === lotPrefix })
    // No docket has this prefix at all (the sheet read 4AA for a 4BA car): the prefix is a misread, so only the tail is used
    if (samePrefix.some((d) => d.model.toUpperCase().includes('(' + lotPrefix + '-'))) c = samePrefix
  }
  // The listing often rounds the engine size to the nearest 100 (MACAN GTS 2894 cc is listed as 3000), so a rounded figure gets a wider band.
  const ccBand = lot.engine_cc && lot.engine_cc % 100 === 0 ? 150 : 60
  if (lot.engine_cc) { c = c.filter((d) => d.cc != null && Math.abs(d.cc - lot.engine_cc!) <= ccBand); if (!c.length) return { pool: [], reason: 'no docket with this code has this engine size' } }
  return { pool: c, reason: null }
}

export function guessDocket(dockets: Docket[], lot: { brand: string; model?: string | null; model_code?: string | null; engine_cc?: number | null; family?: string | null; transmission?: string | null; sheet_text?: string | null; seats?: number | null }): { docket: Docket | null; candidates: Docket[]; reason: string } {
  const base = String(lot.model_code || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')
  if (base.length < 3) return { docket: null, candidates: [], reason: 'no usable chassis code' }
  if (!String(lot.model || '').trim()) return { docket: null, candidates: [], reason: 'no model name to match the trim' }
  const brand = docketBrand(lot.brand)
  const P = docketPool(dockets, lot)
  if (!P.pool.length) return { docket: null, candidates: [], reason: P.reason || 'no docket carries this code' }
  const c = P.pool
  let name = String(lot.model).trim()
  let byTrim = c.filter((d) => trimMatches(d.model, name))
  const family = String(lot.family || '').trim()
  if (!byTrim.length && family && name.toUpperCase().startsWith(family.toUpperCase() + ' ')) {
    // The name starts with the site's own model label ("4 SERIES 420I COUPE M-SPORT", "3HB COOPER S"), which no docket carries: compare the grade part.
    name = name.slice(family.length).trim()
    byTrim = c.filter((d) => trimMatches(d.model, name))
  }
  // SEATS: a docket that names a seat count ("7 SEATER", "5S", "5@7 SEATER") is only for a car with that many seats (read from the sheet).
  // A docket that says nothing about seats stays. When the seats are not known, nothing is filtered.
  if (lot.seats && byTrim.length) {
    const seatOk = byTrim.filter((d) => { const s = docketSeats(d.model); return !s || s.includes(Number(lot.seats)) })
    if (!seatOk.length) return { docket: null, candidates: byTrim, reason: `code and name match but only for another seat count (the car has ${lot.seats} seats): ${byTrim.map((d) => d.model).join(' | ')}` }
    byTrim = seatOk
  }
  // a docket whose name is exactly the car's name (ALPHARD) beats longer ones that merely contain it (ALPHARD Z)
  // the name without its code(s) "(6AA-AAHH40W)/6AA-AAHH45W)" or "(6AA-AAHH40W/6AA-AAHH45W)" and without the AT / MT at the end
  const bare = (m: string) => String(m).replace(/\([^()]*\)(\/[0-9A-Z-]+\))?/g, ' ').replace(TRANS_TAIL, '')
  const nameSet = (s: string) => [...new Set(String(s).replace(/\([^)]*\)/g, ' ').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w && !STOP_WORDS.has(w)))].sort().join(' ')
  // the same, with each space-separated word joined (GT-R = GTR), so "GT-R PREMIUM EDITION" is exactly "GTR PREMIUM EDITION" and not T-SPEC
  const joinedSet = (s: string) => [...new Set(String(s).replace(/\([^)]*\)/g, ' ').toUpperCase().split(/\s+/).map((w) => w.replace(/[^A-Z0-9]/g, '')).filter((w) => w && !STOP_WORDS.has(w)))].sort().join(' ')
  // the same with no separators at all, so "35TFSI" is exactly "35 TFSI" (and not the S LINE line)
  const squash = (s: string) => String(s).replace(/\([^)]*\)/g, ' ').toUpperCase().split(/[^A-Z0-9]+/).filter((w) => w && !STOP_WORDS.has(w)).join('')
  const exact = byTrim.filter((d) => nameSet(bare(d.model)) === nameSet(name) || joinedSet(bare(d.model)) === joinedSet(name) || squash(bare(d.model)) === squash(name))
  if (exact.length) byTrim = exact
  // LAST STEP, the transmission: brand, chassis code, engine and the trim name decide first; then a docket for the other transmission is dropped
  // (GR COROLLA RZ ... MT is not for an AT car). It is never swapped for a longer trim name: a manual "86 GT" whose only plain docket is the AT one has no docket.
  const lt = lotTransmission(lot.transmission)
  if (lt && byTrim.length) {
    const same = byTrim.filter((d) => { const t = docketTransmission(d.model); return t === null || t === 'BOTH' || t === lt })
    if (!same.length) return { docket: null, candidates: byTrim, reason: `code and name match but only for the other transmission (the car is ${lt}): ${byTrim.map((d) => d.model).join(' | ')}` }
    byTrim = same
  }
  // SPECIAL CASE, Suzuki Swift Sport: the Customs list has the same car twice, "... SUZUKI SAFETY SUPPORT INSTALLED" and "... NOT INSTALLED".
  // NOT INSTALLED unless the auction report (selling points, notes, equipment) mentions safety (Safety Support / Safety Package / セーフティ).
  if (brand === 'SUZUKI' && /SWIFT/i.test(String(lot.model)) && byTrim.some((d) => /NOT INSTALLED/i.test(d.model)) && byTrim.some((d) => /INSTALLED/i.test(d.model) && !/NOT INSTALLED/i.test(d.model))) {
    const mentioned = /safety|セーフティ/i.test(String(lot.sheet_text || ''))
    byTrim = byTrim.filter((d) => (/NOT INSTALLED/i.test(d.model) ? !mentioned : mentioned))
  }
  // CLOSEST NAME: several dockets contain the car's words; the one with the FEWEST extra trim words is the car (a plain "250 HIGHWAY STAR S" is
  // "250HIGHWAY STAR S 7@8 SEATER", not the "... URBAN CHROME" one; a plain A45 S is "AMG A45 S 4MATIC+", not the STREET STYLE EDITION).
  // Seat counts and AT / MT are not trim words. Only when the names are equally close does the price decide (below).
  if (byTrim.length > 1) {
    const strip = (s: string) => s.replace(/(?<![0-9A-Z])[2-9]\s*@\s*[2-9]/gi, ' ').replace(/SEATERS?/gi, ' ').replace(/(?<![0-9A-Z])[2-9]S\b/gi, ' ').replace(/(?<![0-9A-Z])[2-9](?![0-9A-Z])/g, ' ')
    const extra = (d: Docket) => squash(strip(bare(d.model))).length - squash(strip(name)).length
    const least = Math.min(...byTrim.map(extra))
    byTrim = byTrim.filter((d) => extra(d) === least)
  }
  if (!byTrim.length) return { docket: null, candidates: c, reason: 'code matches but the trim name does not (' + c.map((d) => d.model).join(' | ') + ')' }
  // the car's transmission is unknown and an AT and an MT docket both fit: their values differ, so no guess
  if (!lt && byTrim.some((d) => docketTransmission(d.model) === 'AT') && byTrim.some((d) => docketTransmission(d.model) === 'MT')) return { docket: null, candidates: byTrim, reason: 'an AT and an MT docket both fit and the car\'s transmission is not known' }
  const top = (d: Docket) => Math.max(...[d.amt_12m_24m, d.amt_24m_36m, d.amt_36m_48m, d.amt_48m_60m, d.amt_60m_plus].map((v) => Number(v) || 0))
  const sorted = [...byTrim].sort((a, b) => top(b) - top(a))
  if (top(sorted[0]) > 1.5 * Math.max(1, top(sorted[sorted.length - 1]))) return { docket: null, candidates: sorted, reason: 'several dockets fit the name and their values differ a lot' }
  return { docket: sorted[0], candidates: sorted, reason: sorted.length === 1 ? 'code, engine and trim match one docket' : 'highest of ' + sorted.length + ' dockets that all fit' }
}

/** The docket line shown on the offer report: its name and its amount in yen for the car's age now (null amount for a non-yen docket or an unknown age). */
export function docketLine(d: Docket | null | undefined, year: number | null | undefined, month: number | null | undefined, today = new Date()): { name: string; jpy: number | null } | null {
  if (!d) return null
  let jpy: number | null = null
  if ((d.currency_code || 'JPY') === 'JPY' && year && month) {
    const v = d[ageBand(ageMonths(year, month, null, today)).field]
    jpy = v != null ? Number(v) : null
  }
  return { name: d.model, jpy }
}

// Pass 2 helper: a scored list for the AI / staff to choose from.
// A docket model reads "ALPHARD (3BA-AGH40W)": the chassis code is inside the brackets. A lot carries the same code
// (or its tail, "AGH40W"), plus the engine size, so most cars match without any AI.

const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const codeOf = (model: string) => (model.match(/\(([A-Z0-9-]*\d[A-Z0-9-]*)\)/i)?.[1] || '').toUpperCase()
const tail = (code: string) => code.split('-').pop() || code

export interface DocketMatch { docket: Docket; score: number; by: string }

/** Candidate dockets for a lot, best first. `exact` is true when one docket clearly wins on code + cc + name. */
export function matchDockets(dockets: Docket[], lot: { brand: string; model: string; model_code?: string | null; engine_cc?: number | null; transmission?: string | null }, limit = 8): { exact: boolean; list: DocketMatch[] } {
  const brand = norm(docketBrand(lot.brand))
  const code = String(lot.model_code || '').toUpperCase().replace(/\s+/g, '')
  const lotTail = tail(code)
  const name = norm(lot.model)
  const words = name.split(' ').filter((w) => w.length > 1)
  const pool = dockets.filter((d) => norm(d.brand) === brand || norm(d.brand).includes(brand) || brand.includes(norm(d.brand)))
  const scored: DocketMatch[] = []
  for (const d of pool) {
    const dc = codeOf(d.model)
    let score = 0
    let by = ''
    if (code && dc) {
      if (dc === code) { score += 60; by = 'code' } else if (tail(dc) === lotTail) { score += 45; by = 'code tail' } else if (lotTail.length >= 3 && dc.includes(lotTail)) { score += 30; by = 'code part' }
    }
    if (lot.engine_cc && d.cc) { if (d.cc === lot.engine_cc) score += 20; else if (Math.abs(d.cc - lot.engine_cc) <= 10) score += 12; else score -= 25 }
    const dn = norm(d.model.replace(/\([^)]*\)/g, ' '))
    const hit = words.filter((w) => dn.split(' ').includes(w)).length
    if (words.length) score += Math.round(25 * hit / words.length)
    if (words.length && dn && hit === words.length) score += 5
    const dt = docketTransmission(d.model), lt = lotTransmission(lot.transmission)
    if (lt && dt && dt !== 'BOTH') score += dt === lt ? 6 : -30      // the other transmission is a different docket
    if (score > 0) scored.push({ docket: d, score, by: by || 'name' })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored[0], next = scored[1]
  const exact = !!top && top.score >= 80 && (!next || top.score - next.score >= 10)
  return { exact, list: scored.slice(0, limit) }
}

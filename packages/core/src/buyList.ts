// A dealer's buy list and the "Today for you" list built from it. Pure rules, no database.
// The numbers a dealer sees in a personal list are fixed when staff make the list (see ListItem): no duty and no docket in them.

export interface BuyList {
  brands: string[]; models: string[]; year_from: number | null; budget_myr: number | null; min_margin_pct: number
  aps_left?: number | null; speed?: string | null; notes?: string | null
}
export interface CarFigures { brand: string; model: string; year: number | null; landedMyr: number | null; marginPct: number | null }

const up = (s: string) => String(s || '').toUpperCase().trim()

/** Does this car fit the buy list? `why` lists every reason it does not (shown to staff). A car with no margin figure never fits: nothing is promised without a number. */
export function matchesBuyList(bl: BuyList, car: CarFigures): { ok: boolean; why: string[] } {
  const why: string[] = []
  const brands = bl.brands.map(up).filter(Boolean), models = bl.models.map(up).filter(Boolean)
  if (brands.length && !brands.some((b) => up(car.brand) === b)) why.push('other make')
  if (models.length && !models.some((m) => up(car.model).includes(m))) why.push('other model')
  if (bl.year_from && (!car.year || car.year < bl.year_from)) why.push('older than ' + bl.year_from)
  if (bl.budget_myr && (car.landedMyr == null || car.landedMyr > bl.budget_myr)) why.push(car.landedMyr == null ? 'cost unknown' : 'over budget')
  if (car.marginPct == null) why.push('no margin figure')
  else if (car.marginPct < (bl.min_margin_pct || 0)) why.push('margin below ' + bl.min_margin_pct + '%')
  return { ok: why.length === 0, why }
}

/** Best margin first; among equal margins the car that closes first. */
export function rankForDealer<T extends { marginPct: number | null; closesAt: string }>(cars: T[]): T[] {
  return [...cars].sort((a, b) => (b.marginPct ?? -Infinity) - (a.marginPct ?? -Infinity) || a.closesAt.localeCompare(b.closesAt))
}

/** One car in a personal list, as it is stored and shown to the dealer. */
export interface ListItem {
  lot_id: string; title: string; year: number | null; km: number | null; grade: string | null; photo: string | null
  venue: string; auction_date: string; closes_at: string
  market_low: number | null; market_typical: number | null; market_high: number | null; market_n: number; market_source: string; confidence: string; wider: boolean
  usual_jpy: number | null; max_bid_jpy: number | null; landed_myr: number | null; sell_myr: number | null; profit_myr: number | null; margin_pct: number | null
  target_pct: number; jpy_rate: number
}

/** The text staff send with the link (WhatsApp). Plain words; the numbers are on the page. */
export function listMessage(p: { dealer: string; count: number; url: string; expiresDays: number }): string {
  const hi = p.dealer ? `Hi ${p.dealer},` : 'Hi,'
  return `${hi} ${p.count} car${p.count === 1 ? '' : 's'} picked for you today, with the estimated margin on each:\n${p.url}\nOpen cars close soon; the link works for ${p.expiresDays} days. Margins are estimates from Malaysian asking prices, not promises.`
}

// Market position and margin. Input: ASKING prices of comparable cars in Malaysia (from the CarzNexus snapshot) and the car's landed cost.
// Asking prices are not sold prices: every figure here is an estimate and must be labelled so in the UI.
// margin % is on COST (profit / (landed + recon)), the same as ROI, so "12% margin" means RM 112 back for every RM 100 put in.

export interface MarketStats { n: number; min: number; max: number; mean: number; median: number; p25: number; p75: number; stdev: number }
export type Confidence = 'high' | 'medium' | 'low' | 'none'

const sortAsc = (a: number[]) => [...a].sort((x, y) => x - y)
function quantile(s: number[], q: number): number {
  if (!s.length) return NaN
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos)
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo)
}

export function marketStats(prices: number[]): MarketStats | null {
  const p = prices.filter((v) => Number.isFinite(v) && v > 0)
  if (!p.length) return null
  const s = sortAsc(p), n = s.length, mean = s.reduce((a, b) => a + b, 0) / n
  const stdev = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  return { n, min: s[0]!, max: s[n - 1]!, mean, median: quantile(s, 0.5), p25: quantile(s, 0.25), p75: quantile(s, 0.75), stdev }
}

/** Percentile rank of `value` among the prices (0 = cheapest, 100 = dearest). */
export function percentileRank(prices: number[], value: number): number | null {
  const p = prices.filter((v) => Number.isFinite(v) && v > 0)
  if (!p.length) return null
  const below = p.filter((v) => v < value).length, equal = p.filter((v) => v === value).length
  return Math.round(((below + equal / 2) / p.length) * 100)
}

/** How far to trust a market range: by the number of comparable listings and how tight they are. Never "high" on a handful of listings. */
export function confidence(s: MarketStats | null, sellers?: number | null): Confidence {
  if (!s || s.n < 3) return 'none'
  // one seller's price list is not a market: never better than "low"
  if (sellers != null && sellers < 2) return 'low'
  const tight = s.stdev / s.median <= 0.12
  if (s.n >= 12 && tight) return 'high'
  if (s.n >= 6) return 'medium'
  return 'low'
}

export interface Margin { profitMyr: number; marginPct: number; costMyr: number }
/** Profit if sold at `sellMyr`: sell - landed - recon. marginPct = profit / (landed + recon). */
export function margin(p: { landedMyr: number; sellMyr: number; reconMyr?: number }): Margin {
  const cost = p.landedMyr + (p.reconMyr || 0), profit = p.sellMyr - cost
  return { profitMyr: Math.round(profit), marginPct: cost > 0 ? Math.round((profit / cost) * 1000) / 10 : 0, costMyr: Math.round(cost) }
}

/** The reverse question: the highest landed cost that still gives `targetPct` margin at `sellMyr` (recon is taken off first). */
export function maxLandedFor(p: { sellMyr: number; targetPct: number; reconMyr?: number }): number {
  return Math.max(0, Math.round(p.sellMyr / (1 + p.targetPct / 100) - (p.reconMyr || 0)))
}

/** A cautious "sell price" to use for margin: the median, or the lower quartile when the range is wide or thin (never the top of the range). */
export function conservativeSell(s: MarketStats | null): number | null {
  if (!s) return null
  const c = confidence(s)
  if (c === 'none') return null
  return Math.round(c === 'high' ? s.median : (s.p25 + s.median) / 2)
}

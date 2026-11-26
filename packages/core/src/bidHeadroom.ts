// The reverse-bid question: "what is the most I can bid and still make my target margin?", and what a bid of X earns.
// Uses the same offerPricing() as the offer report, so every figure here adds up to the same import price.
import { offerPricing, type AgentTier, DEFAULT_PORT_MYR, DEFAULT_INLAND_MYR, DEFAULT_AP_FEE_MYR } from './offerPricing.ts'
import { margin, maxLandedFor, conservativeSell, confidence, type MarketStats, type Confidence, type Margin } from './marketStats.ts'
import { BID_STEP } from './historyPrice.ts'
import type { IdMarketRow } from './marketSnapshot.ts'

export interface BidCosts { rate: number; dutyMyr: number; reconMyr: number; portMyr?: number; inlandMyr?: number; apFeeMyr?: number }
const fees = (c: BidCosts) => ({ portMyr: c.portMyr ?? DEFAULT_PORT_MYR, inlandMyr: c.inlandMyr ?? DEFAULT_INLAND_MYR, apFeeMyr: c.apFeeMyr ?? DEFAULT_AP_FEE_MYR })

/** Landed cost in RM (body + agent & shipping + duty + port + inland + AP fee) of a winning bid, or null without a rate. */
export function landedMyr(bodyJpy: number, c: BidCosts): number | null {
  return offerPricing({ historyJpy: bodyJpy, rate: c.rate, dutyMyr: c.dutyMyr, ...fees(c) }).importMyr
}

/** Profit and margin (on cost) if the car is won at `bodyJpy` and sold at `sellMyr`. */
export function marginAtBid(p: { bodyJpy: number; sellMyr: number } & BidCosts): (Margin & { landedMyr: number }) | null {
  const landed = landedMyr(p.bodyJpy, p)
  return landed == null ? null : { ...margin({ landedMyr: landed, sellMyr: p.sellMyr, reconMyr: p.reconMyr }), landedMyr: landed }
}

/** The highest bid (in ¥5,000 auction steps) that still gives `targetPct` margin at `sellMyr`. 0 when even a ¥0 bid cannot (duty and fees alone are too much). */
export function maxBidJpy(p: { sellMyr: number; targetPct: number } & BidCosts): number {
  const cap = maxLandedFor({ sellMyr: p.sellMyr, targetPct: p.targetPct, reconMyr: p.reconMyr })
  const ok = (steps: number) => { const l = landedMyr(steps * BID_STEP, p); return l != null && l <= cap }
  let lo = 0, hi = 20_000_000 / BID_STEP   // up to ¥100 million
  if (!ok(1)) return 0
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); ok(mid) ? (lo = mid) : (hi = mid - 1) }
  return lo * BID_STEP
}

/** MarketStats rebuilt from a stored market row (the spread is estimated from the quartiles) so confidence() and conservativeSell() can be used. */
export function statsFromRow(r: Pick<IdMarketRow, 'n' | 'min_myr' | 'max_myr' | 'p25_myr' | 'median_myr' | 'p75_myr'>): MarketStats {
  return { n: r.n, min: r.min_myr, max: r.max_myr, mean: r.median_myr, median: r.median_myr, p25: r.p25_myr, p75: r.p75_myr, stdev: (r.p75_myr - r.p25_myr) / 1.349 }
}

/** The cautious sell price and how far to trust it for a market row. `wider` (the model, not the grade) never rates above "low". */
export function sellFromRow(r: Pick<IdMarketRow, 'n' | 'sellers' | 'min_myr' | 'max_myr' | 'p25_myr' | 'median_myr' | 'p75_myr'> & { source?: string }, wider: boolean): { sellMyr: number | null; confidence: Confidence } {
  const s = statsFromRow(r)
  // a hand-checked price (a person looked at n comparable cars) is trusted as "medium" from 3 cars, never "high"; the range the person typed is used as it is
  const c: Confidence = r.source === 'manual' ? (r.n >= 3 ? 'medium' : 'low') : confidence(s, r.sellers)
  // a typed price is used even from 1-2 cars checked (a person chose to enter it); the cautious sell price is the typical figure pulled towards the low end
  const sellMyr = r.source === 'manual' ? Math.round((r.p25_myr + r.median_myr) / 2) : conservativeSell(s)
  return { sellMyr, confidence: wider && (c === 'high' || c === 'medium') ? 'low' : c }
}

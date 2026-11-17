// The Malaysian market snapshot: raw CarzNexus listings (ASKING prices, customer price) -> aggregated rows for market_stats.
// Privacy rule: a row is only made when at least `minN` listings AND `minSellers` different sellers stand behind it, so one dealer's
// price list can never be read back from the numbers. Seller ids are used to count and are never stored.
// One row per brand + model + year: the stats cover the window year-1 .. year+1 (cars of nearly the same age), centred on that year.
import { docketBrand } from './duty.ts'
import { marketStats } from './marketStats.ts'

export interface RawListing { brand: string; model: string; year: number; price: number; km?: number | null; seller?: string | null }
export interface MarketRow {
  brand: string; model_key: string; year_from: number; year_to: number; n: number
  min_myr: number; p25_myr: number; median_myr: number; p75_myr: number; max_myr: number; avg_km: number | null; as_of: string; source: string
}

/** "Vellfire", "VELLFIRE 2.5 Z" -> VELLFIRE: the model name as one upper-case token (letters and digits only). */
export const modelKey = (model: string): string => String(model || '').toUpperCase().replace(/[^A-Z0-9]+/g, '')

export function buildMarketRows(listings: RawListing[], asOf: string, opts: { minN?: number; minSellers?: number } = {}): MarketRow[] {
  const minN = opts.minN ?? 3, minSellers = opts.minSellers ?? 2
  const groups = new Map<string, RawListing[]>()
  for (const l of listings) {
    if (!(l.price > 0) || !l.year || !l.model) continue
    const k = docketBrand(l.brand) + '|' + modelKey(l.model)
    ;(groups.get(k) || groups.set(k, []).get(k)!).push(l)
  }
  const out: MarketRow[] = []
  for (const [k, ls] of groups) {
    const [brand, model_key] = k.split('|') as [string, string]
    for (const y of [...new Set(ls.map((l) => l.year))].sort()) {
      const win = ls.filter((l) => Math.abs(l.year - y) <= 1)
      const sellers = new Set(win.map((l) => l.seller || '?')).size
      if (win.length < minN || sellers < minSellers) continue
      const s = marketStats(win.map((l) => l.price))!
      const kms = win.map((l) => l.km).filter((v): v is number => typeof v === 'number' && v >= 0)
      out.push({
        brand, model_key, year_from: y - 1, year_to: y + 1, n: s.n,
        min_myr: Math.round(s.min), p25_myr: Math.round(s.p25), median_myr: Math.round(s.median), p75_myr: Math.round(s.p75), max_myr: Math.round(s.max),
        avg_km: kms.length ? Math.round(kms.reduce((a, b) => a + b, 0) / kms.length) : null, as_of: asOf, source: 'carznexus',
      })
    }
  }
  return out
}

/**
 * The market row for a Japanese lot: same brand, the lot's model name starts with the row's model key (longest key wins:
 * "VELLFIREHYBRID" beats "VELLFIRE"), and the window is centred on the lot's year. Newest snapshot wins. null when none.
 */
export function lookupMarket(rows: MarketRow[], lot: { brand: string; model: string; year: number | null | undefined }): MarketRow | null {
  if (!lot.year) return null
  const brand = docketBrand(lot.brand), name = modelKey(lot.model)
  const fit = rows.filter((r) => r.brand === brand && name.startsWith(r.model_key) && r.year_from + 1 === lot.year)
  if (!fit.length) return null
  fit.sort((a, b) => b.model_key.length - a.model_key.length || b.as_of.localeCompare(a.as_of))
  return fit[0]!
}

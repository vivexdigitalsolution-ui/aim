// The Malaysian market snapshot: raw CarzNexus listings (ASKING prices, customer price) -> aggregated rows for market_stats.
// Privacy rule: a row is only made when at least `minN` listings AND `minSellers` different sellers stand behind it, so one dealer's
// price list can never be read back from the numbers. Seller ids are used to count and are never stored.
// One row per brand + model + year: the stats cover the window year-1 .. year+1 (cars of nearly the same age), centred on that year.
import { docketBrand } from './duty.ts'
import { marketStats } from './marketStats.ts'

export interface RawListing { brand: string; model: string; year: number; price: number; km?: number | null; seller?: string | null }
export interface MarketRow {
  brand: string; model_key: string; year_from: number; year_to: number; n: number; sellers: number
  min_myr: number; p25_myr: number; median_myr: number; p75_myr: number; max_myr: number; avg_km: number | null; as_of: string; source: string
}

/** "Vellfire", "VELLFIRE 2.5 Z" -> VELLFIRE: the model name as one upper-case token (letters and digits only). */
export const modelKey = (model: string): string => String(model || '').toUpperCase().replace(/[^A-Z0-9]+/g, '')

/**
 * The model FAMILY of a listing name: dealer lists write the whole variant in the model name ("ALPHARD 25 SC 7 SEATER").
 * `families` = the model-family names the Japan side knows (scrape_targets.model_name: VELLFIRE, ALPHARD, LAND CRUISER ...);
 * the longest one the name starts with wins; otherwise the first word.
 */
export function familyKey(modelName: string, families: string[] = []): string {
  const norm = modelKey(modelName)
  const fam = families.map(modelKey).filter((f) => f && norm.startsWith(f)).sort((a, b) => b.length - a.length)[0]
  if (fam) return fam
  return modelKey(String(modelName || '').trim().split(/[\s]+/)[0] || '')
}

export function buildMarketRows(listings: RawListing[], asOf: string, opts: { minN?: number; minSellers?: number; families?: string[] } = {}): MarketRow[] {
  const minN = opts.minN ?? 3, minSellers = opts.minSellers ?? 2
  const groups = new Map<string, RawListing[]>()
  for (const l of listings) {
    if (!(l.price > 0) || !l.year || !l.model) continue
    const k = docketBrand(l.brand) + '|' + familyKey(l.model, opts.families)
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
        brand, model_key, year_from: y - 1, year_to: y + 1, n: s.n, sellers,
        min_myr: Math.round(s.min), p25_myr: Math.round(s.p25), median_myr: Math.round(s.median), p75_myr: Math.round(s.p75), max_myr: Math.round(s.max),
        avg_km: kms.length ? Math.round(kms.reduce((a, b) => a + b, 0) / kms.length) : null, as_of: asOf, source: 'carznexus',
      })
    }
  }
  return out
}

// ── By catalog ids (the final way) ─────────────────────────────────────────────────────────────────
// A CarzNexus listing counts only when it carries a catalog link: variant_id (-> a 'variant' row) and/or model_id (-> a 'model' row).
// No link = no price yet. No minimum number of dealers: every dealer's listing counts, and the row says how many stand behind it.
export interface LinkedListing { price: number; year: number; km?: number | null; seller?: string | null; brandId?: string | null; modelId?: string | null; variantId?: string | null }
export interface IdMarketRow {
  level: 'variant' | 'model'; ref_id: string; brand_id: string | null; model_id: string | null; variant_id: string | null
  brand: string; model_key: string; variant_name: string | null
  year_from: number; year_to: number; n: number; sellers: number
  min_myr: number; p25_myr: number; median_myr: number; p75_myr: number; max_myr: number; avg_km: number | null; as_of: string; source: string
}

export function buildIdMarketRows(listings: LinkedListing[], asOf: string, names: { brand?: (id: string) => string; model?: (id: string) => string; variant?: (id: string) => string | null } = {}): IdMarketRow[] {
  const out: IdMarketRow[] = []
  const groups = new Map<string, LinkedListing[]>()
  for (const l of listings) {
    if (!(l.price > 0) || !l.year) continue
    if (l.variantId) (groups.get('variant|' + l.variantId) || groups.set('variant|' + l.variantId, []).get('variant|' + l.variantId)!).push(l)
    if (l.modelId) (groups.get('model|' + l.modelId) || groups.set('model|' + l.modelId, []).get('model|' + l.modelId)!).push(l)
  }
  for (const [k, ls] of groups) {
    const [level, ref] = k.split('|') as ['variant' | 'model', string]
    for (const y of [...new Set(ls.map((l) => l.year))].sort()) {
      const win = ls.filter((l) => Math.abs(l.year - y) <= 1)
      const s = marketStats(win.map((l) => l.price))!
      const kms = win.map((l) => l.km).filter((v): v is number => typeof v === 'number' && v >= 0)
      const first = win[0]!
      out.push({
        level, ref_id: ref, brand_id: first.brandId || null, model_id: first.modelId || null, variant_id: level === 'variant' ? ref : null,
        brand: first.brandId && names.brand ? names.brand(first.brandId) : '', model_key: first.modelId && names.model ? names.model(first.modelId) : '',
        variant_name: level === 'variant' && names.variant ? names.variant(ref) : null,
        year_from: y - 1, year_to: y + 1, n: s.n, sellers: new Set(win.map((l) => l.seller || '?')).size,
        min_myr: Math.round(s.min), p25_myr: Math.round(s.p25), median_myr: Math.round(s.median), p75_myr: Math.round(s.p75), max_myr: Math.round(s.max),
        avg_km: kms.length ? Math.round(kms.reduce((a, b) => a + b, 0) / kms.length) : null, as_of: asOf, source: 'carznexus',
      })
    }
  }
  return out
}

/** The market row for a linked lot: its variant row if there is one, else its model row (`wider` = true: the whole model, not the grade). Never a guess: null when nothing is linked. */
export function lookupMarketById(rows: IdMarketRow[], lot: { variantId?: string | null; modelId?: string | null; year: number | null | undefined }): { row: IdMarketRow; wider: boolean } | null {
  if (!lot.year) return null
  const pick = (level: string, id: string | null | undefined) => (id ? rows.filter((r) => r.level === level && r.ref_id === id && r.year_from + 1 === lot.year).sort((a, b) => b.as_of.localeCompare(a.as_of))[0] : undefined)
  const v = pick('variant', lot.variantId)
  if (v) return { row: v, wider: false }
  const m = pick('model', lot.modelId)
  return m ? { row: m, wider: true } : null
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

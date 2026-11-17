// Market price keys: the same car model must give the same key every time, so a price keyed in once is found again.
// The chassis code without its emission prefix (3BA-AGH40W -> AGH40W); the model name when the car has no code.
export function marketKey(code: string | null | undefined, model: string): string {
  const base = String(code || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')
  return base.length >= 3 ? base : String(model || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
}

export interface LatestPrice { brand: string; model_key: string; mfg_year: number | null; price_myr: number; recorded_on: string }

/** Latest price for a car: same year first, then a price that holds for any year, then the newest price of any year for this model. */
export function findMarketPrice(list: LatestPrice[], brand: string, key: string, year: number | null): LatestPrice | null {
  const same = list.filter((p) => p.brand === brand.toUpperCase() && p.model_key === key)
  if (!same.length) return null
  return same.find((p) => p.mfg_year === year) || same.find((p) => p.mfg_year == null) || [...same].sort((a, b) => b.recorded_on.localeCompare(a.recorded_on))[0]
}

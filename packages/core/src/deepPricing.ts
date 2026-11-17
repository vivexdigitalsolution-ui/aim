// Prices of one unit of a deep search (a customer option). Built on the offer report maths (offerPricing.ts), plus the margin.
//
//   body price            = history price (same grade), or the yen price staff keyed in
//   agent fee & shipping  = CIF rate table by body price
//   import price          = body + agent fee & shipping + duty + port + carrier + AP fee      (what the car costs us landed)
//   margin                = margin % of the import price ('import_price'), or of body + agent fee & shipping ('cif'); whole RM
//   selling price         = import price + margin                                           (what the customer pays)
//
// The customer copy hides the margin: it is added INTO the body price, so every line still adds up to the selling price.
// The internal copy shows the same lines with the margin amount and % under the import price.

import { offerPricing, type OfferPricing } from './offerPricing.ts'

export type MarginMode = 'cif' | 'import_price'
export const MAX_OPTION_UNITS = 6

export interface DeepInput {
  historyJpy: number | null; rate: number; dutyMyr: number | null
  portMyr: number; inlandMyr: number; apFeeMyr: number
  marginPct: number; marginMode: MarginMode
}
export interface DeepPricing extends OfferPricing {
  marginPct: number
  marginMyr: number | null          // whole RM, null while the import price is unknown (no duty yet)
  sellingMyr: number | null         // import price + margin
  marginOfSellingPct: number | null // margin as a % of the selling price (what staff earn on each RM sold)
  // the customer copy: the margin sits inside the body price
  custBodyMyr: number | null; custBodyJpy: number | null
}

export function deepPricing(i: DeepInput): DeepPricing {
  const p = offerPricing(i)
  const pct = Number.isFinite(i.marginPct) && i.marginPct > 0 ? i.marginPct : 0
  const none: DeepPricing = { ...p, marginPct: pct, marginMyr: null, sellingMyr: null, marginOfSellingPct: null, custBodyMyr: null, custBodyJpy: null }
  if (p.importMyr == null || p.bodyMyr == null || p.agentMyr == null) return none
  const base = i.marginMode === 'cif' ? p.bodyMyr + p.agentMyr : p.importMyr
  const marginMyr = Math.round(base * pct / 100)
  const sellingMyr = p.importMyr + marginMyr
  const custBodyMyr = p.bodyMyr + marginMyr
  return {
    ...p, marginPct: pct, marginMyr, sellingMyr,
    marginOfSellingPct: sellingMyr > 0 ? Math.round(marginMyr / sellingMyr * 1000) / 10 : null,
    custBodyMyr, custBodyJpy: i.rate > 0 ? Math.round(custBodyMyr / i.rate) : null,
  }
}

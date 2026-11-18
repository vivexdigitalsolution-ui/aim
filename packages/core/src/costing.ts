// Order costing (internal, staff only): what the dealer is invoiced, what the car really cost, the profit. Pure maths, no database.
// Everything in yen. Nothing here is shown to a dealer or a customer.

export type DealBasis = 'bid_plus_fixed' | 'cif'

export interface Deal {
  basis: DealBasis
  offerJpy: number | null          // the dealer's agreed amount: for bidding (bid_plus_fixed) or all in (cif)
  fixedChargeJpy: number | null    // freight + insurance you add on top (bid_plus_fixed only)
  showWonPrice: boolean            // false: the dealer did not ask for the winning price, so their amount is what is invoiced
  givebackJpy: number              // what you hand back to show you are honest (reduces the invoice)
  wonJpy: number | null            // the winning price (null until the car is won)
}

export interface CostLine { amountJpy: number; refundableJpy: number }

const n = (v: number | null | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/**
 * What the dealer pays in total.
 *   cif:            their all-in amount.
 *   bid_plus_fixed: (the winning price, or their amount when they did not ask to see it) + the fixed charge.
 * Minus whatever you give back. null while it cannot be known yet (not won, or no amount agreed).
 */
export function invoiceJpy(d: Deal): number | null {
  let base: number | null
  if (d.basis === 'cif') base = d.offerJpy == null ? null : n(d.offerJpy)
  else {
    if (d.wonJpy == null) return null
    base = d.showWonPrice || d.offerJpy == null ? n(d.wonJpy) : n(d.offerJpy)
    base += n(d.fixedChargeJpy)
  }
  return base == null ? null : Math.max(0, base - n(d.givebackJpy))
}

/** What the car really cost you: the winning price plus every line, less the part that comes back. */
export function netCostJpy(wonJpy: number | null, lines: CostLine[]): number {
  return n(wonJpy) + lines.reduce((s, l) => s + n(l.amountJpy) - n(l.refundableJpy), 0)
}

/** What you spend in cash before refunds come back (the "Total Cash Outlay" of your sheet). */
export function cashOutlayJpy(wonJpy: number | null, lines: CostLine[]): number {
  return n(wonJpy) + lines.reduce((s, l) => s + n(l.amountJpy), 0)
}

export interface Profit { invoiceJpy: number; netCostJpy: number; profitJpy: number; marginPct: number | null }
/** Profit = invoice minus net cost. The margin is the profit on the invoice (your sheet divides the document cost by the amount received instead: that formula is wrong). */
export function profitOf(d: Deal, lines: CostLine[]): Profit | null {
  const inv = invoiceJpy(d)
  if (inv == null || d.wonJpy == null) return null
  const cost = netCostJpy(d.wonJpy, lines)
  return { invoiceJpy: inv, netCostJpy: cost, profitJpy: inv - cost, marginPct: inv > 0 ? Math.round(((inv - cost) / inv) * 1000) / 10 : null }
}

/**
 * Before bidding: the most you can bid so that the car still makes `targetProfitJpy`.
 *   cif:            offer - the other costs (net of refunds) - the profit you want
 *   bid_plus_fixed: the dealer's amount IS the bid ceiling (the fixed charge is on top, so it pays your costs: you see the profit it leaves with `profitIfWonAt`)
 * Rounded down to the auction's ¥5,000 step.
 */
export function bidCeilingJpy(d: Pick<Deal, 'basis' | 'offerJpy' | 'givebackJpy'>, estimatedLines: CostLine[], targetProfitJpy = 0): number | null {
  if (d.offerJpy == null) return null
  if (d.basis === 'bid_plus_fixed') return Math.floor(n(d.offerJpy) / 5000) * 5000
  const others = estimatedLines.reduce((s, l) => s + n(l.amountJpy) - n(l.refundableJpy), 0)
  const room = n(d.offerJpy) - n(d.givebackJpy) - others - n(targetProfitJpy)
  return room > 0 ? Math.floor(room / 5000) * 5000 : 0
}

export interface Rate { item_key: string; venue: string | null; party: string | null; amount_jpy: number; valid_from: string }
/**
 * The estimate for one cost line: among the rate-card lines that have started (valid_from <= today), a line for this venue beats a line for every venue;
 * then the newest start date wins. A party can be asked for to narrow it. null when the card has nothing for it: the amount is then left for staff to type.
 */
export function pickRate(rates: Rate[], itemKey: string, venue: string | null, today: string, party?: string | null): Rate | null {
  const v = String(venue || '').trim().toUpperCase()
  const ok = rates.filter((r) => r.item_key === itemKey && r.valid_from <= today && (!party || String(r.party || '').toUpperCase() === party.toUpperCase()))
  const rank = (r: Rate) => (r.venue && String(r.venue).trim().toUpperCase() === v ? 2 : !r.venue ? 1 : 0)
  const fit = ok.filter((r) => rank(r) > 0)
  fit.sort((a, b) => rank(b) - rank(a) || b.valid_from.localeCompare(a.valid_from))
  return fit[0] || null
}

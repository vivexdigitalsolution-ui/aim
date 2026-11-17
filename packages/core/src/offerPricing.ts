// The numbers on the offer report's last column. Plain maths, nothing hidden: the reader adds their own margin.
//   Body price            = history price (yen), shown in RM at the rate
//   Agent fee & shipping  = CIF rate table by body price (yen), shown in RM at the rate
//   Import price          = body + agent fee & shipping + duty + port clearance + inland transfer + AP fee (all RM)

export const DEFAULT_PORT_MYR = 2500
export const DEFAULT_INLAND_MYR = 250
export const DEFAULT_AP_FEE_MYR = 10500

/** CIF rate table (Port Klang North & West): the car price in yen decides the agent fee & shipping in yen. 16,000,000 and above = 5% of the car price. */
export function agentFeeJpy(bodyJpy: number): number {
  if (bodyJpy < 5_000_000) return 250_000
  if (bodyJpy < 8_000_000) return 300_000
  if (bodyJpy < 11_000_000) return 350_000
  if (bodyJpy < 14_000_000) return 400_000
  if (bodyJpy < 16_000_000) return 450_000
  return Math.round(bodyJpy * 0.05)
}

export interface OfferPricing {
  bodyJpy: number | null; bodyMyr: number | null; agentJpy: number | null; agentMyr: number | null; importMyr: number | null
}

export function offerPricing(i: { historyJpy: number | null; rate: number; dutyMyr: number | null; portMyr: number; inlandMyr: number; apFeeMyr: number }): OfferPricing {
  if (!i.historyJpy || !(i.rate > 0)) return { bodyJpy: null, bodyMyr: null, agentJpy: null, agentMyr: null, importMyr: null }
  const agentJpy = agentFeeJpy(i.historyJpy)
  const bodyMyr = Math.round(i.historyJpy * i.rate), agentMyr = Math.round(agentJpy * i.rate)     // whole RM, so the lines add up to the total
  const fees = Math.round(i.portMyr || 0) + Math.round(i.inlandMyr || 0) + Math.round(i.apFeeMyr || 0)
  return { bodyJpy: i.historyJpy, bodyMyr, agentJpy, agentMyr, importMyr: i.dutyMyr != null ? bodyMyr + agentMyr + Math.round(i.dutyMyr) + fees : null }
}

// The duty row of one car for one docket: what lot_costs stores. Same maths the scraper's priceLot() does, kept here so the app
// (staff confirming a docket) and the scraper give identical numbers. Pure: rates, exchange rates and currencies are passed in.
import { calcDuty, calcDutyAt, dutyMonth, matangFrom, type Docket, type DutyRate } from './duty.ts'

export interface CostRow {
  docket_id: string; age_months: number | null; duty_myr: number | null
  duty_after_matang_myr: number | null; matang_from: string
}
export interface CostRef {
  rates: DutyRate[]
  currencies: { code: string; standard_fare_myr: number | null }[]
  fx: Record<string, { rate: number } | undefined>
}

/** @returns the cost row, or null with the reasons in `notes` (no rate, no year / month ...). */
export function dutyCostRow(p: { docket: Docket; regYear: number | null; regMonth: number | null; ref: CostRef; today?: Date }): { cost: CostRow | null; notes: string[] } {
  const { docket, regYear, regMonth, ref } = p
  const today = p.today || new Date()
  const notes: string[] = []
  const month = dutyMonth(regYear, regMonth, today)
  if (!regYear || !month) return { cost: null, notes: ['first register year / month not found: duty not calculated'] }
  const cur = docket.currency_code || 'JPY'
  const rate = ref.fx?.[cur]?.rate
  if (!(Number(rate) > 0)) return { cost: null, notes: [`no exchange rate for ${cur}`] }
  const info = ref.currencies.find((c) => c.code === cur)
  const input = { docket, mfgYear: regYear, mfgMonth: month, rate: Number(rate), rates: ref.rates, standardFare: info?.standard_fare_myr ?? undefined, vehicleType: 'car' as const, today }
  const now = calcDuty(input)
  const from = matangFrom(regYear, month, today)
  const later = calcDutyAt(input, from)
  if (!regMonth) notes.push('first register month not readable: every month of ' + regYear + ' gives the same docket column, so the duty is exact')
  if (now.under12) notes.push('car is under 12 months old: 12-24 month docket figure used')
  now.warnings.forEach((w: string) => notes.push(w))
  return {
    cost: {
      docket_id: docket.id, age_months: now.ageMonths, duty_myr: now.dutyMyr,
      duty_after_matang_myr: !regMonth ? null : later.dutyMyr != null && later.band !== now.band ? later.dutyMyr : null,
      matang_from: `${from.year}-${String(from.month).padStart(2, '0')}-01`,
    },
    notes,
  }
}

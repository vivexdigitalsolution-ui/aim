// Fuel type of a car, for the offer report's "which fuel types to recommend" option.
// The auction listing has no fuel column, so it is worked out from, in this order:
//   1. the fuel the sheet reading saved on the lot (lot.fuel: Petrol / Diesel / Hybrid / Plug-in hybrid / Electric)
//   2. words in the model name (420D, D300, HYBRID, e:HEV, EHEV, PHEV, 330e ...)
//   3. the emission prefix of the model code: the middle letter of 3BA-... is the fuel (B petrol, D diesel, A hybrid, ZAA electric)
// Anything not clearly one of them is null (unknown). Unknown is never excluded: only a car that is clearly diesel / hybrid /
// plug-in is left out when its switch is off.

export type FuelKind = 'petrol' | 'diesel' | 'hybrid' | 'phev' | 'ev'
export type FuelGroup = 'diesel' | 'hybrid' | 'plug'      // the three switches (petrol is always recommended)
export interface FuelAllow { diesel: boolean; hybrid: boolean; plug: boolean }

export const FUEL_LABEL: Record<FuelKind, string> = { petrol: 'Petrol', diesel: 'Diesel', hybrid: 'Hybrid', phev: 'Plug-in hybrid', ev: 'Electric' }

const fromText = (s: string): FuelKind | null => {
  const t = s.toUpperCase()
  if (/PLUG-?IN|PHEV|\bP\d{3}E\b|\d{2,3}E\b|E-HYBRID/.test(t)) return 'phev'
  if (/\bBEV\b|\bEV\b|ELECTRIC|E-TRON|TAYCAN|\bEQ[A-Z]\b|IONIQ ?5|\bLEAF\b/.test(t)) return 'ev'
  if (/HYBRID|HEV\b|\d{3}HL?\b|\bISG\b|MHEV/.test(t)) return 'hybrid'
  if (/DIESEL|\d{2,3}D\b|\bD\d{3}\b|\bTDI\b|\bCDI\b|\bBLUETEC\b|\bCRDI\b|\bXD\b|\bCOOPER S?D\b/.test(t)) return 'diesel'
  return null
}

const fromCode = (code: string | null | undefined): FuelKind | null => {
  const m = String(code || '').toUpperCase().match(/^([0-9A-Z])([A-Z])A-/)
  if (!m) return null
  if (m[2] === 'B') return 'petrol'
  if (m[2] === 'D') return 'diesel'
  if (m[2] === 'A') return m[1] === 'Z' ? 'ev' : 'hybrid'
  return null
}

const fromSheet = (f: string | null | undefined): FuelKind | null => {
  const t = String(f || '').toLowerCase()
  if (!t) return null
  if (/plug/.test(t)) return 'phev'
  if (/electric|^ev$/.test(t)) return 'ev'
  if (/hybrid/.test(t)) return 'hybrid'
  if (/diesel|軽油/.test(t)) return 'diesel'
  if (/petrol|gasoline|ガソリン/.test(t)) return 'petrol'
  return null
}

/** The fuel of a lot row (or null when it cannot be told). A hybrid / diesel named car is that even when the sheet says petrol. */
export function fuelKind(l: { fuel?: string | null; model?: string | null; model_code?: string | null }): FuelKind | null {
  const named = fromText(String(l.model || ''))
  const sheet = fromSheet(l.fuel)
  // the sheet's fuel box says petrol for a hybrid, so a hybrid word in the name or a hybrid code beats "petrol"
  if (sheet && sheet !== 'petrol') return sheet
  if (named) return named
  const coded = fromCode(l.model_code)
  if (sheet === 'petrol') return coded && coded !== 'petrol' ? coded : 'petrol'
  return coded
}

export const fuelGroup = (k: FuelKind | null): FuelGroup | null => (k === 'diesel' ? 'diesel' : k === 'hybrid' ? 'hybrid' : k === 'phev' || k === 'ev' ? 'plug' : null)

/** False only for a car that is clearly diesel / hybrid / plug-in while that switch is off. */
export function fuelAllowed(l: { fuel?: string | null; model?: string | null; model_code?: string | null }, allow: FuelAllow): boolean {
  const g = fuelGroup(fuelKind(l))
  return g ? allow[g] : true
}

export const ALL_FUELS: FuelAllow = { diesel: true, hybrid: true, plug: true }

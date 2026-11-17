// Model codes and Customs lines of one brand + model (used by Admin › Deep search to list the model codes to choose from).
//   a model code reads 3BA-AGH40W on the sheet, AGH40W on the auction listing: compare them without the emission prefix
//   a Customs line reads "ALPHARD (3BA-AGH40W)": the code is inside the brackets

import { docketBrand } from './duty.ts'

export interface ModelRef { maker_code?: string; car_code?: string; brand_name: string; model_name: string; model_code?: string | null }
export interface SiteCode { maker_code: string; car_code: string; code: string }

export const codeCore = (c: string | null | undefined): string => String(c || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')
/** Same model (chassis) code, with or without the emission prefix. */
export const sameCode = (a: string | null | undefined, b: string | null | undefined): boolean => { const x = codeCore(a), y = codeCore(b); return x.length >= 3 && x === y }
export const codeOfDocket = (model: string): string => (String(model).match(/\(([^()]*)\)\s*$/)?.[1] || '').trim()

/** A Customs line belongs to a model when the brand matches (MERCEDES AMG = MERCEDES BENZ) and its name starts with the model name,
 *  or, for "GLA-CLASS", one of its words starts with "GLA" (the AMG lines read "AMG GLA45 S 4MATIC+"). */
export function sameLine(d: { brand: string; model: string }, m: ModelRef): boolean {
  if (docketBrand(d.brand) !== docketBrand(m.brand_name)) return false
  const dm = String(d.model).toUpperCase(), mn = String(m.model_name).toUpperCase()
  if (dm.startsWith(mn)) return true
  const base = mn.replace(/-?CLASS$/, '').trim()
  return base.length >= 3 && dm.replace(/\([^)]*\)/g, ' ').split(/\s+/).some((w) => w.startsWith(base))
}

/** Model codes for a brand + model: the site's own list first, then any extra code only the price guide has (e.g. 3BA-AGH40W). */
export function codesForModel(siteCodes: SiteCode[], dockets: { brand: string; model: string }[], m: ModelRef): string[] {
  const out = new Map<string, string>()          // core -> shown code
  siteCodes.forEach((c) => { if (c.maker_code === m.maker_code && c.car_code === m.car_code) out.set(codeCore(c.code), c.code) })
  dockets.forEach((d) => { if (sameLine(d, m)) { const c = codeOfDocket(d.model); if (c && !out.has(codeCore(c))) out.set(codeCore(c), c) } })
  if (m.model_code && !out.has(codeCore(m.model_code))) out.set(codeCore(m.model_code), m.model_code)
  return [...out.values()].sort()
}

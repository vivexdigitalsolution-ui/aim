// A One price car keeps its model ("ALPHARD") and its trim ("Z", column `grade`) apart; a bidding car's model already holds both
// ("ALPHARD Z"). (`grade` of a One price car is the trim. Its auction score is `auction_grade`.)
import { docketPool, docketTransmission, lotTransmission, type Docket } from './duty.ts'

/** Model and trim as one name, nothing taken out of the trim: ("ALPHARD", "Z SUNROOF") -> "ALPHARD Z SUNROOF".
 *  A trim that already starts with the model ("RX", "RX350 F SPORT") stands alone. */
export function trimmedName(model: string | null | undefined, grade: string | null | undefined): string {
  const m = String(model || '').trim(), v = String(grade || '').replace(/\s+/g, ' ').trim()
  if (!v) return m
  const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const first = squash(v.split(' ')[0]!), name = squash(m)
  if (!name) return v
  // the same word, or the model followed by figures (RX350)
  if (squash(v) === name || first === name || (first.startsWith(name) && /^\d/.test(first.slice(name.length))) || (' ' + v.toUpperCase()).startsWith(' ' + m.toUpperCase() + ' ')) return v
  return `${m} ${v}`
}

// only spacing and - _ . are overlooked; every letter, figure and mark counts (Japanese ones too)
const sameName = (s: string) => s.normalize('NFKC').toUpperCase().replace(/[\s\-_.]+/g, '')

/** A docket's name without its chassis code(s) and without the AT / MT at the end. */
function docketName(model: string, base: string): string {
  const noGear = (s: string) => s.trim().replace(/\s+(AT\s*\/\s*MT|AT|MT)$/, '')
  const noCode = noGear(model.toUpperCase()).replace(/\([^()]*\)(\/[0-9A-Z-]+\))?/g, (m) => (m.replace(/[^A-Z0-9]/g, '').includes(base) || /^\(\s*[0-9A-Z]{2,4}-[0-9A-Z]/.test(m) ? ' ' : m))
  return noGear(noCode.replace(/^[\s/]+|[\s/]+$/g, ''))
}

/**
 * The strict match (decided 28 Nov 2026, ASNET cars): brand, chassis code and engine fit (docketPool) AND the car's whole name is the
 * docket's whole name. Nothing is guessed: no closest name, no word left out. No such docket, or more than one: a person picks.
 */
export function exactDocket(dockets: Docket[], lot: { brand: string; model: string; model_code?: string | null; engine_cc?: number | null; transmission?: string | null }): { docket: Docket | null; candidates: Docket[]; reason: string } {
  const { pool, reason } = docketPool(dockets, lot)
  if (!pool.length) return { docket: null, candidates: [], reason: reason || 'no docket carries this code' }
  const base = String(lot.model_code || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')
  const gear = lotTransmission(lot.transmission)
  const same = pool.filter((d) => sameName(docketName(d.model, base)) === sameName(lot.model))
    .filter((d) => { const t = docketTransmission(d.model); return !gear || t === null || t === 'BOTH' || t === gear })
  if (same.length === 1) return { docket: same[0]!, candidates: pool, reason: `exact name and chassis code: ${lot.model}` }
  return { docket: null, candidates: pool, reason: same.length ? `more than one docket is named exactly "${lot.model}": pick one` : `no docket is named exactly "${lot.model}": pick one` }
}

// The docket decision: the free rule (duty.ts guessDocket) and the AI (docketAi.ts) both pick, then they are compared.
//   confirmed  a person confirmed this exact car before (confirmKey): used, no AI cost
//   trusted    rule and AI chose the SAME docket: used
//   review     they differ, only one of them picked, or the AI check did not run: NOT used, a person checks (shows what each one suggests)
//   none       neither found a docket: no docket, no duty
// Only `confirmed` and `trusted` carry a docket into duty, the offer report and the daily count. A wrong docket is worse than none.
import { docketBrand, type Docket } from './duty.ts'

export type DocketStatus = 'confirmed' | 'trusted' | 'review' | 'none'
export interface AiPick { docket: Docket | null; confidence: 'high' | 'medium' | 'low' | null; reason?: string; words?: string }
export interface DocketDecision {
  status: DocketStatus
  docket: Docket | null              // the docket to use (null for review / none)
  suggestions: Docket[]              // what the rule / AI suggested, for the review screen
  reason: string
}

export function decideDocket(p: { confirmed?: Docket | null; rule: Docket | null; ai: AiPick | null }): DocketDecision {
  const { confirmed = null, rule, ai } = p
  if (confirmed) return { status: 'confirmed', docket: confirmed, suggestions: [confirmed], reason: 'confirmed by staff for this exact car' }
  const aiDocket = ai?.docket ?? null
  if (rule && aiDocket && rule.id === aiDocket.id) return { status: 'trusted', docket: rule, suggestions: [rule], reason: 'rule and AI chose the same docket' }
  const suggestions = [rule, aiDocket].filter((d): d is Docket => !!d).filter((d, i, a) => a.findIndex((x) => x.id === d.id) === i)
  if (!ai) return suggestions.length
    ? { status: 'review', docket: null, suggestions, reason: 'the AI check did not run: a person confirms the rule\'s pick' }
    : { status: 'none', docket: null, suggestions: [], reason: 'no docket found (AI check did not run)' }
  if (!rule && !aiDocket) return { status: 'none', docket: null, suggestions: [], reason: 'neither the rule nor the AI found a docket' }
  if (rule && !aiDocket) return { status: 'review', docket: null, suggestions, reason: 'the rule picked one, the AI says none' + (ai.reason ? ': ' + ai.reason : '') }
  if (!rule && aiDocket) return { status: 'review', docket: null, suggestions, reason: 'only the AI picked one' + (ai.reason ? ': ' + ai.reason : '') }
  return { status: 'review', docket: null, suggestions, reason: 'the rule and the AI picked different dockets' }
}

const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const codeBase = (c: unknown) => String(c ?? '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')

/**
 * The key a confirmed docket is remembered under. Two cars with the same key are the same car for docket purposes:
 * brand, chassis code (without the emission prefix), engine size, listing model name, seats and transmission.
 * Seats and transmission are in the key because the same name can have a 5 and a 7 seat docket, an AT and an MT docket.
 */
export function confirmKey(lot: { brand: string; model_code?: string | null; engine_cc?: number | null; model?: string | null; seats?: number | null; transmission?: string | null }): string {
  const t = /manual|mt|マニュアル/i.test(String(lot.transmission || '')) ? 'MT' : lot.transmission ? 'AT' : '?'
  return [docketBrand(lot.brand), codeBase(lot.model_code), lot.engine_cc || '?', norm(lot.model), lot.seats || '?', t].join('|')
}

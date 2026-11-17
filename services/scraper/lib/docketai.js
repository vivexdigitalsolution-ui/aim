'use strict'

/**
 * lib/docketai.js — the AI docket check. Claude picks the Customs docket for ONE car, but only from the short list the
 * free rule already narrowed (brand + newest edition + chassis code + emission prefix + engine size = duty.ts docketPool).
 * It can answer "none", it must say which words decided it, and it can never invent a docket (it answers with a number from the list).
 *
 * Used together with the rule pick (guessDocket): both agree -> trusted; they differ, or the AI is unsure -> a person checks.
 * Pure function: the caller passes `ask` (lib/claude.ask or a fake), so it is testable offline.
 */

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['choice', 'confidence', 'deciding_words', 'reason'],
  properties: {
    choice: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'the number of the docket in the list that is this car; null when none of them is this car, or when the car details do not separate two or more of them' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high = the car details clearly point to this one docket and exclude the others' },
    deciding_words: { type: 'string', description: 'the words from the car name / sheet that decided it (e.g. "GR SPORT", "7 seats", "HYBRID"); empty when choice is null' },
    reason: { type: 'string', description: 'one short sentence, max 20 words, English' },
  },
}

const SYSTEM = `You match ONE used Japanese car to its Malaysian Customs (JKDM) docket line. You get the car's details and a numbered list of candidate dockets.
Rules:
- Answer with the number of the docket from the list, or null. Never invent or alter a docket.
- Every candidate already has the right brand, chassis code and engine size. You decide the TRIM / VARIANT: the trim words of the docket must be what the car is.
- A docket for a different body style is wrong (SHOOTING BRAKE, COUPE, CONVERTIBLE, WAGON, VAN) unless the car is that body style.
- A docket that names a seat count (7 SEATER, 5S, 5@7 = 5 or 7 seats) is only for a car with that many seats. If the car's seats are not given, do not use seats to decide.
- A docket that names a package or grade word (M SPORT, AMG LINE, S LINE, GR SPORT, HYBRID, EXECUTIVE LOUNGE, URBAN CHROME ...) is only for a car that has that word in its name or in its sheet text. A plain car must not get the docket of a fuller trim just because it is the only one left.
- AT / MT at the end of a docket is the transmission: it must match the car's transmission when the car's is given.
- Prefer the docket whose name is closest to the car's name (fewest extra trim words).
- A plain car gets the plain docket: when the car's name has no package / edition word and a docket has exactly the car's name (HARRIER Z, CIVIC TYPE R, NX250 VERSION L), that docket is the answer, because the longer dockets (Z LEATHER PACKAGE, RACING BLACK PACKAGE, PLASMA ORANGE EDITION) are only for cars that carry those words in their name or sheet. A fuller docket is never chosen on a guess either. Equipment words such as "leather" or "half leather" do not make a LEATHER PACKAGE.
- Answer null only when no docket is the car, or when two dockets are equally close to the car's name and the car's words do not separate them. A wrong docket is far worse than no docket.
- confidence "high" only when the car details clearly point to that one docket.
- English only. deciding_words: the exact words that decided it.`

function carText(lot, pool) {
  const bits = [
    `Brand: ${lot.brand}`, `Model name (listing): ${lot.model}`, lot.grade && `Grade: ${lot.grade}`, lot.model_code && `Chassis code: ${lot.model_code}`,
    lot.mfg_year && `Year: ${lot.mfg_year}`, lot.engine_cc && `Engine: ${lot.engine_cc} cc`, lot.transmission && `Transmission: ${lot.transmission}`,
    lot.seats ? `Seats: ${lot.seats}` : 'Seats: not known', lot.drive && `Drive: ${lot.drive}`, lot.fuel && `Fuel: ${lot.fuel}`,
    lot.equipment && `Equipment: ${String(lot.equipment).slice(0, 400)}`,
    lot.sales_points && `Selling points: ${String(lot.sales_points).slice(0, 300)}`,
    (lot.inspector_report_en || lot.notes_en) && `Sheet notes: ${String(lot.inspector_report_en || lot.notes_en).slice(0, 400)}`,
  ].filter(Boolean)
  return bits.join('\n') + '\n\nCandidate dockets:\n' + pool.map((d, i) => `${i + 1}. ${d.model}`).join('\n')
}

/**
 * @param {object} p
 * @param {object} p.lot     a row of public.lots (seats may be patched in by the caller)
 * @param {object[]} p.pool  duty.ts docketPool(...).pool
 * @param {Function} p.ask   lib/claude.ask
 * @returns {Promise<{ docket: object|null, confidence: string|null, words: string, reason: string, usage: object }>}
 */
async function aiPickDocket({ lot, pool, ask }) {
  if (!pool.length) return { docket: null, confidence: null, words: '', reason: 'no candidate', usage: { input: 0, output: 0 } }
  const r = await ask({ system: SYSTEM, content: carText(lot, pool), schema: SCHEMA, maxTokens: 1200 })
  const n = r.data.choice
  const docket = Number.isInteger(n) && n >= 1 && n <= pool.length ? pool[n - 1] : null
  return { docket, confidence: docket ? r.data.confidence : (r.data.confidence || null), words: r.data.deciding_words || '', reason: r.data.reason || '', usage: r.usage }
}

module.exports = { aiPickDocket, DOCKET_SCHEMA: SCHEMA, carText }

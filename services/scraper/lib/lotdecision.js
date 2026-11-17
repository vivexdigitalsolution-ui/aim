'use strict'

/**
 * lib/lotdecision.js — the docket decision for ONE lot (v2): the free rule and Claude both pick, then they are compared (core decideDocket).
 *   confirmed -> a person confirmed this exact car before (docket_confirmations, key = core confirmKey): used, no AI call
 *   trusted   -> rule and AI chose the same docket: used
 *   review    -> they differ / only one picked / the AI did not run: NOT used, a person checks
 *   none      -> no docket
 * Claude only chooses among the dockets the rule already narrowed (core docketPool); an empty list costs no AI call.
 * Pure of the database except saveDecision() / saveFeatures(). `ask` is lib/claude.ask (or a fake).
 */

async function decideLot({ lot, code, ref, ask }) {
  const C = ref.duty   // the whole @aim/core module
  const car = { brand: lot.brand, model: lot.model, model_code: code, engine_cc: lot.engine_cc, transmission: lot.transmission, seats: lot.seats }
  const key = C.confirmKey(car)
  const confirmed = ref.confirmations?.get(key) || null
  const g = C.guessDocket(ref.dockets, { ...car, family: ref.families?.get(lot.maker_code + '|' + lot.car_code) || null, sheet_text: [lot.sales_points, lot.notes, lot.notes_en, lot.inspector_report, lot.inspector_report_en, lot.equipment].filter(Boolean).join(' ') })
  let ai = null, aiError = null
  if (!confirmed) {
    const { pool } = C.docketPool(ref.dockets, car)
    if (!pool.length) ai = { docket: null, confidence: null, reason: 'no candidate' }
    else if (ask) {
      try { ai = await C.aiPickDocket({ lot: { ...lot, model_code: code }, pool, ask }) } catch (e) { aiError = e.message }
    }
  }
  const decision = C.decideDocket({ confirmed, rule: g.docket, ai })
  return { decision, ruleDocket: g.docket, ruleReason: g.reason, ai, aiError, key }
}

/** Save what was decided (one row per lot). Returns an error message or null. */
async function saveDecision(supabase, lotId, r) {
  const d = r.decision
  const row = {
    lot_id: lotId, status: d.status, docket_id: d.docket?.id || null, rule_docket_id: r.ruleDocket?.id || null, ai_docket_id: r.ai?.docket?.id || null,
    ai_confidence: r.ai?.confidence || null, ai_words: (r.ai?.words || '').slice(0, 200) || null, ai_reason: (r.ai?.reason || '').slice(0, 300) || null,
    reason: (d.reason + (r.aiError ? ' (AI error: ' + r.aiError + ')' : '')).slice(0, 400), decided_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('lot_docket_decisions').upsert(row, { onConflict: 'lot_id' })
  return error ? error.message : null
}

/** Replace a lot's features (delete + insert). `features` = core normalizeFeatures() output. */
async function saveFeatures(supabase, lotId, features) {
  const del = await supabase.from('lot_features').delete().eq('lot_id', lotId)
  if (del.error) return del.error.message
  if (!features.length) return null
  const { error } = await supabase.from('lot_features').insert(features.map((f) => ({ lot_id: lotId, key: f.key, label: f.label, grp: f.group || 'Other', source: f.source || 'unknown', evidence: (f.evidence || '').slice(0, 200) || null })))
  return error ? error.message : null
}

module.exports = { decideLot, saveDecision, saveFeatures }

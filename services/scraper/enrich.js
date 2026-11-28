'use strict'

/**
 * enrich.js — run after a scrape. Fills the gaps on upcoming cars (chassis code, first register month, inspection date, doors, seats,
 * drive, English notes, selling points) by reading each car's auction sheet with Claude, finds the Customs docket, and works out the duty.
 * ONE run does both kinds of car: the bidding cars (table lots) first, then the One price cars (table one_price_lots).
 * A car that was read before is never read again. A One price car that is the same car as an already-read bidding car (same source key)
 * simply gets that bidding car's result copied: no Claude call.
 *
 * A sheet that is handwritten, or a value Claude is not sure of, sets needs_review + review_note on the car: the car page then warns
 * buyers and staff to check the sheet.
 *
 *   node enrich.js                 every car not done yet (max 100 in total)
 *   node enrich.js --limit 300     more cars in one run (bidding cars first, the rest of the limit goes to One price cars)
 *   node enrich.js --only bid      just the bidding cars      (--only oneprice: just the One price cars)
 *   node enrich.js --features      re-read only the cars that have no features read from the sheet (text match only, or none)
 *   node enrich.js --force         redo cars that were already done (the first ones by deadline: add --limit or --model)
 *   node enrich.js --force --model "GT-R"   redo only the cars whose model name contains this text
 *   node enrich.js --source asnet --limit 3   only One price cars from this source (asnet or uss)
 *   node enrich.js --dry           show what it would do, change nothing, no AI call
 *
 * Needs ANTHROPIC_API_KEY in scraper/.env. Without it the run stops before touching anything.
 * Cost: one Claude call per car (sheet picture + text), plus one more to choose the docket when the free rule is not enough.
 */

const supabase = require('./lib/db')
const claude = require('./lib/claude')
const { enrichLot } = require('./lib/enrich')
const { loadRef } = require('./lib/ref')
const { saveDecision, saveFeatures } = require('./lib/lotdecision')
const { refreshBatchCopies } = require('./lib/batchcopy')

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const FEATURES = process.argv.includes('--features')       // re-read only the cars whose features were never read from the sheet picture
const FORCE = process.argv.includes('--force') || FEATURES
const DRY = process.argv.includes('--dry')
const LIMIT = parseInt(arg('--limit') || '100', 10)
const MODEL = arg('--model')
const SOURCE = (arg('--source') || '').toLowerCase()                          // '' = both; asnet / uss = One price cars of that source only
if (process.argv.includes('--source') && !['asnet', 'uss'].includes(SOURCE)) { console.log('--source needs asnet or uss'); process.exit(1) }
const ONLY = SOURCE ? 'oneprice' : (arg('--only') || '').toLowerCase().replace(/[^a-z]/g, '')       // '' = both
if (ONLY && !['bid', 'oneprice'].includes(ONLY)) { console.log('--only needs bid or oneprice'); process.exit(1) }

// what a read fills in: same column names in lots and one_price_lots
const READ_FIELDS = ['model_code', 'chassis_no', 'first_reg_month', 'mfg_month', 'mfg_year', 'inspection_until', 'doors', 'seats', 'drive', 'fuel', 'steering',
  'sales_points', 'pick_score', 'pick_reason', 'accident', 'inspector_report_en', 'needs_review', 'review_note']

const stats = { done: 0, priced: 0, failed: 0, copied: 0, flagged: 0 }
let stop = false

// ── bidding cars ──────────────────────────────────────────────────────────────

async function bidLots(limit) {
  let q = supabase.from('lots').select('*').eq('my_eligible', true).gt('bid_deadline', new Date().toISOString()).gte('auction_date', require('./lib/cutoff').jstToday()).order('bid_deadline').limit(limit)
  if (!FORCE) q = q.is('enriched_at', null)
  if (MODEL) q = q.ilike('model', '%' + MODEL + '%')
  if (FEATURES) {
    q = q.not('enriched_at', 'is', null).limit(5000)
    const have = new Set()
    for (let from = 0; ; from += 1000) {
      const f = await supabase.from('lot_features').select('lot_id').neq('evidence', 'text match').range(from, from + 999)
      if (f.error) throw f.error
      f.data.forEach((r) => have.add(r.lot_id))
      if (f.data.length < 1000) break
    }
    const { data, error } = await q
    if (error) throw error
    return data.filter((l) => !have.has(l.id)).slice(0, limit)
  }
  const { data, error } = await q
  if (error) throw error
  return data
}

async function enrichBid(lot, ref) {
  const r = await enrichLot({ lot, ref, ask: claude.ask, imageBlock: claude.imageBlock })
  const up = await supabase.from('lots').update({ ...r.patch, enriched_at: new Date().toISOString(), enrich_note: r.notes.join('; ') || null }).eq('id', lot.id)
  if (up.error) throw new Error(up.error.message)
  if (r.cost) {
    const c = await supabase.from('lot_costs').upsert({ lot_id: lot.id, ...r.cost, updated_at: new Date().toISOString() }, { onConflict: 'lot_id' })
    if (c.error) throw new Error(c.error.message)
    stats.priced++
  } else if (r.decided) await supabase.from('lot_costs').delete().eq('lot_id', lot.id)   // no used docket: no duty either
  if (r.decided) { const e1 = await saveDecision(supabase, lot.id, r.decided); if (e1) console.log('   decision not saved: ' + e1) }
  const e2 = await saveFeatures(supabase, lot.id, r.features || []); if (e2) console.log('   features not saved: ' + e2)
  await refreshBatchCopies(lot.id)
  return r
}

// ── One price cars ────────────────────────────────────────────────────────────

async function onePriceRows(limit) {
  // open = the offer has not ended, or the car has no end date (ASNET: it is removed once no longer listed). The soonest ending come first.
  const hasSource = !(await supabase.from('one_price_lots').select('source').limit(1)).error      // false until migration 63 has run
  const now = new Date().toISOString()
  let q = supabase.from('one_price_lots').select('*')
  q = hasSource ? q.or(`deadline.gt."${now}",and(source.eq.asnet,deadline.is.null)`) : q.gt('deadline', now)
  if (SOURCE) q = q.eq('source', SOURCE)
  q = q.order('deadline', { ascending: true, nullsFirst: false }).limit(limit)
  if (!FORCE) q = q.is('enriched_at', null)
  if (MODEL) q = q.ilike('model', '%' + MODEL + '%')
  if (FEATURES) {
    const { data, error } = await q.not('enriched_at', 'is', null).limit(5000)
    if (error) throw error
    return data.filter((o) => !(Array.isArray(o.features) && o.features.some((f) => f && f.evidence && f.evidence !== 'text match'))).slice(0, limit)
  }
  const { data, error } = await q
  if (error) throw error
  return data
}

/** a One price row in the shape the sheet read expects. An ASNET car carries its trim in the name and is matched strictly (exact_only). */
function asLot(o, ref) {
  const strict = o.source === 'asnet'
  return {
    id: o.id, brand: o.brand, model: strict ? ref.duty.trimmedName(o.model, o.grade) : o.model, exact_only: strict, maker_code: o.maker_code, car_code: o.car_code, model_code: o.model_code, grade: o.auction_grade, interior_grade: null,
    mfg_year: o.mfg_year, mfg_month: o.mfg_month, mileage_km: o.mileage_km, engine_cc: o.engine_cc, transmission: o.transmission, drive: o.drive, fuel: o.fuel,
    equipment: o.equipment, notes: o.grade ? `Variant (Japanese listing): ${o.grade}` : null, inspector_report: null, sheet_url: o.sheet_url, photos: o.photos, seats: o.seats, sales_points: null,
  }
}

/** the same car was already read as a bidding car: copy that result (no Claude call). @returns {boolean} copied */
async function copyFromBid(o) {
  const { data: l } = await supabase.from('lots').select('*').eq('ex_key', o.ex_key).not('enriched_at', 'is', null).order('enriched_at', { ascending: false }).limit(1).maybeSingle()
  if (!l) return false
  const patch = {}
  for (const k of READ_FIELDS) if (l[k] !== undefined && l[k] !== null) patch[k] = l[k]
  const { data: c } = await supabase.from('lot_costs').select('*').eq('lot_id', l.id).maybeSingle()
  const { data: d } = await supabase.from('lot_docket_decisions').select('status,reason,docket_id').eq('lot_id', l.id).maybeSingle()
  const { data: f } = await supabase.from('lot_features').select('key,label,grp,source,evidence').eq('lot_id', l.id)
  const up = await supabase.from('one_price_lots').update({
    ...patch, features: f?.length ? f : null, enriched_at: new Date().toISOString(), enrich_note: 'copied from the same car read as a bidding car',
    docket_id: c?.docket_id || d?.docket_id || null, docket_status: d?.status || null, docket_reason: d?.reason || null,
    age_months: c?.age_months ?? null, duty_myr: c?.duty_myr ?? null, duty_after_matang_myr: c?.duty_after_matang_myr ?? null, matang_from: c?.matang_from ?? null,
  }).eq('id', o.id)
  if (up.error) throw new Error(up.error.message)
  return true
}

async function enrichOnePrice(o, ref) {
  if (!FORCE && await copyFromBid(o)) { stats.copied++; return { copied: true } }
  const r = await enrichLot({ lot: asLot(o, ref), ref, ask: claude.ask, imageBlock: claude.imageBlock })
  const dec = r.decided?.decision
  const up = await supabase.from('one_price_lots').update({
    ...r.patch, enriched_at: new Date().toISOString(), enrich_note: r.notes.join('; ') || null,
    features: r.features?.length ? r.features : null,
    docket_id: r.cost?.docket_id || dec?.docket?.id || null, docket_status: dec?.status || null, docket_reason: dec?.reason ? String(dec.reason).slice(0, 400) : null,
    age_months: r.cost?.age_months ?? null, duty_myr: r.cost?.duty_myr ?? null, duty_after_matang_myr: r.cost?.duty_after_matang_myr ?? null, matang_from: r.cost?.matang_from ?? null,
  }).eq('id', o.id)
  if (up.error) throw new Error(up.error.message)
  if (r.cost) stats.priced++
  return r
}

// ── the run ───────────────────────────────────────────────────────────────────

async function pass(label, rows, ref, work, table) {
  console.log(`\n${rows.length} ${label} to do${DRY ? ' (dry run)' : ''}`)
  if (DRY) { rows.slice(0, 20).forEach((l) => console.log(' -', l.brand, l.model, l.lot_no || l.ex_key, l.sheet_url ? '' : '(no sheet)')); if (rows.length > 20) console.log(`   ... and ${rows.length - 20} more`); return }
  for (const lot of rows) {
    if (stop) break
    try {
      const r = await work(lot, ref)
      if (r.copied) { console.log(`${lot.brand} ${lot.model} ${lot.ex_key}: copied from the bidding record`); continue }
      stats.done++
      if (r.patch?.needs_review) stats.flagged++
      console.log(`${lot.brand} ${lot.model} ${lot.lot_no || lot.ex_key}: ${r.cost ? 'duty RM ' + r.cost.duty_myr : 'no duty'} (${r.decided ? r.decided.decision.status : r.docketSource || 'no docket'}) [${(r.features || []).length} features]${r.patch?.needs_review ? ' ⚠ CHECK SHEET: ' + r.patch.review_note : ''}${r.notes.length ? ' · ' + r.notes[0] : ''}`)
    } catch (e) {
      stats.failed++
      console.log(`${lot.brand} ${lot.model} ${lot.lot_no || lot.ex_key}: FAILED ${e.message}`)
      if (/token cap|not set up/.test(e.message)) { stop = true; break }
      await supabase.from(table).update({ enrich_note: ('AI: ' + e.message).slice(0, 300) }).eq('id', lot.id)
    }
  }
}

async function main() {
  if (!claude.isReady() && !DRY) { console.log('ANTHROPIC_API_KEY is empty in scraper/.env: nothing done.'); process.exit(1) }
  const flagCol = await supabase.from('lots').select('needs_review').limit(1)
  if (flagCol.error) { console.log('Run supabase/migrations/44_enrich_one_price_review_flag.sql first (the "check the sheet" flag column is missing): ' + flagCol.error.message); process.exit(1) }
  const ref = await loadRef()
  console.log(`Reference: ${ref.dockets.length} dockets, rates ${Object.keys(ref.fx).join(', ') || 'NONE'}`)
  if (!ref.dockets.length) { console.log('No dockets in the database. Run: node ../scripts/copy-reference.mjs'); process.exit(1) }

  let left = LIMIT
  if (ONLY !== 'oneprice') {
    const lots = await bidLots(left)
    await pass('bidding car(s)', lots, ref, enrichBid, 'lots')
    left -= lots.length
  }
  if (ONLY !== 'bid' && left > 0 && !stop) {
    const probe = await supabase.from('one_price_lots').select('enriched_at').limit(1)
    if (probe.error) console.log('\nOne price cars skipped: ' + probe.error.message + ' (run migration 44 first)')
    else await pass('One price car(s)', await onePriceRows(left), ref, enrichOnePrice, 'one_price_lots')
  }
  if (DRY) return
  console.log(`\nDone ${stats.done} (read by Claude), copied ${stats.copied} (same car already read), duty worked out for ${stats.priced}, flagged "check the sheet" ${stats.flagged}, failed ${stats.failed}. ${claude.summary()}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

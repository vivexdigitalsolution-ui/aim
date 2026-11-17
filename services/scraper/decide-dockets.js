'use strict'

/**
 * decide-dockets.js — runs the v2 docket decision (the free rule AND Claude both pick, then compared) on lots that were already read,
 * and saves one row per lot in lot_docket_decisions. It does NOT read the auction sheet again (only a short docket question to Claude).
 *
 *   node decide-dockets.js --n 200               the next 200 open lots with no decision yet (a sample)
 *   node decide-dockets.js --n 200 --model "VELLFIRE"   only lots whose model name contains this text
 *   node decide-dockets.js --all-open            every open lot with no decision yet
 *   node decide-dockets.js --redo                also lots that already have a decision
 *   node decide-dockets.js --dry                 show the outcome, write nothing
 *   node decide-dockets.js --apply               ALSO change the duty (lot_costs): a lot without a used docket loses its duty.
 *                                                Without --apply only lot_docket_decisions is written; lot_costs and the offer report stay as they are.
 *   node decide-dockets.js --no-ai               rule only (every rule pick then waits for a person: review)
 *
 * Spends AI tokens: about 350 input + 105 output per lot that has candidate dockets.
 */

const supabase = require('./lib/db')
const claude = require('./lib/claude')
const { loadRef } = require('./lib/ref')
const { priceLot } = require('./lib/enrich')
const { decideLot, saveDecision } = require('./lib/lotdecision')
const { refreshBatchCopies } = require('./lib/batchcopy')

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const has = (n) => process.argv.includes(n)
const N = has('--all-open') ? 100000 : parseInt(arg('--n') || '200', 10)
const MODEL = arg('--model')
const DRY = has('--dry'), APPLY = has('--apply'), REDO = has('--redo'), NOAI = has('--no-ai')

async function main() {
  if (!NOAI && !claude.isReady()) { console.log('ANTHROPIC_API_KEY is empty in .env: use --no-ai or add the key.'); process.exit(1) }
  const ref = await loadRef()
  if (!ref.hasDecisions) { console.log('Migration 18 is not applied (docket_confirmations missing).'); process.exit(1) }
  console.log(`Reference: ${ref.dockets.length} dockets, ${ref.confirmations.size} confirmed cars`)

  const lots = []
  for (let from = 0; lots.length < N; from += 1000) {
    let q = supabase.from('lots').select('*').eq('my_eligible', true).not('enriched_at', 'is', null).not('model_code', 'is', null).gt('bid_deadline', new Date().toISOString()).order('bid_deadline').range(from, from + 999)
    if (MODEL) q = q.ilike('model', '%' + MODEL + '%')
    const { data, error } = await q
    if (error) throw error
    lots.push(...data)
    if (data.length < 1000) break
  }
  let todo = lots
  if (!REDO) {
    const done = new Set()
    for (let i = 0; i < lots.length; i += 200) {
      const { data } = await supabase.from('lot_docket_decisions').select('lot_id').in('lot_id', lots.slice(i, i + 200).map((l) => l.id))
      ;(data || []).forEach((r) => done.add(r.lot_id))
    }
    todo = lots.filter((l) => !done.has(l.id))
  }
  todo = todo.slice(0, N)
  console.log(`${todo.length} open lots to decide${DRY ? ' (dry run: nothing written)' : APPLY ? ' (duty WILL be changed)' : ' (decisions only; duty and report unchanged)'}\n`)

  const count = {}, shown = []
  let next = 0
  const worker = async () => {
    while (next < todo.length) {
      const lot = todo[next++]
      try {
        const r = await decideLot({ lot, code: lot.model_code, ref, ask: NOAI ? null : claude.ask })
        const st = r.decision.status
        count[st] = (count[st] || 0) + 1
        if (st === 'review' || st === 'none' && r.ai?.docket) shown.push({ lot, r })
        if (DRY) continue
        const err = await saveDecision(supabase, lot.id, r)
        if (err) { console.log(`   ${lot.lot_no}: decision not saved: ${err}`); continue }
        if (APPLY) {
          const p = priceLot({ lot, code: lot.model_code, regYear: lot.mfg_year, regMonth: lot.mfg_month || lot.first_reg_month, ref, decision: r.decision })
          if (p.cost) await supabase.from('lot_costs').upsert({ lot_id: lot.id, ...p.cost, updated_at: new Date().toISOString() }, { onConflict: 'lot_id' })
          else await supabase.from('lot_costs').delete().eq('lot_id', lot.id)
          await refreshBatchCopies(lot.id)
        }
      } catch (e) {
        count.error = (count.error || 0) + 1
        console.log(`   ${lot.brand} ${lot.model} ${lot.lot_no}: FAILED ${e.message}`)
        if (/token cap|not set up/.test(e.message)) next = todo.length
      }
    }
  }
  await Promise.all([0, 1, 2, 3].map(worker))

  console.log('RESULT')
  ;[['trusted', 'rule and AI agree (used)'], ['confirmed', 'confirmed by a person (used)'], ['review', 'a person must check (not used)'], ['none', 'no docket'], ['error', 'failed']].forEach(([k, t]) => { if (count[k]) console.log(`  ${String(count[k]).padStart(5)}  ${k.padEnd(10)} ${t}`) })
  if (shown.length) {
    console.log(`\nWaiting for a person (${shown.length}), first 30:`)
    shown.slice(0, 30).forEach(({ lot, r }) => console.log(`- ${lot.brand} ${lot.model} (${lot.model_code}, ${lot.engine_cc}cc, seats ${lot.seats || '?'}) lot ${lot.lot_no}\n    rule: ${r.ruleDocket ? r.ruleDocket.model : 'none'}\n    ai  : ${r.ai?.docket ? r.ai.docket.model + ' [' + r.ai.confidence + ']' : 'none'} ${r.ai?.reason || r.aiError || ''}`))
  }
  console.log('\n' + claude.summary())
}

main().catch((e) => { console.error(e); process.exit(1) })

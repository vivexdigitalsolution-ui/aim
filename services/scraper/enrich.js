'use strict'

/**
 * enrich.js — run after a scrape. Fills the gaps on upcoming lots (chassis code, first register month, inspection date, doors, seats,
 * drive, English notes, selling points) by reading each lot's auction sheet with Claude, finds the Customs docket, and works out the duty.
 *
 *   node enrich.js                 upcoming lots not done yet (max 100)
 *   node enrich.js --limit 300     more lots in one run
 *   node enrich.js --force         redo lots that were already done (the first 100 by deadline: add --limit or --model)
 *   node enrich.js --force --model "GT-R"   redo only the lots whose model name contains this text
 *   node enrich.js --dry           show what it would do, change nothing, no AI call
 *
 * Needs ANTHROPIC_API_KEY in scraper/.env. Without it the run stops before touching anything.
 * Cost: one Claude call per lot (sheet picture + text). The docket is found by a free strict rule (chassis code + engine + trim name
 * must all match, see guessDocket in app/utils/duty.ts); when they do not, the lot simply has no docket and no duty.
 */

const supabase = require('./lib/db')
const claude = require('./lib/claude')
const { enrichLot } = require('./lib/enrich')
const { loadRef } = require('./lib/ref')
const { saveDecision, saveFeatures } = require('./lib/lotdecision')
const { refreshBatchCopies } = require('./lib/batchcopy')

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const FORCE = process.argv.includes('--force')
const DRY = process.argv.includes('--dry')
const LIMIT = parseInt(arg('--limit') || '100', 10)
const MODEL = arg('--model')

async function main() {
  if (!claude.isReady() && !DRY) { console.log('ANTHROPIC_API_KEY is empty in scraper/.env: nothing done.'); process.exit(1) }
  const ref = await loadRef()
  console.log(`Reference: ${ref.dockets.length} dockets, rates ${Object.keys(ref.fx).join(', ') || 'NONE'}`)
  if (!ref.dockets.length) { console.log('No dockets in the database. Run: node ../scripts/copy-reference.mjs'); process.exit(1) }

  let q = supabase.from('lots').select('*').eq('my_eligible', true).gt('bid_deadline', new Date().toISOString()).gte('auction_date', require('./lib/cutoff').firstAuctionDate()).order('bid_deadline').limit(LIMIT)
  if (!FORCE) q = q.is('enriched_at', null)
  if (MODEL) q = q.ilike('model', '%' + MODEL + '%')
  const { data: lots, error } = await q
  if (error) throw error
  console.log(`${lots.length} lots to do${DRY ? ' (dry run)' : ''}`)
  if (DRY) { lots.slice(0, 20).forEach((l) => console.log(' -', l.brand, l.model, l.lot_no, l.sheet_url ? '' : '(no sheet)')); return }

  let done = 0, priced = 0, failed = 0
  for (const lot of lots) {
    try {
      const r = await enrichLot({ lot, ref, ask: claude.ask, imageBlock: claude.imageBlock })
      const up = await supabase.from('lots').update({ ...r.patch, enriched_at: new Date().toISOString(), enrich_note: r.notes.join('; ') || null }).eq('id', lot.id)
      if (up.error) throw new Error(up.error.message)
      if (r.cost) {
        const c = await supabase.from('lot_costs').upsert({ lot_id: lot.id, ...r.cost, updated_at: new Date().toISOString() }, { onConflict: 'lot_id' })
        if (c.error) throw new Error(c.error.message)
        priced++
      } else if (r.decided) await supabase.from('lot_costs').delete().eq('lot_id', lot.id)   // no used docket: no duty either
      if (r.decided) { const e1 = await saveDecision(supabase, lot.id, r.decided); if (e1) console.log('   decision not saved: ' + e1) }
      const e2 = await saveFeatures(supabase, lot.id, r.features || []); if (e2) console.log('   features not saved: ' + e2)
      await refreshBatchCopies(lot.id)
      done++
      console.log(`${lot.brand} ${lot.model} ${lot.lot_no}: ${r.cost ? 'duty RM ' + r.cost.duty_myr : 'no duty'} (${r.decided ? r.decided.decision.status : r.docketSource || 'no docket'}) [${(r.features || []).length} features]${r.notes.length ? ' · ' + r.notes[0] : ''}`)
    } catch (e) {
      failed++
      console.log(`${lot.brand} ${lot.model} ${lot.lot_no}: FAILED ${e.message}`)
      if (/token cap|not set up/.test(e.message)) break
      await supabase.from('lots').update({ enrich_note: ('AI: ' + e.message).slice(0, 300) }).eq('id', lot.id)
    }
  }
  console.log(`Done ${done}, duty worked out for ${priced}, failed ${failed}. ${claude.summary()}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

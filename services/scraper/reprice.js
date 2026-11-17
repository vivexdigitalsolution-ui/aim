'use strict'

/**
 * reprice.js — finds the docket and works out the duty AGAIN for lots that were already read, with NO AI call (free, takes seconds).
 * Use it after the docket rule changed, or after new dockets were loaded. It uses what is already saved on each lot
 * (brand, model name, chassis code, engine size, first register month), never the auction sheet.
 *
 *   node reprice.js --dry          show what would change, write nothing
 *   node reprice.js                fix every open lot that was read (enriched)
 *   node reprice.js --model "GT-R" only lots whose model name contains this text
 *
 * Also brings the offer report batches up to date, so the report shows the new docket and duty.
 */

const supabase = require('./lib/db')
const { priceLot } = require('./lib/enrich')
const { loadRef } = require('./lib/ref')
const { refreshBatchCopies } = require('./lib/batchcopy')

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const DRY = process.argv.includes('--dry')
const MODEL = arg('--model')
// the notes this script owns: they are replaced, every other note the AI wrote stays
const OURS = /^(no docket|no exchange rate|car is under 12 months|first register year \/ month not found)/

async function main() {
  const ref = await loadRef()
  console.log(`Reference: ${ref.dockets.length} dockets, rates ${Object.keys(ref.fx).join(', ') || 'NONE'}`)
  if (!ref.dockets.length) { console.log('No dockets in the database. Run: node ../scripts/copy-reference.mjs'); process.exit(1) }

  const lots = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from('lots').select('*').eq('my_eligible', true).not('enriched_at', 'is', null).gt('bid_deadline', new Date().toISOString()).order('bid_deadline').range(from, from + 999)
    if (MODEL) q = q.ilike('model', '%' + MODEL + '%')
    const { data, error } = await q
    if (error) throw error
    lots.push(...data)
    if (data.length < 1000) break
  }
  const costs = new Map()
  for (let i = 0; i < lots.length; i += 100) {
    const { data } = await supabase.from('lot_costs').select('lot_id,docket_id,duty_myr').in('lot_id', lots.slice(i, i + 100).map((l) => l.id))
    ;(data || []).forEach((r) => costs.set(r.lot_id, r))
  }
  console.log(`${lots.length} read lots${DRY ? ' (dry run: nothing is written)' : ''}`)

  let same = 0, gained = 0, changed = 0, lost = 0, still = 0
  for (const lot of lots) {
    const r = priceLot({ lot, code: lot.model_code, regYear: lot.mfg_year, regMonth: lot.mfg_month || lot.first_reg_month, ref })
    const old = costs.get(lot.id) || null
    const nowId = r.cost ? r.cost.docket_id : null
    const oldId = old ? old.docket_id : null
    if (nowId === oldId && (!r.cost || Number(old?.duty_myr) === Number(r.cost.duty_myr))) { if (!nowId) still++; else same++; continue }
    const kind = !oldId ? 'NEW ' : !nowId ? 'LOST' : 'DIFF'
    if (kind === 'NEW ') gained++; else if (kind === 'LOST') lost++; else changed++
    const dk = r.docket ? r.docket.model : '—'
    console.log(`${kind} ${lot.brand} | ${lot.model} | ${lot.model_code} | ${lot.lot_no}  =>  ${dk}${r.cost ? '  RM ' + r.cost.duty_myr : ''}${oldId ? '   (was RM ' + old.duty_myr + ')' : ''}`)
    if (DRY) continue
    if (r.cost) {
      const c = await supabase.from('lot_costs').upsert({ lot_id: lot.id, ...r.cost, updated_at: new Date().toISOString() }, { onConflict: 'lot_id' })
      if (c.error) { console.log('   FAILED ' + c.error.message); continue }
    } else if (old) {
      await supabase.from('lot_costs').delete().eq('lot_id', lot.id)
    }
    const kept = String(lot.enrich_note || '').split('; ').filter((n) => n && !OURS.test(n))
    await supabase.from('lots').update({ enrich_note: [...kept, ...r.notes].join('; ') || null }).eq('id', lot.id)
    await refreshBatchCopies(lot.id)
  }
  console.log(`\nunchanged with docket ${same}, still no docket ${still}, NEW docket ${gained}, changed docket ${changed}, docket removed ${lost}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

'use strict'

/**
 * recalc-duty.js — works the customs duty of the open cars out again with the vehicle type of their model (Saloon / Non-saloon, migration 54).
 * Free (no AI): it uses the docket already chosen for each car (lot_costs.docket_id), the first register year / month, and the newest exchange rate.
 * Run it after you changed a model's vehicle type, or after migration 54 for the first time. The daily job does not need it: new cars get the right type from the start.
 *
 *   node recalc-duty.js            show what would change (nothing written)
 *   node recalc-duty.js --write    save the new duty
 */

require('dotenv').config()
const supabase = require('./lib/db')
const { loadRef } = require('./lib/ref')
const WRITE = process.argv.includes('--write')

async function main() {
  const ref = await loadRef()
  const dockets = new Map(ref.dockets.map((d) => [d.id, d]))
  const lots = []
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from('lots').select('id,brand,model,mfg_year,mfg_month,first_reg_month,vehicle_type').gt('bid_deadline', new Date().toISOString()).order('id').range(from, from + 499)
    if (error) { console.log('lots: ' + error.message + (/vehicle_type/.test(error.message) ? '  (run supabase/migrations/54_vehicle_type.sql first)' : '')); process.exit(1) }
    lots.push(...data)
    if (data.length < 500) break
  }
  const costs = new Map()
  for (let i = 0; i < lots.length; i += 200) {
    const ids = lots.slice(i, i + 200).map((l) => l.id)
    const { data } = await supabase.from('lot_costs').select('*').in('lot_id', ids)
    for (const c of data || []) costs.set(c.lot_id, c)
  }
  let changed = 0, same = 0, skipped = 0
  const byModel = new Map()
  for (const l of lots) {
    const c = costs.get(l.id), docket = c && dockets.get(c.docket_id)
    if (!docket) { skipped++; continue }
    const { cost } = ref.duty.dutyCostRow({ docket, regYear: l.mfg_year, regMonth: l.mfg_month || l.first_reg_month, ref, vehicleType: l.vehicle_type })
    if (!cost || cost.duty_myr == null) { skipped++; continue }
    if (Math.abs(Number(c.duty_myr) - Number(cost.duty_myr)) < 0.5) { same++; continue }
    changed++
    const k = `${l.brand} ${l.model.split(/\s+/)[0]} (${l.vehicle_type === 'non_car' ? 'non-saloon' : 'saloon'})`
    byModel.set(k, (byModel.get(k) || 0) + 1)
    if (WRITE) { const { error } = await supabase.from('lot_costs').update({ ...cost, updated_at: new Date().toISOString() }).eq('lot_id', l.id); if (error) console.log(`  ! ${l.brand} ${l.model}: ${error.message}`) }
  }
  console.log(`${lots.length} open cars: ${changed} duty ${WRITE ? 'updated' : 'would change'}, ${same} already right, ${skipped} without docket / register date.`)
  for (const [k, n] of [...byModel].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`   ${String(n).padStart(4)}  ${k}`)
  if (!WRITE && changed) console.log('\nRun again with --write to save.')
}
main().catch((e) => { console.error('FAILED: ' + e.message); process.exit(1) })

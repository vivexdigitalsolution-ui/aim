'use strict'

/**
 * One batch per DAY (Japan date): all batches made today are combined into the newest one.
 * Every car of today's batches is looked at again: it must still be open for bidding, for an auction tomorrow or later,
 * and pass the hard rules. Per model at most 5 cars (top first), main models first in list order, then the backup models.
 * 50 is a MINIMUM, not a limit: every valid car is kept (the report has a tick box per car, so staff pick from the extras). Pass target to cap it.
 * Held-back cars (no history price and no duty) are kept as held back. The other batches of today are deleted.
 */

const path = require('path')
const { pathToFileURL } = require('url')
const supabase = require('./db')
const { firstAuctionDate, todayStart } = require('./cutoff')
const { isOthers, TOP_N, MID_N } = require('./pick')

const PER_MODEL = TOP_N + MID_N
const mkey = (r) => `${r.model_brand || r.brand_name}|${r.model_name}|${r.model_code || ''}`

async function mergeToday({ dry = false, target = Infinity, log = console.log } = {}) {
  const rules = await import(pathToFileURL(path.join(__dirname, '..', '..', '..', 'packages', 'core', 'src', 'recommendRules.ts')).href)
  const nb = await supabase.from('offer_batches').select('id,car_count,created_at').gte('created_at', todayStart()).order('created_at', { ascending: false })
  if (nb.error) throw new Error('offer_batches: ' + nb.error.message)
  if (!nb.data.length) { log('No batch was made today.'); return null }
  const [keep, ...others] = nb.data
  const models = await supabase.from('offer_models').select('brand_name,model_name,model_code,reserve,sort,created_at').order('sort').order('created_at')
  if (models.error) throw new Error('offer_models: ' + models.error.message)
  const order = new Map(), reserve = new Map()
  models.data.forEach((m, i) => { order.set(mkey(m), i); reserve.set(mkey(m), !!m.reserve) })

  // every car of today's batches, one row per car (a recommended row beats a held-back one, top beats mid)
  const best = new Map()
  for (const b of nb.data) {
    const r = await supabase.from('offer_batch_cars').select('*').eq('batch_id', b.id)
    if (r.error) throw new Error('offer_batch_cars: ' + r.error.message)
    for (const c of r.data) {
      const o = best.get(c.lot_id)
      const rank = (x) => (x.held_back ? 0 : x.tier === 'top' ? 2 : 1)
      if (!o || rank(c) > rank(o)) best.set(c.lot_id, c)
    }
  }
  const ok = []
  let dropped = 0
  for (const c of best.values()) {
    const { data: l } = await supabase.from('lots').select('*').eq('id', c.lot_id).maybeSingle()
    if (!l || !l.my_eligible || new Date(l.bid_deadline) <= new Date() || l.auction_date < firstAuctionDate()) { dropped++; continue }
    if (!c.held_back && (isOthers(l) || rules.recommendBlock(l))) { dropped++; continue }
    const { data: cost } = await supabase.from('lot_costs').select('*').eq('lot_id', l.id).maybeSingle()
    ok.push({ ...c, lot: l, cost: cost || null })
  }

  // choose: models in list order, main models before backups, at most 5 per model, up to the target
  const byModel = new Map()
  ok.filter((c) => !c.held_back).forEach((c) => { const k = mkey(c); if (!byModel.has(k)) byModel.set(k, []); byModel.get(k).push(c) })
  const keys = [...byModel.keys()].sort((a, b) => (reserve.get(a) ? 1 : 0) - (reserve.get(b) ? 1 : 0) || (order.get(a) ?? 999) - (order.get(b) ?? 999))
  const chosen = []
  for (const k of keys) {
    const cars = byModel.get(k).sort((a, b) => (a.tier === b.tier ? 0 : a.tier === 'top' ? -1 : 1)).slice(0, PER_MODEL)
    for (const c of cars) { if (chosen.length < target) chosen.push(c) }
  }
  const inChosen = new Set(chosen.map((c) => c.lot_id))
  const held = ok.filter((c) => c.held_back && !inChosen.has(c.lot_id))
  log(`Today's batches: ${nb.data.length}. Cars: ${best.size} (${dropped} no longer valid: ended, today's auction, or a rule). Combined batch: ${chosen.length} recommended + ${held.length} held back.`)
  const per = {}; chosen.forEach((c) => { const k = `${c.model_brand} ${c.model_name}`; per[k] = (per[k] || 0) + 1 })
  Object.entries(per).forEach(([k, n]) => log(`  ${k}: ${n}`))
  if (dry) { log('--dry: nothing changed.'); return { chosen, held } }

  const rows = [...chosen.map((c) => ({ ...c, held_back: false })), ...held].map((c) => ({
    batch_id: keep.id, lot_id: c.lot_id, tier: c.tier, model_brand: c.model_brand, model_name: c.model_name, model_code: c.model_code,
    docket_id: c.docket_id, lot: c.lot, cost: c.cost, held_back: !!c.held_back,
  }))
  const del = await supabase.from('offer_batch_cars').delete().eq('batch_id', keep.id)
  if (del.error) throw new Error('offer_batch_cars: ' + del.error.message)
  for (let i = 0; i < rows.length; i += 100) {
    const ins = await supabase.from('offer_batch_cars').insert(rows.slice(i, i + 100))
    if (ins.error) throw new Error('offer_batch_cars: ' + ins.error.message)
  }
  await supabase.from('offer_batches').update({ car_count: chosen.length }).eq('id', keep.id)
  if (others.length) {
    const d2 = await supabase.from('offer_batches').delete().in('id', others.map((b) => b.id))
    if (d2.error) throw new Error('offer_batches: ' + d2.error.message)
  }
  log(`One batch for today: ${chosen.length} cars (${others.length} other batch(es) of today merged in).`)
  return { chosen, held }
}

module.exports = { mergeToday }

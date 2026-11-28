'use strict'

/**
 * clean-features.js — removes car features that the auction sheet does not prove, and takes out the original / aftermarket labels (no AI call, free).
 * The sheet is the truth: a feature stays only when its evidence (the words printed on the sheet) shows it.
 * Example: "JBL audio" tagged because the sheet says "14インチ純正ディスプレイオーディオ" is removed.
 *
 *   node clean-features.js --dry      show what would be removed, change nothing
 *   node clean-features.js            remove them (bidding cars: lot_features; One price cars: the features list on the car)
 */

const supabase = require('./lib/db')
const { loadRef } = require('./lib/ref')

const DRY = process.argv.includes('--dry')

async function main() {
  const C = (await loadRef()).duty
  const catalog = new Map(C.CATALOG.map((d) => [d.key, d]))
  // keep when the printed words show it; rows found from the listing text ("text match") are real text, so they stay
  const supported = (f) => {
    const ev = String(f.evidence || '').normalize('NFKC').trim()
    if (ev === 'text match') return true
    const d = catalog.get(f.key)
    if (d) return d.re.test(ev)
    return !!ev && C.namesSamePart(f.label || '', ev)   // a free tag needs printed words that name the same part
  }
  /** what a kept feature should look like now; null = nothing to change */
  const renamed = (f) => {
    // the old "Aftermarket exhaust" feature is now part of "Sports exhaust"
    if (f.key === 'aftermarket_exhaust') return catalog.get('sport_exhaust').re.test(String(f.evidence || '').normalize('NFKC')) ? { key: 'sport_exhaust', label: catalog.get('sport_exhaust').label } : { remove: true }
    const d = catalog.get(f.key)
    const label = d ? d.label : C.plainText(f.label || '') || f.label
    return label !== f.label || (f.source && f.source !== 'unknown') ? { key: f.key, label } : null
  }
  const byKey = {}
  const count = (f) => { byKey[f.key] = (byKey[f.key] || 0) + 1 }

  // 1. bidding cars
  let bad = [], change = [], seen = 0
  const has = new Set()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('lot_features').select('lot_id,key,label,source,evidence').order('lot_id').order('key').range(from, from + 999)
    if (error) throw error
    if (!data.length) break
    seen += data.length
    for (const f of data) {
      has.add(f.lot_id + '|' + f.key)
      if (f.key !== 'aftermarket_exhaust' && !supported(f)) { bad.push(f); count(f); continue }
      const to = renamed(f)
      if (!to) continue
      if (to.remove) { bad.push(f); count(f) } else change.push({ f, to })
    }
    if (data.length < 1000) break
  }
  console.log(`Bidding cars: ${seen} feature rows checked, ${bad.length} not proven by the sheet, ${change.length} to relabel.`)
  if (!DRY) for (let i = 0; i < bad.length; i++) {
    const f = bad[i]
    const { error } = await supabase.from('lot_features').delete().eq('lot_id', f.lot_id).eq('key', f.key)
    if (error) { console.log('  could not remove: ' + error.message); break }
  }

  if (!DRY) for (const { f, to } of change) {
    // a car that already has the target feature keeps that one: the old row just goes
    const double = to.key !== f.key && has.has(f.lot_id + '|' + to.key)
    const q = supabase.from('lot_features')
    const { error } = await (double ? q.delete() : q.update({ key: to.key, label: to.label, source: 'unknown' })).eq('lot_id', f.lot_id).eq('key', f.key)
    if (error) { console.log('  could not relabel: ' + error.message); break }
    has.add(f.lot_id + '|' + to.key)
  }

  // 2. One price cars (the features sit on the car as a list)
  let opSeen = 0, opBad = 0, opCars = 0, opChanged = 0
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from('one_price_lots').select('id,features').not('features', 'is', null).range(from, from + 499)
    if (error) { console.log('One price cars: ' + error.message); break }
    if (!data.length) break
    for (const row of data) {
      const list = Array.isArray(row.features) ? row.features : []
      const out = new Map()
      let removed = 0, relabelled = 0
      for (const f of list) {
        const to = f.key === 'aftermarket_exhaust' || supported(f) ? renamed(f) : { remove: true }
        if (to?.remove) { removed++; count(f); continue }
        const next = to ? { ...f, key: to.key, label: to.label, source: 'unknown' } : f
        if (to) relabelled++
        if (!out.has(next.key)) out.set(next.key, next)
      }
      const keep = [...out.values()]
      opSeen += list.length
      if (!removed && !relabelled) continue
      opBad += removed; opChanged += relabelled; opCars++
      if (!DRY) { const up = await supabase.from('one_price_lots').update({ features: keep.length ? keep : null }).eq('id', row.id); if (up.error) { console.log('  could not update: ' + up.error.message); break } }
    }
    if (data.length < 500) break
  }
  console.log(`One price cars: ${opSeen} features checked, ${opBad} to remove and ${opChanged} to relabel, on ${opCars} car(s).`)

  // 3. the same words in the written notes of both kinds of car
  const TEXT = ['sales_points', 'pick_reason', 'inspector_report_en']
  for (const table of ['lots', 'one_price_lots']) {
    const fix = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(table).select('id,' + TEXT.join(',')).or(TEXT.map((k) => `${k}.ilike.%market%,${k}.ilike.%non%`).join(',')).order('id').range(from, from + 999)
      if (error) { console.log(table + ' notes: ' + error.message); break }
      for (const row of data) {
        const patch = {}
        for (const k of TEXT) if (row[k]) { const t = C.plainText(row[k]); if (t !== row[k].trim()) patch[k] = t }
        if (Object.keys(patch).length) fix.push({ id: row.id, patch })
      }
      if (data.length < 1000) break
    }
    console.log(`${table}: ${fix.length} car(s) with those words in their notes.`)
    if (!DRY) for (const f of fix) { const { error } = await supabase.from(table).update(f.patch).eq('id', f.id); if (error) { console.log('  could not update: ' + error.message); break } }
  }
  console.log('Most removed: ' + (Object.entries(byKey).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'))
  console.log(DRY ? 'Dry run: nothing changed. Run without --dry to apply.' : 'Done.')
}
main().catch((e) => { console.error(e.message); process.exit(1) })

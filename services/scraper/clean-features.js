'use strict'

/**
 * clean-features.js — removes car features that the auction sheet does not prove (no AI call, free).
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
    return !!ev                                      // a free tag needs its printed words
  }
  const byKey = {}
  const count = (f) => { byKey[f.key] = (byKey[f.key] || 0) + 1 }

  // 1. bidding cars
  let bad = [], seen = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('lot_features').select('lot_id,key,label,evidence').range(from, from + 999)
    if (error) throw error
    if (!data.length) break
    seen += data.length
    for (const f of data) if (!supported(f)) { bad.push(f); count(f) }
    if (data.length < 1000) break
  }
  console.log(`Bidding cars: ${seen} feature rows checked, ${bad.length} not proven by the sheet.`)
  if (!DRY) for (let i = 0; i < bad.length; i++) {
    const f = bad[i]
    const { error } = await supabase.from('lot_features').delete().eq('lot_id', f.lot_id).eq('key', f.key)
    if (error) { console.log('  could not remove: ' + error.message); break }
  }

  // 2. One price cars (the features sit on the car as a list)
  let opSeen = 0, opBad = 0, opCars = 0
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase.from('one_price_lots').select('id,features').not('features', 'is', null).range(from, from + 499)
    if (error) { console.log('One price cars: ' + error.message); break }
    if (!data.length) break
    for (const row of data) {
      const list = Array.isArray(row.features) ? row.features : []
      const keep = list.filter(supported)
      opSeen += list.length
      if (keep.length === list.length) continue
      list.filter((f) => !supported(f)).forEach(count)
      opBad += list.length - keep.length; opCars++
      if (!DRY) { const up = await supabase.from('one_price_lots').update({ features: keep.length ? keep : null }).eq('id', row.id); if (up.error) { console.log('  could not update: ' + up.error.message); break } }
    }
    if (data.length < 500) break
  }
  console.log(`One price cars: ${opSeen} features checked, ${opBad} removed from ${opCars} car(s).`)
  console.log('Most removed: ' + (Object.entries(byKey).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'))
  console.log(DRY ? 'Dry run: nothing changed. Run without --dry to remove them.' : 'Done.')
}
main().catch((e) => { console.error(e.message); process.exit(1) })

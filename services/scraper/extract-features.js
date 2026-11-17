'use strict'

/**
 * extract-features.js — fills lot_features (the searchable car features) for lots that were already read, WITHOUT reading the sheet picture again.
 *
 *   node extract-features.js --free               free: the catalog matcher on the lot's own text (selling points, equipment, notes, inspector note)
 *   node extract-features.js --ai --n 200         Claude lists the features from those same texts (cheap: text only, no picture)
 *   node extract-features.js --free --all-open    every open lot (default: the next 500 without features)
 *   node extract-features.js --dry                show counts and examples, write nothing
 *
 * The most accurate source is the sheet picture itself: node enrich.js --force reads it again and saves features too (one call per lot).
 */

const supabase = require('./lib/db')
const claude = require('./lib/claude')
const { loadRef } = require('./lib/ref')
const { saveFeatures } = require('./lib/lotdecision')

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const has = (n) => process.argv.includes(n)
const N = has('--all-open') ? 100000 : parseInt(arg('--n') || '500', 10)
const DRY = has('--dry'), AI = has('--ai')
const FIELDS = ['sales_points', 'equipment', 'notes', 'notes_en', 'inspector_report', 'inspector_report_en']

async function main() {
  if (!AI && !has('--free')) { console.log('Choose --free (no AI) or --ai.'); process.exit(1) }
  if (AI && !claude.isReady()) { console.log('ANTHROPIC_API_KEY is empty in .env.'); process.exit(1) }
  const C = (await loadRef()).duty
  const lots = []
  for (let from = 0; lots.length < N * 3 && lots.length < 100000; from += 1000) {
    const { data, error } = await supabase.from('lots').select('*').eq('my_eligible', true).not('enriched_at', 'is', null).gt('bid_deadline', new Date().toISOString()).order('bid_deadline').range(from, from + 999)
    if (error) throw error
    lots.push(...data)
    if (data.length < 1000) break
  }
  const have = new Set()
  for (let i = 0; i < lots.length; i += 200) {
    const { data } = await supabase.from('lot_features').select('lot_id').in('lot_id', lots.slice(i, i + 200).map((l) => l.id))
    ;(data || []).forEach((r) => have.add(r.lot_id))
  }
  const todo = lots.filter((l) => !have.has(l.id)).slice(0, N)
  console.log(`${todo.length} open lots without features${DRY ? ' (dry run)' : ''}, mode: ${AI ? 'AI (text only)' : 'free matcher'}`)

  const tally = new Map()
  let withAny = 0, next = 0, failed = 0
  const worker = async () => {
    while (next < todo.length) {
      const lot = todo[next++]
      const text = FIELDS.map((f) => lot[f]).filter(Boolean).join('\n')
      try {
        let features
        if (AI) {
          const r = await claude.ask({ system: C.FEATURE_SYSTEM, content: `Car: ${lot.brand} ${lot.model} ${lot.grade || ''}\n\n${text.slice(0, 2500)}`, schema: C.FEATURE_SCHEMA, maxTokens: 1500 })
          features = C.normalizeFeatures(r.data.features || [])
        } else features = C.textFeatures(text).map((k) => ({ key: k, label: C.featureLabel(k), group: C.CATALOG.find((c) => c.key === k)?.group || 'Other', source: 'unknown', evidence: 'text match' }))
        if (features.length) withAny++
        features.forEach((f) => tally.set(f.label, (tally.get(f.label) || 0) + 1))
        if (!DRY) { const e = await saveFeatures(supabase, lot.id, features); if (e) { failed++; console.log(`   ${lot.lot_no}: not saved: ${e}`) } }
      } catch (e) { failed++; console.log(`   ${lot.brand} ${lot.model} ${lot.lot_no}: FAILED ${e.message}`); if (/token cap|not set up/.test(e.message)) next = todo.length }
    }
  }
  await Promise.all([0, 1, 2, 3].map(worker))
  console.log(`\n${withAny} of ${todo.length} lots have at least one feature. Failed: ${failed}`)
  console.log('Most common features:')
  ;[...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(`  ${String(v).padStart(5)}  ${k}`))
  if (AI) console.log('\n' + claude.summary())
}

main().catch((e) => { console.error(e); process.exit(1) })

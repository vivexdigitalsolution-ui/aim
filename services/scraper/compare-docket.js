'use strict'

/**
 * compare-docket.js — the docket accuracy test. READ-ONLY: it changes nothing in the database.
 * For the last N read cars it runs (1) the free rule pick (duty.ts guessDocket) and (2) the AI pick (Claude chooses from the same
 * narrowed list), then reports how often they agree and lists every case where they do not, so a person checks only those.
 *
 *   node compare-docket.js              last 200 read cars
 *   node compare-docket.js --n 50       a smaller test
 *   node compare-docket.js --model "VELLFIRE"   only cars whose model name contains this text
 *
 * Writes the full list to docket-compare.txt (next to this file). Spends real AI tokens: about 1,000 input + 60 output per car.
 */

const fs = require('fs')
const path = require('path')
const supabase = require('./lib/db')
const { loadRef } = require('./lib/ref')
const { ask, summary, totals } = require('./lib/claude')
const { aiPickDocket } = require('./lib/docketai')

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const N = parseInt(arg('--n') || '200', 10)
const MODEL = arg('--model')

async function main() {
  const ref = await loadRef()
  const D = ref.duty
  console.log(`Reference: ${ref.dockets.length} dockets`)
  let q = supabase.from('lots').select('*').not('enriched_at', 'is', null).not('model_code', 'is', null).order('enriched_at', { ascending: false }).limit(N)
  if (MODEL) q = q.ilike('model', '%' + MODEL + '%')
  const { data: lots, error } = await q
  if (error) throw error
  console.log(`${lots.length} read cars (newest first). Running the rule and the AI on each...\n`)

  const rows = []
  let next = 0
  const worker = async () => {
    while (next < lots.length) {
      const lot = lots[next++]
      const car = { brand: lot.brand, model: lot.model, model_code: lot.model_code, engine_cc: lot.engine_cc, transmission: lot.transmission, seats: lot.seats, family: ref.families?.get(lot.maker_code + '|' + lot.car_code) || null, sheet_text: [lot.sales_points, lot.notes, lot.notes_en, lot.inspector_report, lot.inspector_report_en, lot.equipment].filter(Boolean).join(' ') }
      const rule = D.guessDocket(ref.dockets, car)
      const { pool } = D.docketPool(ref.dockets, car)
      let ai = null, err = null
      try { ai = await aiPickDocket({ lot, pool, ask }) } catch (e) { err = e.message }
      rows.push({ lot, rule, pool, ai, err })
    }
  }
  await Promise.all([0, 1, 2, 3].map(worker))

  const kind = (r) => {
    if (r.err) return 'ERROR'
    const a = r.rule.docket, b = r.ai.docket
    if (!a && !b) return 'BOTH NONE'
    if (a && b && a.id === b.id) return r.ai.confidence === 'high' ? 'AGREE' : 'AGREE (AI not sure)'
    if (a && !b) return 'RULE ONLY (AI says none)'
    if (!a && b) return 'AI ONLY (rule says none)'
    return 'DIFFERENT'
  }
  const count = {}
  rows.forEach((r) => { const k = kind(r); count[k] = (count[k] || 0) + 1 })

  const lines = []
  const show = (r) => {
    const l = r.lot
    lines.push(`[${kind(r)}] ${l.brand} | ${l.model} | ${l.model_code} | ${l.engine_cc || '?'}cc | ${l.transmission || '?'} | seats ${l.seats || '?'} | lot ${l.lot_no}`)
    lines.push(`   RULE: ${r.rule.docket ? r.rule.docket.model : 'none — ' + r.rule.reason}`)
    lines.push(`   AI  : ${r.err ? 'ERROR ' + r.err : (r.ai.docket ? r.ai.docket.model : 'none') + `  [${r.ai.confidence}] "${r.ai.words}" — ${r.ai.reason}`}`)
    lines.push(`   pool: ${r.pool.length} docket(s)`)
    lines.push('')
  }
  const order = ['DIFFERENT', 'RULE ONLY (AI says none)', 'AI ONLY (rule says none)', 'AGREE (AI not sure)', 'ERROR', 'AGREE', 'BOTH NONE']
  order.forEach((k) => rows.filter((r) => kind(r) === k).forEach(show))
  const file = path.join(__dirname, 'docket-compare.txt')
  fs.writeFileSync(file, lines.join('\n'))

  console.log('RESULT (' + rows.length + ' cars)')
  order.forEach((k) => { if (count[k]) console.log(`  ${String(count[k]).padStart(4)}  ${k}`) })
  const review = rows.filter((r) => !['AGREE', 'BOTH NONE'].includes(kind(r))).length
  console.log(`\nA person would check ${review} of ${rows.length} cars (${Math.round(100 * review / rows.length)}%).`)
  console.log('\nThe cases to look at first:')
  rows.filter((r) => ['DIFFERENT', 'RULE ONLY (AI says none)', 'AI ONLY (rule says none)'].includes(kind(r))).slice(0, 25).forEach((r) => {
    const l = r.lot
    console.log(`- [${kind(r)}] ${l.brand} ${l.model} (${l.model_code}, ${l.engine_cc}cc, seats ${l.seats || '?'})\n    rule: ${r.rule.docket ? r.rule.docket.model : 'none'}\n    ai  : ${r.ai?.docket ? r.ai.docket.model : 'none'}  [${r.ai?.confidence}] ${r.ai?.reason || r.err || ''}`)
  })
  console.log('\n' + summary())
  console.log('Full list: ' + file)
}

main().catch((e) => { console.error(e); process.exit(1) })

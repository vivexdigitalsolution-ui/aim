'use strict'

// Offline check of lib/enrich.js with a fake Claude (no key, no network):   node test-enrich.js
const path = require('path')
const { pathToFileURL } = require('url')
const { enrichLot } = require('./lib/enrich')

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

;(async () => {
  const duty = await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'duty.ts')).href)
  const mk = (id, model, cc, amt) => ({ id, brand: 'TOYOTA', model, cc, currency_code: 'JPY', year: 2026, amt_12m_24m: amt, amt_24m_36m: amt * 0.9, amt_36m_48m: amt * 0.8, amt_48m_60m: amt * 0.7, amt_60m_plus: amt * 0.6 })
  const ref = {
    duty, rates: [{ vehicle_type: 'car', cc_min: 2001, cc_max: 2500, multiplier: 1.717 }, { vehicle_type: 'car', cc_min: null, cc_max: 2001, multiplier: 1.574 }],
    currencies: [{ code: 'JPY', rate_unit: 100, standard_fare_myr: 1200 }], fx: { JPY: { rate: 0.0272 } }, docketMap: new Map(),
    dockets: [mk('alp', 'ALPHARD (3BA-AGH40W)', 2493, 5000000), mk('alpz', 'ALPHARD Z (3BA-AGH40W)', 2493, 9000000), mk('vel', 'VELLFIRE (3BA-AGH30W)', 2493, 5100000)],
  }
  const calls = []
  const reply = (schemaName, data) => ({ data, usage: {}, schemaName })
  const ask = async ({ system, schema, content }) => {
    calls.push(system.slice(0, 20))
    if (schema.required.includes('doubts')) return reply('read', { model_code: '3BA-AGH40W', first_reg_year: 2025, first_reg_month: 7, inspection_until: '2027-06', doors: 5, seats: 7, drive: '2WD', highlight_score: 8, highlight_reason: 'Low mileage, one owner', accident: false, inspector_note_en: 'Small scratch on rear bumper', selling_points: 'Grade 4.5\nLow mileage', doubts: [] })
    const line = String(content).split('\n').find((l) => /^\d+\. ALPHARD \(3BA/.test(l))   // the plain Alphard line, wherever it sits in the list
    return reply('pick', { choice: parseInt(line, 10), confidence: 0.9, reason: 'plain Alphard, no Z' })
  }
  const imageBlock = (u) => ({ type: 'image', source: { type: 'url', url: u } })
  const lot = { id: 'L1', brand: 'TOYOTA', model: 'ALPHARD', model_code: null, engine_cc: 2493, mfg_year: 2025, mfg_month: null, sheet_url: 'https://x/sheet.jpg', photos: ['https://x/1.jpg'], grade: '4.5', mileage_km: 12000 }
  const today = new Date(2026, 10, 5)

  const r = await enrichLot({ lot, ref, ask, imageBlock, today })
  ok(r.patch.first_reg_month === 7 && r.patch.mfg_month === 7 && r.patch.doors === 5 && r.patch.seats === 7 && r.patch.inspection_until === '2027-06', 'register month, doors, seats, inspection date are filled from the sheet')
  ok(r.patch.model_code === '3BA-AGH40W' && r.patch.drive === '2WD', 'missing model code and drive are filled')
  ok(r.patch.pick_score === 8 && r.patch.accident === false && !('notes_en' in r.patch) && r.patch.sales_points.includes('Low mileage') && r.patch.inspector_report_en, 'inspection note, selling points, highlight score and accident flag are filled; no seller note')
  ok(r.docketSource === 'code' && r.cost.docket_id === 'alp', 'code + engine + name match: the plain Alphard docket, not the Z one (' + r.docketSource + ')')
  ok(calls.length === 1, 'only one AI call (reading the sheet): the docket step uses no AI')
  ok(r.cost.duty_myr > 0 && r.cost.matang_from === '2027-08-01', 'duty worked out, matang from 2027-08 (duty RM ' + r.cost.duty_myr + ')')
  ok(r.cost.duty_after_matang_myr < r.cost.duty_myr, 'duty after matang is lower')
  ok(r.mapEntry === null, 'nothing is remembered per model any more (the trim differs car to car)')

  // the strict rule: same chassis code but a trim name no docket has -> NO docket, no duty, no estimate
  const noTrim = await enrichLot({ lot: { ...lot, id: 'L3', model: 'ALPHARD FINAL EDITION' }, ref, ask, imageBlock, today })
  ok(!noTrim.cost && noTrim.docketSource === null && noTrim.notes.some((n) => /no docket: code matches but the trim name does not/.test(n)), 'code matches but the trim does not: no docket, no duty (' + (noTrim.notes.find((n) => /no docket/.test(n)) || '') + ')')

  const noSheet = await enrichLot({ lot: { ...lot, sheet_url: null }, ref, ask, imageBlock, today })
  ok(noSheet.notes.includes('no auction sheet picture'), 'a lot with no sheet picture is flagged')

  // a docket chosen by staff is used as it is, even where the strict rule would find none
  const chosen = await enrichLot({ lot: { ...lot, id: 'L4', model: 'ALPHARD FINAL EDITION' }, ref, ask, imageBlock, today, forceDocket: ref.dockets[0] })
  ok(chosen.docketSource === 'chosen' && chosen.cost?.docket_id === 'alp' && chosen.cost.duty_myr > 0, 'chosen docket is used without the matching rule')

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.log(e); process.exit(1) })

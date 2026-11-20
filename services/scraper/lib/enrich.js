'use strict'

/**
 * lib/enrich.js — fills in what the listing page does not give, for ONE lot, using only that lot's own data:
 *   1. Claude reads the auction sheet picture (+ the scraped text) -> chassis code, first register month, inspection date,
 *      doors, seats, drive, English inspection note, a short selling-points text, and a 0-10 "how much to sell" score + accident flag.
 *   2. Finds the Customs docket with the STRICT free rule (duty.ts guessDocket): chassis code + engine + trim name must all match.
 *      Otherwise "no docket" and no duty. No estimate from a near docket, no AI pick, no remembered guess.
 *   3. Works the duty out (now, and once the car has aged into the next band). Plain maths, no AI.
 * Pure function: no database, the caller passes the reference data and the `ask` function (so it is testable offline).
 */

const nullable = (type, extra = {}) => ({ anyOf: [{ type }, { type: 'null' }], ...extra })

const READ_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['model_code', 'fuel', 'steering', 'chassis_no', 'first_reg_year', 'first_reg_month', 'inspection_until', 'doors', 'seats', 'drive', 'inspector_note_en', 'selling_points', 'highlight_score', 'highlight_reason', 'accident', 'doubts', 'handwriting', 'uncertain'],
  properties: {
    model_code: nullable('string', { description: 'full model / chassis code printed on the sheet, e.g. 3BA-AGH40W' }),
    fuel: { anyOf: [{ type: 'string', enum: ['Petrol', 'Diesel', 'Hybrid', 'Plug-in hybrid', 'Electric'] }, { type: 'null' }], description: 'fuel type: the 燃料 box on the sheet (ガソリン = Petrol, 軽油 = Diesel) and the model name (HYBRID, e:HEV, PHEV, EV); a hybrid is shown as ガソリン on the sheet, so use the name; null when not clear' },
    steering: { anyOf: [{ type: 'string', enum: ['LHD', 'RHD'] }, { type: 'null' }], description: 'steering side: LHD when the sheet or the name shows a left-hand-drive car (左ハンドル, 左H, LHD, a left-hand mark in the steering box), RHD when it shows right-hand drive (右ハンドル); null when not shown' },
    chassis_no: nullable('string', { description: 'the chassis / body number in the 車台No. box, e.g. ZWR90-0030775 (series code, hyphen, serial number); null when the box is empty or unreadable' }),
    first_reg_year: nullable('integer', { description: 'year of first registration (初度登録), Gregorian' }),
    first_reg_month: nullable('integer', { description: 'month of first registration, 1-12' }),
    inspection_until: nullable('string', { description: 'vehicle inspection (車検) expiry as YYYY-MM, or null when none / not shown' }),
    doors: nullable('integer'),
    seats: nullable('integer'),
    drive: { anyOf: [{ type: 'string', enum: ['2WD', '4WD'] }, { type: 'null' }] },
    inspector_note_en: nullable('string', { description: 'the inspection note: scratches, dents, repairs, interior condition from the sheet, translated to English, short; null when none' }),
    selling_points: nullable('string', { description: 'at most 3 short lines (separated by newline) a Malaysian buyer cares about: modified / custom parts, high spec equipment, low mileage for the year, one owner, no accident ...; only facts from the sheet or the listing' }),
    highlight_score: { type: 'integer', description: '0-10: how much there is to sell. 0 = plain car; 5 = clean with some good equipment; 8-10 = modified or very high spec, low mileage for its age, no accident, clean body' },
    highlight_reason: nullable('string', { description: 'one short line (max 12 words) why this score' }),
    accident: { anyOf: [{ type: 'boolean' }, { type: 'null' }], description: 'true when the sheet shows repair history / accident (修復歴, R, RA) or heavy body damage; false when clearly none; null when unreadable' },
    doubts: { type: 'array', items: { type: 'string' }, description: 'anything unreadable or that disagrees with the listing' },
    handwriting: { type: 'boolean', description: 'true when any value that matters (first registration date, chassis number, mileage, model code, grade, accident / repair mark, the inspector note) is HANDWRITTEN on the sheet or in a handwritten correction; false when the sheet is printed' },
    uncertain: { type: 'array', items: { type: 'string' }, description: 'the fields you are NOT confident about, each as "field: why", e.g. "first registration: handwritten, 4 or 9?", "chassis number: smudged". Empty when you are confident in everything you filled in' },
  },
}

const FEATURE_RULE = `
- features: list every notable feature, option, package or modification shown on the sheet or in the text (audio brand such as JBL, sunroof, leather, a body kit such as GR or Modellista, 4WD, safety packages, aftermarket parts). Only what is shown, never what the model usually has. source: aftermarket for non-maker parts (社外), factory for standard or maker options, dealer_option for dealer-fit items, unknown when the sheet does not say. evidence = the exact words printed.`

const READ_SYSTEM = `You read one used Japanese auction car for a Malaysian importer. You get the auction sheet image(s) and the scraped listing text.
Rules:
- Only give a value you can read on the sheet or that is certain; otherwise null. Never guess a chassis code or a date.
- model_code is the full code with its prefix (3BA-AGH40W), not the chassis number.
- fuel: Petrol, Diesel, Hybrid (also e:HEV and mild hybrid), Plug-in hybrid or Electric. The 燃料 box says ガソリン (petrol) or 軽油 (diesel); a hybrid is printed as ガソリン, so a HYBRID / e:HEV / HEV word in the model name or on the sheet means Hybrid. null when not clear.
- steering: LHD only when the sheet or the model name clearly shows left-hand drive (左ハンドル, 左H, LHD); RHD when it clearly shows right-hand drive; otherwise null. Do not guess from the brand.
- chassis_no is the number printed in the 車台No. box (bottom right, above シリアルNo.), for example ZWR90-0030775 or AAHH45-0069995. Copy it exactly, letters and digits as printed; do not confuse it with the model code in the 型式 box, and null when the box is empty.
- First registration is the month and year of first registration on the sheet (the Japanese era year must be converted: Reiwa 4 = 2022, Reiwa 5 = 2023, Heisei 30 = 2018).
- drive: 4WD when the sheet or model shows 4WD / AWD, otherwise 2WD; null when unknown.
- Write English only. Keep the notes short and factual; do not add opinions. Do not mention any company, auction house or website name.
- selling_points: facts only, max 3 lines. Lead with what makes the car easy to sell: modified or custom parts, high spec, low mileage for its age, no accident, only light scratches.
- highlight_score is your honest 0-10 rating of that (a plain car is 0-3). accident is true only for repair history or heavy damage.
- doubts: short notes for staff (unreadable sheet, value that disagrees with the listing). Empty array when clear.
- handwriting: true when something that matters is handwritten (a handwritten first-registration date, chassis number, mileage, grade, repair mark or note). Handwriting is the main reason a value is wrong, so be strict.
- uncertain: list every value you filled in but are not sure of (handwritten, smudged, tiny, cut off, or two readings possible) as "field: why". If you are only guessing, leave the value null instead and say why in doubts. Empty array when you are sure of everything.` + FEATURE_RULE

function lotText(lot) {
  const bits = [
    `Brand: ${lot.brand}`, `Model: ${lot.model}`, lot.model_code && `Model code (listing): ${lot.model_code}`, lot.grade && `Grade: ${lot.grade}${lot.interior_grade ? ' / interior ' + lot.interior_grade : ''}`,
    lot.mfg_year && `Year (listing): ${lot.mfg_year}${lot.mfg_month ? '/' + lot.mfg_month : ''}`, lot.mileage_km != null && `Mileage: ${lot.mileage_km} km`, lot.engine_cc && `Engine: ${lot.engine_cc} cc`,
    lot.transmission && `Transmission: ${lot.transmission}`, lot.drive && `Drive (listing): ${lot.drive}`, lot.fuel && `Fuel: ${lot.fuel}`,
    lot.equipment && `Equipment (listing): ${lot.equipment}`, lot.notes && `Seller notes (listing): ${lot.notes}`, lot.inspector_report && `Inspector (listing): ${lot.inspector_report}`,
  ]
  return bits.filter(Boolean).join('\n')
}

/**
 * The docket + duty step, on its own (no AI): used by enrichLot and by reprice.js.
 * Strict rule: chassis code + engine + trim name must all match one docket (JPY dockets only); otherwise "no docket" (no estimate, no AI pick).
 * A docket chosen by staff for this model (forceDocket) is used as it is.
 * @returns {{ cost: object|null, notes: string[], docketSource: string|null, docket: object|null }}
 */
function priceLot({ lot, code, regYear, regMonth, ref, today = new Date(), forceDocket = null, decision = null }) {
  const D = ref.duty
  const notes = []
  // v2: a decision (core decideDocket) already chose: only confirmed / trusted carry a docket; review / none carry none
  const g = decision ? { docket: decision.docket, reason: decision.reason } : forceDocket ? { docket: forceDocket } : D.guessDocket(ref.dockets, { brand: lot.brand, model: lot.model, model_code: code, engine_cc: lot.engine_cc, transmission: lot.transmission, seats: lot.seats, family: ref.families?.get(lot.maker_code + '|' + lot.car_code) || null, sheet_text: [lot.sales_points, lot.notes, lot.notes_en, lot.inspector_report, lot.inspector_report_en, lot.equipment].filter(Boolean).join(' ') })
  const docket = g.docket
  const source = docket ? (decision ? decision.status : forceDocket ? 'chosen' : 'code') : null
  if (!docket) notes.push(decision?.status === 'review' ? `docket check needed: ${g.reason}` : `no docket: ${g.reason}`)
  let cost = null
  // month not readable: when every month of the year gives the same docket column the duty is still exact (see dutyMonth)
  const month = docket ? D.dutyMonth(regYear, regMonth, today) : regMonth
  if (docket && regYear && month) {
    const cur = docket.currency_code
    const rate = ref.fx?.[cur]?.rate
    const info = (ref.currencies || []).find((c) => c.code === cur)
    if (!(rate > 0)) notes.push(`no exchange rate for ${cur}`)
    else {
      const input = { docket, mfgYear: regYear, mfgMonth: month, rate, rates: ref.rates, standardFare: info?.standard_fare_myr ?? undefined, vehicleType: 'car', today }
      const now = D.calcDuty(input)
      const from = D.matangFrom(regYear, month, today)
      const later = D.calcDutyAt(input, from)
      cost = {
        docket_id: docket.id, age_months: now.ageMonths, duty_myr: now.dutyMyr,
        duty_after_matang_myr: !regMonth ? null : later.dutyMyr != null && later.band !== now.band ? later.dutyMyr : null,
        matang_from: `${from.year}-${String(from.month).padStart(2, '0')}-01`,
      }
      if (!regMonth) notes.push('first register month not readable: every month of ' + regYear + ' gives the same docket column, so the duty is exact')
      if (now.under12) notes.push('car is under 12 months old: 12-24 month docket figure used')
      now.warnings.forEach((w) => notes.push(w))
    }
  } else if (docket) notes.push('first register year / month not found: duty not calculated')
  return { cost, notes, docketSource: source, docket }
}

/**
 * @param {object} p
 * @param {object} p.lot            a row of public.lots
 * @param {object} p.ref            { duty (the duty.ts module), dockets, rates, currencies, fx: {JPY:{rate}} }
 * @param {object|null} p.forceDocket  a docket row chosen by staff (skips the matching rule)
 * @param {Function} p.ask          lib/claude.ask (or a fake)
 * @param {Function} p.imageBlock   lib/claude.imageBlock
 * @returns {{ patch: object, cost: object|null, mapEntry: object|null, notes: string[] }}
 */
async function enrichLot({ lot, ref, ask, imageBlock, today = new Date(), forceDocket = null }) {
  const D = ref.duty
  const notes = []
  const patch = {}

  // ── 1. read the sheet ──
  const photos = Array.isArray(lot.photos) ? lot.photos : []
  const content = []
  if (lot.sheet_url) content.push(imageBlock(lot.sheet_url))
  photos.slice(0, 1).forEach((u) => content.push(imageBlock(u)))
  content.push({ type: 'text', text: lotText(lot) })
  // v2: the sheet read also lists the car's features (core FEATURE_SCHEMA), so every feature is searchable
  const schema = D.FEATURE_SCHEMA ? { ...READ_SCHEMA, required: [...READ_SCHEMA.required, 'features'], properties: { ...READ_SCHEMA.properties, features: D.FEATURE_SCHEMA.properties.features } } : READ_SCHEMA
  const read = (await ask({ system: READ_SYSTEM, content, schema, maxTokens: 2500 })).data
  if (!lot.sheet_url) notes.push('no auction sheet picture')
  ;(read.doubts || []).forEach((d) => notes.push(d))

  // the listing often has the code without its prefix (ZWR90W); the sheet has the full one (6AA-ZWR90W): keep the full one
  const have = String(lot.model_code || '').toUpperCase(), sheet = String(read.model_code || '').trim().toUpperCase()
  if (sheet && (!have || (sheet.length > have.length && sheet.endsWith(have.replace(/^[0-9A-Z]{2,4}-/, ''))))) patch.model_code = sheet
  const code = patch.model_code || lot.model_code || null
  if (!lot.chassis_no && read.chassis_no) patch.chassis_no = String(read.chassis_no).trim().toUpperCase()
  const regYear = lot.mfg_year || read.first_reg_year || null
  const regMonth = lot.mfg_month || read.first_reg_month || null
  if (read.first_reg_month) patch.first_reg_month = read.first_reg_month
  if (!lot.mfg_month && read.first_reg_month) patch.mfg_month = read.first_reg_month
  if (!lot.mfg_year && read.first_reg_year) patch.mfg_year = read.first_reg_year
  if (read.inspection_until) patch.inspection_until = read.inspection_until
  if (read.doors) patch.doors = read.doors
  if (read.seats) patch.seats = read.seats
  if (!lot.drive && read.drive) patch.drive = read.drive
  if (!lot.fuel && read.fuel) patch.fuel = read.fuel
  if (ref.hasSteering && read.steering) patch.steering = read.steering      // the column comes with migration 17: before it exists nothing is written
  if (read.selling_points) patch.sales_points = read.selling_points
  if (Number.isInteger(read.highlight_score)) patch.pick_score = Math.max(0, Math.min(10, read.highlight_score))
  if (read.highlight_reason) patch.pick_reason = String(read.highlight_reason).slice(0, 200)
  if (typeof read.accident === 'boolean') patch.accident = read.accident
  if (read.inspector_note_en) patch.inspector_report_en = read.inspector_note_en

  // a car whose sheet is handwritten, or whose key values Claude is not sure of, is flagged: the car page warns buyers and staff to check the sheet
  const keyField = /first reg|registration|chassis|model code|mileage|accident|repair|grade|year/i
  const unsure = (read.uncertain || []).map((u) => String(u).trim()).filter(Boolean)
  const reasons = []
  if (read.handwriting) reasons.push('handwritten on the sheet')
  unsure.filter((u) => keyField.test(u)).forEach((u) => reasons.push(u))
  if (!lot.sheet_url) reasons.push('no auction sheet picture: read from the photo and listing only')
  patch.needs_review = reasons.length > 0
  patch.review_note = reasons.length ? ([...new Set(reasons)].join('; ')).slice(0, 300) : null

  // ── 2 + 3. docket and duty ──
  const lotNow = { ...lot, seats: patch.seats ?? lot.seats }
  // v2: the rule and Claude both pick and are compared (lib/lotdecision.js); a staff-chosen docket (forceDocket) still wins
  let decided = null, decision = null
  if (!forceDocket && D.decideDocket) {
    decided = await require('./lotdecision').decideLot({ lot: lotNow, code, ref, ask })
    decision = decided.decision
  }
  const priced = priceLot({ lot: lotNow, code, regYear, regMonth, ref, today, forceDocket, decision })
  notes.push(...priced.notes)
  const cost = priced.cost, mapEntry = null, source = priced.docketSource

  // features: Claude's list, plus what the free text matcher finds in the lot's own text that Claude did not list
  let features = []
  if (D.normalizeFeatures) {
    features = D.normalizeFeatures(read.features || [])
    const have = new Set(features.map((f) => f.key))
    D.textFeatures(lot.sales_points, lot.equipment, lot.notes, lot.inspector_report, patch.sales_points, patch.inspector_report_en)
      .filter((k) => !have.has(k)).forEach((k) => features.push({ key: k, label: D.featureLabel(k), group: D.CATALOG.find((c) => c.key === k)?.group || 'Other', source: 'unknown', evidence: 'text match' }))
  }

  return { patch, cost, mapEntry, notes, docketSource: source, decided, features }
}

module.exports = { enrichLot, priceLot, READ_SCHEMA }

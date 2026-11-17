'use strict'

/**
 * offer.js — prepares the offer report (the models are chosen in the app: Admin › Offer report › Models).
 *
 *   node offer.js                  1. scrape every venue for the offer models (bid cars + sold history)
 *                                  2. Claude reads the auction sheets of a short list per model
 *                                  3. picks 2 nearly-perfect + 3 mid-tier cars per model, saved as one BATCH (offer_batches).
 *                                     A batch is kept 10 days; a car of a kept batch is never recommended again.
 *   node offer.js --skip-scrape    only steps 2–3 (cars are already scraped)
 *   node offer.js --skip-history   scrape the bid cars but not the history
 *   node offer.js --new            only the models that are not in the newest batch yet (e.g. after you changed 2 of the models);
 *                                  nothing is scraped or read for the others, and the new cars are added to that batch
 *   node offer.js --refill         no scrape: fills the NEWEST batch up again to 2 top + 3 mid per model, replacing cars that have
 *                                  neither a history price nor a duty (they are hidden in the report; see the rule below)
 *   node offer.js --force          read the sheets again even for cars already read
 *   node offer.js --include-blank  also pick cars that have neither a history price nor a duty (normally they are not recommended)
 *   node offer.js --skip-reprice   do not work the dockets / duties out again before picking (reprice.js, free, takes seconds)
 *   node offer.js --dry            show the short list per model, no AI, nothing saved
 *   node offer.js --include-today  also use today's auctions (normally only tomorrow's and later are scraped / recommended: a scrape takes
 *                                  hours and today's cars may be over before the customer sees them; --refill also takes them out of the batch)
 *
 * Hard rules (app/utils/recommendRules.ts): a car is never recommended, and another one takes its place, when its mileage is over 10,000 km a year,
 * its auction sheet could not be read (reading failed, or no field on a handwritten sheet could be filled), it is under 9 months old (or its first
 * registration month is unreadable on a car that may be), or its grade name is OTHERS.
 * Rule: a car with NO history price AND NO duty is not recommended; a replacement is picked instead (more cars are read until the
 * 2 top + 3 mid are full). With only one of the two a car is fine. The cars left out are kept in the batch as "held back"
 * and the report shows them only when its switch is on.
 *
 * Target 50 cars: models marked "backup" in the app are only used, after the main models and in list order, while the batch is below the
 * target (a backup is scraped only then). Each model still gives at most 5 cars (2 top + 3 mid).
 *
 * Needs ANTHROPIC_API_KEY in scraper/.env for step 2. Step 1 opens the browser like `node scrape.js bid`.
 * Cost: at most about 16 sheet readings per model (6 top + 10 mid candidates), cars already read are not read again.
 */

const { spawnSync } = require('child_process')      // reprice.js
const path = require('path')
const supabase = require('./lib/db')
const claude = require('./lib/claude')
const { enrichLot } = require('./lib/enrich')
const { loadRef } = require('./lib/ref')
const { shortlist, finalize, sameCode, isOthers, TOP_N, MID_N } = require('./lib/pick')
const { pathToFileURL } = require('url')
const { ensureTargets, runScrape: scrapeModels } = require('./lib/targets')
const { firstAuctionDate, todayStart } = require('./lib/cutoff')
const { mergeToday } = require('./lib/mergeToday')

const runScrape = (mode, models) => {
  try { scrapeModels(mode, models, { hint: 'Fix it and run again with --skip-scrape if the cars are already saved.' }) }
  catch (e) {
    if (mode !== 'history') throw e      // no cars = nothing to pick: stop
    // the sold history only feeds the body price: the cars are saved, so carry on with the history already in the database
    console.log(`\n[WARNING] ${e.message}\n[WARNING] The sold-history scrape failed: continuing with the history already saved (run "node scrape.js history" later to refresh it).`)
  }
}

const KEEP_DAYS = 10      // how long a recommended batch is kept (and its cars are not recommended again)
const has = (f) => process.argv.includes(f)
const DRY = has('--dry'), FORCE = has('--force'), NEW = has('--new'), REFILL = has('--refill'), ALLOW_BLANK = has('--include-blank')
const TARGET = 50      // cars a day: the main models give at most 5 each, the backup models fill what is missing
const TOP_POOL = 6, MID_POOL = 10, MAX_ROUNDS = 3      // cars read per model at first, and how far the pool grows when the picks are not full

/** Every sold price inside the history window, per brand + model text (the same data the report uses). */
async function loadSales(brands) {
  const st = await supabase.from('app_settings').select('history_weeks').maybeSingle()
  const weeks = st.data?.history_weeks || 4
  const since = new Date(Date.now() - weeks * 7 * 86400000).toISOString().slice(0, 10)
  const out = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('lot_history').select('brand,model,grade,model_code,sold_price_jpy').in('brand', brands).eq('result', 'sold')
      .gte('auction_date', since).not('sold_price_jpy', 'is', null).order('id').range(from, from + 999)
    if (error) throw new Error('history: ' + error.message)
    data.forEach((h) => { const k = `${h.brand}|${h.model}`.toUpperCase(); if (!out.has(k)) out.set(k, []); out.get(k).push({ grade: h.grade, price: Number(h.sold_price_jpy), model_code: h.model_code }) })
    if (data.length < 1000) break
  }
  return out
}

/** lot_id -> true when the car has a worked-out duty. */
async function dutyMapFor(ids) {
  const out = new Map()
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from('lot_costs').select('lot_id,duty_myr').in('lot_id', ids.slice(i, i + 100))
    if (error) throw new Error('lot_costs: ' + error.message)
    data.forEach((r) => out.set(r.lot_id, r.duty_myr != null))
  }
  return out
}

/** The fuel types to recommend (set in Admin > Offer report; kept in calc_presets: 1 = include, missing = include). Petrol is always in. */
async function loadFuelAllow() {
  const { data, error } = await supabase.from('calc_presets').select('preset_key,amount').in('preset_key', ['offer_fuel_diesel', 'offer_fuel_hybrid', 'offer_fuel_plug'])
  if (error) throw new Error('calc_presets: ' + error.message)
  const on = (k) => { const r = data.find((x) => x.preset_key === k); return r ? Number(r.amount) !== 0 : true }
  return { diesel: on('offer_fuel_diesel'), hybrid: on('offer_fuel_hybrid'), plug: on('offer_fuel_plug') }
}

/** The car's grade with its interior letter, e.g. 4.5A (as the report builds it). */
const lotGrade = (l) => (/[A-D]$/i.test(String(l.grade || '')) ? l.grade : `${l.grade || ''}${l.interior_grade || ''}`)

/** Saves this run's cars as one batch: each car keeps its own copy of the lot and duty rows (the lot may be deleted later). */
async function saveBatch(chosen, appendTo = null, held = []) {
  const ids = [...chosen, ...held].map((c) => c.l.id), lotRows = new Map(), costRows = new Map()
  for (let i = 0; i < ids.length; i += 100) {
    const a = await supabase.from('lots').select('*').in('id', ids.slice(i, i + 100))
    if (a.error) throw new Error('lots: ' + a.error.message)
    a.data.forEach((r) => lotRows.set(r.id, r))
    const b = await supabase.from('lot_costs').select('*').in('lot_id', ids.slice(i, i + 100))
    if (b.error) throw new Error('lot_costs: ' + b.error.message)
    b.data.forEach((r) => costRows.set(r.lot_id, r))
  }
  // adding to a batch: a car can already be in it (held back earlier). A held-back car that is now recommended replaces its held-back row;
  // a car that is in the batch already is never saved twice (one row per car in a batch).
  if (appendTo) {
    const have = new Map()
    for (let from = 0; ; from += 1000) {
      const r = await supabase.from('offer_batch_cars').select('lot_id,held_back').eq('batch_id', appendTo.id).range(from, from + 999)
      if (r.error) throw new Error('offer_batch_cars: ' + r.error.message)
      r.data.forEach((x) => have.set(x.lot_id, x.held_back))
      if (r.data.length < 1000) break
    }
    const seen = new Set()
    const keepChosen = chosen.filter((c) => { if (seen.has(c.l.id) || have.get(c.l.id) === false) return false; seen.add(c.l.id); return true })
    const promote = keepChosen.filter((c) => have.get(c.l.id) === true).map((c) => c.l.id)
    for (let i = 0; i < promote.length; i += 100) {
      const d = await supabase.from('offer_batch_cars').delete().eq('batch_id', appendTo.id).in('lot_id', promote.slice(i, i + 100))
      if (d.error) throw new Error('offer_batch_cars: ' + d.error.message)
    }
    const keepHeld = held.filter((c) => { if (seen.has(c.l.id) || have.has(c.l.id)) return false; seen.add(c.l.id); return true })
    chosen.length = 0; chosen.push(...keepChosen)
    held.length = 0; held.push(...keepHeld)
  }
  if (!appendTo) {
    // a new batch: still one row per car (the same lot can be picked for two models, or be picked and held back); the first pick wins
    const seen = new Set()
    const keepChosen = chosen.filter((c) => { if (seen.has(c.l.id)) return false; seen.add(c.l.id); return true })
    const keepHeld = held.filter((c) => { if (seen.has(c.l.id)) return false; seen.add(c.l.id); return true })
    if (keepChosen.length !== chosen.length) console.log(`  ${chosen.length - keepChosen.length} car(s) were picked for two models: kept once`)
    chosen.length = 0; chosen.push(...keepChosen)
    held.length = 0; held.push(...keepHeld)
  }
  const batch = appendTo ? { data: { id: appendTo.id } } : await supabase.from('offer_batches').insert({ car_count: chosen.length }).select('id').single()      // car_count = the recommended cars, not the held-back ones
  if (batch.error) throw new Error('offer_batches: ' + batch.error.message)
  const toRow = (held_back) => ({ m, l, tier }) => ({
    batch_id: batch.data.id, lot_id: l.id, tier, model_brand: m.brand_name, model_name: m.model_name, model_code: m.model_code || null,
    docket_id: m.docket_id || null, lot: lotRows.get(l.id) || l, cost: costRows.get(l.id) || null, held_back,
  })
  const rows = [...chosen.map(toRow(false)), ...held.map(toRow(true))]
  const ins = await supabase.from('offer_batch_cars').insert(rows)
  if (ins.error) {
    if (!appendTo) await supabase.from('offer_batches').delete().eq('id', batch.data.id)
    throw new Error('offer_batch_cars: ' + ins.error.message)
  }
  if (appendTo) await supabase.from('offer_batches').update({ car_count: (appendTo.car_count || 0) + chosen.length }).eq('id', appendTo.id)
  console.log(`\n${appendTo ? 'Added to the newest batch' : 'Batch saved'}: ${chosen.length} cars${held.length ? ` + ${held.length} held back (no history price and no duty)` : ''} (kept ${KEEP_DAYS} days, print it from Admin › Offer report).`)
}

let rules = null      // app/utils/recommendRules.ts
let fuel = null      // app/utils/fuel.ts
let historyPriceFn = null      // app/utils/historyPrice.ts (the report's own rule), loaded once
/** True when the car has a history price: the same rule as the report (same grade, same model code). */
function bodyHistOf(sales, l) {
  return !!historyPriceFn(sales.get(`${l.brand}|${l.model}`.toUpperCase()) || [], lotGrade(l), l.model_code)
}

const modelKey = (brand, name, code) => `${brand}|${name}|${code || ''}`

async function main() {
  historyPriceFn = (await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'historyPrice.ts')).href)).historyPrice
  rules = await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'recommendRules.ts')).href)
  const blocked = (l, afterReading) => rules.recommendBlock(l, { afterReading })      // reason text, or null when the car may be recommended
  fuel = await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'fuel.ts')).href)
  const allow = await loadFuelAllow()
  const fuelOk = (l) => fuel.fuelAllowed(l, allow)      // false: a diesel / hybrid / plug-in car whose switch is off
  console.log('Fuel types: petrol' + (allow.diesel ? ', diesel' : '') + (allow.hybrid ? ', hybrid / e:HEV' : '') + (allow.plug ? ', plug-in / electric' : '') + (allow.diesel && allow.hybrid && allow.plug ? ' (all)' : allow.diesel || allow.hybrid || allow.plug ? '' : ' only'))
  const { data: allModels, error } = await supabase.from('offer_models').select('*').order('sort').order('created_at')
  if (error) throw new Error('offer_models: ' + error.message)
  if (!allModels.length) { console.log('No models yet. Add them in the app: Admin › Offer report › Models.'); return }

  // free, no AI: work the dockets and duties out again for the cars already read (the rules or the dockets may have changed)
  if (!DRY && !has('--skip-reprice')) {
    console.log('\n=== reprice (docket + duty again, free) ===')
    spawnSync(process.execPath, [path.join(__dirname, 'reprice.js')], { stdio: 'inherit' })
  }

  // --new: only the models that are not in the newest batch yet; their cars are added to that batch
  // --refill: only the models of the newest batch that are short of cars that have a history price or a duty; new cars are added to it
  if (NEW && REFILL) throw new Error('Use --new or --refill, not both.')
  let models = allModels, appendTo = null
  let existing = 0      // cars already in the batch this run adds to (--new / --refill)
  const batchLots = new Set()      // lots already recommended in that batch: this run never picks them again (it would count them twice)
  const needsScrape = new Set()      // backup models that have never been scraped for this batch
  const need = new Map()      // --refill: model key -> { top, mid } still missing
  if (NEW || REFILL) {
    const since = todayStart()      // one batch per day: --new / --refill only work on today's batch
    const nb = await supabase.from('offer_batches').select('id,car_count').gte('created_at', since).order('created_at', { ascending: false }).limit(1)
    if (nb.error) throw new Error('offer_batches: ' + nb.error.message)
    appendTo = nb.data[0] || null
    if (REFILL && !appendTo) { console.log('--refill: there is no batch made today. Run node offer.js first.'); return }
    if (appendTo) {
      let bc = await supabase.from('offer_batch_cars').select('*').eq('batch_id', appendTo.id)
      if (bc.error) throw new Error('offer_batch_cars: ' + bc.error.message)
      // cars of an auction that is today (or over) are taken out of the batch: they may have ended before the customer sees them
      const ended = bc.data.filter((r) => r.lot?.auction_date && r.lot.auction_date < firstAuctionDate())
      if (ended.length && REFILL && !DRY) {
        for (let i = 0; i < ended.length; i += 100) {
          const d = await supabase.from('offer_batch_cars').delete().eq('batch_id', appendTo.id).in('id', ended.slice(i, i + 100).map((r) => r.id))
          if (d.error) throw new Error('offer_batch_cars: ' + d.error.message)
        }
        const gone = ended.filter((r) => !r.held_back).length
        appendTo.car_count = Math.max(0, (appendTo.car_count || 0) - gone)
        await supabase.from('offer_batches').update({ car_count: appendTo.car_count }).eq('id', appendTo.id)
        console.log(`--refill: ${ended.length} car(s) of an auction before ${firstAuctionDate()} taken out of the batch (${gone} were recommended)`)
        const out = new Set(ended.map((r) => r.id))
        bc = { data: bc.data.filter((r) => !out.has(r.id)) }
      }
      bc.data.filter((r) => !r.held_back).forEach((r) => batchLots.add(r.lot_id))
      const inBatch = new Set(bc.data.map((r) => modelKey(r.model_brand, r.model_name, r.model_code)))
      if (NEW) {
        models = allModels.filter((m) => !inBatch.has(modelKey(m.brand_name, m.model_name, m.model_code)))
        existing = bc.data.filter((r) => !r.held_back).length
        console.log(`--new: ${allModels.length - models.length} model(s) already in the newest batch are skipped`)
        if (!models.length) { console.log('Every model is already in the newest batch. Change a model in the app first.'); return }
      } else {
        models = allModels.filter((m) => inBatch.has(modelKey(m.brand_name, m.model_name, m.model_code)))
        // how many cars of each tier still have a history price or a duty (worked out now, from fresh data)
        const sales0 = await loadSales([...new Set(bc.data.map((r) => r.model_brand))])
        const duty0 = await dutyMapFor(bc.data.map((r) => r.lot_id))
        for (const m of models) {
          const key = modelKey(m.brand_name, m.model_name, m.model_code)
          const good = { top: 0, mid: 0 }
          for (const r of bc.data.filter((x) => !x.held_back && modelKey(x.model_brand, x.model_name, x.model_code) === key)) {
            if (r.lot && !isOthers(r.lot) && !rules.recommendBlock(r.lot) && fuelOk(r.lot) && (bodyHistOf(sales0, r.lot) || duty0.get(r.lot_id) === true)) good[r.tier]++
          }
          existing += good.top + good.mid
          need.set(key, { top: Math.max(0, TOP_N - good.top), mid: Math.max(0, MID_N - good.mid) })
        }
        models = models.filter((m) => { const n = need.get(modelKey(m.brand_name, m.model_name, m.model_code)); return n.top + n.mid > 0 })
        // still under the target: backup models that are not in the batch yet can fill it (scraped only when they are reached)
        // (a main model with no car in the batch yet is tried too: it may have had none because of a rule that has been switched since, e.g. hybrid cars on)
        allModels.filter((m) => !inBatch.has(modelKey(m.brand_name, m.model_name, m.model_code)) && (!m.reserve || existing < TARGET))
          .forEach((m) => { models.push(m); if (m.reserve) needsScrape.add(m.id) })
        console.log(`--refill: ${models.length} model(s) are short of cars with a history price or a duty (or are backups)`)
        if (!models.length) { console.log('Nothing to refill.'); return }
      }
    } else console.log('--new: there is no batch yet, so every model is run')
  }
  models = [...models.filter((m) => !m.reserve), ...models.filter((m) => m.reserve)]      // main models first, backups after them
  if (!REFILL) models.filter((m) => m.reserve).forEach((m) => needsScrape.add(m.id))
  const mains = models.filter((m) => !m.reserve)
  console.log(`Offer models: ${mains.map((m) => m.brand_name + ' ' + m.model_name).join(', ')}`)
  if (models.length > mains.length) console.log(`Backup models (used only below ${TARGET} cars): ${models.filter((m) => m.reserve).map((m) => m.brand_name + ' ' + m.model_name).join(', ')}`)

  const skipScrape = has('--skip-scrape') || REFILL
  if (!DRY) await ensureTargets(mains)
  if (!DRY && !skipScrape && mains.length) { runScrape('bid', mains); if (!has('--skip-history')) runScrape('history', mains) }
  if (!DRY && !claude.isReady()) { console.log('ANTHROPIC_API_KEY is empty in scraper/.env: cars are scraped, nothing picked.'); process.exit(1) }
  // Batches are kept 10 days. Older ones are removed here, and no car of a kept batch is recommended again
  // (a held-back car was never recommended, so it can still be picked later).
  if (!DRY) {
    const cut = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString()
    const del = await supabase.from('offer_batches').delete().lt('created_at', cut)
    if (del.error) throw new Error('offer_batches: ' + del.error.message)
  }
  // Only batches of EARLIER DAYS block a car: batches made today are redone, so a second run today (or --refill) may use any car again.
  const used = new Set()
  const olderB = await supabase.from('offer_batches').select('id').lt('created_at', todayStart())
  if (olderB.error) throw new Error('offer_batches: ' + olderB.error.message)
  for (let i = 0; i < olderB.data.length; i += 50) {
    for (let from = 0; ; from += 1000) {
      const { data, error: e } = await supabase.from('offer_batch_cars').select('lot_id').eq('held_back', false).in('batch_id', olderB.data.slice(i, i + 50).map((b) => b.id)).range(from, from + 999)
      if (e) throw new Error('offer_batch_cars: ' + e.message + ' (run supabase/migrations/14_batch_held_back.sql first)')
      data.forEach((r) => used.add(r.lot_id))
      if (data.length < 1000) break
    }
  }
  console.log(`${used.size} cars were recommended on earlier days (last ${KEEP_DAYS} days): they are not recommended again. Cars of today's batches can be used again.`)
  const chosen = [], heldAll = []      // { m, l, tier } of this run: recommended, and held back (no history price and no duty)

  const ref = DRY ? null : await loadRef()
  const sales = await loadSales([...new Set(models.map((m) => m.brand_name))])
  const bodyHist = (l) => bodyHistOf(sales, l)
  const summary = []

  let backupsScraped = false
  for (const m of models) {
    const left = TARGET - existing - chosen.length      // cars still missing from the target
    if (m.reserve) {
      if (!DRY && left <= 0) { summary.push(`${m.brand_name} ${m.model_name}: backup, not needed (${TARGET} cars reached)`); continue }
      console.log('')
      console.log(`(backup model: ${left} car(s) are still missing from ${TARGET})`)
      // the main models did not fill the target: scrape ALL the backup models in ONE run (one login), then read / pick them one after another
      if (!DRY && !backupsScraped && !has('--skip-scrape')) {
        backupsScraped = true
        const todo = models.filter((x) => x.reserve && needsScrape.has(x.id))
        if (todo.length) {
          console.log(`=== the main models are ${left} car(s) short of ${TARGET}: scraping all ${todo.length} backup model(s) in one run ===`)
          await ensureTargets(todo); runScrape('bid', todo); if (!has('--skip-history')) runScrape('history', todo)
        }
      }
    }
    let { data: lots, error: e } = await supabase.from('lots').select('*').eq('maker_code', m.maker_code).eq('car_code', m.car_code)
      .eq('my_eligible', true).gt('bid_deadline', new Date().toISOString()).gte('auction_date', firstAuctionDate())
    if (e) throw new Error('lots: ' + e.message)
    const label = `${m.brand_name} ${m.model_name}${m.model_code ? ' ' + m.model_code : ''}`
    const found = lots.length
    if (m.model_code) lots = lots.filter((l) => sameCode(l.model_code, m.model_code))      // only the chosen model code
    const before = lots.length
    lots = lots.filter((l) => !used.has(l.id))      // never the same car as an earlier batch
    if (before !== lots.length) console.log(`  ${before - lots.length} car(s) skipped: already recommended in an earlier batch`)
    const taken = new Set([...batchLots, ...chosen.map((c) => c.l.id), ...heldAll.map((c) => c.l.id)])      // never a car already in the batch, or the same car twice in one run (two models can share a car code)
    const beforeTaken = lots.length
    lots = lots.filter((l) => !taken.has(l.id))
    if (beforeTaken !== lots.length) console.log(`  ${beforeTaken - lots.length} car(s) skipped: already picked for another model in this run`)
    console.log(`\n--- ${label}: ${lots.length} cars on offer${m.model_code ? ` (of ${found} for the model)` : ''} ---`)
    if (!lots.length) { summary.push(`${label}: no cars`); continue }

    let want = need.get(modelKey(m.brand_name, m.model_name, m.model_code)) || { top: TOP_N, mid: MID_N }
    if (m.reserve && !DRY) { const t = Math.max(0, Math.min(want.top, left)); want = { top: t, mid: Math.max(0, Math.min(want.mid, left - t)) } }      // a backup only fills the gap
    const dutyMap = await dutyMapFor(lots.map((l) => l.id))
    const hasDuty = (l) => (l.enriched_at == null ? null : dutyMap.get(l.id) === true)      // null = not read yet
    const rule = { hasDuty, allowBlank: ALLOW_BLANK, fuelOk, blocked }
    const failed = new Set()      // cars whose reading failed in this run: not tried again in the next round
    const forceDocket = m.docket_id ? ref?.dockets.find((d) => d.id === m.docket_id) || null : null
    if (m.docket_id && ref && !forceDocket) console.log('  the chosen docket is not in the price guide any more: the automatic rule is used')

    // Read the short list, pick; when cars with neither a history price nor a duty are dropped and the picks are not full,
    // widen the list, read more cars and pick again (up to MAX_ROUNDS).
    let pool = { topPool: TOP_POOL, midPool: MID_POOL }, short, final, stop = false
    for (let round = 0; round < MAX_ROUNDS; round++) {
      short = shortlist(lots, bodyHist, { ...rule, ...pool })
      const toRead = [...short.top, ...short.mid].filter((l) => !failed.has(l.id) && ((FORCE && round === 0) || l.enriched_at == null || l.pick_score == null))
      console.log(`short list: ${short.top.length} top + ${short.mid.length} mid candidates, ${toRead.length} to read`)
      if (DRY) { toRead.slice(0, 20).forEach((l) => console.log(' -', l.lot_no, l.grade, l.mileage_km + ' km', l.mfg_year)); break }
      for (const lot of toRead) {
        try {
          const r = await enrichLot({ lot, ref, ask: claude.ask, imageBlock: claude.imageBlock, forceDocket })
          const up = await supabase.from('lots').update({ ...r.patch, enriched_at: new Date().toISOString(), enrich_note: r.notes.join('; ') || null }).eq('id', lot.id)
          if (up.error) throw new Error(up.error.message)
          Object.assign(lot, r.patch, { enriched_at: new Date().toISOString() })
          if (r.cost) {
            const c = await supabase.from('lot_costs').upsert({ lot_id: lot.id, ...r.cost, updated_at: new Date().toISOString() }, { onConflict: 'lot_id' })
            if (c.error) throw new Error(c.error.message)
          } else await supabase.from('lot_costs').delete().eq('lot_id', lot.id)      // no docket now: an older duty must not stay
          dutyMap.set(lot.id, !!(r.cost && r.cost.duty_myr != null))
          console.log(`  read ${lot.lot_no} ${lot.grade}: score ${r.patch.pick_score ?? '?'}${r.patch.accident ? ' ACCIDENT' : ''} ${r.patch.pick_reason || ''}${r.cost ? '' : ' · no duty'}`)
          const why = blocked(lot, true)
          if (why) console.log(`    -> not recommended: ${why}`)
        } catch (err) {
          console.log(`  ${lot.lot_no}: FAILED ${err.message} -> not recommended (the sheet was not read)`)
          failed.add(lot.id)
          if (/token cap|not set up/.test(err.message)) { stop = true; break }
        }
      }
      if (stop) break
      final = finalize(short, bodyHist, { ...rule, topN: want.top, midN: want.mid })
      const got = final.top.length + final.mid.length
      if (got >= want.top + want.mid || ALLOW_BLANK) break
      if (round > 0 && !toRead.length) break      // nothing new to read: a wider list would give the same picks
      if (round < MAX_ROUNDS - 1) console.log(`  ${got} of ${want.top + want.mid} picked with a history price or a duty: reading more cars`)
      pool = { topPool: pool.topPool + 6, midPool: pool.midPool + 10 }
    }
    if (DRY) continue
    if (stop) { console.log('Stopped: AI limit reached. This model was not picked; the models before it are still saved.'); break }

    const picks = [...final.top.map((l) => ({ l, tier: 'top' })), ...final.mid.map((l) => ({ l, tier: 'mid' }))]
    picks.forEach(({ l, tier }) => chosen.push({ m, l, tier }))
    // the cars the old rule would have picked: kept in the batch (held back), shown in the report only when asked
    let held = []
    if (!ALLOW_BLANK) {
      const wide = shortlist(lots, bodyHist, { hasDuty, allowBlank: true, fuelOk, blocked, ...pool })
      const all = finalize(wide, bodyHist, { hasDuty, allowBlank: true, fuelOk, blocked, topN: want.top, midN: want.mid })
      const keep = new Set(picks.map(({ l }) => l.id))
      held = [...all.top.map((l) => ({ l, tier: 'top' })), ...all.mid.map((l) => ({ l, tier: 'mid' }))].filter(({ l }) => !keep.has(l.id) && !bodyHist(l) && hasDuty(l) === false)
      held.forEach(({ l, tier }) => heldAll.push({ m, l, tier }))
    }
    const noHist = picks.filter(({ l }) => !bodyHist(l)).length
    summary.push(`${label}: ${final.top.length} top + ${final.mid.length} mid${picks.length < want.top + want.mid ? ` (only ${picks.length} of ${want.top + want.mid} found)` : ''}${noHist ? ` (${noHist} without history price, with duty)` : ''}${held.length ? ` · ${held.length} held back (no history price and no duty)` : ''}`)
    console.log(summary[summary.length - 1])
  }

  const total = existing + chosen.length
  if (!DRY) console.log(`
Cars recommended: ${total} of ${TARGET}${total < TARGET ? ` (${TARGET - total} short: add more backup models in the app, or run with --include-blank)` : ''}`)
  if (!DRY && chosen.length) await saveBatch(chosen, appendTo, heldAll)
  else if (!DRY) console.log('\nNo cars were picked: no batch saved.')
  // one batch per day (Japan date): everything made today is combined into one batch (still valid cars only, 5 per model; 50 is a minimum, more are kept)
  if (!DRY && chosen.length) { console.log("\n=== combine today's batches into one ==="); await mergeToday() }

  console.log('\n=== done ===\n' + summary.join('\n') + (DRY ? '' : '\n' + claude.summary()))
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })

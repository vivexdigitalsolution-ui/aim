'use strict'

/**
 * model-watch.js — the weekly check of WHICH models are still worth scraping (run it once a week, it takes a while, leave it running).
 *
 *   node model-watch.js                        DEFAULT = History only: every model with 2022+ sold results that is not in the list yet is added
 *                                              as Bidding + One price + History (all New / off). Bidding and One price are not walked at all.
 *   node model-watch.js --types bid,one_price,history   also walk Bidding / One price (their 0-car warnings and auto-off work as before)
 *   node model-watch.js --stocked-only         History: only models that have cars on Bidding or One price (the old rule)
 *   node model-watch.js --brand "TOYOTA,BMW"   only these brands (name or code)
 *   node model-watch.js --dry                  look and report, write nothing to the database
 *   node model-watch.js --force                check again even models checked in the last 5 days (normally they are skipped, so an
 *                                              interrupted run continues where it stopped and one model is never counted twice in a week)
 *   node model-watch.js --max-zero 8           switch a model off after MORE than this many checks in a row with 0 cars (default 8)
 *
 * For each type, on its own page of the USS site (Bidding: the pre-auction search; History: Market Price; One price: the Japanese
 * one-click search), brand by brand, with the year filter YEAR_FROM from .env (2022 and later), any score, every venue:
 *   1. Opens the brand and reads its model list. USS only lists models that have stock (or sold results) today.
 *   2. A model in that list with NO row of this type in scrape_targets: opens it with the year filter. Cars found -> a target of that type is
 *      added with status "new" and OFF (you switch it on on the Scrape targets page). 0 cars -> nothing is saved.
 *   3. A model with a live, switched-on row of this type: opens it with the year filter. 0 cars -> the row's warning count (zero_count) goes
 *      up by 1; cars found -> back to 0. A model USS does not list at all counts as 0 without opening it.
 *      After MORE than 8 checks in a row with 0 cars that row is switched OFF (disabled_reason says why).
 *   Rows already in the list are never re-added; rows you switched off, and rows still New, are not checked.
 *   Each type is counted on its own: a model can be live for Bidding and off for One price.
 *
 * Safety: if the first 15 models checked of a type ALL show 0 cars, the filter is probably not working: that type stops and writes nothing.
 * A model that fails to open is skipped and not counted. Needs migration 49. Do not run it at the same time as scrape.js (same login).
 * The report is also saved to out/model-watch-YYYY-MM-DD.csv.
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const supabase = require('./lib/db')
const config = require('./lib/config')
const { login } = require('./lib/auth')
const nav = require('./lib/nav')

const args = process.argv.slice(2)
const has = (n) => args.includes(n)
const arg = (n) => { const i = args.indexOf(n); return i > -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null }
const DRY = has('--dry'), FORCE = has('--force'), STOCKED_ONLY = has('--stocked-only')
const MAX_ZERO = parseInt(arg('--max-zero') || '8', 10)
const RECHECK_DAYS = 5
const YEAR_FROM = config.yearFrom || 2022
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const log = (m) => console.log(m)
const key = (type, b, c) => `${type}|${b}|${c}`
const CRIT = { year_from: YEAR_FROM, year_to: config.yearTo, score_min: null, scores: null }      // years only: every score counts

let stop = false
process.on('SIGINT', () => { if (stop) process.exit(1); stop = true; log('\nStopping after the current model ... (Ctrl+C again to quit now)') })

let sessionLang = 'en'
// the three places on the USS site (same entry steps scrape.js uses)
const SITES = {
  bid: {
    label: 'Bidding', lang: 'en',
    enter: async () => {},
    open: async (p) => { await nav.goToSearchDirect(p, 'bid'); await nav.selectAllVenues(p, []) },
    filter: (p) => nav.applyFilter(p, CRIT, 'bid'),
  },
  history: {
    label: 'History', lang: 'en',
    enter: (p) => nav.openMarketPriceFirstTime(p),
    open: async (p) => { await nav.goToMarketSearch(p); await nav.skipVenueStep(p) },
    filter: (p) => nav.applyHistoryFilter(p, CRIT),
  },
  one_price: {
    label: 'One price', lang: 'jp',
    // the Japanese pages: try the same login first, log in again in Japanese if USS does not accept it (as scrape.js does)
    enter: async (p) => {
      try { await nav.openOneClickWizardFirstTime(p) } catch (e) {
        if (sessionLang === 'jp') throw e
        log(`   the English login did not open the Japanese page (${String(e.message).split('\n')[0]}): logging in again in Japanese`)
        await login(p, 'jp'); sessionLang = 'jp'
        await nav.openOneClickWizardFirstTime(p)
      }
    },
    open: async (p) => { await nav.goToSearchDirect(p, 'one_price'); await nav.selectAllVenues(p, []) },
    filter: (p) => nav.applyFilter(p, CRIT, 'one_price'),
  },
}

async function loadAll(table, cols, apply = (q) => q) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await apply(supabase.from(table).select(cols)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}${/zero_count|status|checked_at/.test(error.message) ? '  (run migration 49 first)' : ''}`)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

/** the choices of a panel as { code, name }: read straight from the checkboxes (the wrapper's id differs between the Bidding, Market Price and One price pages) */
const readPanel = (page, boxName) => page.evaluate((boxName) => {
  const out = [], seen = new Set()
  for (const i of document.querySelectorAll(`input[name="${boxName}"]`)) {
    if (!i.value || seen.has(i.value)) continue
    const name = (i.closest('label')?.textContent || i.parentElement?.textContent || '').trim().replace(/s*(d+)s*$/, '').trim()
    if (name) { seen.add(i.value); out.push({ code: i.value, name }) }
  }
  return out
}, boxName)

async function bringUp() {
  const context = await chromium.launchPersistentContext(path.join(__dirname, '.chrome-profile'), { headless: false, slowMo: 80 })
  const page = context.pages()[0] || (await context.newPage())
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(120000)
  page.on('dialog', (d) => { log(`>>> Browser dialog: "${d.message().replace(/\s+/g, ' ').slice(0, 160)}" (OK is pressed after 20 s)`); setTimeout(() => d.accept().catch(() => {}), 20000) })
  return { context, page }
}

/** the number of cars of one model with the year filter on (any score), on every venue */
async function hitsFor(site, page, brandCode, modelCode) {
  await site.open(page)
  await nav.selectBrand(page, brandCode)
  if (!(await nav.selectModel(page, modelCode))) return 0        // no "detailed criteria" link: nothing there
  const hits = await site.filter(page)
  const shown = await page.inputValue('#ModelYearFromOption').catch(() => null)
  if (shown !== null && shown !== String(YEAR_FROM)) throw new Error(`the year filter shows ${shown || 'nothing'} instead of ${YEAR_FROM}: the count cannot be trusted`)
  return hits
}

async function main() {
  const wantedBrands = (arg('--brand') || '').split(',').map(norm).filter(Boolean)
  const types = (arg('--types') || 'history').split(',').map((s) => s.trim()).filter((t) => SITES[t])
  if (!types.length) { console.log('--types takes bid, history and/or one_price'); process.exit(1) }
  types.sort((a, b) => (a === 'history') - (b === 'history'))              // History goes last: it only looks at models that have cars on Bidding or One price

  const brandsDb = await loadAll('scraper_brands', 'code,name')
  const modelsDb = await loadAll('scraper_models', 'brand_code,code,name')
  const brandName = new Map(brandsDb.map((b) => [String(b.code), b.name]))
  const modelName = new Map(modelsDb.map((m) => [`${m.brand_code}|${m.code}`, m.name]))       // English names, whatever language the page we read is in
  const targets = await loadAll('scrape_targets', 'id,lot_type,maker_code,car_code,brand_name,model_name,enabled,status,zero_count,last_hits,checked_at,disabled_reason', (q) => q.eq('source', 'uss').in('lot_type', types))
  const anyName = new Map(), allKeys = new Set()
  for (const t of await loadAll('scrape_targets', 'lot_type,maker_code,car_code,brand_name,model_name', (q) => q.eq('source', 'uss'))) { anyName.set(`${t.maker_code}|${t.car_code}`, t); allKeys.add(key(t.lot_type, t.maker_code, t.car_code)) }
  // models with cars on Bidding or One price: History is checked for these only (a model with none there is skipped completely)
  const stocked = new Set()
  if (types.includes('history') && STOCKED_ONLY) {
    for (const t of await loadAll('scrape_targets', 'lot_type,maker_code,car_code,enabled,status,last_hits', (q) => q.eq('source', 'uss').in('lot_type', ['bid', 'one_price'])))
      if ((t.last_hits ?? 0) > 0 || (t.last_hits == null && t.enabled && t.status === 'live')) stocked.add(`${t.maker_code}|${t.car_code}`)
  }
  const byKey = new Map(targets.map((t) => [key(t.lot_type, t.maker_code, t.car_code), t]))
  const recentCut = Date.now() - RECHECK_DAYS * 86400e3
  const fresh = (t) => !FORCE && t.checked_at && new Date(t.checked_at).getTime() > recentCut

  // progress file: models without a row (0 cars) are not saved in the database, so this is how a rerun skips what was already looked at
  const stateFile = path.join(__dirname, 'out', 'model-watch-state.json')
  let state = {}
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch {}
  for (const k of Object.keys(state)) if (new Date(state[k].at).getTime() < recentCut) delete state[k]
  if (FORCE) state = {}
  if (types.includes('history') && STOCKED_ONLY) for (const k of Object.keys(state)) { const [ty, b, c] = k.split('|'); if ((ty === 'bid' || ty === 'one_price') && state[k].hits > 0) stocked.add(`${b}|${c}`) }
  const saveState = () => { if (DRY) return; try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state)) } catch {} }

  log(`Weekly model check (${types.map((t) => SITES[t].label).join(', ')}): cars made in ${YEAR_FROM} or later${config.yearTo ? ' to ' + config.yearTo : ''}, all venues, any score. ${DRY ? 'DRY RUN: nothing is written.' : ''}`)
  for (const t of types) { const r = targets.filter((x) => x.lot_type === t); log(`  ${SITES[t].label}: ${r.length} targets in the list (${r.filter((x) => x.enabled).length} on)`) }
  log(`  A model is switched off after more than ${MAX_ZERO} checks in a row with 0 cars.`)

  const { context, page } = await bringUp()
  const report = { added: [], zero: [], off: [], errors: [], skippedFresh: 0, checked: 0, aborted: [] }
  const enter = async (type) => {
    const site = SITES[type]
    if (sessionLang !== site.lang && type !== 'one_price') { await login(page, site.lang); sessionLang = site.lang }
    await site.enter(page)
  }

  try {
    await login(page, 'en'); sessionLang = 'en'

    for (const type of types) {
      if (stop) break
      const site = SITES[type]
      log('\n' + '═'.repeat(60) + `\n  ${site.label}\n` + '═'.repeat(60))
      try { await enter(type); await site.open(page) } catch (e) { report.errors.push(`${site.label}: could not open the page (${e.message.split('\n')[0]})`); log(`Could not open the ${site.label} page: ${e.message.split('\n')[0]}`); continue }
      const brandsOnSite = await readPanel(page, 'BrandCodeOption')
      if (brandsOnSite.length < 5) { report.errors.push(`${site.label}: the brand list has only ${brandsOnSite.length} brands`); log(`The ${site.label} brand list has only ${brandsOnSite.length} brands: the page did not load properly. Skipped.`); continue }
      log(`${brandsOnSite.length} brands on the site.`)
      const siteCodes = new Set(brandsOnSite.map((b) => String(b.code)))
      const mineAll = targets.filter((t) => t.lot_type === type)

      // brands to walk: every brand on the site plus every brand with a row of this type (absent from the site = no stock), minus the skip list
      const codes = [...new Set([...brandsOnSite.map((b) => String(b.code)), ...mineAll.map((t) => String(t.maker_code))])]
        .filter((c) => !config.skipBrandCodes.has(c.toUpperCase()))
        .filter((c) => type !== 'history' || !STOCKED_ONLY || [...stocked].some((s) => s.startsWith(c + '|')))   // History: no model of this brand has cars on Bidding / One price
        .filter((c) => !wantedBrands.length || wantedBrands.includes(norm(c)) || wantedBrands.includes(norm(brandName.get(c) || brandsOnSite.find((b) => String(b.code) === c)?.name)))

      // nothing is written until the first 15 models of this type have been looked at and not ALL were 0 (a broken filter makes every model look empty)
      let checked = 0, zeroSoFar = 0, passed = false, aborted = false
      const pending = []
      const later = (fn) => (passed ? fn() : (pending.push(fn), undefined))
      const flush = async () => { passed = true; for (const f of pending.splice(0)) await f() }

      // History found cars (2022+ sold results): the model can be imported, so it also gets a Bidding and a One price target (New, off).
      // That is how the History page alone finds new models: no need to walk Bidding and One price. Rows already in the list are left alone.
      const addSiblings = async (brandCode, model, bName, mName, hits, now) => {
        for (const ty of ['bid', 'one_price']) {
          const k2 = key(ty, brandCode, model.code)
          if (allKeys.has(k2)) continue
          allKeys.add(k2)
          report.added.push({ type: SITES[ty].label + ' (from History)', brand: bName, model: mName, hits })
          log(`   + NEW  ${bName} ${mName}: sold in ${YEAR_FROM}+ -> added to ${SITES[ty].label} as New (off)`)
          if (!DRY) {
            const row = { label: `${bName} / ${mName} (${ty})`, lot_type: ty, source: 'uss', maker_code: brandCode, car_code: model.code, brand_name: bName, model_name: mName, year_from: YEAR_FROM, year_to: config.yearTo ?? null, enabled: false, status: 'new', checked_at: now, zero_count: 0 }
            const { error } = await supabase.from('scrape_targets').upsert(row, { onConflict: 'source,lot_type,maker_code,car_code', ignoreDuplicates: true })
            if (error) report.errors.push(`${bName} ${mName}: could not add ${ty} (${error.message})`)
          }
        }
      }
      const record = async (brandCode, brand, model, hits) => {
        const k = key(type, brandCode, model.code), t = byKey.get(k), now = new Date().toISOString()
        state[k] = { hits, at: now }
        if (!t) {
          if (hits > 0) {
            // English names, even when the page read is Japanese (One price): from the model list, else from any target of the same model
            const en = anyName.get(`${brandCode}|${model.code}`)
            const bName = brandName.get(brandCode) || en?.brand_name || brand, mName = modelName.get(`${brandCode}|${model.code}`) || en?.model_name || model.name
            report.added.push({ type: site.label, brand: bName, model: mName, hits })
            log(`   + NEW  ${bName} ${mName}: ${hits} car(s) → added to ${site.label} as New (off)`)
            if (!DRY) {
              const row = { label: `${bName} / ${mName} (${type})`, lot_type: type, source: 'uss', maker_code: brandCode, car_code: model.code, brand_name: bName, model_name: mName, year_from: YEAR_FROM, year_to: config.yearTo ?? null, enabled: false, status: 'new', last_hits: hits, checked_at: now, zero_count: 0 }
              const { error } = await supabase.from('scrape_targets').upsert(row, { onConflict: 'source,lot_type,maker_code,car_code', ignoreDuplicates: true })
              if (error) report.errors.push(`${bName} ${mName}: could not add (${error.message})`)
            }
            allKeys.add(k)
            if (type === 'history') await addSiblings(brandCode, model, bName, mName, hits, now)
          }
          return
        }
        if (type === 'history' && hits > 0 && t.enabled && t.status === 'live') await addSiblings(brandCode, model, t.brand_name, t.model_name, hits, now)
        const zero = hits > 0 ? 0 : (t.zero_count || 0) + 1
        const patch = { zero_count: zero, last_hits: hits, checked_at: now }
        if (hits === 0) {
          report.zero.push({ type: site.label, brand: t.brand_name, model: t.model_name, count: zero })
          log(`   ⚠ ${t.brand_name} ${t.model_name}: 0 cars (warning ${zero} of ${MAX_ZERO + 1})`)
          if (zero > MAX_ZERO) {
            patch.enabled = false; patch.disabled_reason = `Switched off by the weekly check: no ${YEAR_FROM}+ cars for ${zero} checks in a row`
            report.off.push({ type: site.label, brand: t.brand_name, model: t.model_name, count: zero })
            log(`   ✗ ${t.brand_name} ${t.model_name}: ${zero} checks in a row with 0 cars → SWITCHED OFF`)
          }
        }
        if (!DRY) {
          const { error } = await supabase.from('scrape_targets').update(patch).eq('id', t.id)
          if (error) report.errors.push(`${t.brand_name} ${t.model_name}: could not save (${error.message})`)
        }
        Object.assign(t, patch)
      }

      for (const code of codes) {
        if (stop || aborted) break
        const bName = brandName.get(code) || brandsOnSite.find((b) => String(b.code) === code)?.name || code
        const mine = mineAll.filter((t) => String(t.maker_code) === code && t.enabled && t.status === 'live')
        let models = []
        if (siteCodes.has(code)) {
          try {
            await site.open(page)
            await nav.selectBrand(page, code)
            models = await readPanel(page, 'CarCategoryNoOption')
          } catch (e) { report.errors.push(`${site.label} ${bName}: model list not read (${e.message.split('\n')[0]})`); log(`${bName}: could not read the model list, skipped (${e.message.split('\n')[0]})`); continue }
          if (!models.length) { log(`${bName}: the model list came back empty, skipped (not counted)`); continue }
        }
        const listed = new Set(models.map((m) => String(m.code)))
        log(`\n${bName}: ${models.length} model(s) listed, ${mine.length} live target(s)`)

        // live rows USS does not list at all: no stock = 0 cars, no browsing needed
        for (const t of mine) {
          if (stop) break
          if (listed.has(String(t.car_code))) continue
          if (type === 'history' && STOCKED_ONLY && !stocked.has(`${code}|${t.car_code}`)) continue
          if (fresh(t) || state[key(type, code, t.car_code)]) { report.skippedFresh++; continue }
          await later(() => record(code, bName, { code: t.car_code, name: t.model_name }, 0))
        }

        // models on the site that need a look: no row of this type yet, or a live switched-on row
        for (const m of models) {
          if (stop) break
          const k = key(type, code, m.code), t = byKey.get(k)
          if (type === 'history' && STOCKED_ONLY && !stocked.has(`${code}|${m.code}`)) { report.noStock = (report.noStock || 0) + 1; continue }   // no cars on Bidding / One price: skip History for it
          if (t && !(t.enabled && t.status === 'live')) continue                  // in the list, off or still New: nothing to do
          if ((t && fresh(t)) || (!t && state[k])) { report.skippedFresh++; continue }
          let hits = null, lastErr = ''
          for (let attempt = 1; attempt <= 2 && hits === null; attempt++) {
            try { hits = await hitsFor(site, page, code, m.code) } catch (e) {
              lastErr = e.message.split('\n')[0]
              if (attempt === 1) { try { await page.goto('about:blank', { timeout: 10000 }).catch(() => {}); await login(page, sessionLang); await site.enter(page) } catch {} }
            }
          }
          if (hits === null) { report.errors.push(`${site.label} ${bName} ${m.name}: ${lastErr}`); log(`   ! ${bName} ${m.name}: could not check (${lastErr})`); continue }
          checked++; report.checked++; if (hits === 0) zeroSoFar++
          if (hits > 0 && type !== 'history') stocked.add(`${code}|${m.code}`)
          log(`   ${hits > 0 ? '✓' : '·'} ${bName} ${m.name}: ${hits} car(s)${t ? '' : ' (not in the list)'}`)
          if (checked === 15 && zeroSoFar === 15) { aborted = true; report.aborted.push(site.label); log(`\nThe first 15 ${site.label} models all show 0 cars: the filter is probably not working. ${site.label} stopped; nothing from it was counted.`); break }
          await later(() => record(code, bName, m, hits))
          if (checked === 15) await flush()
          if (checked % 10 === 0) saveState()
        }
      }
      if (!aborted) await flush()
      saveState()
    }
  } finally {
    await context.close().catch(() => {})
  }
  saveState()

  // report
  const lines = ['type,site,brand,model,detail']
  report.added.forEach((r) => lines.push(`new,${r.type},${r.brand},${r.model},${r.hits} cars`))
  report.zero.forEach((r) => lines.push(`zero,${r.type},${r.brand},${r.model},warning ${r.count} of ${MAX_ZERO + 1}`))
  report.off.forEach((r) => lines.push(`switched_off,${r.type},${r.brand},${r.model},${r.count} checks in a row`))
  report.errors.forEach((e) => lines.push(`error,,,,"${e.replace(/"/g, "'")}"`))
  try { const f = path.join(__dirname, 'out', `model-watch-${new Date().toISOString().slice(0, 10)}.csv`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, lines.join('\n')); log(`\nReport saved: ${f}`) } catch {}

  const fmt = (r, extra) => `${r.type}: ${r.brand} ${r.model}${extra ? ' ' + extra : ''}`
  log('\n' + '═'.repeat(60))
  if (report.noStock) log(`History: ${report.noStock} model(s) skipped because they have no cars on Bidding or One price.`)
  log(`Checked ${report.checked} model(s) on the site. ${report.skippedFresh} skipped (already checked in the last ${RECHECK_DAYS} days).`)
  log(`New models found (added OFF, status New): ${report.added.length}${report.added.length ? '\n   ' + report.added.map((r) => fmt(r, `(${r.hits})`)).join('\n   ') : ''}`)
  log(`Live models with 0 cars (warning count): ${report.zero.length}${report.zero.length ? '\n   ' + report.zero.sort((a, b) => b.count - a.count).map((r) => fmt(r, `: ${r.count} of ${MAX_ZERO + 1}`)).join('\n   ') : ''}`)
  log(`Switched off this run: ${report.off.length}${report.off.length ? '\n   ' + report.off.map((r) => fmt(r)).join('\n   ') : ''}`)
  if (report.errors.length) log(`Problems (${report.errors.length}):\n   ${report.errors.slice(0, 20).join('\n   ')}`)
  if (report.aborted.length) process.exit(1)
}

main().catch((e) => { console.error('[model-watch] FAILED: ' + e.message); process.exit(1) })

// ASNET list row -> One price car, matching of names, saving, removing sold cars, reading every page.   node tests/asnet-map.test.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// writer.js opens a database client when loaded: give it harmless values (nothing is called)
process.env.SUPABASE_URL ||= 'http://localhost:1'; process.env.SUPABASE_SERVICE_KEY ||= 'x'
const { exKey, slotOwner, venueName, isAsOne, bareModel, wantedModel, stripCount, matchModels, onAsnet, ourMake, savedModel, rowToCar, nameKey } = require('../services/scraper/lib/asnet/map.js')
const { saveCar, removeGone, isOtherCar } = require('../services/scraper/lib/asnet/save.js')
const { readAllPages } = require('../services/scraper/lib/asnet/read.js')
const { eraToYear, normalizeFormCode } = require('../services/scraper/lib/asnet/extract.js')

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

// a row as the real list gave it (an AS-One Price Alphard: no auction date)
const row = { lot_no: 'F551250167', auction_method: 'AS-One Price', auction_date: null, location: '千葉県', make: 'TOYOTA', car_name: 'ALPHARD', grade: 'Z', model_code_raw: 'AGH40W', engine_cc: 2500, mfg_year_western: 2026, mileage: 3000, color: 'Pearl', gear: 'FAT', score_grade: '4.5', wholesale_price: 5080000 }
const car = rowToCar(row)
ok(car && car.deadline === null && car.source === 'asnet', 'a car without an auction date is usable, with no deadline')
ok(car.price_jpy === 5080000 && car.brand === 'TOYOTA' && car.model === 'ALPHARD' && car.grade === 'Z' && car.auction_grade === '4.5', 'price, make, model, variant and score each in their own field')
ok(car.model_code === 'AGH40W' && car.mfg_year === 2026 && car.mileage_km === 3000 && car.engine_cc === 2500 && car.transmission === 'AT' && car.venue === 'Chiba', 'the figures carry over, the place in English')
ok(venueName('大阪府') === 'Osaka' && venueName('北海道') === 'Hokkaido' && venueName('どこか') === 'Japan' && venueName('') === 'Japan', 'prefectures, and a fallback')
ok(/^[0-9a-f]{32}$/.test(car.ex_key) && car.ex_key === exKey('f551250167') && car.ex_key !== exKey('F551250168'), 'the key is a code that names nothing, from the lot number')
ok(rowToCar({ ...row, lot_no: '' }) === null && rowToCar({ ...row, make: '' }) === null && rowToCar({ ...row, car_name: '' }) === null, 'a row without lot number, make or name is not usable')
ok(rowToCar({ ...row, grade: 'Z JBL sound &amp; rear monitor' }).grade === 'Z JBL SOUND & REAR MONITOR', 'text encoded twice is decoded')
ok(rowToCar({ ...row, model_code_raw: '-1' }).model_code === null, 'the "-1" code means none')
ok(isAsOne('AS-One Price') && isAsOne('AS-One Price (5stars)') && !isAsOne('AA-One Price') && !isAsOne('AA-Bid') && !isAsOne(''), 'only AS-One Price is the wanted sale type')
ok(eraToYear('R7') === 2025 && eraToYear('H30') === 2018 && normalizeFormCode('3BA-AGH40W') === 'AGH40W' && nameKey('Land-Cruiser') === 'LANDCRUISER', 'helpers')

// ── names ──
const mini = new Set(['CLUBMAN', 'CROSSOVER'])
ok(wantedModel(mini, 'MINI', 'MINI CLUBMAN') && !wantedModel(mini, 'MINI', 'MINI PACEMAN') && !wantedModel(undefined, 'MINI', 'MINI'), 'names with the make in front match ours')
ok(bareModel('MAZDA', 'MAZDA3 SEDAN') === 'MAZDA3 SEDAN' && savedModel('MINI', 'MINI CLUBMAN') === 'CLUBMAN' && savedModel('MINI', 'MINI') === 'MINI', 'only a whole make word in front is dropped')
ok(savedModel('SUBARU', 'IMPREZA SPORTS') === 'IMPREZA SPORT' && savedModel('ALFA ROMEO', 'JULIA') === 'GIULIA' && savedModel('DODGE', 'DODGE CHARENGER') === 'CHALLENGER' && savedModel('CADILLAC', 'CADILLAC CT5') === 'CT5' && savedModel('VOLKSWAGEN', 'GOLF') === 'GOLF', 'saved cars are named like the other source; a broader name stays')
ok(stripCount('CT5 (7)') === 'CT5' && stripCount('COPEN(TOYOTA)') === 'COPEN(TOYOTA)', 'only a trailing number in brackets is dropped')
const list = (names) => names.map((name, i) => ({ code: String(i), name }))
let mm = matchModels('MINI', ['3HB', '5HB', 'CLUBMAN', 'COUNTRYMAN', 'CROSSOVER', 'ACEMAN'], list(['MINI', 'MINI CLUBMAN', 'MINI CROSSOVER', 'MINI COUPE']))
ok(mm.keep.map((c) => c.name).join() === 'MINI,MINI CLUBMAN,MINI CROSSOVER' && mm.missing.join() === 'ACEMAN', 'listed matches work, each ASNET model once, the rest is reported')
mm = matchModels('VOLKSWAGEN', ['GOLF GTI', 'GOLF R VARIANT'], list(['GOLF', 'GOLF VARIANT', 'GOLF GTE']))
ok(mm.keep.map((c) => c.name).join() === 'GOLF,GOLF VARIANT' && !mm.missing.length, 'a variant is found under the broader name')
ok(onAsnet('ABARTH', '595C').brand === 'FIAT' && onAsnet('MERCEDES MAYBACH', 'S-CLASS').brand === 'MAYBACH' && ourMake('Fiat', 'Abarth') === 'ABARTH' && ourMake('Fiat', '500') === 'FIAT' && ourMake('Maybach', 'S-CLASS') === 'MERCEDES MAYBACH', 'Abarth sits under Fiat, Mercedes Maybach is Maybach')
const abarth = rowToCar({ ...row, make: 'Fiat', car_name: 'Abarth', grade: '595 Turismo' })
ok(abarth.brand === 'ABARTH' && abarth.model === '595 TURISMO', 'an Abarth is saved under our make')

// ── saving, with a pretend database and pretend photos ──
const full = { ...car, maker_code: '1010', car_code: '10102070' }
function fakeDb({ slot = null, rows = [], slotError = null, insertError = null, updated = [{ id: 1 }] } = {}) {
  const log = { inserts: [], updates: [], deletes: [], upserts: 0, filters: [] }
  const q = (result, kind) => {
    const c = { select: () => c, eq: (k, v) => { log.filters.push(`${kind} ${k}=${v}`); return c }, in: (k, v) => { log.filters.push(`${kind} ${k} in ${v.length}`); return c }, order: () => c, range: async () => ({ data: rows, error: slotError }), maybeSingle: async () => result, then: (a, b) => Promise.resolve(result).then(a, b) }
    return c
  }
  const db = { from: () => ({
    select: () => q({ data: slot, error: slotError }, 'select'),
    insert: async (r) => { log.inserts.push(r); return { error: insertError } },
    update: (r) => { log.updates.push(r); return q({ data: updated, error: null }, 'update') },
    delete: () => { log.deletes.push(1); return q({ error: null }, 'delete') },
    upsert: async () => { log.upserts++; return { error: null } },
  }) }
  return { db, log }
}
async function run({ gone = [], photoError = null, write = true, ...dbo } = {}) {
  const { db, log } = fakeDb(dbo)
  log.fetched = []; log.removed = []
  const res = await saveCar({ db, car: full, write, isGone: async (u) => gone.includes(u), removePhotos: async (k) => { log.removed.push(...k) },
    fetchPhotos: async (keep) => { log.fetched.push(keep); return photoError ? { photos: [], sheet: null, keys: [], error: photoError } : { photos: ['new-f'], sheet: null, keys: ['k1'], error: null } } })
  return { res, log }
}
const untouched = (l) => !l.inserts.length && !l.updates.length && !l.deletes.length && !l.upserts && !l.fetched.length && !l.removed.length
const ours = { id: 1, ex_key: full.ex_key, source: 'asnet', photos: ['old-f'], sheet_url: 'old-sheet', brand: 'TOYOTA', model_code: '3BA-AGH40W', mfg_year: 2025 }
let t = await run({ slot: { id: 9, ex_key: full.ex_key, source: 'uss', photos: ['u'] } })
ok(t.res.status === 'taken' && untouched(t.log), 'a row of the other source is never touched')
t = await run({ slotError: { message: 'down' } })
ok(t.res.status === 'failed' && untouched(t.log), 'cannot read what is saved: nothing is written')
t = await run({ write: false })
ok(t.res.status === 'would' && untouched(t.log), 'dry run writes and downloads nothing')
t = await run()
ok(t.res.status === 'saved' && t.log.inserts.length === 1 && t.log.inserts[0].photos[0] === 'new-f' && !t.log.upserts, 'a new car is inserted, never upserted')
t = await run({ slot: ours })
const patch = t.log.updates[0]
ok(t.res.status === 'updated' && !t.log.fetched.length && patch.price_jpy === 5080000 && patch.last_seen_at, 'a saved car gets its price and last-seen time')
ok(!['mfg_year', 'mileage_km', 'model_code', 'color', 'transmission', 'photos'].some((k) => k in patch), 'what the sheet reading filled in is left alone, and working photos are kept')
ok(t.log.filters.includes('update source=asnet'), 'the update is limited to ASNET rows')
t = await run({ slot: ours, gone: ['old-f'] })
ok(t.res.repaired === true && t.log.updates[0].photos[0] === 'new-f' && !('sheet_url' in t.log.updates[0]), 'a missing cover is fetched again; the saved sheet link is not wiped')
t = await run({ slot: ours, gone: ['old-sheet'] })
ok(t.res.repaired === true, 'a missing sheet is fetched again')
t = await run({ slot: ours, gone: ['old-f'], photoError: 'HTTP 500' })
ok(t.res.status === 'failed' && t.log.fetched[0] === true && !t.log.removed.length && !t.log.deletes.length && !('photos' in t.log.updates[0]), 'a failed repair deletes nothing and keeps the photo links')
t = await run({ photoError: 'HTTP 500' })
ok(t.res.status === 'failed' && !t.log.inserts.length, 'a new car without photos is not saved')
t = await run({ slot: { ...ours, brand: 'NISSAN' } })
ok(t.res.status === 'saved' && t.log.deletes.length === 1 && t.log.inserts.length === 1, 'the same lot number showing another car replaces it')
t = await run({ slot: { ...ours, brand: 'NISSAN' }, photoError: 'HTTP 500' })
ok(t.res.status === 'failed' && !t.log.deletes.length, 'it is not replaced when the new photos cannot be fetched')
ok(!isOtherCar(ours, car) && !isOtherCar({ ...ours, model_code: '3BA-AGH40W-PFXSK' }, car) && isOtherCar({ ...ours, model_code: 'GGH30W' }, car) && isOtherCar({ ...ours, mfg_year: 2020 }, car), 'a longer code or a year corrected by one is the same car')
t = await run({ slot: ours, updated: [] })
ok(t.res.status === 'taken', 'the row changed while reading: reported, not saved')
t = await run({ insertError: { code: '23505', message: 'dup' } })
ok(t.res.status === 'taken' && !t.log.removed.length, 'saved by another run meanwhile: its photos are not removed')
ok(slotOwner(full, null) === 'free' && slotOwner(full, ours) === 'ours' && slotOwner(full, { source: 'uss', ex_key: full.ex_key }) === 'taken', 'a row is ours only when it is this ASNET car')

// ── removing the cars no longer listed ──
const saved = Array.from({ length: 20 }, (_, i) => ({ id: i, ex_key: 'k' + i, brand: 'TOYOTA', model: 'ALPHARD' }))
const seenAll = (n) => new Set(saved.slice(0, n).map((c) => c.ex_key))
const prune = async (seen, extra = {}) => { const f = fakeDb({ rows: extra.rows || saved }); const r = await removeGone({ db: f.db, target: { maker_code: '1010', car_code: '10102070' }, seen, write: true, ...extra }); return { r, log: f.log } }
let p = await prune(seenAll(17))
ok(p.r.removed === 3 && p.log.filters.includes('delete id in 3') && p.log.filters.includes('delete source=asnet'), 'cars no longer listed are removed, ASNET rows only')
ok(p.log.filters.includes('select source=asnet') && p.log.filters.includes('select maker_code=1010') && p.log.filters.includes('select car_code=10102070'), 'only that model is looked at')
p = await prune(seenAll(20))
ok(p.r.removed === 0 && !p.log.deletes.length, 'everything still listed: nothing is removed')
p = await prune(seenAll(5))
ok(p.r.blocked && !p.log.deletes.length, 'most of a model disappearing at once is held back')
p = await prune(seenAll(5), { allowMany: true })
ok(p.r.removed === 15, '--remove-many allows it')
p = await prune(new Set(), { rows: saved.slice(0, 3) })
ok(p.r.removed === 3, 'a small model that sold out is cleared')
p = await prune(seenAll(17), { write: false })
ok(p.r.gone.length === 3 && !p.log.deletes.length, 'dry run only counts')

// ── reading every page ──
const pages = (n, size = 2) => Array.from({ length: n }, (_, p) => Array.from({ length: size }, (_, i) => ({ lot_no: `L${p}-${i}` })))
async function read(data, { units = data.flat().length, maxPages = 50, stuck = false, unitsAt = null } = {}) {
  let at = 0
  const page = { evaluate: async () => { const u = unitsAt ? unitsAt(at) : units; return u == null ? 'Searched for TOYOTA' : `${u.toLocaleString('en-US')} units found / Model year` }, waitForTimeout: async () => {} }
  const site = { extractRows: async () => data[at], getPagingInfo: async () => ({ current: at + 1, total: data.length }), goToNextPage: async () => { if (!stuck) at++; return true } }
  return readAllPages({ page, site, maxPages })
}
let r = await read(pages(3))
ok(r.complete && r.rows.length === 6, 'all pages read and the count matches: complete')
r = await read(pages(9, 100), { units: 900 })
ok(r.complete && r.rows.length === 900, 'nine pages of a hundred')
ok(!(await read(pages(3), { maxPages: 1 })).complete, 'a page limit is not complete')
r = await read(pages(3), { stuck: true })
ok(!r.complete && r.rows.length === 2 && /page 2 did not load/.test(r.why), 'a next page that never loads is not complete (no page is read twice)')
ok(!(await read(pages(3), { units: 7 })).complete, 'fewer cars than the site counts is not complete')
ok(!(await read(pages(3), { units: null })).complete, 'no count on the page is not complete')
ok(!(await read(pages(3), { unitsAt: (i) => 6 - i })).complete, 'the list changing while it is read is not complete')

// ── the result page: nothing is read or pressed before it is complete, and a press waits for the new page ──
const { goToNextPage, waitForList } = require('../services/scraper/lib/asnet/page.js')
/** a pretend page that arrives step by step: each step says what the browser would see */
function slowPage({ steps, links = [] }) {
  const log = { order: [], polls: 0 }
  let at = 0
  const see = () => { const s = steps[Math.min(at, steps.length - 1)]; globalThis.document = { readyState: s.ready, title: s.title || '', body: { innerText: s.text || '' }, querySelector: (q) => (q === 'li.next a[data-page]' ? links[0] || null : q.startsWith('tr:has') && s.rows ? {} : null), querySelectorAll: () => links } }
  const page = {
    waitForFunction: async (fn) => { for (let i = 0; i < 50; i++) { see(); const v = fn(); log.polls++; if (v) { log.order.push('ready:' + v + (steps[Math.min(at, steps.length - 1)].ready)); return { jsonValue: async () => v } } at++ } throw new Error('never ready') },
    waitForNavigation: async () => { log.order.push('waiting for the new page') },
    evaluate: async (fn) => { see(); return fn() }, textContent: async () => 'list', waitForTimeout: async () => {}, reload: async () => { log.order.push('reload') },
  }
  return { page, log }
}
let w = slowPage({ steps: [{ ready: 'loading', rows: 16 }, { ready: 'loading', rows: 33 }, { ready: 'complete', rows: 50 }] })
await waitForList(w.page)
ok(w.log.polls === 3 && w.log.order.join() === 'ready:listcomplete', 'rows on a page that is still arriving are not enough: it waits until the page is complete')
w = slowPage({ steps: [{ ready: 'complete', title: 'タイムアウトしました - ASNET', text: 'The search timed out.' }] })
let thrown = null
const quietLog = console.log; console.log = () => {}
try { await waitForList(w.page) } catch (e) { thrown = e } finally { console.log = quietLog }
ok(thrown?.isSearchTimeout && !w.log.order.includes('reload'), 'the "search timed out" page is noticed at once, without reloading it')
const link = (visible, clicked, i, log) => ({ getClientRects: () => (visible ? [1] : []), scrollIntoView: () => {}, click: () => { clicked.push(i); log?.() } })
const clicked = []
const links = []
w = slowPage({ steps: [{ ready: 'complete', rows: 50 }], links })
links.push(link(false, clicked, 0), link(true, clicked, 1, () => w.log.order.push('click')))
let went = await goToNextPage(w.page)
ok(went && clicked.join() === '1' && w.log.order.join() === 'waiting for the new page,click,ready:listcomplete', 'the visible Next link is clicked, after starting to wait for the new page')
w = slowPage({ steps: [{ ready: 'complete', rows: 50 }] })
went = await goToNextPage(w.page)
ok(!went && !w.log.order.length, 'no Next link: there is no next page')

// ── sale type: the search may only run with both auction boxes off ──
const { applyFilters } = require('../services/scraper/lib/asnet/filters.js')
async function search(boxes) {
  const log = { searched: false }
  const doc = { getElementById: (id) => boxes[id] || null, querySelector: (s) => { const id = s.match(/for="(\w+)"/)?.[1]; const b = boxes[id]; return b ? { click: () => { if (!b.stuck) b.checked = !b.checked } } : null } }
  const page = { waitForSelector: async () => {}, selectOption: async () => {}, waitForFunction: async () => {}, waitForTimeout: async () => {},
    evaluate: async (fn, arg) => { globalThis.document = doc; return fn(arg) }, click: async () => { log.searched = true; throw new Error('stop here') } }
  const quiet = console.log; console.log = () => {}
  try { await applyFilters(page, { label: 't', maker_code: '1' }) } catch (e) { log.error = e.message } finally { console.log = quiet }
  return log
}
let b = { checkboxUseAA: { checked: true }, checkboxUseAAOneprice: { checked: true } }
let s = await search(b)
ok(s.searched && !b.checkboxUseAA.checked && !b.checkboxUseAAOneprice.checked, 'AA-Bid and AA-One Price are unticked before the search')
s = await search({ checkboxUseAA: { checked: true, stuck: true }, checkboxUseAAOneprice: { checked: true } })
ok(!s.searched && /AA-Bid is still ticked/.test(s.error), 'a box that stays ticked stops the search')
s = await search({ checkboxUseAA: { checked: false } })
ok(!s.searched && /AA-One Price box not found/.test(s.error), 'a missing box stops the search')

// ── photos: the same car number with another ending ──
const { findPhotos, withoutRepeats } = require('../services/scraper/lib/asnet/photos.js')
const server = (have) => { const asked = []; return { asked, get: async (e) => { asked.push(e); return have.includes(e) ? Buffer.from(e) : null } } }
let srv = server(['o', 'f', 'r', 'z', 'x', 'm', 's16', 's17', 's23', 's41', 's43'])
let got = (await findPhotos(srv.get)).map((x) => x.ending)
ok(got.join() === 'f,r,z,x,m,s16,s17,s23,s41,s43', 'letters then numbers, with gaps, past 40; the sheet is not a photo')
ok(new Set(srv.asked).size === srv.asked.length && !srv.asked.includes('o'), 'no ending is asked for twice')
srv = server(['f', 'sp1', 'sp2', 'sp21'])
got = (await findPhotos(srv.get)).map((x) => x.ending)
ok(got.join() === 'f,sp1,sp2,sp21' && !srv.asked.includes('s21') && !srv.asked.includes('sp61'), 'the sp names are found; a series stops after 20 empty numbers')
let broke = null
try { await findPhotos(async (e) => { if (e === 's5') throw new Error('HTTP 500'); return null }) } catch (e) { broke = e.message }
ok(broke === 'HTTP 500', 'a picture that cannot be checked fails the car instead of being skipped')
const shots = [{ ending: 'f', data: Buffer.from([10, 10, 10]) }, { ending: 'r', data: Buffer.from([90, 90, 90]) }, { ending: 'z', data: Buffer.from([11, 12, 11]) }]
ok((await withoutRepeats(shots, async (b) => b)).map((x) => x.ending).join() === 'f,r', 'the same shot listed twice is kept once')
const again = await run({ slot: { ...ours, photos: ['f', 'r', 'i', 'r'] } })
ok(again.res.repaired === true && again.log.fetched[0] === true && again.log.updates[0].photos[0] === 'new-f', 'a saved car with one picture twice gets its pictures again, keeping the old ones if that fails')

// ── an ASNET car's name is its model and whole trim; its docket needs the whole name and the chassis code ──
const { trimmedName, exactDocket } = await import('../packages/core/src/variant.ts')
const names = [
  [['ALPHARD', 'Z'], 'ALPHARD Z'], [['ALPHARD', 'Z MOONROOF'], 'ALPHARD Z MOONROOF'], [['ALPHARD', 'S ■SR ■JBL'], 'ALPHARD S ■SR ■JBL'],
  [['ALPHARD', null], 'ALPHARD'], [['ALPHARD', 'ALPHARD Z'], 'ALPHARD Z'], [['RX', 'RX350 F SPORT'], 'RX350 F SPORT'], [['CIVIC TYPE R', 'CIVIC TYPE R'], 'CIVIC TYPE R'],
]
for (const [[m, g], want] of names) ok(trimmedName(m, g) === want, `name of ${m} + ${g} = ${want}`)
const dk = (model, id) => ({ id, brand: 'TOYOTA', model, cc: 2493, currency_code: 'JPY', year: 2026 })
const dockets = [dk('ALPHARD Z (3BA-AGH40W)/(3BA-AGH45W)', 'z'), dk('ALPHARD G SIDE LIFT UP TILT SEAT (3BA-AGH40W)', 'g'), dk('ALPHARD S C PACKAGE (3BA-AGH40W)', 'sc')]
const pick = (name, extra = {}) => exactDocket(dockets, { brand: 'TOYOTA', model: name, model_code: '3BA-AGH40W', engine_cc: 2500, transmission: 'AT', ...extra })
ok(pick('ALPHARD Z').docket?.id === 'z' && pick('ALPHARD Z', { model_code: 'AGH40W' }).docket?.id === 'z', 'the whole name and the chassis code match: picked')
for (const n of ['ALPHARD Z MOONROOF', 'ALPHARD Z SUNROOF', 'ALPHARD G', 'ALPHARD', 'ALPHARD Z■SR', 'ALPHARD Zプレミア', 'ALPHARD EXECUTIVE LOUNGE']) {
  const r = pick(n)
  ok(!r.docket && r.candidates.length === 3, `"${n}" is not guessed: a person picks`)
}
ok(pick('ALPHARD S_C PACKAGE').docket?.id === 'sc', 'only spacing differs (S_C PACKAGE / S C PACKAGE): the same name')
ok(!pick('ALPHARD Z', { model_code: '3BA-GGH30W' }).docket, 'the same name with another chassis code: not picked')
ok(!exactDocket([...dockets, dk('ALPHARD Z (3BA-AGH40W)', 'z2')], { brand: 'TOYOTA', model: 'ALPHARD Z', model_code: '3BA-AGH40W', engine_cc: 2500 }).docket, 'two dockets with the same name: a person picks')
const { decideLot } = require('../services/scraper/lib/lotdecision.js')
const core = await import('../packages/core/src/index.ts')
let asked = 0
const decide = (model) => decideLot({ lot: { brand: 'TOYOTA', model, engine_cc: 2500, transmission: 'AT', exact_only: true }, code: '3BA-AGH40W', ref: { duty: core, dockets }, ask: async () => { asked++; return { data: {} } } })
const hit = await decide('ALPHARD Z'), miss = await decide('ALPHARD Z MOONROOF')
ok(hit.decision.status === 'trusted' && hit.decision.docket.id === 'z' && miss.decision.status === 'review' && !miss.decision.docket && !asked, 'an ASNET car: exact = used, anything else = review, and Claude is not asked to pick')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

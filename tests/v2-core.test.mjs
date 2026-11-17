// The new v2 core: docket decision (rule + AI compared), AI pick with a fake Claude, feature search, market stats and margin.   node tests/v2-core.test.mjs
import { decideDocket, confirmKey, aiPickDocket, docketPool, guessDocket, normalizeFeatures, textFeatures, searchByFeatures, marketStats, percentileRank, confidence, margin, maxLandedFor, conservativeSell } from '../packages/core/src/index.ts'

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

const mk = (id, model, cc = 2000) => ({ id, brand: 'TOYOTA', model, cc, currency_code: 'JPY', year: 2026, amt_12m_24m: 4e6, amt_24m_36m: 3.5e6, amt_36m_48m: 3e6, amt_48m_60m: 2.5e6, amt_60m_plus: 2e6 })
const hz = mk('hz', 'HARRIER Z (6BA-MXUA80)'), hzl = mk('hzl', 'HARRIER Z LEATHER PACKAGE (6BA-MXUA80)'), hg = mk('hg', 'HARRIER G (6BA-MXUA80)')

// ── decideDocket ──
ok(decideDocket({ rule: hz, ai: { docket: hz, confidence: 'high' } }).status === 'trusted', 'rule and AI agree: trusted, docket used')
ok(decideDocket({ rule: hz, ai: { docket: hz, confidence: 'medium' } }).docket?.id === 'hz', 'agree with medium AI confidence is still used')
let d = decideDocket({ rule: hz, ai: { docket: hzl, confidence: 'high' } })
ok(d.status === 'review' && d.docket === null && d.suggestions.length === 2, 'different picks: review, NO docket used, both suggestions shown')
d = decideDocket({ rule: hz, ai: { docket: null, confidence: 'low', reason: 'cannot separate' } })
ok(d.status === 'review' && d.docket === null && /AI says none/.test(d.reason), 'rule picks, AI says none: review')
d = decideDocket({ rule: null, ai: { docket: hz, confidence: 'high' } })
ok(d.status === 'review' && d.docket === null && /only the AI/.test(d.reason), 'only the AI picks: never used on its own, review')
ok(decideDocket({ rule: null, ai: { docket: null, confidence: 'low' } }).status === 'none', 'neither picks: none')
d = decideDocket({ rule: hz, ai: null })
ok(d.status === 'review' && d.docket === null, 'AI did not run: the rule pick alone is held for a person')
ok(decideDocket({ rule: null, ai: null }).status === 'none', 'AI did not run and no rule pick: none')
d = decideDocket({ confirmed: hzl, rule: hz, ai: { docket: hz, confidence: 'high' } })
ok(d.status === 'confirmed' && d.docket.id === 'hzl', 'a confirmed docket beats the rule and the AI')

// ── confirmKey ──
const car = { brand: 'TOYOTA', model_code: '6BA-MXUA80', engine_cc: 1987, model: 'Harrier  Z', seats: 5, transmission: 'AT' }
ok(confirmKey(car) === confirmKey({ ...car, model: 'HARRIER Z', model_code: 'MXUA80' }), 'same car: prefix and spacing do not change the key')
ok(confirmKey(car) !== confirmKey({ ...car, seats: 7 }), '5 seats and 7 seats are different keys')
ok(confirmKey(car) !== confirmKey({ ...car, transmission: 'MT' }), 'AT and MT are different keys')
ok(confirmKey(car) !== confirmKey({ ...car, model: 'HARRIER Z LEATHER PACKAGE' }), 'a different trim is a different key')

// ── AI pick with a fake Claude ──
const fake = (answer) => async () => ({ data: answer, usage: { input: 300, output: 80 } })
let r = await aiPickDocket({ lot: { brand: 'TOYOTA', model: 'HARRIER Z' }, pool: [hz, hzl], ask: fake({ choice: 1, confidence: 'high', deciding_words: 'HARRIER Z', reason: 'plain Z' }) })
ok(r.docket?.id === 'hz' && r.confidence === 'high', 'AI answers a number from the list: that docket')
r = await aiPickDocket({ lot: { brand: 'TOYOTA', model: 'HARRIER Z' }, pool: [hz, hzl], ask: fake({ choice: 9, confidence: 'high', deciding_words: '', reason: '' }) })
ok(r.docket === null, 'a number that is not in the list is never used (cannot invent a docket)')
r = await aiPickDocket({ lot: { brand: 'TOYOTA', model: 'HARRIER Z' }, pool: [hz, hzl], ask: fake({ choice: null, confidence: 'low', deciding_words: '', reason: 'tie' }) })
ok(r.docket === null, 'AI answers null: no docket')
let called = false
r = await aiPickDocket({ lot: { brand: 'TOYOTA', model: 'X' }, pool: [], ask: async () => { called = true } })
ok(!called && r.docket === null, 'an empty candidate list costs no AI call')

// ── docketPool + guessDocket still work from the core ──
const lot = { brand: 'TOYOTA', model: 'HARRIER Z', model_code: '6BA-MXUA80', engine_cc: 1986 }
ok(docketPool([hz, hzl, hg], lot).pool.length === 3, 'pool = every docket with the right brand, code and engine')
ok(guessDocket([hz, hzl, hg], lot).docket?.id === 'hz', 'the rule picks the plain Harrier Z')

// ── features ──
const f = normalizeFeatures([
  { name: 'JBL 14 speaker audio', source: 'factory', evidence: 'JBL 14SP' },
  { name: 'TRD GR aero kit', source: 'aftermarket', evidence: 'TRD GRエアロ' },
  { name: 'tinted rear glass', source: 'unknown', evidence: 'smoke film' },
])
ok(f.some((x) => x.key === 'jbl' && x.source === 'factory'), 'JBL audio is the catalog key jbl, factory')
ok(f.some((x) => x.key === 'gr_kit' && x.source === 'aftermarket'), 'GR aero kit is gr_kit and marked aftermarket')
ok(f.some((x) => x.key.startsWith('x:')), 'a feature the catalog does not know is kept as a free tag')
ok(textFeatures('サンルーフ 本革 JBL').sort().join() === 'jbl,leather,sunroof', 'free text fallback finds Japanese words')
ok(!textFeatures('GR SPORT grade').includes('gr_kit') && textFeatures('GR SPORT grade').includes('gr_sport'), 'GR SPORT grade is not a GR body kit')
const cars = [
  { id: 1, features: normalizeFeatures([{ name: 'JBL audio', source: 'factory' }, { name: 'GR aero kit', source: 'aftermarket' }, { name: 'sunroof', source: 'factory' }]) },
  { id: 2, features: normalizeFeatures([{ name: 'JBL audio', source: 'factory' }]) },
  { id: 3, features: normalizeFeatures([{ name: 'GR aero kit', source: 'aftermarket' }]) },
]
ok(searchByFeatures(cars, ['jbl', 'gr_kit']).map((c) => c.id).join() === '1', 'JBL + GR kit finds only the car that has both')
ok(searchByFeatures(cars, ['gr_kit'], { sources: ['factory'] }).length === 0, 'GR kit as a factory option: none (it is aftermarket)')
ok(searchByFeatures(cars, ['jbl']).map((c) => c.id).join() === '1,2', 'ranked by number of features')

// ── market stats and margin ──
const prices = [176, 181, 186, 189, 192, 195, 196, 198, 201, 203, 204, 206, 208, 209, 212, 215, 221, 228].map((v) => v * 1000)
const s = marketStats(prices)
ok(s.n === 18 && s.min === 176000 && s.max === 228000, 'stats: count, min, max')
ok(Math.abs(s.median - 202000) < 1, 'stats: median of 18 prices = 202,000')
ok(percentileRank(prices, 168400) === 0 && percentileRank(prices, 300000) === 100, 'percentile: below all = 0, above all = 100')
ok(confidence(s) === 'high' || confidence(s) === 'medium', 'confidence: 18 listings is not "none" or "low"')
ok(confidence(marketStats(prices.slice(0, 2))) === 'none', 'confidence: 2 listings = none, no range shown')
ok(confidence(marketStats(prices.slice(0, 4))) === 'low', 'confidence: 4 listings = low')
ok(marketStats([]) === null && conservativeSell(null) === null, 'no prices: no stats, no sell price')
const m = margin({ landedMyr: 168400, sellMyr: 203800, reconMyr: 4200 })
ok(m.profitMyr === 31200 && m.marginPct === 18.1, 'margin: RM 31,200 on RM 172,600 cost = 18.1% (on cost)')
const maxL = maxLandedFor({ sellMyr: 203800, targetPct: 12, reconMyr: 4200 })
ok(maxL === Math.round(203800 / 1.12 - 4200), 'reverse: highest landed cost for a 12% margin')
ok(Math.abs(margin({ landedMyr: maxL, sellMyr: 203800, reconMyr: 4200 }).marginPct - 12) < 0.1, 'reverse then forward gives the same 12%')
ok(conservativeSell(s) <= Math.round(s.median) && conservativeSell(s) > 0, 'conservative sell price is never above the median')

// ── dutyCostRow: the same duty as calcDuty ──
const { dutyCostRow, calcDuty } = await import('../packages/core/src/index.ts')
const dk = { id: 'x', brand: 'TOYOTA', model: 'ALPHARD (3BA-AGH40W)', cc: 2493, currency_code: 'JPY', year: 2026, amt_12m_24m: 5e6, amt_24m_36m: 4.5e6, amt_36m_48m: 4e6, amt_48m_60m: 3.5e6, amt_60m_plus: 3e6 }
const cref = { rates: [{ vehicle_type: 'car', cc_min: 2001, cc_max: 2500, multiplier: 1.717 }], currencies: [{ code: 'JPY', standard_fare_myr: 1200 }], fx: { JPY: { rate: 0.0295 } } }
const today = new Date('2026-11-17')
const cr = dutyCostRow({ docket: dk, regYear: 2021, regMonth: 5, ref: cref, today })
const direct = calcDuty({ docket: dk, mfgYear: 2021, mfgMonth: 5, rate: 0.0295, rates: cref.rates, standardFare: 1200, vehicleType: 'car', today })
ok(cr.cost && cr.cost.duty_myr === direct.dutyMyr && cr.cost.docket_id === 'x', 'dutyCostRow gives the same duty as calcDuty')
ok(dutyCostRow({ docket: dk, regYear: 2021, regMonth: 5, ref: { ...cref, fx: {} }, today }).cost === null, 'no exchange rate: no cost row, with a reason')
ok(dutyCostRow({ docket: dk, regYear: null, regMonth: null, ref: cref, today }).cost === null, 'no register year: no cost row')

// ── market snapshot: privacy and lookup ──
const { buildMarketRows, lookupMarket, modelKey } = await import('../packages/core/src/index.ts')
const raw = (seller, year, price, model = 'Vellfire') => ({ brand: 'Toyota', model, year, price, km: 30000, seller })
const rows = buildMarketRows([raw('A', 2020, 190000), raw('B', 2020, 200000), raw('C', 2021, 210000), raw('A', 2019, 185000), raw('B', 2021, 205000)], '2026-11-17')
ok(rows.length > 0 && rows.every((r) => r.n >= 3), 'snapshot: every row has at least 3 listings')
const r2020 = rows.find((r) => r.year_from === 2019 && r.year_to === 2021)
ok(r2020 && r2020.n === 5 && r2020.min_myr === 185000 && r2020.max_myr === 210000 && r2020.as_of === '2026-11-17', 'snapshot: window year-1..year+1 around 2020 holds all 5 listings')
ok(buildMarketRows([raw('A', 2020, 190000), raw('A', 2020, 195000), raw('A', 2020, 200000), raw('A', 2020, 205000)], '2026-11-17').length === 0, 'snapshot: 4 listings from ONE seller make no row (one dealer cannot be read back)')
ok(buildMarketRows([raw('A', 2020, 190000), raw('B', 2020, 195000)], '2026-11-17').length === 0, 'snapshot: 2 listings make no row')
ok(!JSON.stringify(rows).includes('"A"') && !('seller' in rows[0]), 'snapshot: no seller id in the output')
ok(buildMarketRows([raw('A', 2020, 0), raw('B', 2020, -5), raw('C', 2020, 190000)], '2026-11-17').length === 0, 'snapshot: zero or negative prices are ignored')
ok(modelKey('C-Class') === 'CCLASS' && modelKey('Vellfire') === 'VELLFIRE', 'modelKey: letters and digits only')
ok(lookupMarket(rows, { brand: 'TOYOTA', model: 'VELLFIRE 2.5 Z GOLDEN EYES', year: 2020 })?.n === 5, 'lookup: a Japanese lot finds its market row (brand, model start, year)')
ok(lookupMarket(rows, { brand: 'TOYOTA', model: 'VELLFIRE 2.5 Z', year: 2015 }) === null, 'lookup: no row for a year with no listings')
ok(lookupMarket(rows, { brand: 'HONDA', model: 'VELLFIRE', year: 2020 }) === null, 'lookup: another brand finds nothing')
const two = [...rows, { ...r2020, model_key: 'VELLFIREHYBRID', median_myr: 1 }]
ok(lookupMarket(two, { brand: 'TOYOTA', model: 'VELLFIRE HYBRID ZR', year: 2020 })?.model_key === 'VELLFIREHYBRID', 'lookup: the longest matching model key wins')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

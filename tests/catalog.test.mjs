// Catalog ids: a Japan lot is linked to the CarzNexus catalog by chassis code + grade words; listings become id-based market rows.   node tests/catalog.test.mjs
import { linkLot, tokens, buildIdMarketRows, lookupMarketById, mergeManualRows } from '../packages/core/src/index.ts'

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

const cv = (variant_id, variant, code = 'AGH30W') => ({ brand_id: 'b1', model_id: 'm1', model_code: code, variant_id, variant })
const cat = [cv('v1', '2.5S'), cv('v2', '2.5S C Package'), cv('v3', '2.5S Type Gold'), cv('v4', '2.5S Type Gold II'), cv('v5', '2.5S Type Gold III'), cv('v6', '2.5X')]
const al = [{ variant_id: 'v5', name: '2.5S Type Gold 3' }]

ok(tokens('2.5S Type Gold Ⅲ').join(' ') === '2 5 S TYPE GOLD III', 'tokens: letters and digits split, Roman numeral read')
ok(linkLot(cat, al, { model_code: '3BA-AGH30W', model: 'ALPHARD 2.5S TYPE GOLD II' }).variantId === 'v4', 'link: chassis code + grade words -> the exact variant (Gold II, not Gold)')
ok(linkLot(cat, al, { model_code: 'AGH30W', model: 'ALPHARD 2.5S C PACKAGE' }).variantId === 'v2', 'link: the longest grade name wins over the shorter 2.5S')
ok(linkLot(cat, al, { model_code: 'AGH30W', model: 'ALPHARD 2.5S TYPE GOLD 3' }).variantId === 'v5', 'link: an alternate spelling from the lookup table finds the variant')
ok(linkLot(cat, al, { model_code: 'AGH30W', model: 'ALPHARD 2.5SC' }).level === 'model', 'link: 2.5SC is not 2.5S (model level only)')
ok(linkLot(cat, al, { model_code: 'AGH30W', model: 'ALPHARD EXECUTIVE LOUNGE' }).level === 'model', 'link: grade not in the catalog -> model level, no guess')
ok(linkLot(cat, al, { model_code: 'ZZZ99', model: 'X' }).level === 'none' && linkLot(cat, al, { model: 'ALPHARD' }).level === 'none', 'link: unknown or missing chassis code -> none')

const L = (price, year, seller, variantId, modelId = 'm1') => ({ price, year, seller, variantId, modelId, brandId: 'b1' })
const rows = buildIdMarketRows([L(200000, 2022, 'A', 'v1'), L(210000, 2022, 'B', 'v1'), L(300000, 2022, 'A', 'v6'), L(180000, 2022, 'A', null), { price: 1e5, year: 2022, seller: 'A' }], '2026-11-17')
const v1 = rows.find((r) => r.level === 'variant' && r.ref_id === 'v1')
ok(v1?.n === 2 && v1.sellers === 2, 'ids: a variant row counts its own listings and dealers (no minimum)')
ok(rows.find((r) => r.level === 'model' && r.year_from === 2021)?.n === 4, 'ids: the model row counts all linked listings of the model; an unlinked listing counts nowhere')
ok(lookupMarketById(rows, { variantId: 'v1', modelId: 'm1', year: 2022 })?.wider === false && lookupMarketById(rows, { variantId: 'v9', modelId: 'm1', year: 2022 })?.wider === true, 'lookup by ids: variant row first, else the model row marked wider')
ok(lookupMarketById(rows, { variantId: null, modelId: null, year: 2022 }) === null && lookupMarketById(rows, { variantId: 'v1', year: 2030 }) === null, 'lookup by ids: not linked, or no listings that year = no price')

// sister cars share a chassis code: the lot's model name decides
const sis = [{ brand_id: 'b1', model_id: 'mA', model: 'Alphard', model_code: 'AGH30W', variant_id: 'a1', variant: '2.5S' }, { brand_id: 'b1', model_id: 'mV', model: 'Vellfire', model_code: 'AGH30W', variant_id: 'v1', variant: '2.5Z' }]
ok(linkLot(sis, [], { model_code: 'AGH30W', model: 'VELLFIRE 2.5Z G EDITION' }).modelId === 'mV', 'sister cars: the model name picks Vellfire out of a shared chassis code')
ok(linkLot(sis, [], { model_code: 'AGH30W', model: 'WELCAB 2.5' }).level === 'none', 'sister cars: a name that fits neither model -> none, no guess')

// an alternate spelling that points at two variants: the variant's own name wins
const cat2 = [{ brand_id: 'b', model_id: 'm', model: 'Harrier', model_code: 'MXUA80', variant_id: 'z', variant: 'Z' }, { brand_id: 'b', model_id: 'm', model: 'Harrier', model_code: 'MXUA80', variant_id: 'zl', variant: 'Z LEATHER PACKAGE' }]
const al2 = [{ variant_id: 'zl', name: 'Z' }]
ok(linkLot(cat2, al2, { model_code: '6BA-MXUA80', model: 'HARRIER Z' }).variantId === 'z', 'link: the variant own name Z beats the alternate spelling Z of another variant')
ok(linkLot(cat2, al2, { model_code: '6BA-MXUA80', model: 'HARRIER Z LEATHER PACKAGE' }).variantId === 'zl', 'link: the longer own name still wins')

// hand-entered prices override the snapshot for the same car and year
const snap = buildIdMarketRows([L(200000, 2022, 'A', 'v1'), L(210000, 2022, 'B', 'v1'), L(205000, 2022, 'C', 'v1')], '2026-11-17')
const mrow = (year, median, asOf) => ({ level: 'variant', ref_id: 'v1', brand_id: 'b1', model_id: 'm1', variant_id: 'v1', brand: 'T', model_key: 'M', variant_name: 'V', year_from: year - 1, year_to: year + 1, n: 5, sellers: 1, min_myr: 1, p25_myr: 1, median_myr: median, p75_myr: 2, max_myr: 2, avg_km: null, as_of: asOf, source: 'manual' })
const merged = mergeManualRows(snap, [mrow(2022, 250000, '2026-11-01'), mrow(2022, 260000, '2026-11-10'), mrow(2023, 270000, '2026-11-10')])
ok(lookupMarketById(merged, { variantId: 'v1', year: 2022 }).row.median_myr === 260000, 'manual: the newest hand-checked price replaces the snapshot row for the same car and year')
ok(lookupMarketById(merged, { variantId: 'v1', year: 2023 }).row.source === 'manual' && merged.filter((r) => r.level === 'variant' && r.year_from === 2021).length === 1, 'manual: a year with no snapshot row still gets the hand-checked price; no duplicate rows')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

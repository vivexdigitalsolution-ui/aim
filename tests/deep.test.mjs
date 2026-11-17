// Deep search pricing (margin on the import price / CIF, internal and customer copy):   node tests/deep.test.mjs
import { deepPricing, MAX_OPTION_UNITS } from '../packages/core/src/deepPricing.ts'

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

const base = { historyJpy: 4_000_000, rate: 0.0272, dutyMyr: 50_000, portMyr: 2500, inlandMyr: 250, apFeeMyr: 10500, marginPct: 5, marginMode: 'import_price' }
const p = deepPricing(base)
// body 4,000,000 x 0.0272 = 108,800 ; agent 250,000 x 0.0272 = 6,800 ; fees 13,250 ; import = 108,800 + 6,800 + 50,000 + 13,250
ok(p.bodyMyr === 108800 && p.agentMyr === 6800 && p.importMyr === 178850, 'import price = body + agent + duty + fees (' + p.importMyr + ')')
ok(p.marginMyr === Math.round(178850 * 0.05) && p.marginMyr === 8943, 'margin 5% on the import price = RM 8,943 (rounded)')
ok(p.sellingMyr === 178850 + 8943, 'selling price = import price + margin')
ok(p.marginOfSellingPct === Math.round(8943 / 187793 * 1000) / 10, 'margin as a % of the selling price (' + p.marginOfSellingPct + '%)')

// the customer copy: the margin is inside the body price, the lines add up to the selling price
ok(p.custBodyMyr === 108800 + 8943, 'customer body price = body + margin')
const lines = p.custBodyMyr + p.agentMyr + 50000 + 2500 + 250 + 10500
ok(lines === p.sellingMyr, 'customer lines (body incl. margin + agent + duty + fees) add up to the selling price exactly')
ok(Math.abs(p.custBodyJpy * 0.0272 - p.custBodyMyr) < 0.0272, 'the yen shown beside the customer body price matches it')

// margin on CIF = body + agent fee & shipping
const c = deepPricing({ ...base, marginMode: 'cif' })
ok(c.marginMyr === Math.round((108800 + 6800) * 0.05) && c.marginMyr === 5780, 'margin 5% on CIF (body + agent) = RM 5,780')
ok(c.sellingMyr === 178850 + 5780, 'CIF mode: selling = import + margin')

// 0 %, negative or missing margin = no margin
ok(deepPricing({ ...base, marginPct: 0 }).marginMyr === 0 && deepPricing({ ...base, marginPct: -3 }).marginMyr === 0 && deepPricing({ ...base, marginPct: NaN }).marginMyr === 0, 'margin 0 / negative / empty = RM 0')
ok(deepPricing({ ...base, marginPct: 0 }).sellingMyr === p.importMyr, 'no margin: selling price = import price')

// no duty (no docket yet) or no price: nothing is invented
const nd = deepPricing({ ...base, dutyMyr: null })
ok(nd.importMyr === null && nd.marginMyr === null && nd.sellingMyr === null && nd.custBodyMyr === null, 'no duty yet: no import price, no margin, no selling price')
const np = deepPricing({ ...base, historyJpy: null })
ok(np.bodyMyr === null && np.sellingMyr === null, 'no body price: nothing is worked out')
ok(deepPricing({ ...base, rate: 0 }).sellingMyr === null, 'no exchange rate: nothing is worked out')

// big car: the agent fee is 5% from 16,000,000 yen
const big = deepPricing({ ...base, historyJpy: 18_000_000 })
ok(big.agentJpy === 900_000, 'agent fee follows the CIF table (5% at 18,000,000 yen)')
ok(MAX_OPTION_UNITS === 6, 'an option has at most 6 units')

// model codes and Customs lines of a model
const { sameCode, codeCore, codeOfDocket, sameLine, codesForModel } = await import('../packages/core/src/docketLines.ts')
ok(sameCode('3BA-AGH40W', 'AGH40W') && sameCode('JL', 'JL') === false && !sameCode('AGH30W', 'AGH40W') && !sameCode(null, 'AGH40W'), 'model codes match without the emission prefix; codes shorter than 3 characters never match')
ok(codeCore('6AA-ZWR90W') === 'ZWR90W' && codeOfDocket('ALPHARD (3BA-AGH40W)') === '3BA-AGH40W' && codeOfDocket('NO CODE') === '', 'the code is read from the brackets of a Customs line')
const dk = [
  { brand: 'JEEP', model: 'WRANGLER UNLIMITED RUBICON (3BA-JL36L)' }, { brand: 'JEEP', model: 'WRANGLER SAHARA (3BA-JL20L)' }, { brand: 'JEEP', model: 'RENEGADE (3BA-BV13)' },
  { brand: 'MERCEDES BENZ', model: 'AMG GLA35 4MATIC (4BA-247751M)' }, { brand: 'MERCEDES BENZ', model: 'GLA 200D (3DA-247612M)' },
]
ok(sameLine(dk[0], { brand_name: 'CHRYSLER JEEP', model_name: 'WRANGLER' }) && !sameLine(dk[2], { brand_name: 'CHRYSLER JEEP', model_name: 'WRANGLER' }), 'a Jeep Wrangler line belongs to CHRYSLER JEEP WRANGLER, a Renegade does not')
ok(sameLine(dk[3], { brand_name: 'MERCEDES AMG', model_name: 'GLA-CLASS' }), 'an "AMG GLA35" line belongs to MERCEDES AMG GLA-CLASS')
const codes = codesForModel([{ maker_code: 'M1', car_code: 'W1', code: 'JL36L' }, { maker_code: 'M1', car_code: 'W9', code: 'XX99' }], dk, { maker_code: 'M1', car_code: 'W1', brand_name: 'CHRYSLER JEEP', model_name: 'WRANGLER' })
ok(codes.join(',') === '3BA-JL20L,JL36L', 'the codes of a model: the site list, plus a code only the price guide has (' + codes.join(',') + ')')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exitCode = fails ? 1 : 0

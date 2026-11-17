// Checks the import cost maths against hand-worked numbers.   node tests/duty.test.mjs   (Node 22+ runs the .ts file directly)
import { historyPrice, gradeParts } from '../packages/core/src/historyPrice.ts'
import { offerPricing } from '../packages/core/src/offerPricing.ts'
import { marketKey, findMarketPrice } from '../packages/core/src/market.ts'
import { guessDocket, docketBrand, docketTransmission, trimMatches, ageMonths, ageBand, calcDuty, calcDutyAt, calcCost, matangFrom, maxBodyPrice, matchDockets, dutyRateFor, dutyMonth } from '../packages/core/src/duty.ts'

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const near = (a, b) => Math.abs(a - b) < 0.011

const rates = [
  { vehicle_type: 'car', cc_min: null, cc_max: 1800, multiplier: 1.5025 },
  { vehicle_type: 'car', cc_min: 1800, cc_max: 2000, multiplier: 1.574 },
  { vehicle_type: 'car', cc_min: 2001, cc_max: 2500, multiplier: 1.717 },
  { vehicle_type: 'car', cc_min: 2501, cc_max: 3000, multiplier: 1.9315 },
  { vehicle_type: 'car', cc_min: 3001, cc_max: null, multiplier: 1.9315 },
]
const d86 = { id: 'a', brand: 'TOYOTA', model: '86 G (4BA-ZN6)', cc: 1998, currency_code: 'JPY', amt_12m_24m: 863288, amt_24m_36m: 800000, amt_36m_48m: 700000, amt_48m_60m: 600000, amt_60m_plus: 398441 }
const dAlph = { id: 'b', brand: 'TOYOTA', model: 'ALPHARD (3BA-AGH40W)', cc: 2493, currency_code: 'JPY', amt_12m_24m: 5000000, amt_24m_36m: 4500000, amt_36m_48m: 4000000, amt_48m_60m: 3500000, amt_60m_plus: 3000000 }
const dAlph2 = { id: 'c', brand: 'TOYOTA', model: 'ALPHARD HYBRID (6AA-AYH30W)', cc: 2493, currency_code: 'JPY', amt_12m_24m: 5200000, amt_24m_36m: 4700000, amt_36m_48m: 4200000, amt_48m_60m: 3700000, amt_60m_plus: 3200000 }
const today = new Date(2026, 10, 5)   // 5 Nov 2026

ok(ageMonths(2025, 7, null, today) === 16, 'age: 2025/07 seen in 2026/11 is 16 months')
ok(ageBand(11).under12 && ageBand(12).field === 'amt_12m_24m' && ageBand(24).field === 'amt_24m_36m' && ageBand(60).field === 'amt_60m_plus', 'age bands')
ok(dutyRateFor(rates, 1998, 'car').multiplier === 1.574 && dutyRateFor(rates, 1500, 'car').multiplier === 1.5025, 'duty rate by cc')

const r = calcDuty({ docket: d86, mfgYear: 2025, mfgMonth: 7, rate: 0.0272, rates, today })
ok(r.band === '12m-24m' && near(r.docketAmountMyr, 23481.43), 'docket amount in MYR (' + r.docketAmountMyr + ')')
ok(near(r.customsValueMyr, 25033.65), 'customs value = amount x 1.015 + 1200 (' + r.customsValueMyr + ')')
ok(near(r.dutyMyr, 39402.97), 'duty = customs value x 1.574 (' + r.dutyMyr + ')')

const m = matangFrom(2025, 7, today)
ok(m.year === 2027 && m.month === 8, 'matang date for 2025/07 seen in 2026/11 is 2027/08 (' + m.year + '/' + m.month + ')')
const later = calcDutyAt({ docket: d86, mfgYear: 2025, mfgMonth: 7, rate: 0.0272, rates }, m)
ok(later.band === '24m-36m' && later.dutyMyr < r.dutyMyr, 'duty after matang uses the next band and is lower (' + later.dutyMyr + ')')

const c = calcCost({ duty: r, rate: 0.0272, price: 1000000, freight: 100000, marginPct: 3, marginMode: 'cif', apFeeMyr: 500, portClearanceMyr: 300, carrierFeeMyr: 200 })
ok(near(c.cifMyr, (1000000 + 100000 + 33000) * 0.0272), 'CIF includes 3% margin on price + freight (' + c.cifMyr + ')')
ok(near(c.importPriceMyr, c.cifMyr + r.dutyMyr + 1000), 'import price = CIF + duty + fees (' + c.importPriceMyr + ')')
const back = maxBodyPrice(c.importPriceMyr, r, 0.0272, 100000, 1000, 3, 'cif')
ok(Math.abs(back - 1000000) < 5, 'reverse mode gives the price back (' + back + ')')

const lot = { brand: 'TOYOTA', model: 'ALPHARD', model_code: 'AGH40W', engine_cc: 2493 }
const found = matchDockets([d86, dAlph, dAlph2], lot)
ok(found.list[0].docket.id === 'b', 'code AGH40W + 2493 cc picks the Alphard petrol docket')
ok(found.exact, 'a clear code + cc + name match is exact (no AI needed)')
const none = matchDockets([d86, dAlph, dAlph2], { brand: 'TOYOTA', model: 'VELLFIRE', model_code: null, engine_cc: 2493 })
ok(!none.exact, 'a car with no code and no name match is not exact (goes to AI / staff)')

const dl = [{ ...dAlph, year: 2026 }, { ...dAlph2, year: 2026 }, { ...d86, year: 2026 }, { ...dAlph, id: 'old', year: 2025 }]
const g1 = guessDocket(dl, { brand: 'TOYOTA', model: 'ALPHARD', model_code: '3BA-AGH40W', engine_cc: 2493 })
ok(g1.docket?.id === 'b', 'guess: code without prefix finds the latest-edition docket only (' + g1.reason + ')')
ok(guessDocket(dl, { brand: 'TOYOTA', model: '86 G', model_code: null, engine_cc: 1998 }).docket === null, 'guess: no code, no guess')
ok(guessDocket(dl, { brand: 'TOYOTA', model_code: '3BA-AGH40W', engine_cc: 2493 }).docket === null, 'guess: no model name, no guess (the trim cannot be checked)')
const dHi = { ...dAlph, id: 'hi', model: 'ALPHARD Z (3BA-AGH40W)', year: 2026, amt_12m_24m: 9000000, amt_24m_36m: 8000000, amt_36m_48m: 7000000, amt_48m_60m: 6000000, amt_60m_plus: 5000000 }
const gz = guessDocket([{ ...dAlph, year: 2026 }, dHi], { brand: 'TOYOTA', model: 'ALPHARD', model_code: 'AGH40W', engine_cc: 2493 })
ok(gz.docket?.id === 'b', 'strict: a plain ALPHARD gets the plain docket, not the longer ALPHARD Z one (' + gz.docket?.id + ')')
const gz2 = guessDocket([{ ...dAlph, year: 2026 }, dHi], { brand: 'TOYOTA', model: 'ALPHARD Z', model_code: 'AGH40W', engine_cc: 2493 })
ok(gz2.docket?.id === 'hi', 'strict: ALPHARD Z gets the Z docket (the plain docket lacks the word Z) (' + gz2.docket?.id + ')')

// the trim rule (decided 6 Nov 2026): code match is not enough, the trim name must match too, else NO docket
const audi = [{ id: 'sl', brand: 'AUDI', model: 'TT COUPE S-LINE COMPETITION PLUS (3BA-FVDNPF)', cc: 1984, year: 2026, amt_12m_24m: 2468733 }, { id: 'q', brand: 'AUDI', model: 'TT COUPE 45 TFSI QUATTRO (3BA-FVDNPF)', cc: 1984, year: 2026, amt_12m_24m: 2046071 }]
ok(guessDocket(audi, { brand: 'AUDI', model: 'TT COUPE FINAL EDITION', model_code: 'FVDNPF', engine_cc: 2000 }).docket === null, 'trim: Audi TT FINAL EDITION has no docket (neither candidate has that name)')
ok(guessDocket(audi, { brand: 'AUDI', model: 'TT COUPE 45 TFSI QUATTRO', model_code: 'FVDNPF', engine_cc: 2000 }).docket?.id === 'q', 'trim: the same car with the right name gets its docket')
const jag = [{ id: 'hse', brand: 'JAGUAR', model: 'XF R-DYNAMIC HSE P250 (3BA-JB2XD)', cc: 1995, year: 2026, amt_12m_24m: 2603217 }]
ok(guessDocket(jag, { brand: 'JAGUAR', model: 'XF R-DYNAMIC BLACK P250', model_code: 'JB2XD', engine_cc: 2000 }).docket === null, 'trim: Jaguar XF R-DYNAMIC BLACK does not get the HSE docket')
ok(guessDocket(jag, { brand: 'JAGUAR', model: 'XF R-DYNAMIC HSE P250', model_code: 'JB2XD', engine_cc: 2000 }).docket?.id === 'hse', 'trim: the exact trim gets the docket')
ok(trimMatches('GLA 200D 4MATIC AMG LINE (3DA-247713M)', 'GLA-CLASS GLA200D 4MATIC AMG LINE'), 'trim: GLA-CLASS GLA200D fits GLA 200D (CLASS ignored, 200D joined)')
ok(trimMatches('GTR BLACK EDITION (4BA-R35)', 'GT-R BLACK EDITION'), 'trim: the listing GT-R fits the docket GTR')
ok(!trimMatches('GTR PREMIUM EDITION (4BA-R35)', 'GT-R BLACK EDITION'), 'trim: GT-R BLACK EDITION does not fit GTR PREMIUM EDITION')
{
  const gtr = [
    { id: 'black', brand: 'NISSAN', model: 'GTR BLACK EDITION (4BA-R35)', cc: 3799, year: 2026, currency_code: 'JPY', amt_12m_24m: 4089612, amt_24m_36m: 3460441, amt_36m_48m: 3000000, amt_48m_60m: 2500000, amt_60m_plus: 1887513 },
    { id: 'prem', brand: 'NISSAN', model: 'GTR PREMIUM EDITION (4BA-R35)', cc: 3799, year: 2026, currency_code: 'JPY', amt_12m_24m: 3948020, amt_24m_36m: 3340632, amt_36m_48m: 2900000, amt_48m_60m: 2400000, amt_60m_plus: 1822163 },
  ]
  ok(guessDocket(gtr, { brand: 'NISSAN', model: 'GT-R BLACK EDITION', model_code: '4BA-R35', engine_cc: 3800 }).docket?.id === 'black', 'guess: GT-R BLACK EDITION gets the GTR BLACK EDITION docket')
  const gtr2 = [...gtr, { id: 'tspec', brand: 'NISSAN', model: 'GTR PREMIUM EDITION T-SPEC (4BA-R35)', cc: 3799, year: 2026, currency_code: 'JPY', amt_12m_24m: 5092731, amt_24m_36m: 4309234, amt_36m_48m: 3525737, amt_48m_60m: 2742240, amt_60m_plus: 2350491 }]
  ok(guessDocket(gtr2, { brand: 'NISSAN', model: 'GT-R PREMIUM EDITION', model_code: '4BA-R35', engine_cc: 3800 }).docket?.id === 'prem', 'guess: GT-R PREMIUM EDITION gets PREMIUM EDITION, not the dearer T-SPEC that also contains its words')
}
{
  // the site's model label ("4 SERIES", "5HB") leads the car's name and no docket has it: the grade part is compared
  const mk = (id, model, cc = 1998, cur = 'JPY') => ({ id, brand: 'BMW', model, cc, year: 2026, currency_code: cur, amt_12m_24m: 3000000, amt_24m_36m: 2500000, amt_36m_48m: 2000000, amt_48m_60m: 1500000, amt_60m_plus: 1000000 })
  const bmw = [mk('cab', '420I CABRIOLET (3BA-12AP20)'), mk('cabm', '420I CABRIOLET M SPORT (3BA-12AP20)'), mk('coupe', '420i COUPE M SPORT (3BA-12AP20)'), mk('edge', '420I M SPORT EDITION EDGE (3BA-12AP20)')]
  const car = { brand: 'BMW', model: '4 SERIES 420I COUPE M-SPORT', model_code: '3BA-12AP20', engine_cc: 2000 }
  ok(guessDocket(bmw, car).docket === null, 'family: without the family label the name cannot be compared')
  ok(guessDocket(bmw, { ...car, family: '4 SERIES' }).docket?.id === 'coupe', 'family: 4 SERIES 420I COUPE M-SPORT gets the 420i COUPE M SPORT docket')
  const mini = [{ ...mk('res', 'COOPER S RESOLUTE EDITION (3BA-XU20MW)', 1998), brand: 'MINI' }, { ...mk('cs', 'COOPER S (3BA-XU20MW)', 1998), brand: 'MINI' }]
  ok(guessDocket(mini, { brand: 'MINI', model: '5HB SHADOW EDITION', model_code: '3BA-XU20MW', engine_cc: 1998, family: '5HB' }).docket === null, 'family: 5HB SHADOW EDITION is not RESOLUTE EDITION (only the label is dropped, never a trim word)')
  ok(guessDocket(mini, { brand: 'MINI', model: '5HB COOPER S', model_code: '3BA-XU20MW', engine_cc: 1998, family: '5HB' }).docket?.id === 'cs', 'family: 5HB COOPER S gets the exact COOPER S docket')
  ok(guessDocket([mk('gbp', '420i COUPE M SPORT (3BA-12AP20)', 1998, 'GBP')], { ...car, family: '4 SERIES' }).docket === null, 'JPY only: a GBP docket is never used for a Japan auction car')
}
{
  // the auction brand MERCEDES AMG is filed in the Customs list under MERCEDES BENZ ("AMG GLA35 4MATIC")
  const mk = (id, model, cc = 1991) => ({ id, brand: 'MERCEDES BENZ', model, cc, year: 2026, currency_code: 'JPY', amt_12m_24m: 6000000, amt_24m_36m: 5000000, amt_36m_48m: 4000000, amt_48m_60m: 3000000, amt_60m_plus: 2000000 })
  const amg = [mk('g35', 'AMG GLA35 4MATIC (4BA-247751M)'), mk('g45', 'AMG GLA45 S 4MATIC+ (4BA-247754M)'), mk('a200', 'A200D AMG LINE (3DA-177012)')]
  ok(docketBrand('MERCEDES AMG') === 'MERCEDES BENZ' && docketBrand('mercedes maybach') === 'MERCEDES BENZ' && docketBrand('CHRYSLER JEEP') === 'JEEP' && docketBrand('TOYOTA') === 'TOYOTA', 'brand: MERCEDES AMG / MAYBACH and CHRYSLER JEEP map to the Customs brand')
  const gla35 = { brand: 'MERCEDES AMG', model: 'GLA-CLASS GLA35 4MATIC', model_code: '4BA-247751M', engine_cc: 2000, family: 'GLA-CLASS' }
  ok(guessDocket(amg, gla35).docket?.id === 'g35', 'AMG: MERCEDES AMG GLA-CLASS GLA35 4MATIC gets the AMG GLA35 4MATIC docket')
  ok(guessDocket(amg, { ...gla35, model: 'GLA-CLASS GLA45 S 4MATIC+', model_code: '4BA-247754M' }).docket?.id === 'g45', 'AMG: GLA45 S 4MATIC+ gets the AMG GLA45 S docket')
  ok(guessDocket(amg, { ...gla35, model: 'GLA-CLASS GLA45 S 4MATIC+', model_code: '4BA-247751M' }).docket === null, 'AMG: a GLA45 name does not take the GLA35 docket (same strict trim rule)')
  ok(matchDockets(amg, { brand: 'MERCEDES AMG', model: 'GLA-CLASS GLA35 4MATIC', model_code: '4BA-247751M', engine_cc: 2000 }).list[0]?.docket.id === 'g35', 'AMG: the suggestion list (calculator / popup) finds the docket too')
}
{
  // GR COROLLA: the Customs list has RZ AT, RZ MT and RZ MORIZO EDITION MT under one chassis code; the car's name and transmission pick one
  const mk = (id, model, top) => ({ id, brand: 'TOYOTA', model, cc: 1618, year: 2026, currency_code: 'JPY', amt_12m_24m: top, amt_24m_36m: top * 0.85, amt_36m_48m: top * 0.7, amt_48m_60m: top * 0.55, amt_60m_plus: top * 0.45 })
  const gr = [mk('morizo', 'GR COROLLA RZ MORIZO EDITION (4BA-GZEA14H) MT', 2289422), mk('rzmt', 'GR COROLLA RZ (4BA-GZEA14H) MT', 1681044), mk('rzat', 'GR COROLLA RZ (4BA-GZEA14H) AT', 1914789)]
  const car = { brand: 'TOYOTA', model: 'GR COROLLA RZ', model_code: '4BA-GZEA14H', engine_cc: 1600 }
  ok(guessDocket(gr, { ...car, transmission: 'MT' }).docket?.id === 'rzmt', 'GR COROLLA RZ, MT: gets "GR COROLLA RZ ... MT", not the dearer MORIZO EDITION')
  ok(guessDocket(gr, { ...car, transmission: 'AT' }).docket?.id === 'rzat', 'GR COROLLA RZ, AT: gets "GR COROLLA RZ ... AT"')
  ok(guessDocket(gr, { ...car, model: 'GR COROLLA RZ MORIZO EDITION', transmission: 'MT' }).docket?.id === 'morizo', 'GR COROLLA RZ MORIZO EDITION, MT: gets the MORIZO EDITION docket')
  ok(guessDocket(gr, { ...car, model: 'GR COROLLA RZ MORIZO EDITION', transmission: 'AT' }).docket === null, 'a MORIZO EDITION car that is AT has no docket (only an MT one exists)')
  ok(guessDocket(gr, car).docket === null && /transmission/.test(guessDocket(gr, car).reason), 'transmission unknown and both an AT and an MT docket fit: no guess')
  ok(guessDocket(gr, { ...car, transmission: 'CVT' }).docket?.id === 'rzat', 'CVT counts as automatic')
  ok(guessDocket([gr[0], gr[1]], { ...car, transmission: 'AT' }).docket === null, 'an AT car with only MT dockets: no docket')
  ok(docketTransmission('X (3BA-AGH40W) AT') === 'AT' && docketTransmission('X (3BA-AGH40W) MT') === 'MT' && docketTransmission('X (3BA-AGH40W) AT/MT') === 'BOTH' && docketTransmission('ALPHARD (3BA-AGH40W) 8 SEATER') === null, 'the transmission of a docket is read from the end of its name')
  // transmission is the LAST step: the trim name decides first, and a docket of the right trim but the other transmission is not swapped for a longer trim
  const t86 = [mk('gtat', '86 GT (DBA-ZN6) AT', 2500000), mk('gtlimmt', '86 GT LIMITED (DBA-ZN6) MT', 2800000)]
  ok(guessDocket(t86, { brand: 'TOYOTA', model: '86 GT', model_code: 'DBA-ZN6', engine_cc: 1600, transmission: 'MT' }).docket === null, 'a manual "86 GT" with only an automatic 86 GT docket gets NO docket (not the 86 GT LIMITED MT: that is another trim)')
  ok(guessDocket(t86, { brand: 'TOYOTA', model: '86 GT', model_code: 'DBA-ZN6', engine_cc: 1600, transmission: 'AT' }).docket?.id === 'gtat', 'the automatic 86 GT gets the 86 GT AT docket')
  ok(guessDocket(t86, { brand: 'TOYOTA', model: '86 GT LIMITED', model_code: 'DBA-ZN6', engine_cc: 1600, transmission: 'MT' }).docket?.id === 'gtlimmt', 'the manual 86 GT LIMITED gets the 86 GT LIMITED MT docket')
  const both = [mk('one', 'ALPHARD Z (3BA-AGH40W) AT/MT', 5000000)]
  ok(guessDocket(both, { brand: 'TOYOTA', model: 'ALPHARD Z', model_code: '3BA-AGH40W', engine_cc: 1600, transmission: 'MT' }).docket?.id === 'one', 'a docket written AT/MT fits both transmissions')
  const sug = matchDockets(gr, { ...car, transmission: 'MT' }).list.map((m) => m.docket.id)
  ok(sug.indexOf('rzmt') < sug.indexOf('rzat'), 'the suggestion list puts the right transmission before the other (' + sug.join(' > ') + ')')
}
ok(trimMatches('ATRAI RS 5D 2@4 SEATER (3BD-S710V) AT', 'ATRAI RS'), 'trim: the listing name may be shorter than the docket name when all its words are in it')
ok(!trimMatches('CIVIC TYPE R (6BA-FL5) MT', 'CIVIC TYPE R RACING BLACK PACKAGE'), 'trim: RACING BLACK PACKAGE is not in the plain Type R docket')
ok(guessDocket([{ ...d86, year: 2026 }], { brand: 'TOYOTA', model: '86 G', model_code: 'ZN6', engine_cc: 2500 }).docket === null, 'strict: code and name fit but the engine size is far off, no docket')
ok(marketKey('3BA-AGH40W', 'ALPHARD') === 'AGH40W' && marketKey('AGH40W', 'ALPHARD') === 'AGH40W', 'market key: same model, same key with or without the emission prefix')
ok(marketKey(null, 'Fit Hybrid') === 'FIT HYBRID', 'market key: model name when there is no code')
const mp = [{ brand: 'TOYOTA', model_key: 'AGH40W', mfg_year: 2024, price_myr: 400000, recorded_on: '2026-10-01' }, { brand: 'TOYOTA', model_key: 'AGH40W', mfg_year: 2025, price_myr: 420000, recorded_on: '2026-11-06' }]
ok(findMarketPrice(mp, 'toyota', 'AGH40W', 2025).price_myr === 420000, 'market price: same year first')
ok(findMarketPrice(mp, 'TOYOTA', 'AGH40W', 2023).price_myr === 420000, 'market price: other year falls back to the newest recorded')
ok(findMarketPrice(mp, 'TOYOTA', 'ZZZ', 2025) === null, 'market price: none for an unknown model')
// offer report: body price + agent fee & shipping (CIF table) + duty + port + inland + AP fee
import { agentFeeJpy } from '../packages/core/src/offerPricing.ts'
ok(agentFeeJpy(4995000) === 250000 && agentFeeJpy(5000000) === 300000 && agentFeeJpy(7995000) === 300000 && agentFeeJpy(8000000) === 350000 && agentFeeJpy(11000000) === 400000 && agentFeeJpy(14000000) === 450000 && agentFeeJpy(16000000) === 800000 && agentFeeJpy(20000000) === 1000000, 'CIF table: 250k / 300k / 350k / 400k / 450k, then 5% from 16,000,000')
const F = { portMyr: 2500, inlandMyr: 250, apFeeMyr: 10500 }
const op = offerPricing({ historyJpy: 5235000, rate: 0.0257055, dutyMyr: 31000, ...F })
ok(op.agentJpy === 300000 && op.bodyMyr === 134568 && op.agentMyr === 7712 && op.importMyr === 134568 + 7712 + 31000 + 13250, 'offer pricing: 5,235,000 -> agent 300,000 (RM 7,712); import = all lines added')
ok(offerPricing({ historyJpy: null, rate: 0.0272, dutyMyr: 1, ...F }).importMyr === null, 'offer pricing: no history price, no import price')
ok(offerPricing({ historyJpy: 3000000, rate: 0.0272, dutyMyr: null, ...F }).bodyMyr === 81600 && offerPricing({ historyJpy: 3000000, rate: 0.0272, dutyMyr: null, ...F }).importMyr === null, 'offer pricing: no duty, body shown but no import price')
// history price: same grade first, then 4.5B / 5A / 5B; same model code only
const S = (grade, price, model_code = null) => ({ grade, price, model_code })
const hp = historyPrice([S('4.5A', 5000000), S('4.5A', 5200000), S('4.5B', 4000000), S('5A', 6000000)], '4.5A')
ok(hp && hp.price === 5100000 && hp.n === 2 && hp.basis === '4.5A', 'history price: only the 4.5A sales when there are some (avg 5,100,000)')
const hp2 = historyPrice([S('4.5B', 4000000), S('5B', 5000000), S('5A', 6000000), S('4A', 1000000), S('3.5A', 1000000), S('5C', 1000000)], '4.5A')
ok(hp2 && hp2.price === 5000000 && hp2.n === 3 && hp2.basis === '4.5B / 5A / 5B', 'history price: no 4.5A, so 4.5B / 5A / 5B together (avg 5,000,000)')
ok(historyPrice([S('4A', 1), S('3.5B', 1)], '4.5A') === null, 'history price: nothing of that grade or near it gives no price')
ok(historyPrice([S('4.5A', 5000000, '3BA-AGH30W'), S('4.5A', 5400000, 'AGH40W')], '4.5A', '3BA-AGH40W').price === 5400000, 'history price: another model code is left out')
ok(historyPrice([S('4.5A', 5001000), S('4.5A', 5002000)], '4.5A').price === 5005000 && historyPrice([S('4.5A', 5000000)], '4.5A').price === 5000000, 'history price: the average is rounded UP to the next 5,000 yen (5,001,500 -> 5,005,000; exact stays)')
ok(historyPrice([S('4.5A', 5000000, null)], '4.5A', 'AGH40W').price === 5000000, 'history price: a sale saved without a code still counts')
ok(gradeParts('4.5') && gradeParts('4.5').letter === '' && gradeParts('SA').main === 'S' && gradeParts('SA').letter === 'A', 'grade parts: 4.5 / SA')
{
  const mk = (id, brand, model, cc, a) => ({ id, brand, model, cc, currency_code: 'JPY', year: 2026, amt_12m_24m: a, amt_24m_36m: a, amt_36m_48m: a, amt_48m_60m: a, amt_60m_plus: a })
  const DD = [mk('q', 'AUDI', 'Q3 SPORTBACK 35 TFSI (3BA-F3DPC)', 1497, 1447299), mk('qs', 'AUDI', 'Q3 SPORTBACK 35 TFSI S LINE (3BA-F3DPC)', 1497, 1652226), mk('m', 'PORSCHE', 'MACAN GTS (7BA-J1NUA)', 2894, 3954456)]
  ok(guessDocket(DD, { brand: 'PORSCHE', model: 'MACAN GTS', model_code: '7BA-J1NUA', engine_cc: 3000, transmission: 'AT' }).docket?.id === 'm', 'docket: Macan GTS listed as 3000 cc fits the 2894 cc docket (rounded engine size)')
  ok(guessDocket(DD, { brand: 'AUDI', model: 'Q3 SPORTBACK 35TFSI', model_code: 'F3DPC', engine_cc: 1500, transmission: 'AT' }).docket?.id === 'q', 'docket: Q3 SPORTBACK 35TFSI is exactly the 35 TFSI line, not S LINE')
  ok(guessDocket(DD, { brand: 'AUDI', model: 'Q3 SPORTBACK 35TFSI S LINE', model_code: '3BA-F3DPC', engine_cc: 1500, transmission: 'AT' }).docket?.id === 'qs', 'docket: Q3 SPORTBACK 35TFSI S LINE is the S LINE line')
  ok(!guessDocket(DD, { brand: 'PORSCHE', model: 'MACAN GTS', model_code: '7BA-J1NUA', engine_cc: 3200, transmission: 'AT' }).docket, 'docket: a 3200 cc car is still too far from 2894 cc')
  const CR = [mk('cz', 'TOYOTA', 'CROWN SPORT Z (6AA-AZSH36W)', 2487, 5000000), mk('cr', 'TOYOTA', 'CROWN SPORT RS (6AA-AZSH36W)', 2487, 5200000)]
  ok(guessDocket(CR, { brand: 'TOYOTA', model: 'CROWN SPORT Z (HEV)', model_code: '6AA-AZSH36W', engine_cc: 2500, transmission: 'AT' }).docket?.id === 'cz', 'docket: CROWN SPORT Z (HEV) is the CROWN SPORT Z docket (HEV is not a trim word)')
  ok(guessDocket(CR, { brand: 'TOYOTA', model: 'CROWN SPORT RS (HEV)', model_code: 'AZSH36W', engine_cc: 2500, transmission: 'AT' }).docket?.id === 'cr', 'docket: CROWN SPORT RS (HEV) is the RS docket')
  // the emission prefix counts: 4BA-ZC33S is not the CBA-ZC33S docket (lots 85108, 53911, 91164, 17445)
  const SW = [
    mk('c1', 'SUZUKI', 'SWIFT SPORT BASE GRADE (CBA-ZC33S) MT', 1371, 598772),
    mk('c2', 'SUZUKI', 'SWIFT SPORT BASE GRADE (CBA-ZC33S) AT', 1371, 600000),
    mk('a1', 'SUZUKI', 'SWIFT SPORT BASE GRADE WITH SUZUKI SAFETY SUPPORT INSTALLED (4BA-ZC33S) MT', 1371, 649491),
    mk('a2', 'SUZUKI', 'SWIFT SPORT BASE GRADE WITH SUZUKI SAFETY SUPPORT NOT INSTALLED (4BA-ZC33S) MT', 1371, 603703),
    mk('a3', 'SUZUKI', 'SWIFT SPORT BASE GRADE SUZUKI SAFETY SUPPORT INSTALLED (4BA-ZC33S) AT', 1371, 668863),
    mk('a4', 'SUZUKI', 'SWIFT SPORT BASE GRADE WITH SUZUKI SAFETY SUPPORT NOT INSTALLED (4BA-ZC33S) AT', 1371, 626597)]
  const sw = (code, tr) => guessDocket(SW, { brand: 'SUZUKI', model: 'SWIFT SPORT BASE GRADE', model_code: code, engine_cc: 1400, transmission: tr }).docket?.id
  ok(sw('4BA-ZC33S', 'MT') === 'a2', 'docket: 4BA-ZC33S MT, the report does not mention safety: NOT INSTALLED (lot 85108: adaptive cruise is not "safety")')
  const swS = (txt, tr) => guessDocket(SW, { brand: 'SUZUKI', model: 'SWIFT SPORT BASE GRADE', model_code: '4BA-ZC33S', engine_cc: 1400, transmission: tr, sheet_text: txt }).docket?.id
  ok(swS('Genuine navi, adaptive cruise control', 'MT') === 'a2', 'docket: adaptive cruise alone is not a mention of safety: NOT INSTALLED')
  ok(swS('Suzuki Safety Support installed, navi', 'MT') === 'a1', 'docket: the report mentions safety: INSTALLED')
  ok(swS('', 'AT') === 'a4' && swS('Safety Package', 'AT') === 'a3', 'docket: the same for AT')
    ok(sw('CBA-ZC33S', 'MT') === 'c1', 'docket: CBA-ZC33S still gets the CBA docket')
  ok(sw('DBA-ZC33S', 'MT') === 'c1', 'docket: a prefix no docket carries is a misread (4AA for 4BA): only the tail is used, as before')
  ok(guessDocket([mk('g', 'MERCEDES BENZ', 'AMG GLA35 4MATIC (4BA-247751M)', 1991, 7000000)], { brand: 'MERCEDES AMG', model: 'GLA-CLASS GLA35 4MATIC', family: 'GLA-CLASS', model_code: '4AA-247751M', engine_cc: 2000, transmission: 'AT' }).docket?.id === 'g', 'docket: lot 58066 read as 4AA-247751M still gets the 4BA-247751M docket')
  // two codes in one docket (lot 1019): ALPHARD HYBRID X (6AA-AAHH40W/6AA-AAHH45W)
  const AL = [mk('x', 'TOYOTA', 'ALPHARD HYBRID X (6AA-AAHH40W/6AA-AAHH45W)', 2487, 5000000), mk('z', 'TOYOTA', 'ALPHARD HYBRID Z (6AA-AAHH40W/6AA-AAHH45W)', 2487, 6000000)]
  ok(guessDocket(AL, { brand: 'TOYOTA', model: 'ALPHARD HYBRID X', family: 'ALPHARD HYBRID', model_code: '6AA-AAHH40W', engine_cc: 2500, transmission: 'AT' }).docket?.id === 'x', 'docket: ALPHARD HYBRID X is found in a docket that lists two codes (AAHH40W/AAHH45W)')
  ok(guessDocket(AL, { brand: 'TOYOTA', model: 'ALPHARD HYBRID X', model_code: '6AA-AAHH45W', engine_cc: 2500, transmission: 'AT' }).docket?.id === 'x', 'docket: the second code of the docket works too')
  // month not readable: exact only when every month of the year is the same docket column (lot 35269, a 2025 Civic Type R seen in Nov 2026)
  const NOWD = new Date(2026, 10, 13)
  ok(dutyMonth(2025, null, NOWD) === 12, 'dutyMonth: a 2025 car seen in Nov 2026 (11-22 months) is the 12-24 column whatever the month')
  ok(dutyMonth(2024, null, NOWD) === null, 'dutyMonth: a 2024 car (23-34 months) could be in two columns: month needed')
  ok(dutyMonth(2024, 5, NOWD) === 5 && dutyMonth(null, null, NOWD) === null, 'dutyMonth: a known month is kept, no year gives nothing')
}
{
  // Defender 110 SE P300: the 5 seater and the 7 seater have their own dockets; the Customs list writes "110SE" joined
  const mk = (id, model, amt) => ({ id, brand: 'LAND ROVER', model, cc: 1995, currency_code: 'JPY', year: 2026, amt_12m_24m: amt, amt_24m_36m: amt, amt_36m_48m: amt, amt_48m_60m: amt, amt_60m_plus: amt })
  const ds = [mk('s5', 'DEFENDER 110SE P300 5 SEATER (3BA-LE72XAA)', 2622749), mk('s7', 'DEFENDER 110 SE P300 7 SEATER (3BA-LE72XAA)', 2765237), mk('sx', 'DEFENDER 110 SE 5@7 SEATER (3BA-LE72XAA) AT', 2472706)]
  const lot = { brand: 'LAND ROVER', model: 'DEFENDER 110 SE P300', model_code: '3BA-LE72XAA', engine_cc: 1995, transmission: 'AT' }
  ok(guessDocket(ds, { ...lot, seats: 5 }).docket?.id === 's5', 'seats: a 5 seater gets the 5 SEATER docket (110SE = 110 SE)')
  ok(guessDocket(ds, { ...lot, seats: 7 }).docket?.id === 's7', 'seats: a 7 seater gets the 7 SEATER docket')
  ok(guessDocket(ds.slice(1, 2), { ...lot, seats: 5 }).docket === null, 'seats: only a 7 seater docket exists, the car has 5 seats: no docket')
  ok(guessDocket(ds.slice(1, 2), lot).docket?.id === 's7', 'seats not known: not filtered')
}
{
  // the closest name wins; the price only breaks a tie
  const mk = (id, brand, model, cc, amt) => ({ id, brand, model, cc, currency_code: 'JPY', year: 2026, amt_12m_24m: amt, amt_24m_36m: amt, amt_36m_48m: amt, amt_48m_60m: amt, amt_60m_plus: amt })
  const el = [mk('e1', 'NISSAN', 'ELGRAND 250 HIGHWAY STAR S URBAN CHROME 7 SEATER (5BA-TE52)', 2488, 1311663), mk('e2', 'NISSAN', 'ELGRAND 250HIGHWAY STAR S 7@8 SEATER (5BA-TE52)', 2488, 1183103)]
  ok(guessDocket(el, { brand: 'NISSAN', model: 'ELGRAND 250 HIGHWAY STAR S', model_code: '5BA-TE52', engine_cc: 2500, seats: 7, transmission: 'AT' }).docket?.id === 'e2', 'closest name: a plain 250 HIGHWAY STAR S is not the URBAN CHROME docket')
  const am = [mk('a1', 'MERCEDES AMG', 'AMG A45 S 4MATIC+ (4BA-177054M)', 1991, 2529571), mk('a2', 'MERCEDES AMG', 'AMG A45 S 4MATIC+ STREET STYLE EDITION (4BA-177054M)', 1991, 3474158), mk('a3', 'MERCEDES AMG', 'AMG A45 S 4MATIC+ EDITION 1 (4BA-177054M)', 1991, 2942628)]
  ok(guessDocket(am, { brand: 'MERCEDES AMG', model: 'A-CLASS A45 S 4MATIC+', model_code: '4BA-177054M', engine_cc: 2000, family: 'A-CLASS', transmission: 'AT' }).docket?.id === 'a1', 'closest name: a plain A45 S 4MATIC+ is not the STREET STYLE EDITION')
}
{
  const sb = { id: 'sb', brand: 'VOLKSWAGEN', model: 'ARTEON SHOOTING BRAKE TSI 4MOTION R LINE ADVANCE (3BA-3HDNUF)', cc: 1984, currency_code: 'JPY', year: 2026, amt_12m_24m: 2095702, amt_24m_36m: 2000000, amt_36m_48m: 1900000, amt_48m_60m: 1800000, amt_60m_plus: 1700000 }
  ok(guessDocket([sb], { brand: 'VOLKSWAGEN', model: 'ARTEON TSI 4MOTION R-LINE ADVANCE', model_code: '3BA-3HDNUF', engine_cc: 2000, transmission: 'AT' }).docket === null, 'a plain Arteon does not get the SHOOTING BRAKE docket')
  ok(guessDocket([sb], { brand: 'VOLKSWAGEN', model: 'ARTEON SHOOTING BRAKE TSI 4MOTION R-LINE ADVANCE', model_code: '3BA-3HDNUF', engine_cc: 2000, transmission: 'AT' }).docket?.id === 'sb', 'an Arteon Shooting Brake does')
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

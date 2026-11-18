// ASNET list row -> lots record, and the duplicate rule.   node tests/asnet-map.test.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
// writer.js opens a database client when loaded: give it harmless values (nothing is called)
process.env.SUPABASE_URL ||= 'http://localhost:1'; process.env.SUPABASE_SERVICE_KEY ||= 'x'
const { rowToLot, isDuplicate, splitDateTime, exKey, baseCode, nameKey } = require('../services/scraper/lib/asnet/map.js')
const { eraToYear, normalizeFormCode } = require('../services/scraper/lib/asnet/extract.js')

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

const row = { lot_no: '1571270933', auction_date: '2026-11-19', location: 'USS Tokyo', make: 'Toyota', car_name: 'Vellfire', grade: '2.5Z G EDITION', model_code_raw: '3BA-AGH30W', engine_cc: 2500, mfg_year_western: 2022, mileage: 21000, color: 'White', gear: 'AT', score_grade: '4.5', wholesale_price: 3150000, thumbnail_url: 'x' }
const lot = rowToLot(row)
ok(lot.ex_key === 'asnet:1571270933' && lot.source === 'asnet', 'the key names the source and the ASNET number')
ok(lot.venue === 'Tokyo', 'the venue loses the source prefix, like the other source')
ok(lot.brand === 'TOYOTA' && lot.model === 'VELLFIRE 2.5Z G EDITION', 'brand and model are upper case, grade joined to the name')
ok(lot.model_code === '3BA-AGH30W' && lot.mfg_year === 2022 && lot.mileage_km === 21000 && lot.engine_cc === 2500 && lot.transmission === 'AT' && lot.grade === '4.5', 'the figures carry over')
ok(lot.bid_deadline === '2026-11-19T23:59:00+09:00', 'no time on the page: the end of the auction day in Japan')
ok(rowToLot({ ...row, auction_date: '2026-11-19T10:30:00' }).bid_deadline === '2026-11-19T10:30:00+09:00', 'a time on the page becomes the deadline')
ok(rowToLot({ ...row, lot_no: '' }) === null && rowToLot({ ...row, auction_date: null }) === null && rowToLot({ ...row, make: '' }) === null, 'a row without lot number, date or name is not usable')
ok(rowToLot({ ...row, model_code_raw: '-1' }).model_code === null, 'the "-1" code means none')
ok(splitDateTime('2026-11-19').time === null && splitDateTime('x').date === null, 'date parsing')
ok(exKey(' 157 127 ') === 'asnet:157127', 'spaces are removed from the key')

const mine = { ex_key: 'asnet:1', auction_date: '2026-11-19', brand: 'TOYOTA', model_code: '3BA-AGH30W', mfg_year: 2022, mileage_km: 21000 }
const other = { ex_key: 'uss:9', auction_date: '2026-11-19', brand: 'Toyota', model_code: 'AGH30W', mfg_year: 2022, mileage_km: 21000 }
ok(isDuplicate(mine, [other]), 'same day, make, year, mileage and chassis code: the same car (the code prefix does not matter)')
ok(!isDuplicate(mine, [{ ...other, mileage_km: 21500 }]), 'another mileage: another car')
ok(!isDuplicate(mine, [{ ...other, mfg_year: 2021 }]), 'another year: another car')
ok(!isDuplicate(mine, [{ ...other, model_code: 'GGH30W' }]), 'another chassis code: another car')
ok(!isDuplicate(mine, [{ ...other, auction_date: '2026-11-20' }]), 'another day: another car')
ok(isDuplicate({ ...mine, model_code: null }, [other]), 'no chassis code on one side: mileage, year and make decide')
ok(!isDuplicate(mine, [{ ...other, mileage_km: null }]), 'unknown mileage never proves a duplicate')
ok(baseCode('6AA-MXPK16') === 'MXPK16' && nameKey('Land-Cruiser') === 'LANDCRUISER', 'name and code helpers')
ok(eraToYear('R7') === 2025 && eraToYear('H30') === 2018 && eraToYear('2023') === 2023, 'era years (old scraper helper)')
ok(normalizeFormCode('3BA-AGH40W') === 'AGH40W', 'form code (old scraper helper)')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

// The hard "do not recommend" rules (app/utils/recommendRules.ts):   node tests/recommend.test.mjs
import { recommendBlock, kmPerYear, sheetUnreadable } from '../packages/core/src/recommendRules.ts'

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const NOW = new Date('2026-11-10T00:00:00Z')
const read = { enriched_at: '2026-11-09T08:00:00Z' }
const sheet = { chassis_no: 'W1N2477542J713481', inspection_until: '2028-01', doors: 5, seats: 5, first_reg_month: 1 }
const block = (l, afterReading = true) => recommendBlock(l, { now: NOW, afterReading })

// 1. mileage: over 10,000 km a year is high
const gla = { model: 'GLA-CLASS GLA45 S 4MATIC+', mfg_year: 2025, mfg_month: 1, mileage_km: 28000, ...read, ...sheet }
ok(Math.round(kmPerYear(gla, NOW)) > 15000, 'the GLA45 S (Jan 2025, 28,000 km) runs about 15,300 km a year')
ok(/km a year/.test(block(gla) || ''), 'mileage: the GLA45 S (28,000 km in 22 months) is not recommended')
ok(block({ ...gla, mileage_km: 18000 }) === null, 'mileage: 18,000 km in 22 months (9,800 a year) is fine')
ok(block({ ...gla, mileage_km: 18400 }) !== null, 'mileage: 18,400 km in 22 months (10,000+ a year) is high')
ok(block({ model: 'X', mfg_year: 2026, mfg_month: 1, mileage_km: 8000, ...read, ...sheet }) === null, 'mileage: a car under a year old is counted as one year, so 8,000 km is fine')
ok(block({ model: 'X', mfg_year: 2026, mfg_month: 1, mileage_km: 12000, ...read, ...sheet }) !== null, 'mileage: but 12,000 km in under a year is high')
ok(block({ ...gla, mfg_month: null, first_reg_month: null, mileage_km: 25000, chassis_no: 'X' }) !== null, 'mileage: month unknown counts the calendar years (2025 car = 2 years): 12,500 a year is high')
ok(block({ ...gla, mileage_km: null }) === null, 'mileage: unknown mileage is not blocked')

// 2. the sheet could not be read (handwriting) -> no fields filled -> not recommended
const rx = { model: 'RX F SPORT', mfg_year: 2026, mfg_month: null, mileage_km: 2000 }
ok(/not read/.test(block(rx) || ''), 'unread: lot 20138 (never read, month unknown) is not recommended after the reading step')
ok(block(rx, false) === null, 'unread: before the reading step an unread car is still fine (it is read next)')
const blank = { ...rx, ...read }
ok(sheetUnreadable(blank) && /could not be read/.test(block(blank) || ''), 'unreadable: read, but not a single sheet field could be filled -> not recommended')
ok(!sheetUnreadable({ ...blank, doors: 5 }), 'unreadable: one filled field (doors) means the sheet was readable')
ok(!sheetUnreadable({ ...blank, enriched_at: null }), 'unreadable: a car that was not read is "not read", not "unreadable"')

// 3. age: at least 9 months, and an unreadable month on a very new car cannot prove it
ok(/months old/.test(block({ model: 'X', mfg_year: 2026, mfg_month: 5, mileage_km: 2000, ...read, ...sheet, first_reg_month: 5 }) || ''), 'age: first registered May 2026 (6 months) breaks the 9 month rule')
ok(block({ model: 'X', mfg_year: 2026, mfg_month: 2, mileage_km: 2000, ...read, ...sheet, first_reg_month: 2 }) === null, 'age: Feb 2026 (9 months) is fine')
ok(/month not readable/.test(block({ model: 'X', mfg_year: 2026, mfg_month: null, mileage_km: 2000, ...read, chassis_no: 'ABC' }) || ''), 'age: a 2026 car whose month cannot be read is not recommended (could be 1 month old)')
ok(/month not readable/.test(block({ model: 'X', mfg_year: 2025, mfg_month: null, mileage_km: 9000, ...read, chassis_no: 'ABC' }) || ''), 'age: a 2025 car with an unreadable month is not recommended either (decided 13 Nov 2026)')
ok(block({ model: 'X', mfg_year: 2025, mfg_month: null, mileage_km: 9000, ...read, chassis_no: 'ABC' }, false) === null, 'age: before the reading step an unread month is not blocked yet (the car is read next)')
ok(/month not readable/.test(recommendBlock({ model: 'X', mfg_year: 2026, mfg_month: null, mileage_km: 2000, ...read, chassis_no: 'ABC' }, { now: new Date('2027-01-15T00:00:00Z') }) || ''), 'age: in Jan 2027 a 2026 car with an unreadable month could be 1 month old: not recommended')

// 4. OTHERS and a good car
ok(/OTHERS/.test(block({ model: '5HB OTHERS', ...read, ...sheet, mfg_year: 2023, mileage_km: 20000 }) || ''), 'OTHERS: grade name OTHERS is not recommended')
ok(block({ model: 'LEXUS RX F SPORT', mfg_year: 2024, mfg_month: 3, mileage_km: 15000, ...read, ...sheet, first_reg_month: 3 }) === null, 'a clean car passes every rule')

{
  const car = { model: 'GOLF GTI', mfg_year: 2022, mfg_month: 4, mileage_km: 20000, ...read, ...sheet }
  ok(block({ ...car, steering: 'LHD' }) === 'left-hand drive', 'steering: a left-hand-drive car is not recommended')
  ok(block({ ...car, steering: 'lhd' }) === 'left-hand drive', 'steering: LHD in lower case counts too')
  ok(block({ ...car, steering: 'RHD' }) === null && block({ ...car, steering: null }) === null && block(car) === null, 'steering: right-hand drive / not shown / no field is fine')
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

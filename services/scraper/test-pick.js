'use strict'

// Offline check of lib/pick.js (the 2 top + 3 mid choice):   node test-pick.js
const { shortlist, finalize, sameCode, isRare } = require('./lib/pick')

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

const NOW = 2026
let n = 0
const car = (o) => ({ id: 'L' + ++n, brand: 'TOYOTA', model: 'ALPHARD', grade_num: 4, interior_grade: 'A', mfg_year: 2024, mileage_km: 20000, accident: null, pick_score: null, ...o })
const hist = new Set(['TOYOTA|ALPHARD'])
const ids = (l) => l.map((x) => x.id).join(',')

// 1. top = 4.5+ only, best grade then lowest km per year; mid pool never repeats a top car
const lots = [
  car({ id: 'g6', grade_num: 6, mileage_km: 8000 }), car({ id: 'g5lo', grade_num: 5, mileage_km: 5000 }), car({ id: 'g5hi', grade_num: 5, mileage_km: 40000 }),
  car({ id: 'g45', grade_num: 4.5, mileage_km: 9000 }), car({ id: 'g4a', grade_num: 4, mileage_km: 12000 }), car({ id: 'g4b', grade_num: 4, mileage_km: 4000 }),
  car({ id: 'g35', grade_num: 3.5, mileage_km: 1000 }), car({ id: 'g4C', grade_num: 4, interior_grade: 'C', mileage_km: 1000 }), car({ id: 'g5acc', grade_num: 5, accident: true, mileage_km: 1000 }),
]
const s = shortlist(lots, hist, { nowYear: NOW })
ok(s.top.every((l) => l.grade_num >= 4.5), 'top list holds only grade 4.5 and above')
ok(s.top[0].id === 'g6' && s.top[1].id === 'g5lo', 'top list is ordered by grade, then low mileage (' + ids(s.top) + ')')
ok(!s.top.concat(s.mid).some((l) => ['g35', 'g4C', 'g5acc'].includes(l.id)), 'grade 3.5, a C interior and a known accident are never read')
ok(!s.mid.some((l) => s.top.includes(l)), 'a car is not in both lists')

// 2. after reading: 2 top + 3 mid, mid by highlight score, accident cars dropped
const scored = { 'g4a': 8, 'g4b': 3, 'g5hi': 6, 'g45': 9 }
;[...s.top, ...s.mid].forEach((l) => { if (scored[l.id] != null) l.pick_score = scored[l.id] })
s.mid.find((l) => l.id === 'g4a').accident = false
const f = finalize(s, hist, { nowYear: NOW })
ok(ids(f.top) === 'g6,g5lo', 'the 2 nearly-perfect cars are the best two (' + ids(f.top) + ')')
ok(f.mid.length === 3 && f.mid[0].id === 'g45' && f.mid[1].id === 'g4a', 'mid cars follow the highlight score (' + ids(f.mid) + ')')

// 3. a read car that turns out to have an accident is dropped and replaced
const s2 = shortlist(lots, hist, { nowYear: NOW }); s2.top[0].accident = true
const f2 = finalize(s2, hist, { nowYear: NOW })
ok(!f2.top.concat(f2.mid).some((l) => l.id === 'g6') && f2.top.length === 2, 'accident found on the sheet: that car is dropped, top still has 2')

// 4. history first: with enough cars that have a history price, a car without one is not used
const mixed = [
  car({ id: 'h1', grade_num: 5 }), car({ id: 'h2', grade_num: 5 }), car({ id: 'h3', grade_num: 4 }), car({ id: 'h4', grade_num: 4 }), car({ id: 'h5', grade_num: 4 }),
  car({ id: 'n1', model: 'ALPHARD Z', grade_num: 6, mileage_km: 1000 }),
]
const f3 = finalize(shortlist(mixed, hist, { nowYear: NOW }), hist, { nowYear: NOW })
ok(!f3.top.concat(f3.mid).some((l) => l.id === 'n1'), 'a car with no history price is left out while 5 with a history price exist')

// 5. not enough with history: the rest is filled from cars without one
const few = [car({ id: 'h1', grade_num: 5 }), car({ id: 'n1', model: 'ALPHARD Z', grade_num: 5 }), car({ id: 'n2', model: 'ALPHARD Z', grade_num: 4 })]
const f4 = finalize(shortlist(few, hist, { nowYear: NOW }), hist, { nowYear: NOW })
ok(f4.top.concat(f4.mid).length === 3 && f4.top[0].id === 'h1', 'fewer than 5 with history: the others fill up the list, history car first')

// 6. fewer than 2 top cars: the mid list is made up to 5 in total
const noTop = Array.from({ length: 7 }, (_, i) => car({ id: 'm' + i, grade_num: 4, pick_score: i }))
const f5 = finalize(shortlist(noTop, hist, { nowYear: NOW }), hist, { nowYear: NOW })
ok(f5.top.length === 0 && f5.mid.length === 5 && f5.mid[0].id === 'm6', 'no top cars: 5 mid cars, best score first (' + ids(f5.mid) + ')')

// 7. age: now Nov 2026 -> Feb 2026 is allowed, Mar 2026 is not; older years are fine; unknown month is read then checked
const NM = { nowYear: 2026, nowMonth: 11 }
const aged = [car({ id: 'feb', mfg_year: 2026, mfg_month: 2, grade_num: 5 }), car({ id: 'mar', mfg_year: 2026, mfg_month: 3, grade_num: 5 }), car({ id: 'old', mfg_year: 2025, mfg_month: 12, grade_num: 4.5 }), car({ id: 'unk', mfg_year: 2026, mfg_month: null, grade_num: 4.5 })]
const sa = shortlist(aged, hist, NM)
ok(sa.top.some((l) => l.id === 'feb') && !sa.top.some((l) => l.id === 'mar') && sa.top.some((l) => l.id === 'old') && sa.top.some((l) => l.id === 'unk'), 'age: Feb 2026 ok, Mar 2026 left out, Dec 2025 ok, unknown month still read')
sa.top.find((l) => l.id === 'unk').mfg_month = 8                    // the sheet says Aug 2026: too new
ok(!finalize(sa, hist, NM).top.concat(finalize(sa, hist, NM).mid).some((l) => l.id === 'unk'), 'age: a car whose sheet month turns out too new is dropped')

// 8. rare colour: wins a mid place over an equal plain-colour car, white / black / silver / grey are not rare
const col = [car({ id: 'w', grade_num: 4, color: 'White Pearl', pick_score: 5 }), car({ id: 'r', grade_num: 4, color: 'Red', pick_score: 4 }), car({ id: 'k', grade_num: 4, color: '黒', pick_score: 4 })]
const fc = finalize(shortlist(col, hist, NM), hist, NM)
ok(isRare({ color: 'Red' }) && !isRare({ color: 'Pearl White' }) && !isRare({ color: '黒' }) && !isRare({ color: null }), 'rare colour: red is rare, pearl white / 黒 / no colour are not')
ok(fc.mid[0].id === 'r', 'rare colour: a red car with score 4 beats a white car with score 5 (bonus +2)')

// 9. blank rule: no history price AND no duty -> never picked; one of the two is enough; an unread car is not dropped
{
  const hf = (l) => l.model === 'ALPHARD'                       // history price only for ALPHARD
  const duty = new Map([['hasD', true], ['noD', false], ['unread', null]])
  const hd = (l) => (duty.has(l.id) ? duty.get(l.id) : false)
  const pool = [
    car({ id: 'hasH', model: 'ALPHARD', grade_num: 4, pick_score: 5 }),                 // history, no duty -> fine
    car({ id: 'hasD', model: 'ZZ', grade_num: 4, pick_score: 5 }),                      // duty, no history -> fine
    car({ id: 'noD', model: 'ZZ', grade_num: 5, pick_score: 9, mileage_km: 1000 }),     // neither, the best car -> out
    car({ id: 'unread', model: 'ZZ', grade_num: 4, pick_score: null }),                 // duty not known yet -> not dropped
  ]
  const sb = shortlist(pool, hf, { nowYear: NOW, hasDuty: hd })
  ok(!sb.top.concat(sb.mid).some((l) => l.id === 'noD'), 'blank: a car with no history price and no duty is not on the short list')
  ok(['hasH', 'hasD', 'unread'].every((id) => sb.top.concat(sb.mid).some((l) => l.id === id)), 'blank: history only, duty only and not-yet-read cars stay')
  const fb = finalize(sb, hf, { nowYear: NOW, hasDuty: hd })
  ok(!fb.top.concat(fb.mid).some((l) => l.id === 'noD'), 'blank: and it is not picked after the reading either')
  const sa = shortlist(pool, hf, { nowYear: NOW, hasDuty: hd, allowBlank: true })
  ok(finalize(sa, hf, { nowYear: NOW, hasDuty: hd, allowBlank: true }).top.some((l) => l.id === 'noD'), 'blank: with allowBlank the best car is picked again')
  const sf = shortlist(pool, hf, { nowYear: NOW })
  ok(finalize(sf, hf, { nowYear: NOW }).top.some((l) => l.id === 'noD'), 'blank: without a hasDuty function the rule is off (old behaviour)')
}

// 10. fuel option: fuelOk(lot) = false drops the car (a switched-off diesel / hybrid), in the short list and in the final pick
{
  const diesel = (l) => !/DIESEL/.test(l.model)
  const pool = [car({ id: 'petrol1', model: 'ALPHARD', grade_num: 4, pick_score: 5 }), car({ id: 'diesel1', model: 'ALPHARD DIESEL', grade_num: 6, pick_score: 9, mileage_km: 1000 })]
  const sf = shortlist(pool, () => true, { nowYear: NOW, fuelOk: diesel })
  ok(!sf.top.concat(sf.mid).some((l) => l.id === 'diesel1') && sf.top.concat(sf.mid).some((l) => l.id === 'petrol1'), 'fuel: a car of a switched-off type is not on the short list')
  ok(!finalize(shortlist(pool, () => true, { nowYear: NOW }), () => true, { nowYear: NOW, fuelOk: diesel }).top.some((l) => l.id === 'diesel1'), 'fuel: and not in the final pick either')
  ok(shortlist(pool, () => true, { nowYear: NOW }).top.some((l) => l.id === 'diesel1'), 'fuel: without fuelOk every type is allowed')
}

// 11. RULE: grade name OTHERS is never recommended (and never scraped: isOthersGrade)
{
  const { isOthersGrade, isOthersCar } = require('./lib/rules')
  ok(isOthersGrade('OTHERS') && isOthersGrade('Others') && isOthersGrade(' その他 ') && isOthersGrade('OTHER') && !isOthersGrade('COOPER S') && !isOthersGrade('OTHERWISE X') && !isOthersGrade(null), 'rules: the grade names OTHERS / その他 are caught, real grades are not')
  ok(isOthersCar({ model: '5HB OTHERS' }) && isOthersCar({ model: 'DEFENDER OTHERS' }) && !isOthersCar({ model: '5HB COOPER S' }) && !isOthersCar({ model: 'OTHERS CLUB 1' }), 'rules: a saved lot whose name ends in OTHERS is caught')
  const pool = [car({ id: 'oth', model: 'ALPHARD OTHERS', grade_num: 6, pick_score: 10, mileage_km: 100 }), car({ id: 'real', model: 'ALPHARD Z', grade_num: 4, pick_score: 3 })]
  const so = shortlist(pool, () => true, { nowYear: NOW })
  ok(!so.top.concat(so.mid).some((l) => l.id === 'oth') && so.top.concat(so.mid).some((l) => l.id === 'real'), 'OTHERS: not on the short list even when it is the best car')
  ok(!finalize({ top: pool, mid: pool }, () => true, { nowYear: NOW }).top.concat(finalize({ top: pool, mid: pool }, () => true, { nowYear: NOW }).mid).some((l) => l.id === 'oth'), 'OTHERS: not in the final pick either')
}

// 12. hard rules (blocked): a car that breaks one is never picked, and the next car takes its place
{
  const bad = new Set(['b1'])
  const blocked = (l) => (bad.has(l.id) ? 'high mileage' : null)
  const pool = [car({ id: 'b1', grade_num: 6, pick_score: 10, mileage_km: 1000 }), car({ id: 'g1', grade_num: 5, pick_score: 5 }), car({ id: 'g2', grade_num: 4.5, pick_score: 4 })]
  const sb = shortlist(pool, () => true, { nowYear: NOW, blocked })
  ok(!sb.top.concat(sb.mid).some((l) => l.id === 'b1'), 'blocked: the best car is not on the short list when it breaks a rule')
  const fb = finalize(shortlist(pool, () => true, { nowYear: NOW }), () => true, { nowYear: NOW, blocked })
  const picked = fb.top.concat(fb.mid).map((l) => l.id)
  ok(!picked.includes('b1') && picked.includes('g1') && picked.includes('g2'), 'blocked: and not in the final pick; the other cars are picked instead')
  const seen = []
  finalize(shortlist(pool, () => true, { nowYear: NOW, blocked: (l, after) => { seen.push(after); return null } }), () => true, { nowYear: NOW, blocked: (l, after) => { seen.push(after); return null } })
  ok(seen.includes(false) && seen.includes(true), 'blocked: it is asked before the reading (false) and after it (true)')
}

ok(sameCode('3BA-AGH40W', 'AGH40W') && sameCode('agh40w', '6AA-AGH40W') && !sameCode('AGH30W', 'AGH40W') && !sameCode(null, null), 'model code compare ignores the emission prefix')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

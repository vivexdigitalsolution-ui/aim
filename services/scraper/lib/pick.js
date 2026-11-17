'use strict'

/**
 * lib/pick.js — chooses the cars of the offer report for ONE model (pure functions: no database, no AI, easy to test).
 *
 *   2 "top"  = nearly perfect: grade 4.5 or better, clean interior, lowest mileage for the year
 *   3 "mid"  = grade 4–5 with something to sell: Claude's 0–10 highlight score (modified, high spec, low mileage for the year,
 *              no accident, only light scratches)
 *
 * Two more rules:
 *   - age: a car under 12 months old is only used when it is at most 3 months short of one year (now Nov 2026: first registered Feb 2026 or earlier).
 *     First registration month unknown (this year's car): it is read first, and dropped after the reading if the month is too late.
 *   - rare colour: cars in a colour that is not white / black / silver / grey get a place on the read list and a bonus on the mid-tier score.
 *
 * blocked(lot, afterReading) -> a reason text when the car breaks a hard rule (app/utils/recommendRules.ts: mileage over 10,000 km a year,
 *   sheet not readable, too new, grade OTHERS); the car is then never picked and another one takes its place.
 * Fuel option: fuelOk(lot) -> false drops a car whose fuel type is switched off (diesel / hybrid / plug-in); the caller builds it (app/utils/fuel.ts).
 * Blank rule: a car with NO history price AND NO duty is never picked (allowBlank turns the rule off). One of the two is enough.
 * The duty is only known once the car was read, so an unread car is never dropped for it.
 *
 * Cars whose model has a sold-price history come first (the report shows the history price); cars without one are only used
 * when there are not enough with one.
 * Two steps, so Claude only reads a short list instead of every car:
 *   shortlist()  rules only  -> { top, mid } cars to read
 *   finalize()   after the reading (pick_score / accident are on the lots) -> the final { top, mid }
 */

const { isOthersCar: isOthers } = require('./rules')      // RULE: a car whose grade name is OTHERS is never recommended
const TOP_N = 2, MID_N = 3
const TOP_POOL = 6, MID_POOL = 10          // how many cars Claude reads per model, at most

const kmPerYear = (l, nowYear = new Date().getFullYear()) => {
  if (l.mileage_km == null) return Infinity
  const age = Math.max(1, nowYear - (l.mfg_year || nowYear) + 1)
  return l.mileage_km / age
}
const gradeNum = (l) => (l.grade_num == null ? 0 : Number(l.grade_num))
const interiorOk = (l) => !l.interior_grade || /^[AB]/i.test(String(l.interior_grade))     // A / B interior; unknown is allowed
/** 3BA-AGH40W and AGH40W are the same model: compare without the emission prefix. */
const codeCore = (c) => String(c || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')
const sameCode = (a, b) => { const x = codeCore(a), y = codeCore(b); return x.length >= 3 && x === y }
const MAX_SHORT_MONTHS = 3          // a car may be at most 3 months short of one year old
/** false when the car is too new: under 12 months and more than 3 months short of a year. */
function ageOk(l, nowYear = new Date().getFullYear(), nowMonth = new Date().getMonth() + 1) {
  const y = l.mfg_year, m = l.mfg_month ?? l.first_reg_month
  if (!y) return true
  if (!m) return y < nowYear || y === nowYear                // month unknown: the sheet reading decides later (finalize)
  return (nowYear - y) * 12 + (nowMonth - m) >= 12 - MAX_SHORT_MONTHS
}
/** Month known and still too new (used after the reading). */
const tooNew = (l, nowYear, nowMonth) => !!((l.mfg_month ?? l.first_reg_month) && l.mfg_year) && !ageOk(l, nowYear, nowMonth)
const COMMON_COLOUR = /white|black|silver|gr[ae]y|pearl|^$|白|黒|銀|グレー|パール|ホワイト|ブラック|シルバー/i
const isRare = (l) => { const c = String(l.color || '').trim(); return c !== '' && !COMMON_COLOUR.test(c) }
const RARE_BONUS = 2
const histKey = (l) => `${l.brand}|${l.model}`.toUpperCase()

/** Orders by: has history first, then the given comparator. */
function byHistoryThen(hasHist, cmp) {
  return (a, b) => (hasHist(b) - hasHist(a)) || cmp(a, b)
}

/** historyKeys: a Set of 'BRAND|MODEL' keys, or a function (lot) => true when the car has a history price. */
const histFn = (historyKeys) => (typeof historyKeys === 'function' ? (l) => (historyKeys(l) ? 1 : 0) : (l) => (historyKeys.has(histKey(l)) ? 1 : 0))
/** hasDuty(lot): true / false once the car was read, null when not read yet; without it the rule is not applied. */
const isBlank = (l, hasHist, hasDuty, allowBlank) => !allowBlank && !!hasDuty && !hasHist(l) && hasDuty(l) === false

function shortlist(lots, historyKeys, { nowYear = new Date().getFullYear(), nowMonth = new Date().getMonth() + 1, topPool = TOP_POOL, midPool = MID_POOL, hasDuty = null, allowBlank = false, fuelOk = null, blocked = null } = {}) {
  const hasHist = histFn(historyKeys)
  const ok = lots.filter((l) => !isOthers(l) && gradeNum(l) >= 4 && interiorOk(l) && l.accident !== true && ageOk(l, nowYear, nowMonth) && !isBlank(l, hasHist, hasDuty, allowBlank) && (!fuelOk || fuelOk(l)) && (!blocked || !blocked(l, false)))
  const top = ok.filter((l) => gradeNum(l) >= 4.5)
    .sort(byHistoryThen(hasHist, (a, b) => gradeNum(b) - gradeNum(a) || kmPerYear(a, nowYear) - kmPerYear(b, nowYear))).slice(0, topPool)
  const inTop = new Set(top.map((l) => l.id))
  const mid = ok.filter((l) => !inTop.has(l.id))
    .sort(byHistoryThen(hasHist, (a, b) => (isRare(b) - isRare(a)) || kmPerYear(a, nowYear) - kmPerYear(b, nowYear) || gradeNum(b) - gradeNum(a))).slice(0, midPool)
  return { top, mid }
}

function finalize({ top, mid }, historyKeys, { nowYear = new Date().getFullYear(), nowMonth = new Date().getMonth() + 1, topN = TOP_N, midN = MID_N, hasDuty = null, allowBlank = false, fuelOk = null, blocked = null } = {}) {
  const hasHist = histFn(historyKeys)
  const clean = (l) => !isOthers(l) && l.accident !== true && !tooNew(l, nowYear, nowMonth) && !isBlank(l, hasHist, hasDuty, allowBlank) && (!fuelOk || fuelOk(l)) && (!blocked || !blocked(l, true))
  const chosen = new Set()
  const take = (list, n, cmp) => {
    const out = []
    for (const l of [...list].filter((x) => clean(x) && !chosen.has(x.id)).sort(byHistoryThen(hasHist, cmp))) {
      if (out.length >= n) break
      out.push(l); chosen.add(l.id)
    }
    return out
  }
  const topCmp = (a, b) => gradeNum(b) - gradeNum(a) || kmPerYear(a, nowYear) - kmPerYear(b, nowYear)
  const score = (l) => (l.pick_score ?? -1) + (isRare(l) ? RARE_BONUS : 0)
  const midCmp = (a, b) => score(b) - score(a) || kmPerYear(a, nowYear) - kmPerYear(b, nowYear)
  const t = take(top, topN, topCmp)
  const m = take([...mid, ...top], midN + (topN - t.length), midCmp)       // a missing top car is made up from the mid list
  return { top: t, mid: m }
}

module.exports = { isOthers, isBlank, histFn, ageOk, isRare, sameCode, codeCore, shortlist, finalize, kmPerYear, histKey, TOP_N, MID_N }

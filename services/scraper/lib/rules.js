'use strict'

/**
 * lib/rules.js — scraping / recommending rules that must hold everywhere (pure, no database).
 *
 * RULE: a car whose grade name is "OTHERS" (その他: the auction did not name the grade) is never scraped and never recommended,
 * because its trim is unknown (no docket, no same-grade history).
 */

/** The raw grade name of a listing row ("OTHERS"). */
const isOthersGrade = (grade) => /^(others?|その他)(\s|$)/i.test(String(grade || '').trim())

/** A saved lot: the grade name is the tail of lots.model ("5HB OTHERS", "DEFENDER OTHERS"). */
const isOthersCar = (lot) => /(^|\s)(others?|その他)$/i.test(String((lot && lot.model) || '').trim())

module.exports = { isOthersGrade, isOthersCar }

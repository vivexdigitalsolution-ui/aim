'use strict'

/**
 * lib/filters.js — the "keep only" rules of a scrape target, shared by every scrape type. Pure functions.
 *   model codes: keep only cars of the chosen chassis codes (empty = every code)
 *   grades:      keep only cars of the chosen variants (empty = every variant). A target uses codes OR grades, never both.
 */

const { fullModel } = require('./writer')

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const core = (c) => String(c || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')

/** the variant name as the pick list shows it: the listing's grade without the model name in front ("Z PREMIUM", not "ALPHARD Z PREMIUM") */
function gradeName(modelName, grade) {
  const full = fullModel(modelName, grade), m = String(modelName || '').trim()
  return (full.toUpperCase().startsWith(m.toUpperCase()) ? full.slice(m.length) : full).trim()
}

function codeMatches(target, modelCode) {
  const list = target.model_codes
  if (!Array.isArray(list) || !list.length) return true
  const mine = core(modelCode)
  return list.some((c) => core(c) === mine || (mine && core(c).endsWith(mine)) || (mine && mine.endsWith(core(c))))
}

function gradeMatches(target, rowGrade) {
  const list = target.grades
  if (!Array.isArray(list) || !list.length) return true
  const mine = norm(gradeName(target.model_name, rowGrade))
  return list.some((g) => norm(g) === mine)
}

/** @returns {string|null} why the car is left out, or null to keep it */
function whyLeftOut(target, row) {
  if (!codeMatches(target, row.model_code)) return `model code ${row.model_code || '?'} is not on the target list`
  if (!gradeMatches(target, row.grade)) return `variant ${row.grade || '?'} is not on the target list`
  return null
}

module.exports = { gradeName, codeMatches, gradeMatches, whyLeftOut }

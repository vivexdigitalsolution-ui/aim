'use strict'

/**
 * lib/targets.js — "make sure these models have scrape targets, and scrape just them". Shared by offer.js and deep.js.
 * models: rows with { maker_code, car_code, brand_name, model_name } (an offer model, or a deep search).
 */

const { spawnSync } = require('child_process')
const path = require('path')
const supabase = require('./db')

async function ensureTargets(models) {
  const year = new Date().getFullYear()
  const once = [...new Map(models.map((m) => [m.maker_code + '|' + m.car_code, m])).values()]      // two rows of one model (two codes) share one scrape
  const rows = once.flatMap((m) => ['bid', 'history'].map((t) => ({
    label: `${m.brand_name} / ${m.model_name} (${t})`, lot_type: t, maker_code: m.maker_code, car_code: m.car_code,
    brand_name: m.brand_name, model_name: m.model_name, year_from: year - 5, year_to: year, enabled: true,
  })))
  const up = await supabase.from('scrape_targets').upsert(rows, { onConflict: 'source,lot_type,maker_code,car_code', ignoreDuplicates: true })
  if (up.error) throw new Error('targets: ' + up.error.message)
  for (const m of once) {      // a model asked for here is always scraped, history included
    const en = await supabase.from('scrape_targets').update({ enabled: true }).eq('maker_code', m.maker_code).eq('car_code', m.car_code)
    if (en.error) throw new Error('targets: ' + en.error.message)
  }
}

/** The rule: a model with Bidding or One price switched on always has History switched on too (its selling price comes from History). */
async function ensureHistory() {
  const all = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('scrape_targets').select('id,source,lot_type,maker_code,car_code,brand_name,model_name,year_from,year_to,scores,enabled,priority').order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    all.push(...data)
    if (data.length < 1000) break
  }
  const key = (t) => t.source + '|' + t.maker_code + '|' + t.car_code
  const history = new Map(all.filter((t) => t.lot_type === 'history').map((t) => [key(t), t]))
  const on = [], add = new Map()
  for (const t of all) {
    if (!t.enabled || t.lot_type === 'history' || t.source === 'asnet') continue      // ASNET has no sold history to read
    const h = history.get(key(t))
    if (h) { if (!h.enabled) on.push(h.id) } else add.set(key(t), t)
  }
  for (let i = 0; i < on.length; i += 200) {
    const { error } = await supabase.from('scrape_targets').update({ enabled: true, status: 'live', zero_count: 0, disabled_reason: null }).in('id', on.slice(i, i + 200))
    if (error) throw new Error(error.message)
  }
  if (add.size) {
    const rows = [...add.values()].map((t) => ({ label: `${t.brand_name} / ${t.model_name} (history)`, lot_type: 'history', source: t.source, maker_code: t.maker_code, car_code: t.car_code, brand_name: t.brand_name, model_name: t.model_name, year_from: t.year_from, year_to: t.year_to, scores: t.scores, priority: t.priority, enabled: true, status: 'live' }))
    const { error } = await supabase.from('scrape_targets').insert(rows)
    if (error) throw new Error(error.message)
  }
  if (on.length || add.size) console.log(`[TARGETS] History switched on for ${on.length + add.size} model(s) that have Bidding or One price on`)
}

/**
 * Runs scrape.js for exactly these models, every venue, even if done today.
 * extraEnv: e.g. { YEAR_FROM: '2018', SCORE_MIN: '3.5' } to widen or narrow the filter for this run only (the .env values are the default).
 */
function runScrape(mode, models, { extraEnv = {}, hint = '' } = {}) {
  console.log(`\n=== scrape ${mode} (all venues) ===`)
  // OFFER_MODELS: exactly these models are scraped (lib/lock.js), not every model in the offer list
  const only = [...new Set(models.map((m) => m.maker_code + '|' + m.car_code))].join(',')
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scrape.js'), mode], { stdio: 'inherit', env: { ...process.env, ...extraEnv, OFFER_ONLY: '1', OFFER_MODELS: only } })
  if (r.status !== 0) throw new Error(`scrape.js ${mode} stopped (exit ${r.status}).${hint ? ' ' + hint : ''}`)
}

module.exports = { ensureTargets, ensureHistory, runScrape }

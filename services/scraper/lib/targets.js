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

module.exports = { ensureTargets, runScrape }

'use strict'

/** lib/ref.js — the reference data the duty maths needs (dockets, duty rates, currencies, exchange rates), read once per run. */

const path = require('path')
const { pathToFileURL } = require('url')
const supabase = require('./db')

async function all(table, cols, order) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).order(order).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

async function loadRef() {
  const duty = await import(pathToFileURL(path.join(__dirname, '..', '..', '..', 'packages', 'core', 'src', 'index.ts')).href)
  const num = (v) => (v === null || v === undefined ? null : Number(v))
  const [dockets, rates, currencies, targets, fxRows] = await Promise.all([
    all('custom_dockets', 'id,brand,model,cc,currency_code,bil,year,amt_12m_24m,amt_24m_36m,amt_36m_48m,amt_48m_60m,amt_60m_plus', 'id'),
    all('duty_rates', 'vehicle_type,cc_min,cc_max,multiplier,is_active', 'id'),
    all('currencies', 'code,rate_unit,standard_fare_myr,standard_fare_label', 'code'),
    all('scrape_targets', 'maker_code,car_code,model_name', 'id'),
    supabase.from('currency_rates').select('from_currency,rate,rate_date').eq('to_currency', 'MYR').order('rate_date', { ascending: false }).limit(200).then((r) => r.data || []),
  ])
  const fx = {}
  for (const r of fxRows) if (!fx[r.from_currency]) fx[r.from_currency] = { rate: Number(r.rate), date: r.rate_date }
  // the site's own model label of every scrape target ("4 SERIES", "3HB"): it leads the lot's model name and no docket has it
  const families = new Map()
  for (const t of targets) if (t.model_name && !families.has(t.maker_code + '|' + t.car_code)) families.set(t.maker_code + '|' + t.car_code, t.model_name)
  // migration 17 adds lots.steering: until it is run, the reading does not try to save it
  const hasSteering = !(await supabase.from('lots').select('steering').limit(1)).error
  // v2: dockets a person confirmed for an exact car (core confirmKey): used first, no AI cost
  const mappedDockets = dockets.map((d) => ({ ...d, amt_12m_24m: num(d.amt_12m_24m), amt_24m_36m: num(d.amt_24m_36m), amt_36m_48m: num(d.amt_36m_48m), amt_48m_60m: num(d.amt_48m_60m), amt_60m_plus: num(d.amt_60m_plus) }))
  const docketById = new Map(mappedDockets.map((d) => [d.id, d]))
  const confirmations = new Map()
  const cf = await supabase.from('docket_confirmations').select('key,docket_id')
  if (!cf.error) for (const r of cf.data) { const d = docketById.get(r.docket_id); if (d) confirmations.set(r.key, d) }
  return {
    duty, families, hasSteering, confirmations, hasDecisions: !cf.error, rates: rates.map((r) => ({ ...r, multiplier: Number(r.multiplier) })), currencies, fx,
    dockets: mappedDockets,
  }
}

module.exports = { all, loadRef }

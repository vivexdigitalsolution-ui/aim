'use strict'

/**
 * lib/board.js — the same picture the app's Today for you builds (open cars + catalog link + duty + market price + usual price), for scripts.
 * Plain data in, the shared core functions for the maths. It mirrors apps/aim/app/composables/useMarginBoard.ts (staff version): keep the two in step.
 */

const supabase = require('./db')

async function all(make) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  return out
}
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

async function loadBoard(core) {
  // the yen rate and the Offer report's fees
  const pr = (await supabase.from('calc_presets').select('preset_key,amount').in('preset_key', ['fx_jpy_myr', 'offer_port_myr', 'offer_inland_myr', 'offer_ap_fee_myr'])).data || []
  const preset = (k) => { const r = pr.find((x) => x.preset_key === k); return r ? Number(r.amount) : NaN }
  // the live rate (latest in currency_rates, filled daily by fx.js); the old fixed preset is only the last resort
  let rate = Number((await supabase.from('currency_rates').select('rate').eq('from_currency', 'JPY').eq('to_currency', 'MYR').order('rate_date', { ascending: false }).limit(1).maybeSingle()).data?.rate) || 0
  if (!(rate > 0)) rate = preset('fx_jpy_myr')
  const fees = {
    portMyr: preset('offer_port_myr') >= 0 ? preset('offer_port_myr') : core.DEFAULT_PORT_MYR,
    inlandMyr: preset('offer_inland_myr') >= 0 ? preset('offer_inland_myr') : core.DEFAULT_INLAND_MYR,
    apFeeMyr: preset('offer_ap_fee_myr') >= 0 ? preset('offer_ap_fee_myr') : core.DEFAULT_AP_FEE_MYR,
  }

  const open = await all(() => supabase.from('lots').select('id,brand,model,model_code,grade,mfg_year,mileage_km,start_price_jpy,photos,venue,auction_date,lot_no,bid_deadline').gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true).order('bid_deadline').order('id'))
  const ids = open.map((l) => l.id)
  const cat = new Map(), cost = new Map()
  for (const part of chunks(ids, 100)) {
    const [c, k] = await Promise.all([supabase.from('lot_catalog').select('lot_id,variant_id,model_id,level').in('lot_id', part), supabase.from('lot_costs').select('lot_id,duty_myr').in('lot_id', part)])
    for (const r of c.data || []) cat.set(r.lot_id, r)
    for (const r of k.data || []) if (r.duty_myr != null) cost.set(r.lot_id, Number(r.duty_myr))
  }

  const num = (r) => ({ ...r, min_myr: Number(r.min_myr), p25_myr: Number(r.p25_myr), median_myr: Number(r.median_myr), p75_myr: Number(r.p75_myr), max_myr: Number(r.max_myr) })
  const latest = (await supabase.from('market_stats').select('as_of').eq('source', 'carznexus').order('as_of', { ascending: false }).limit(1)).data?.[0]?.as_of
  const snap = latest ? (await all(() => supabase.from('market_stats').select('*').eq('source', 'carznexus').eq('as_of', latest))).map(num) : []
  const manual = (await all(() => supabase.from('market_stats').select('*').eq('source', 'manual').order('as_of', { ascending: false }))).map(num)
  const market = core.mergeManualRows(snap, manual)

  const lots = open.map((l) => {
    const c = cat.get(l.id), link = c ? { variantId: c.variant_id, modelId: c.model_id } : { variantId: null, modelId: null }
    return { ...l, variant_id: link.variantId, model_id: link.modelId, level: c?.level || 'none', dutyMyr: cost.get(l.id) ?? null, market: core.lookupMarketById(market, { ...link, year: l.mfg_year }), history: null }
  })
  const need = lots.filter((l) => l.market && l.dutyMyr != null)
  // the model family (migration 55): "GR COROLLA", not just the first word "GR" (that took the GR86 and GR Yaris too)
  const famOf = new Map()
  for (let i = 0; i < need.length; i += 100) {
    const f = await supabase.from('lots').select('id,model_family').in('id', need.slice(i, i + 100).map((l) => l.id))
    if (!f.error) for (const r of f.data || []) if (r.model_family) famOf.set(r.id, r.model_family)
  }
  const famKey = (l) => l.brand + '|' + (famOf.get(l.id) || l.model.split(/\s+/)[0])
  const hist = new Map()
  for (const key of new Set(need.map(famKey))) {
    const i = key.indexOf('|'), b = key.slice(0, i), w = key.slice(i + 1)
    const { data } = await supabase.from('lot_history').select('grade,sold_price_jpy,mfg_year,model_code').eq('brand', b).ilike('model', w + '%').eq('result', 'sold').not('sold_price_jpy', 'is', null).order('auction_date', { ascending: false }).limit(2000)
    hist.set(key, data || [])
  }
  for (const l of need) {
    const sales = (hist.get(famKey(l)) || []).filter((s) => l.mfg_year && s.mfg_year && Math.abs(s.mfg_year - l.mfg_year) <= 1).map((s) => ({ grade: s.grade, price: Number(s.sold_price_jpy), model_code: s.model_code }))
    l.history = core.historyPrice(sales, l.grade, l.model_code)
  }

  function evaluate(l, s) {
    const none = { ...l, sellMyr: null, confidence: 'none', maxBid: null, atHistory: null }
    if (!l.market || l.dutyMyr == null || !(rate > 0)) return none
    const { sellMyr, confidence } = core.sellFromRow(l.market.row, l.market.wider)
    if (!sellMyr) return { ...none, confidence }
    const costs = { rate, dutyMyr: l.dutyMyr, reconMyr: s.reconMyr, portMyr: fees.portMyr, inlandMyr: fees.inlandMyr, apFeeMyr: s.apFeeMyr ?? fees.apFeeMyr }
    const at = l.history ? core.marginAtBid({ bodyJpy: l.history.price, sellMyr, ...costs }) : null
    return { ...l, sellMyr, confidence, maxBid: core.maxBidJpy({ sellMyr, targetPct: s.targetPct, ...costs }), atHistory: at ? { profitMyr: at.profitMyr, marginPct: at.marginPct, landedMyr: at.landedMyr } : null }
  }
  return { lots, rate, fees, evaluate }
}

module.exports = { loadBoard }

import { DEFAULT_PORT_MYR, DEFAULT_INLAND_MYR, DEFAULT_AP_FEE_MYR, historyPrice, lookupMarketById, sellFromRow, maxBidJpy, marginAtBid, type IdMarketRow, type Confidence } from '@aim/core'

export interface BoardLot {
  id: string; brand: string; model: string; model_code: string | null; grade: string | null; mfg_year: number | null; mileage_km: number | null
  start_price_jpy: number | null; photos: string[] | null; venue: string; auction_date: string; lot_no: string; bid_deadline: string
  variant_id: string | null; model_id: string | null; level: 'variant' | 'model' | 'none'
  dutyMyr: number | null            // staff: the duty. AP holder: duty + port + inland as ONE number (never the duty alone)
  market: { row: IdMarketRow; wider: boolean } | null
  history: { price: number; n: number; basis: string } | null
}
export interface Settings { targetPct: number; reconMyr: number; apFeeMyr: number }
export interface Evaluated extends BoardLot {
  sellMyr: number | null; confidence: Confidence; maxBid: number | null
  headroom: number | null            // max bid minus the usual winning price: positive = room to move
  atHistory: { profitMyr: number; marginPct: number; landedMyr: number } | null
}

/**
 * Everything the margin screens need, loaded once: open lots, their catalog link, duty, the Malaysian market row (by catalog ids) and the usual winning price
 * (history price of the same model and grade). Staff only today: duty (lot_costs) is staff-only data.
 */
export function useMarginBoard() {
  const db = useDb()
  const { isStaff } = useAuth()
  const { load: loadRef } = useReference()
  const fees = useState('margin-fees', () => ({ portMyr: DEFAULT_PORT_MYR, inlandMyr: DEFAULT_INLAND_MYR, apFeeMyr: DEFAULT_AP_FEE_MYR }))
  const lots = useState<BoardLot[]>('margin-lots', () => [])
  const rate = useState<number>('margin-rate', () => 0)
  const marketAsOf = useState<string | null>('margin-asof', () => null)
  const marketRows = useState<IdMarketRow[]>('margin-market', () => [])
  const stats = useState('margin-stats', () => ({ open: 0, noLink: 0, noMarket: 0, noDuty: 0 }))
  const loaded = useState('margin-loaded', () => false)

  const chunks = <T,>(a: T[], n: number) => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

  async function load(force = false) {
    if (loaded.value && !force) return
    if (isStaff.value) {
      const ref = await loadRef()
      rate.value = ref.fx['JPY']?.rate || 0
      // the Offer report's own settings, so staff see the same numbers as the report
      const pr = await db.from('calc_presets').select('preset_key,amount').in('preset_key', ['fx_jpy_myr', 'offer_port_myr', 'offer_inland_myr', 'offer_ap_fee_myr'])
      const g = (k: string) => Number((pr.data || []).find((r: any) => r.preset_key === k)?.amount)
      if (g('fx_jpy_myr') > 0) rate.value = g('fx_jpy_myr')
      fees.value = { portMyr: g('offer_port_myr') >= 0 ? g('offer_port_myr') : DEFAULT_PORT_MYR, inlandMyr: g('offer_inland_myr') >= 0 ? g('offer_inland_myr') : DEFAULT_INLAND_MYR, apFeeMyr: g('offer_ap_fee_myr') >= 0 ? g('offer_ap_fee_myr') : DEFAULT_AP_FEE_MYR }
    } else {
      const r = await db.rpc('ap_jpy_rate')
      if (r.error) throw r.error
      rate.value = Number(r.data) || 0
      fees.value = { portMyr: 0, inlandMyr: 0, apFeeMyr: DEFAULT_AP_FEE_MYR }   // port + inland are inside the one cost number the server gives an AP
    }

    const open: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('lots').select('id,brand,model,model_code,grade,mfg_year,mileage_km,start_price_jpy,photos,venue,auction_date,lot_no,bid_deadline')
        .gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true).order('bid_deadline').range(from, from + 999)
      if (error) throw error
      open.push(...(data || []))
      if ((data || []).length < 1000) break
    }
    const ids = open.map((l) => l.id)
    const cat = new Map<string, any>(), cost = new Map<string, number>()
    for (const part of chunks(ids, 100)) {
      const [c, k] = await Promise.all([
        db.from('lot_catalog').select('lot_id,variant_id,model_id,level').in('lot_id', part),
        isStaff.value ? db.from('lot_costs').select('lot_id,duty_myr').in('lot_id', part) : db.rpc('ap_lot_costs', { p_lot_ids: part }),
      ])
      if (c.error) throw c.error
      if (k.error) throw k.error
      for (const r of c.data || []) cat.set(r.lot_id, r)
      for (const r of (k.data || []) as any[]) { const v = isStaff.value ? r.duty_myr : r.fixed_myr; if (v != null) cost.set(r.lot_id, Number(v)) }
    }

    // the newest market snapshot
    const latest = await db.from('market_stats').select('as_of').order('as_of', { ascending: false }).limit(1)
    marketAsOf.value = latest.data?.[0]?.as_of || null
    const mk: IdMarketRow[] = []
    if (marketAsOf.value) {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('market_stats').select('*').eq('as_of', marketAsOf.value).range(from, from + 999)
        if (error) throw error
        mk.push(...((data || []) as any[]).map((r) => ({ ...r, min_myr: Number(r.min_myr), p25_myr: Number(r.p25_myr), median_myr: Number(r.median_myr), p75_myr: Number(r.p75_myr), max_myr: Number(r.max_myr) })))
        if ((data || []).length < 1000) break
      }
    }
    marketRows.value = mk

    const out: BoardLot[] = open.map((l) => {
      const c = cat.get(l.id)
      const link = c ? { variantId: c.variant_id as string | null, modelId: c.model_id as string | null } : { variantId: null, modelId: null }
      return {
        ...l, variant_id: link.variantId, model_id: link.modelId, level: c?.level || 'none',
        dutyMyr: cost.get(l.id) ?? null, market: lookupMarketById(mk, { ...link, year: l.mfg_year }), history: null,
      }
    })

    // the usual winning price: sold results of the same brand + model name, cars of nearly the same year, same grade (core historyPrice)
    const need = out.filter((l) => l.market && l.dutyMyr != null)
    const hist = new Map<string, any[]>()
    for (const key of new Set(need.map((l) => l.brand + '|' + l.model.split(/\s+/)[0]))) {
      const [b, w] = key.split('|')
      const { data } = await db.from('lot_history').select('grade,sold_price_jpy,mfg_year').eq('brand', b).ilike('model', w + '%').eq('result', 'sold').not('sold_price_jpy', 'is', null).order('auction_date', { ascending: false }).limit(500)
      hist.set(key, data || [])
    }
    for (const l of need) {
      const sales = (hist.get(l.brand + '|' + l.model.split(/\s+/)[0]) || []).filter((s) => l.mfg_year && s.mfg_year && Math.abs(s.mfg_year - l.mfg_year) <= 1).map((s) => ({ grade: s.grade, price: Number(s.sold_price_jpy) }))
      l.history = historyPrice(sales, l.grade)
    }

    lots.value = out
    stats.value = { open: out.length, noLink: out.filter((l) => l.level === 'none').length, noMarket: out.filter((l) => !l.market).length, noDuty: out.filter((l) => l.dutyMyr == null).length }
    loaded.value = true
  }

  /** The numbers for one lot under the chosen target margin and recon cost. Pure: no database. */
  function evaluate(l: BoardLot, s: Settings): Evaluated {
    const none: Evaluated = { ...l, sellMyr: null, confidence: 'none', maxBid: null, headroom: null, atHistory: null }
    if (!l.market || l.dutyMyr == null || !(rate.value > 0)) return none
    const { sellMyr, confidence } = sellFromRow(l.market.row, l.market.wider)
    if (!sellMyr) return { ...none, confidence }
    const costs = { rate: rate.value, dutyMyr: l.dutyMyr, reconMyr: s.reconMyr, portMyr: fees.value.portMyr, inlandMyr: fees.value.inlandMyr, apFeeMyr: s.apFeeMyr }
    const maxBid = maxBidJpy({ sellMyr, targetPct: s.targetPct, ...costs })
    const at = l.history ? marginAtBid({ bodyJpy: l.history.price, sellMyr, ...costs }) : null
    return { ...l, sellMyr, confidence, maxBid, headroom: l.history ? maxBid - l.history.price : null, atHistory: at ? { profitMyr: at.profitMyr, marginPct: at.marginPct, landedMyr: at.landedMyr } : null }
  }

  return { lots, rate, fees, marketAsOf, marketRows, stats, loaded, load, evaluate }
}

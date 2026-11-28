<template>
  <div>
    <h1>Cars at auction</h1>
    <p class="muted" style="margin: 0 0 16px">Open cars with prices in RM (starting price at today's rate). Place a bid order on any car before it closes.</p>

    <div class="card filters">
      <div class="sbox"><input v-model="q" placeholder="Search make or model" @keyup.enter="reload" /><button v-if="q" class="clr" type="button" aria-label="Clear the search" title="Clear" @click="clearQ">×</button></div>
      <select v-model="kind" aria-label="Type of sale" @change="reload"><option value="bidding">Bidding</option><option value="one_price">One price</option></select>
      <select v-model="brand" @change="reload"><option value="">All makes</option><option v-for="b in brands" :key="b" :value="b">{{ b }}</option></select>
      <select v-model.number="yearFrom" aria-label="Year from" @change="reload"><option :value="0">Year from</option><option v-for="y in years" :key="y" :value="y">{{ y }}</option></select>
      <select v-model.number="yearTo" aria-label="Year to" @change="reload"><option :value="0">Year to</option><option v-for="y in years" :key="y" :value="y">{{ y }}</option></select>
      <NumInput v-model="maxRm" class="maxp" placeholder="Max price RM" @keyup.enter="reload" />
      <select v-model="sort" @change="reload">
        <option value="closing">Closing soonest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
        <option value="year_desc">Newest year</option><option value="km_asc">Lowest mileage</option>
      </select>
      <button class="btn" @click="reload">Search</button>
      <label class="hidev"><input type="checkbox" :checked="!!hide" @change="hide = ($event.target as HTMLInputElement).checked ? 1 : 0; reload()" /> Hide viewed</label>
      <div class="cur" role="group" aria-label="Currency"><button :class="{ on: cur === 'RM' }" @click="setCur('RM')">RM</button><button :class="{ on: cur === 'JPY' }" @click="setCur('JPY')">¥</button></div>
    </div>
    <div v-if="rate" class="muted small" style="margin: 8px 2px 0">Rate used: ¥1 = RM {{ rate }}</div>

    <div v-if="err" class="err" style="margin-top: 12px">{{ err }}</div>
    <div class="muted small" style="margin: 12px 2px">{{ loading ? 'Loading ...' : total + ' car' + (total === 1 ? '' : 's') }}<template v-if="hide && !loading && shown.length < cars.length"> · {{ cars.length - shown.length }} viewed hidden</template></div>

    <div class="grid cars">
      <NuxtLink v-for="c in shown" :key="c.id" :to="c.op ? `/one-price/${c.id}` : `/car/${c.id}`" class="card car" :class="{ seen: viewed.has(c.id) }" @click="viewed.mark(c.id)">
        <div class="ph"><img v-if="c.photos?.[0] && !broken.has(c.id)" :src="c.photos[0]" loading="lazy" alt="" @error="broken.add(c.id)" /><span v-else>no photo</span>
          <span v-if="c.venue" class="glass loc">{{ c.venue }}</span>
          <span v-if="viewed.has(c.id)" class="glass vw"><RailIcon name="eye" />Viewed</span>
          <span v-if="c.bid_deadline" class="glass tm" :class="glassCls(c.bid_deadline)" :title="closingTimeText(c.bid_deadline)">{{ closes(c.bid_deadline) }}</span>
          <button v-if="!isStaff" class="star" :class="{ on: watch.has(c.id) }" :title="watch.has(c.id) ? 'Remove from favourites' : 'Add to favourites'" @click.prevent.stop="star(c.id, !!c.op)"><RailIcon name="heart" :filled="watch.has(c.id)" /></button></div>
        <div class="body">
          <div class="pricerow">
            <div class="estrow" :class="{ opc: c.op }">
              <div v-if="impOf(c) && impOf(c)!.kind !== 'none'" class="est" :class="{ col: c.op }" :title="c.op ? 'Estimated import price at the One price' : 'Estimated import price at the suggested bid (what cars like this usually sell for)'">
                <template v-if="impOf(c)!.kind === 'amt'"><span class="el">{{ c.op ? 'Estimate Import Price' : 'Est.' }}</span>
                <b class="ev">RM {{ Math.round(impOf(c)!.myr!).toLocaleString('en-US') }}</b>
                </template>
                <b v-else class="ev need">Pick docket</b>
              </div>
              <div v-else class="est" :class="{ col: c.op }" aria-hidden="true" style="visibility: hidden"><span class="el">{{ c.op ? 'Estimate Import Price' : 'Est.' }}</span><b class="ev">RM 0</b></div>
              <CarFlags :docket="c.op ? !!c.docket_id : flags.docket(c.id)" :review="c.op ? !!c.needs_review : flags.review(c.id)" />
            </div>
            <div class="sp" :class="{ hid: c.op }" :aria-hidden="c.op ? 'true' : undefined">{{ c.op ? 'One price' : 'Start price' }} <span>{{ c.op && !(c.start_price_jpy > 0) ? 'Not open yet' : money(c.start_price_jpy) }}</span></div>
          </div>
          <div class="namerow"><div class="name">{{ carTitle(c) }}</div></div>
          <div class="infochips">
            <span v-if="c.mfg_year" class="chip">{{ c.mfg_month ? c.mfg_year + '/' + String(c.mfg_month).padStart(2, '0') : c.mfg_year }}</span>
            <span v-if="c.mileage_km != null" class="chip">{{ c.mileage_km.toLocaleString('en-US') }} km</span>
            <span v-if="c.grade" class="chip">Grade {{ c.grade }}</span>
          </div>
        </div>
      </NuxtLink>
    </div>
    <div v-if="!loading && !shown.length" class="card muted">{{ cars.length ? 'You have already viewed every car on this page. Press Show more, or untick Hide viewed.' : 'No car matches. Try another make or a higher price.' }}</div>
    <button v-if="cars.length < total" class="btn ghost" style="margin-top: 16px" :disabled="loading" @click="more">Show more ({{ total - cars.length }} left)</button>
  </div>
</template>

<script setup lang="ts">
import { watch as vueWatch } from 'vue'
import { trimmedName, closesInfo, closingTimeText, docketPool, calcDuty, dutyMonth, offerPricing, type Docket, type DutyRate } from '@aim/core'
const db = useDb()
const now = useNow()
const { rate, loadRate, left, cur, loadCur, setCur, money } = useLite()
const watch = useWatch()
const { isStaff } = useAuth()
const broken = reactive(new Set<string>())      // photos that no longer load: show the grey box instead of a broken-image icon
function clearQ() { q.value = ''; reload() }
async function star(id: string, op = false) { try { await watch.toggle(id, op) } catch (e: any) { err.value = e.message } }
const q = ref(''), brand = ref(''), yearFrom = ref(0), yearTo = ref(0), kind = ref('bidding'), maxRm = ref<number | null>(null), sort = ref('closing'), hide = ref(0)
const viewed = useViewed()
const flags = useCarFlags()
const url = useUrlFilters('lite-cars', { q, brand, kind, yearFrom, yearTo, maxRm, sort, hide }, { sort: 'closing' })
const cars = ref<any[]>([]), total = ref(0), loading = ref(true), err = ref(''), brands = ref<string[]>([])
const PAGE = 24

// ── import price on each card ──
// Duty: the saved duty of the car when its docket was matched by the system; otherwise the docket the car page would pick (one docket = worked out here,
// several = "Pick docket", none = "No docket"). Car price: the suggested bid from the sold history (a One price car: its fixed price). Fees: the same as the car page.
// Customers (no import price for them) and cars with no suggested price show nothing.
const dutyRef = useState<{ dockets: Docket[]; rates: DutyRate[]; currencies: any[] } | null>('lite-duty-ref', () => null)
const cardFees = useState<{ port: number; inland: number; apFee: number } | null>('lite-card-fees', () => null)
const cardRows = reactive(new Map<string, any>())      // lot id -> { duty_myr, price_jpy } from the server
const canImp = ref(true)
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))
async function loadImpRef() {
  if (dutyRef.value && cardFees.value) return
  const [r, f] = await Promise.all([db.rpc('car_duty_reference'), db.rpc('import_fees_lite')])
  if (r.error) throw r.error
  const d = r.data
  dutyRef.value = { dockets: (d.dockets || []).map((x: any) => ({ ...x, amt_12m_24m: nn(x.amt_12m_24m), amt_24m_36m: nn(x.amt_24m_36m), amt_36m_48m: nn(x.amt_36m_48m), amt_48m_60m: nn(x.amt_48m_60m), amt_60m_plus: nn(x.amt_60m_plus) })), rates: (d.rates || []).map((x: any) => ({ ...x, multiplier: Number(x.multiplier) })), currencies: d.currencies || [] }
  const e = f.data?.effective
  cardFees.value = { port: Number(e?.port_myr) || 0, inland: Number(e?.inland_myr) || 0, apFee: Number(e?.ap_fee_myr) || 0 }
}
async function loadCardPrices(list: any[]) {
  if (!canImp.value) return
  try {
    await loadImpRef()
    const bid = list.filter((c) => !c.op && !cardRows.has(c.id))
    if (bid.length) {
      const { data, error } = await db.rpc('lite_card_prices', { p_ids: bid.map((c) => c.id) })
      if (error) throw error
      for (const r of data || []) cardRows.set(r.id, r)
      for (const c of bid) if (!cardRows.has(c.id)) cardRows.set(c.id, {})
    }
    cardTick.value++
  } catch { canImp.value = false }      // a customer account (or anything failing): no import price on the cards, the cars still show
}
const cardTick = ref(0)
function impOf(c: any): { kind: 'amt' | 'pick' | 'none'; myr?: number } | null {
  void cardTick.value
  const ref_ = dutyRef.value, fees = cardFees.value
  if (!canImp.value || !ref_ || !fees || !(rate.value > 0)) return null
  const row = cardRows.get(c.id)
  if (!c.op && !row) return null      // not loaded yet
  let duty: number | null = row?.duty_myr != null ? Number(row.duty_myr) : null
  if (duty == null) {
    const own = c.op && c.docket_id ? ref_.dockets.find((d) => d.id === c.docket_id) : null
    const pool = own ? [own] : docketPool(ref_.dockets, c).pool
    if (!pool.length) return { kind: 'none' }
    if (pool.length > 1) return { kind: 'pick' }
    const month = dutyMonth(c.mfg_year, c.mfg_month)
    if (!c.mfg_year || !month) return null
    const d = pool[0]!
    if (d.currency_code && d.currency_code !== 'JPY') return null
    duty = calcDuty({ docket: d, mfgYear: c.mfg_year, mfgMonth: month, rate: rate.value, rates: ref_.rates, standardFare: ref_.currencies.find((x: any) => x.code === 'JPY')?.standard_fare_myr ?? undefined, vehicleType: 'car', cc: d.cc ? undefined : c.engine_cc || undefined }).dutyMyr
  }
  const jpy = c.op ? (c.price_jpy > 0 ? Number(c.price_jpy) : null) : nn(row?.price_jpy)
  if (!jpy || duty == null) return null
  const p = offerPricing({ historyJpy: jpy, rate: rate.value, dutyMyr: duty, portMyr: fees.port, inlandMyr: fees.inland, apFeeMyr: fees.apFee })
  return p.importMyr != null ? { kind: 'amt', myr: p.importMyr } : null
}
const listBack = useListRestore('lite-cars', () => cars.value.length, () => total.value, more)      // Back from a car returns to the same place in the list
const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i)
const closes = (iso: string) => closesInfo(iso, now.value).text
const glassCls = (iso: string) => { const c = closesInfo(iso, now.value).cls; return c === 'late' || c === 'soon' ? 'warn' : c === 'unknown' || c === 'closed' ? 'off' : '' }
const chipCls = (iso: string) => { const c = closesInfo(iso, now.value).cls; return c === 'late' || c === 'soon' ? 'warn' : c === 'unknown' || c === 'closed' ? '' : 'ac' }

/** One price cars (a fixed price, no bidding): same card shape as a bidding car */
async function fetchOnePrice(from: number) {
  let query = openOffers(db.from('one_price_lots').select('id,brand,model,grade,auction_grade,mfg_year,mfg_month,mileage_km,venue,price_jpy,photos,deadline,needs_review,docket_id,engine_cc,transmission,model_code', { count: 'exact' }))
  if (brand.value) query = query.eq('brand', brand.value)
  const t = q.value.trim().replace(/[,()%]/g, ' ')
  if (t) query = query.or(`model.ilike.%${t}%,brand.ilike.%${t}%`)
  if (yearFrom.value) query = query.gte('mfg_year', yearFrom.value)
  if (yearTo.value) query = query.lte('mfg_year', yearTo.value)
  if (maxRm.value && rate.value > 0) query = query.lte('price_jpy', Math.round(maxRm.value / rate.value))
  const order: Record<string, [string, boolean]> = { closing: ['deadline', true], price_asc: ['price_jpy', true], price_desc: ['price_jpy', false], year_desc: ['mfg_year', false], km_asc: ['mileage_km', true] }
  const [col, asc] = order[sort.value] || order.closing!
  const { data, error, count } = await query.order(col, { ascending: asc, nullsFirst: false }).range(from, from + PAGE - 1)
  if (error) throw error
  total.value = count || 0
  const rows = (data || []).map((r: any) => ({ ...r, op: true, model: trimmedName(r.model, r.grade), grade: r.auction_grade, start_price_jpy: r.price_jpy, bid_deadline: r.deadline }))
  loadCardPrices(rows)
  return rows
}
async function fetchPage(from: number) {
  if (kind.value === 'one_price') return fetchOnePrice(from)
  let query = db.from('lots').select('id,brand,model,grade,mfg_year,mfg_month,mileage_km,venue,start_price_jpy,photos,bid_deadline,engine_cc,transmission,model_code', { count: 'exact' })
    .gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true)
  if (brand.value) query = query.eq('brand', brand.value)
  const t = q.value.trim().replace(/[,()%]/g, ' ')
  if (t) query = query.or(`model.ilike.%${t}%,brand.ilike.%${t}%`)
  if (yearFrom.value) query = query.gte('mfg_year', yearFrom.value)
  if (yearTo.value) query = query.lte('mfg_year', yearTo.value)
  if (maxRm.value && rate.value > 0) query = query.lte('start_price_jpy', Math.round(maxRm.value / rate.value))
  const order: Record<string, [string, boolean]> = { closing: ['bid_deadline', true], price_asc: ['start_price_jpy', true], price_desc: ['start_price_jpy', false], year_desc: ['mfg_year', false], km_asc: ['mileage_km', true] }
  const [col, asc] = order[sort.value] || order.closing!
  const { data, error, count } = await query.order(col, { ascending: asc, nullsFirst: false }).range(from, from + PAGE - 1)
  if (error) throw error
  total.value = count || 0
  flags.load((data || []).map((r: any) => r.id)).catch(() => {})
  loadCardPrices(data || [])
  return data || []
}
// the cars shown: with "Hide viewed" ticked, the ones opened before are left out (the page then loads more by itself until it has a screenful)
const shown = computed(() => (hide.value ? cars.value.filter((c) => !viewed.has(c.id)) : cars.value))
let autoMore = 0
vueWatch([shown, loading], async () => {
  if (hide.value && !loading.value && shown.value.length < 12 && cars.value.length < total.value && autoMore < 6) { autoMore++; await more() }
})
async function reload() { autoMore = 0; url.save(); loading.value = true; err.value = ''; try { cars.value = await fetchPage(0) } catch (e: any) { err.value = e.message } finally { loading.value = false } }
async function more() { loading.value = true; try { cars.value = [...cars.value, ...(await fetchPage(cars.value.length))] } catch (e: any) { err.value = e.message } finally { loading.value = false } }

onMounted(async () => {
  loadCur(); url.restore(); viewed.load(); watch.load().catch(() => {})
  try {
    await loadRate()
    const { data } = await db.from('lots').select('brand').gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true).limit(3000)
    brands.value = [...new Set((data || []).map((r: any) => r.brand))].sort() as string[]
  } catch (e: any) { err.value = e.message }
  await reload()
  await listBack.restore()
})
</script>

<style scoped>
.filters { display: flex; flex-wrap: wrap; gap: 10px; }
.maxp { width: 150px; }
.sbox { position: relative; flex: 1; min-width: 180px; display: flex; } .sbox input { width: 100%; padding-right: 36px; }
.clr { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 26px; height: 26px; border-radius: 50%; border: 0; background: var(--s3); color: var(--mu); font-size: 18px; line-height: 1; cursor: pointer; display: grid; place-items: center; padding: 0; } .clr:hover { background: var(--line); color: var(--tx); }
.cars { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); row-gap: 0; }
.car { padding: 0; overflow: hidden; color: inherit; transition: box-shadow .2s, transform .2s; display: grid; grid-template-rows: subgrid; grid-row: span 4; row-gap: 0; margin-bottom: 16px; }
.car:hover { box-shadow: 0 8px 24px rgba(20, 30, 60, .1); transform: translateY(-2px); }
.ph { aspect-ratio: 4 / 3; background: #e9edf3; display: grid; place-items: center; color: var(--mu2); font-size: 12px; overflow: hidden; }
.ph { position: relative; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.glass { position: absolute; z-index: 1; max-width: calc(100% - 64px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 700; line-height: 1.3; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, .35); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.glass.loc { top: 8px; left: 8px; background: rgba(255, 255, 255, .34); color: #0b1b33; text-shadow: 0 0 3px rgba(255, 255, 255, .85); }
.glass.vw { right: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 4px; background: rgba(255, 255, 255, .34); color: #0b1b33; text-shadow: 0 0 3px rgba(255, 255, 255, .85); } .glass.vw svg { width: 12px; height: 12px; }
.car.seen .ph img { opacity: .86; } .car.seen .name, .car.seen .ev { color: var(--mu); }
.hidev { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px; color: var(--mu); cursor: pointer; white-space: nowrap; } .hidev input { width: 16px; height: 16px; }
.glass.tm { left: 8px; bottom: 8px; background: rgba(13, 22, 40, .34); color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, .6); }
.glass.tm.warn { background: rgba(255, 180, 30, .5); color: #2b1d00; text-shadow: 0 0 3px rgba(255, 255, 255, .6); } .glass.tm.off { background: rgba(13, 22, 40, .3); color: #eef2f8; }
.star svg { width: 19px; height: 19px; display: block; }
.star { position: absolute; top: 8px; right: 8px; width: 34px; height: 34px; border-radius: 50%; border: 0; padding: 0; background: rgba(0, 0, 0, .55); color: #fff; line-height: 1; display: flex; align-items: center; justify-content: center; cursor: pointer; display: grid; place-items: center; }
.star.on { color: #ff5a6e; }
.cur { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.cur button { background: transparent; border: 0; color: inherit; padding: 6px 14px; cursor: pointer; font-weight: 600; }
.cur button.on { background: var(--ac); color: #fff; }
.body { display: contents; }
.body > * { padding-left: 14px; padding-right: 14px; }
.pricerow { grid-row: 2; padding-top: 12px; display: grid; align-content: start; gap: 1px; }
.estrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 28px; }
.est { display: flex; align-items: baseline; gap: 6px; } .est .el { font-size: 12px; font-weight: 700; color: var(--mu); } .est .ev { font-size: 19px; font-weight: 800; } .est .ev.need { font-size: 14px; color: var(--mu); }
.estrow.opc { min-height: 44px; } .est.col { flex-direction: column; align-items: flex-start; gap: 0; } .est.col .el { font-size: 11.5px; line-height: 1.2; }
.sp.hid { visibility: hidden; }      /* One price cars: the price is hidden for now, the line keeps its space so it can come back */
.sp { font-size: 12.5px; color: var(--mu); } .sp span { font-weight: 500; color: var(--tx); }
.namerow { grid-row: 3; align-items: flex-start; }
.infochips .chip { font-size: 11px; padding: 3px 8px; flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.infochips { grid-row: 4; display: flex; flex-wrap: nowrap; gap: 5px; padding-top: 6px; padding-bottom: 14px; align-content: flex-start; }
.plabel { font-size: 11.5px; color: var(--mu); line-height: 1.2; }
.price { font-size: 19px; font-weight: 800; }
.name { font-weight: 600; margin: 2px 0; }
.namerow { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; } .namerow .name { min-width: 0; }
@media (max-width: 760px) {
  .cars { grid-template-columns: 1fr 1fr; gap: 10px; }
  /* the filters on a phone: search on its own row, then two equal halves per row */
  .filters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .filters select { padding: 0 8px; text-overflow: ellipsis; }
  .filters .sbox { grid-column: 1 / -1; min-width: 0; }
  .filters input, .filters select, .filters .btn { width: 100%; min-width: 0; }
  .filters .cur { display: flex; width: 100%; } .filters .cur button { flex: 1; }
}
@media (max-width: 460px) { .cars { grid-template-columns: 1fr; } }
</style>

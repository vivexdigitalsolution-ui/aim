
<template>
  <div>
    <h1>Cars at auction</h1>
    <p class="sub">Every open car that passes the age rule, with the starting price in RM at today's rate. {{ hasTier('member') ? 'Open a car for its margin.' : 'Upgrade to see the margin on each car.' }}</p>

    <div v-if="!isCustomer" class="prefs">
      <span class="muted small">My preferences</span>
      <button v-for="p in prefs" :key="p.id" class="chip tag" :class="{ on: activePref?.id === p.id }" @click="togglePref(p)">{{ p.name }}</button>
      <button v-if="activePref" class="chip tag" @click="togglePref(activePref)">Clear</button>
      <NuxtLink to="/preferences" class="small ac">{{ prefs.length ? 'Manage' : '+ Save what you look for' }}</NuxtLink>
    </div>

    <div class="card filters">
      <input v-model="q" placeholder="Search make or model" style="flex: 1; min-width: 180px" @keyup.enter="reload" />
      <select v-model="kind" aria-label="Type of sale" @change="reload"><option value="bidding">Bidding</option><option value="one_price">One price</option></select>
      <select v-model="brand" @change="reload"><option value="">All makes</option><option v-for="b in brands" :key="b" :value="b">{{ b }}</option></select>
      <select v-model.number="yearFrom" aria-label="Year from" @change="reload"><option :value="0">Year from</option><option v-for="y in years" :key="y" :value="y">{{ y }}</option></select>
      <select v-model.number="yearTo" aria-label="Year to" @change="reload"><option :value="0">Year to</option><option v-for="y in years" :key="y" :value="y">{{ y }}</option></select>
      <NumInput v-model="maxRm" placeholder="Max price RM" style="width: 150px" @keyup.enter="reload" />
      <select v-model="sort" @change="reload">
        <option value="closing">Closing soonest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
        <option value="year_desc">Newest year</option><option value="km_asc">Lowest mileage</option>
      </select>
      <button class="btn" @click="reload">Search</button>
      <div class="cur" role="group" aria-label="Viewed cars"><button :class="{ on: !hide }" @click="setHide(0)">All</button><button :class="{ on: !!hide }" @click="setHide(1)">Hide viewed</button></div>
      <div class="cur" role="group" aria-label="Currency"><button :class="{ on: cur === 'RM' }" @click="setCur('RM')">RM</button><button :class="{ on: cur === 'JPY' }" @click="setCur('JPY')">¥</button></div>
    </div>
    <div v-if="rate" class="muted small" style="margin: 8px 2px 0">Rate used: ¥1 = RM {{ rate }}</div>

    <div v-if="err" class="err" style="margin-top: 12px">{{ err }}</div>
    <div class="muted small" style="margin: 12px 2px">{{ loading ? 'Loading ...' : total + ' car' + (total === 1 ? '' : 's') }}<template v-if="hide && !loading && shown.length < cars.length"> · {{ cars.length - shown.length }} viewed hidden</template></div>

    <div class="grid cars">
      <NuxtLink v-for="c in shown" :key="c.id" :to="c.op ? `/one-price/${c.id}` : `/cars/${c.id}`" class="card car" :class="{ seen: viewed.has(c.id) }" @click="viewed.mark(c.id)">
        <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /><span v-else>no photo</span>
          <span class="gl loc">{{ c.venue }}</span>
          <span class="gl tm" :class="glassCls(c.bid_deadline)" :title="closingTimeText(c.bid_deadline)">{{ closes(c.bid_deadline) }}</span>
          <button v-if="isStaff && !c.op" class="rec" :class="{ on: recs.has(c.id) }" :title="recs.has(c.id) ? 'Remove from the recommend list' : 'Recommend this car'" @click.prevent.stop="recommend(c.id)">{{ recs.has(c.id) ? '✔ Recommended' : '＋ Recommend' }}</button>
          <button class="star" :class="{ on: watch.has(c.id), low: isStaff && !c.op }" :title="watch.has(c.id) ? 'Remove from watchlist' : 'Watch this car'" @click.prevent.stop="star(c.id, !!c.op)"><StarIcon :filled="watch.has(c.id)" /></button>
          <div v-if="impOf(c)?.kind === 'amt'" class="estov" aria-hidden="true">
            <span class="el">Est. import price</span>
            <b class="ev">RM {{ Math.round(impOf(c)!.myr!).toLocaleString('en-US') }}</b>
            <span class="es">{{ c.op ? 'at the One price' : 'at the suggested bid' }}</span>
          </div></div>
        <div class="body">
          <div class="flrow"><CarFlags accent :docket="c.op ? !!c.docket_id : flags.docket(c.id)" :review="c.op ? !!c.needs_review : flags.review(c.id)" /></div>
          <div class="plabel">{{ c.op ? 'One price' : 'Start price' }}</div>
          <div class="price">{{ c.op && !(c.start_price_jpy > 0) ? 'Not open yet' : money(c.start_price_jpy) }}</div>
          <div v-if="!c.op && marginOf(c.id) != null" class="mg" :class="marginOf(c.id)! >= 0 ? 'up' : 'down'">Margin {{ money(marginOf(c.id)!, 'myr') }}</div>
          <div class="name">{{ carTitle(c) }}</div>
          <div class="pills">
            <span v-if="c.mfg_year" class="cpill">{{ c.mfg_month && c.mfg_year ? c.mfg_year + '/' + String(c.mfg_month).padStart(2, '0') : c.mfg_year }}</span>
            <span v-if="c.mileage_km != null" class="cpill">{{ c.mileage_km.toLocaleString('en-US') }} km</span>
            <span v-if="c.grade" class="cpill">Grade {{ c.grade }}</span>
          </div>
        </div>
      </NuxtLink>
    </div>
    <div v-if="!loading && !shown.length" class="card muted">{{ cars.length ? 'You have already viewed every car on this page. Press Show more, or switch back to All.' : 'No car matches. Try another make or a higher price.' }}</div>
    <button v-if="cars.length < total" class="btn ghost" style="margin-top: 16px" :disabled="loading" @click="more">Show more ({{ total - cars.length }} left)</button>
  </div>
</template>

<script setup lang="ts">
import { watch as vueWatch } from 'vue'
import { timeLeft, closesInfo, closingTimeText, docketPool, calcDuty, dutyMonth, offerPricing, type Docket, type DutyRate } from '@aim/core'

const db = useDb()
const now = useNow()
const { hasTier, isStaff, isCustomer } = useAuth()
const route = useRoute()
const { rate, loadRate } = useRate()
const watch = useWatch()
const recs = useRecommend()
async function recommend(id: string) { try { await recs.toggle(id) } catch (e: any) { err.value = e.message } }
// saved preferences: one tap applies a set (makes, models, years, price, score)
const prefs = ref<any[]>([]), activePref = ref<any>(null)
const SCORE_ORDER = ['S', '6', '5', '4.5', '4', '3.5', '3', '2', '1', 'R']
async function togglePref(p: any) { activePref.value = activePref.value?.id === p.id ? null : p; await reload() }
async function loadPrefs() {
  if (isCustomer.value) return
  const { data } = await db.from('saved_preferences').select('*').order('created_at')
  prefs.value = data || []
  const want = prefId.value
  if (want) activePref.value = prefs.value.find((p) => p.id === want) || null
}
const board = useMarginBoard()
const cur = ref<'RM' | 'JPY'>('RM')
function setCur(c: 'RM' | 'JPY') { cur.value = c; try { localStorage.setItem('cars-currency', c) } catch { /* private mode */ } }
/** The starting price in the chosen currency; a car with no starting price says so. `myr` = the number is already in RM. */
function money(v: number | null | undefined, unit: 'jpy' | 'myr' = 'jpy') {
  if (v == null || (unit === 'jpy' && !(v > 0))) return 'Price at auction'
  if (cur.value === 'JPY') return '¥' + Math.round(unit === 'jpy' ? v : rate.value > 0 ? v / rate.value : 0).toLocaleString('en-US')
  const myr = unit === 'jpy' ? v * rate.value : v
  return rate.value > 0 || unit === 'myr' ? 'RM ' + Math.round(myr).toLocaleString('en-US') : '—'
}
async function star(id: string, op = false) { try { await watch.toggle(id, op) } catch (e: any) { err.value = e.message } }
// the margin at the usual winning price (staff and Member plan); the cars page shows only this one number
const marginMap = computed(() => {
  const m = new Map<string, number>()
  if (!board.loaded.value) return m
  for (const l of board.lots.value) { const e = board.evaluate(l, { targetPct: 12, reconMyr: 3000, apFeeMyr: board.fees.value.apFeeMyr }); if (e.atHistory) m.set(l.id, e.atHistory.profitMyr) }
  return m
})
const marginOf = (id: string) => marginMap.value.get(id) ?? null
const q = ref(''), brand = ref(''), yearFrom = ref(0), yearTo = ref(0), kind = ref('bidding'), maxRm = ref<number | null>(null), sort = ref('closing')
const prefId = ref(''), hide = ref(0)
const viewed = useViewed()
const flags = useCarFlags()
const url = useUrlFilters('cars', { q, brand, kind, yearFrom, yearTo, maxRm, sort, pref: prefId, hide }, { sort: 'closing' })
const cars = ref<any[]>([]), total = ref(0), loading = ref(true), err = ref(''), brands = ref<string[]>([])
const PAGE = 24
// ── Est. import price (shows over the photo when the card is hovered) ──
// Duty: the saved duty of the car, or the one docket the car page would pick. Car price: the suggested bid from the sold history (One price car: its fixed price).
// Fees: the same as the car page. Customers (not allowed to see import prices) and cars with no suggested price or no single docket show nothing.
const dutyRef = useState<{ dockets: Docket[]; rates: DutyRate[]; currencies: any[] } | null>('cards-duty-ref', () => null)
const cardFees = useState<{ port: number; inland: number; apFee: number } | null>('cards-fees', () => null)
const cardRows = reactive(new Map<string, any>())
const canImp = ref(true), cardTick = ref(0)
const nn = (v: unknown) => (v === null || v === undefined ? null : Number(v))
async function loadImpRef() {
  if (dutyRef.value && cardFees.value) return
  const [r, f] = await Promise.all([db.rpc('car_duty_reference'), db.rpc('import_fees')])
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
  } catch { canImp.value = false }      // not allowed (customer) or failing: no import price on the cards, the cars still show
}
function impOf(c: any): { kind: 'amt' | 'pick' | 'none'; myr?: number } | null {
  void cardTick.value
  const ref_ = dutyRef.value, fees = cardFees.value
  if (!canImp.value || !ref_ || !fees || !(rate.value > 0)) return null
  const row = cardRows.get(c.id)
  if (!c.op && !row) return null
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
const listBack = useListRestore('aim-cars', () => cars.value.length, () => total.value, more)      // Back from a car returns to the same place in the list
const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i)
const left = (iso: string) => timeLeft(iso, now.value).label
const closes = (iso: string) => closesInfo(iso, now.value).text
const glassCls = (iso: string) => { const c = closesInfo(iso, now.value).cls; return c === 'late' || c === 'soon' ? 'warn' : c === 'unknown' || c === 'closed' ? 'off' : '' }

/** One price cars (a fixed price, no bidding): same card shape as a bidding car */
async function fetchOnePrice(from: number) {
  let query = db.from('one_price_lots').select('id,brand,model,auction_grade,mfg_year,mfg_month,mileage_km,venue,price_jpy,photos,deadline,needs_review,docket_id,engine_cc,transmission', { count: 'exact' }).gt('deadline', new Date().toISOString())
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
  const rows = (data || []).map((r: any) => ({ ...r, op: true, grade: r.auction_grade, start_price_jpy: r.price_jpy, bid_deadline: r.deadline }))
  loadCardPrices(rows)
  return rows
}
async function fetchPage(from: number) {
  if (kind.value === 'one_price') return fetchOnePrice(from)
  let query = db.from('lots').select('id,brand,model,grade,mfg_year,mfg_month,mileage_km,venue,start_price_jpy,photos,bid_deadline,engine_cc,transmission', { count: 'exact' }).gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true)
  const ap = activePref.value
  if (ap) {
    if (ap.brands?.length) query = query.in('brand', ap.brands.map((b: string) => b.toUpperCase()))
    if (ap.models?.length) query = query.or(ap.models.map((m: string) => `model.ilike.%${m.replace(/[,()%]/g, ' ')}%`).join(','))
    if (ap.year_from) query = query.gte('mfg_year', ap.year_from)
    if (ap.year_to) query = query.lte('mfg_year', ap.year_to)
    if (ap.max_price_myr && rate.value > 0) query = query.lte('start_price_jpy', Math.round(Number(ap.max_price_myr) / rate.value))
    if (ap.min_score != null) { const min = Number(ap.min_score); query = query.in('grade', SCORE_ORDER.filter((s) => (s === 'S' ? 7 : Number(s)) >= min)) }
  }
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
// "Hide viewed": the cars opened before are left out; the page loads more by itself until it has a screenful
const shown = computed(() => (hide.value ? cars.value.filter((c) => !viewed.has(c.id)) : cars.value))
let autoMore = 0
vueWatch([shown, loading], async () => { if (hide.value && !loading.value && shown.value.length < 12 && cars.value.length < total.value && autoMore < 6) { autoMore++; await more() } })
function setHide(v: number) { hide.value = v; reload() }
async function reload() { autoMore = 0; prefId.value = activePref.value?.id || ''; url.save(); loading.value = true; err.value = ''; try { cars.value = await fetchPage(0) } catch (e: any) { err.value = e.message } finally { loading.value = false } }
async function more() { loading.value = true; try { cars.value = [...cars.value, ...(await fetchPage(cars.value.length))] } catch (e: any) { err.value = e.message } finally { loading.value = false } }

onMounted(async () => {
  try { const c = localStorage.getItem('cars-currency'); if (c === 'RM' || c === 'JPY') cur.value = c } catch { /* private mode */ }
  url.restore(); viewed.load()
  watch.load().catch(() => {})
  recs.load().catch(() => {})
  if (hasTier('member')) board.load().catch(() => {})
  try {
    await loadRate()
    await loadPrefs()
    const { data } = await db.from('lots').select('brand').gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true).limit(3000)
    brands.value = [...new Set((data || []).map((r: any) => r.brand))].sort() as string[]
  } catch (e: any) { err.value = e.message }
  await reload()
  await listBack.restore()
})
</script>

<style scoped>
.filters { display: flex; flex-wrap: wrap; gap: 10px; }
.cars { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); row-gap: 0; }
.car { padding: 0; overflow: hidden; color: inherit; text-decoration: none; transition: border-color .2s; display: grid; grid-template-rows: subgrid; grid-row: span 6; row-gap: 0; margin-bottom: 16px; }
.car:hover { border-color: var(--ac); }
.ph { aspect-ratio: 4 / 3; background: var(--s2); display: grid; place-items: center; color: var(--mu2); font-size: 12px; overflow: hidden; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.body { display: contents; }
.body > * { padding-left: 14px; padding-right: 14px; }
.body > * { grid-column: 1; }
.flrow { grid-row: 2 / span 2; grid-column: 1; justify-self: end; align-self: start; padding-top: 10px; display: flex; z-index: 1; } .plabel { grid-row: 2; padding-top: 12px; } .price { grid-row: 3; } .mg { grid-row: 4; }
.car > .body > .name { grid-row: 5; } .pills { grid-row: 6; display: flex; flex-wrap: nowrap; gap: 5px; padding-top: 6px; padding-bottom: 14px; }
.cpill { display: inline-flex; align-items: center; white-space: nowrap; font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; background: var(--s3); color: var(--tx); border: 1px solid var(--line); }
.price { font-size: 19px; font-weight: 800; }
.name { font-weight: 600; margin: 2px 0; }
.car.seen .name { color: var(--ac2); font-weight: 400; text-decoration: underline; text-underline-offset: 3px; }
.ph { position: relative; }
.star.low { top: 46px; }
.star { position: absolute; z-index: 3; top: 8px; right: 8px; width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(0,0,0,.55); color: #fff; padding: 0; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.star :deep(svg) { width: 19px; height: 19px; }
.star.on { color: var(--ac); }
.prefs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.rec { position: absolute; z-index: 3; top: 8px; right: 8px; border: 0; border-radius: 16px; background: rgba(0,0,0,.6); backdrop-filter: blur(6px); color: #fff; font-size: 12px; font-weight: 600; padding: 6px 10px; cursor: pointer; }
.rec.on { background: var(--ac); color: #000; }
/* glass badges on the photo: venue top-left, closing time bottom-left */
.gl { position: absolute; z-index: 3; left: 8px; max-width: calc(100% - 100px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; font-weight: 600; line-height: 1; padding: 6px 10px; border-radius: 16px; background: rgba(0,0,0,.6); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.14); pointer-events: none; }
.gl.loc { top: 8px; color: #fff; }
.gl.tm { bottom: 8px; color: var(--ac2); } .gl.tm.warn { color: #ff6b6b; } .gl.tm.off { color: var(--mu); }
/* Est. import price: an orange wipe over the whole photo on hover, the same motion as the sidebar pill (fast leading edge, slower trailing edge) */
.estov { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; text-align: center; pointer-events: none; color: #1a0b05; background: linear-gradient(135deg, var(--ac2), var(--ac)); clip-path: inset(0 100% 0 0); transition: clip-path .55s cubic-bezier(.645, .045, .355, 1); }
.estov > * { opacity: 0; transform: translateY(10px); transition: opacity .2s ease, transform .2s ease; }
.estov .el { font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; } .estov .ev { font-size: 28px; font-weight: 800; letter-spacing: -.5px; } .estov .es { font-size: 11.5px; font-weight: 600; }
@media (hover: hover) {
  .car:hover .estov { clip-path: inset(0 0 0 0); transition: clip-path .36s cubic-bezier(.215, .61, .355, 1); }
  .car:hover .estov > * { opacity: 1; transform: none; transition: opacity .3s ease .16s, transform .4s cubic-bezier(.215, .61, .355, 1) .16s; }
  .car:hover .estov > .ev { transition-delay: .24s; } .car:hover .estov > .es { transition-delay: .32s; }
}
@media (hover: none) { .estov { display: none; } }
.cur { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.cur button { background: transparent; border: 0; color: inherit; padding: 6px 14px; cursor: pointer; font-weight: 600; }
.cur button.on { background: var(--ac); color: #000; }
.plabel { font-size: 11.5px; color: var(--mu); line-height: 1.2; }
.mg { font-size: 13px; font-weight: 700; margin: 2px 0; }
@media (max-width: 760px) { .cars { grid-template-columns: 1fr 1fr; gap: 10px; } .filters input, .filters select { flex: 1 1 140px; } }
@media (max-width: 460px) { .cars { grid-template-columns: 1fr; } }
</style>


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
      <div class="cur" role="group" aria-label="Currency"><button :class="{ on: cur === 'RM' }" @click="setCur('RM')">RM</button><button :class="{ on: cur === 'JPY' }" @click="setCur('JPY')">¥</button></div>
    </div>
    <div v-if="rate" class="muted small" style="margin: 8px 2px 0">Rate used: ¥1 = RM {{ rate }}</div>

    <div v-if="err" class="err" style="margin-top: 12px">{{ err }}</div>
    <div class="muted small" style="margin: 12px 2px">{{ loading ? 'Loading ...' : total + ' car' + (total === 1 ? '' : 's') }}</div>

    <div class="grid cars">
      <NuxtLink v-for="c in cars" :key="c.id" :to="c.op ? `/one-price/${c.id}` : `/cars/${c.id}`" class="card car">
        <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /><span v-else>no photo</span>
          <button v-if="isStaff && !c.op" class="rec" :class="{ on: recs.has(c.id) }" :title="recs.has(c.id) ? 'Remove from the recommend list' : 'Recommend this car'" @click.prevent.stop="recommend(c.id)">{{ recs.has(c.id) ? '✔ Recommended' : '＋ Recommend' }}</button>
          <button v-if="!c.op" class="star" :class="{ on: watch.has(c.id) }" :title="watch.has(c.id) ? 'Remove from watchlist' : 'Watch this car'" @click.prevent.stop="star(c.id)"><StarIcon :filled="watch.has(c.id)" /></button></div>
        <div class="body">
          <div class="plabel">{{ c.op ? 'One price' : 'Start price' }}</div>
          <div class="price">{{ c.op && !(c.start_price_jpy > 0) ? 'Not open yet' : money(c.start_price_jpy) }}</div>
          <div v-if="!c.op && marginOf(c.id) != null" class="mg" :class="marginOf(c.id)! >= 0 ? 'up' : 'down'">Margin {{ money(marginOf(c.id)!, 'myr') }}</div>
          <div class="namerow"><div class="name">{{ c.brand }} {{ c.model }}</div><CarFlags :docket="c.op ? !!c.docket_id : flags.docket(c.id)" :review="c.op ? !!c.needs_review : flags.review(c.id)" /></div>
          <div class="muted small">{{ [c.mfg_month && c.mfg_year ? c.mfg_year + '/' + String(c.mfg_month).padStart(2, '0') : c.mfg_year, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null, c.grade ? 'Grade ' + c.grade : null].filter(Boolean).join(' · ') }}</div>
          <div class="row" style="margin-top: 8px"><span class="chip">{{ c.venue }}</span><span class="chip" :class="chipCls(c.bid_deadline)" :title="closingTimeText(c.bid_deadline)">{{ closes(c.bid_deadline) }}</span></div>
        </div>
      </NuxtLink>
    </div>
    <div v-if="!loading && !cars.length" class="card muted">No car matches. Try another make or a higher price.</div>
    <button v-if="cars.length < total" class="btn ghost" style="margin-top: 16px" :disabled="loading" @click="more">Show more ({{ total - cars.length }} left)</button>
  </div>
</template>

<script setup lang="ts">
import { timeLeft, closesInfo, closingTimeText } from '@aim/core'

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
async function star(id: string) { try { await watch.toggle(id) } catch (e: any) { err.value = e.message } }
// the margin at the usual winning price (staff and Member plan); the cars page shows only this one number
const marginMap = computed(() => {
  const m = new Map<string, number>()
  if (!board.loaded.value) return m
  for (const l of board.lots.value) { const e = board.evaluate(l, { targetPct: 12, reconMyr: 3000, apFeeMyr: board.fees.value.apFeeMyr }); if (e.atHistory) m.set(l.id, e.atHistory.profitMyr) }
  return m
})
const marginOf = (id: string) => marginMap.value.get(id) ?? null
const q = ref(''), brand = ref(''), yearFrom = ref(0), yearTo = ref(0), kind = ref('bidding'), maxRm = ref<number | null>(null), sort = ref('closing')
const prefId = ref('')
const flags = useCarFlags()
const url = useUrlFilters('cars', { q, brand, kind, yearFrom, yearTo, maxRm, sort, pref: prefId }, { sort: 'closing' })
const cars = ref<any[]>([]), total = ref(0), loading = ref(true), err = ref(''), brands = ref<string[]>([])
const PAGE = 24
const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i)
const left = (iso: string) => timeLeft(iso, now.value).label
const closes = (iso: string) => closesInfo(iso, now.value).text
const chipCls = (iso: string) => { const c = closesInfo(iso, now.value).cls; return c === 'late' || c === 'soon' ? 'warn' : c === 'unknown' || c === 'closed' ? '' : 'ac' }

/** One price cars (a fixed price, no bidding): same card shape as a bidding car */
async function fetchOnePrice(from: number) {
  let query = db.from('one_price_lots').select('id,brand,model,auction_grade,mfg_year,mfg_month,mileage_km,venue,price_jpy,photos,deadline,needs_review,docket_id', { count: 'exact' }).gt('deadline', new Date().toISOString())
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
  return (data || []).map((r: any) => ({ ...r, op: true, grade: r.auction_grade, start_price_jpy: r.price_jpy, bid_deadline: r.deadline }))
}
async function fetchPage(from: number) {
  if (kind.value === 'one_price') return fetchOnePrice(from)
  let query = db.from('lots').select('id,brand,model,grade,mfg_year,mfg_month,mileage_km,venue,start_price_jpy,photos,bid_deadline', { count: 'exact' }).gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true)
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
  return data || []
}
async function reload() { prefId.value = activePref.value?.id || ''; url.save(); loading.value = true; err.value = ''; try { cars.value = await fetchPage(0) } catch (e: any) { err.value = e.message } finally { loading.value = false } }
async function more() { loading.value = true; try { cars.value = [...cars.value, ...(await fetchPage(cars.value.length))] } catch (e: any) { err.value = e.message } finally { loading.value = false } }

onMounted(async () => {
  try { const c = localStorage.getItem('cars-currency'); if (c === 'RM' || c === 'JPY') cur.value = c } catch { /* private mode */ }
  url.restore()
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
})
</script>

<style scoped>
.filters { display: flex; flex-wrap: wrap; gap: 10px; }
.cars { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.car { padding: 0; overflow: hidden; color: inherit; text-decoration: none; transition: border-color .2s; display: flex; flex-direction: column; }
.car:hover { border-color: var(--ac); }
.ph { aspect-ratio: 4 / 3; background: var(--s2); display: grid; place-items: center; color: var(--mu2); font-size: 12px; overflow: hidden; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.body { padding: 12px 14px 14px; }
.price { font-size: 19px; font-weight: 800; }
.name { font-weight: 600; margin: 2px 0; }
.ph { position: relative; }
.star { position: absolute; top: 8px; right: 8px; width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(0,0,0,.55); color: #fff; padding: 0; line-height: 1; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.star :deep(svg) { width: 19px; height: 19px; }
.star.on { color: var(--ac); }
.namerow { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 2px 0; } .namerow .name { margin: 0; min-width: 0; }
.prefs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }
.rec { position: absolute; top: 8px; left: 8px; border: 0; border-radius: 16px; background: rgba(0,0,0,.6); color: #fff; font-size: 12px; font-weight: 600; padding: 6px 10px; cursor: pointer; }
.rec.on { background: var(--ac); color: #000; }
.cur { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.cur button { background: transparent; border: 0; color: inherit; padding: 6px 14px; cursor: pointer; font-weight: 600; }
.cur button.on { background: var(--ac); color: #000; }
.plabel { font-size: 11.5px; color: var(--mu); line-height: 1.2; }
.mg { font-size: 13px; font-weight: 700; margin: 2px 0; }
@media (max-width: 760px) { .cars { grid-template-columns: 1fr 1fr; gap: 10px; } .filters input, .filters select { flex: 1 1 140px; } }
@media (max-width: 460px) { .cars { grid-template-columns: 1fr; } }
</style>

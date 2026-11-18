<template>
  <div>
    <h1>Cars at auction</h1>
    <p class="muted" style="margin: 0 0 16px">Open cars with prices in RM (starting price at today's rate). Place a bid order on any car before it closes.</p>

    <div class="card filters">
      <div class="sbox"><input v-model="q" placeholder="Search make or model" @keyup.enter="reload" /><button v-if="q" class="clr" type="button" aria-label="Clear the search" title="Clear" @click="clearQ">×</button></div>
      <select v-model="brand" @change="reload"><option value="">All makes</option><option v-for="b in brands" :key="b" :value="b">{{ b }}</option></select>
      <select v-model="yearFrom" @change="reload"><option :value="0">Any year</option><option v-for="y in years" :key="y" :value="y">{{ y }} +</option></select>
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
      <NuxtLink v-for="c in cars" :key="c.id" :to="`/car/${c.id}`" class="card car">
        <div class="ph"><img v-if="c.photos?.[0] && !broken.has(c.id)" :src="c.photos[0]" loading="lazy" alt="" @error="broken.add(c.id)" /><span v-else>no photo</span>
          <button v-if="!isStaff" class="star" :class="{ on: watch.has(c.id) }" :title="watch.has(c.id) ? 'Remove from favourites' : 'Add to favourites'" @click.prevent.stop="star(c.id)"><RailIcon name="heart" :filled="watch.has(c.id)" /></button></div>
        <div class="body">
          <div class="plabel">Start price</div>
          <div class="price">{{ money(c.start_price_jpy) }}</div>
          <div class="name">{{ c.brand }} {{ c.model }}</div>
          <div class="muted small">{{ [c.mfg_year, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null, c.grade ? 'Grade ' + c.grade : null].filter(Boolean).join(' · ') }}</div>
          <div class="row" style="margin-top: 8px"><span class="chip">{{ c.venue }}</span><span class="chip" :class="soon(c.bid_deadline) ? 'warn' : 'ac'">closes in {{ left(c.bid_deadline, now) }}</span></div>
        </div>
      </NuxtLink>
    </div>
    <div v-if="!loading && !cars.length" class="card muted">No car matches. Try another make or a higher price.</div>
    <button v-if="cars.length < total" class="btn ghost" style="margin-top: 16px" :disabled="loading" @click="more">Show more ({{ total - cars.length }} left)</button>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const now = useNow()
const { rate, loadRate, left, cur, loadCur, setCur, money } = useLite()
const watch = useWatch()
const { isStaff } = useAuth()
const broken = reactive(new Set<string>())      // photos that no longer load: show the grey box instead of a broken-image icon
function clearQ() { q.value = ''; reload() }
async function star(id: string) { try { await watch.toggle(id) } catch (e: any) { err.value = e.message } }
const q = ref(''), brand = ref(''), yearFrom = ref(0), maxRm = ref<number | null>(null), sort = ref('closing')
const url = useUrlFilters('lite-cars', { q, brand, yearFrom, maxRm, sort }, { sort: 'closing' })
const cars = ref<any[]>([]), total = ref(0), loading = ref(true), err = ref(''), brands = ref<string[]>([])
const PAGE = 24
const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i)
const soon = (iso: string) => new Date(iso).getTime() - now.value < 6 * 3600_000

async function fetchPage(from: number) {
  let query = db.from('lots').select('id,brand,model,grade,mfg_year,mileage_km,venue,start_price_jpy,photos,bid_deadline', { count: 'exact' })
    .gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true)
  if (brand.value) query = query.eq('brand', brand.value)
  const t = q.value.trim().replace(/[,()%]/g, ' ')
  if (t) query = query.or(`model.ilike.%${t}%,brand.ilike.%${t}%`)
  if (yearFrom.value) query = query.gte('mfg_year', yearFrom.value)
  if (maxRm.value && rate.value > 0) query = query.lte('start_price_jpy', Math.round(maxRm.value / rate.value))
  const order: Record<string, [string, boolean]> = { closing: ['bid_deadline', true], price_asc: ['start_price_jpy', true], price_desc: ['start_price_jpy', false], year_desc: ['mfg_year', false], km_asc: ['mileage_km', true] }
  const [col, asc] = order[sort.value] || order.closing!
  const { data, error, count } = await query.order(col, { ascending: asc, nullsFirst: false }).range(from, from + PAGE - 1)
  if (error) throw error
  total.value = count || 0
  return data || []
}
async function reload() { url.save(); loading.value = true; err.value = ''; try { cars.value = await fetchPage(0) } catch (e: any) { err.value = e.message } finally { loading.value = false } }
async function more() { loading.value = true; try { cars.value = [...cars.value, ...(await fetchPage(cars.value.length))] } catch (e: any) { err.value = e.message } finally { loading.value = false } }

onMounted(async () => {
  loadCur(); url.restore(); watch.load().catch(() => {})
  try {
    await loadRate()
    const { data } = await db.from('lots').select('brand').gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true).limit(3000)
    brands.value = [...new Set((data || []).map((r: any) => r.brand))].sort() as string[]
  } catch (e: any) { err.value = e.message }
  await reload()
})
</script>

<style scoped>
.filters { display: flex; flex-wrap: wrap; gap: 10px; }
.sbox { position: relative; flex: 1; min-width: 180px; display: flex; } .sbox input { width: 100%; padding-right: 36px; }
.clr { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); width: 26px; height: 26px; border-radius: 50%; border: 0; background: var(--s3); color: var(--mu); font-size: 18px; line-height: 1; cursor: pointer; display: grid; place-items: center; padding: 0; } .clr:hover { background: var(--line); color: var(--tx); }
.cars { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.car { padding: 0; overflow: hidden; color: inherit; transition: box-shadow .2s, transform .2s; display: flex; flex-direction: column; }
.car:hover { box-shadow: 0 8px 24px rgba(20, 30, 60, .1); transform: translateY(-2px); }
.ph { aspect-ratio: 4 / 3; background: #e9edf3; display: grid; place-items: center; color: var(--mu2); font-size: 12px; overflow: hidden; }
.ph { position: relative; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.star svg { width: 19px; height: 19px; display: block; }
.star { position: absolute; top: 8px; right: 8px; width: 34px; height: 34px; border-radius: 50%; border: 0; padding: 0; background: rgba(0, 0, 0, .55); color: #fff; line-height: 1; display: flex; align-items: center; justify-content: center; cursor: pointer; display: grid; place-items: center; }
.star.on { color: #ff5a6e; }
.cur { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.cur button { background: transparent; border: 0; color: inherit; padding: 6px 14px; cursor: pointer; font-weight: 600; }
.cur button.on { background: var(--ac); color: #fff; }
.body { padding: 12px 14px 14px; }
.plabel { font-size: 11.5px; color: var(--mu); line-height: 1.2; }
.price { font-size: 19px; font-weight: 800; }
.name { font-weight: 600; margin: 2px 0; }
@media (max-width: 760px) { .cars { grid-template-columns: 1fr 1fr; gap: 10px; } .filters input, .filters select { flex: 1 1 140px; } }
@media (max-width: 460px) { .cars { grid-template-columns: 1fr; } }
</style>

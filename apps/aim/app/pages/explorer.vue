
<template>
  <div>
    <h1>Market explorer</h1>
    <p class="sub">What dealers ask in Malaysia for one car: the spread of prices, price against mileage, and each comparable listing. Asking prices, not sold prices.</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>

    <div class="card sel">
      <label class="f">Brand<select v-model="brand" @change="model = ''; variantId = ''"><option value="">Choose ...</option><option v-for="b in brands" :key="b" :value="b">{{ b }}</option></select></label>
      <label class="f">Model<select v-model="model" :disabled="!brand" @change="variantId = ''"><option value="">Choose ...</option><option v-for="m in models" :key="m" :value="m">{{ m }}</option></select></label>
      <label class="f">Variant<select v-model="variantId" :disabled="!model"><option value="">All variants</option><option v-for="v in variants" :key="v.ref_id" :value="v.ref_id">{{ v.variant }}</option></select></label>
      <label class="f">Year<select v-model.number="year"><option v-for="y in years" :key="y" :value="y">{{ y }} (±1 year)</option></select></label>
      <button class="btn" :disabled="!model || busy" @click="run">Show</button>
    </div>

    <div v-if="busy" class="muted" style="margin-top: 14px">Loading ...</div>
    <div v-else-if="shown && !comps.length" class="card muted" style="margin-top: 14px">
      No comparable listings for this car yet{{ manual ? '' : '.' }}<template v-if="manual"> — but a hand-checked price exists: RM {{ n(manual.p25_myr) }} – {{ n(manual.p75_myr) }}, typical RM {{ n(manual.median_myr) }} ({{ manual.as_of }}).</template>
      <div class="small" style="margin-top: 6px">Listings appear here once CarzNexus has linked its cars to the catalog and the market snapshot has run.</div>
    </div>

    <template v-else-if="shown">
      <div class="grid kpis" style="margin: 14px 0">
        <div class="card kpi"><small>Listings</small><b>{{ stats!.n }}</b><span class="muted small">{{ levelLabel }}</span></div>
        <div class="card kpi"><small>Median ask</small><b>RM {{ n(stats!.median) }}</b></div>
        <div class="card kpi"><small>Middle half</small><b>RM {{ n(stats!.p25) }} – {{ n(stats!.p75) }}</b></div>
        <div class="card kpi"><small>Lowest – highest</small><b>RM {{ n(stats!.min) }} – {{ n(stats!.max) }}</b></div>
        <div class="card kpi"><small>Average mileage</small><b>{{ avgKm != null ? n(avgKm) + ' km' : '—' }}</b></div>
        <div class="card kpi"><small>Average days listed</small><b>{{ avgDays != null ? Math.round(avgDays) + ' days' : '—' }}</b><span v-if="avgDays == null" class="muted small">listing dates not available yet</span></div>
      </div>
      <div v-if="manual" class="chip ac" style="margin-bottom: 12px">Hand-checked price: RM {{ n(manual.p25_myr) }} – {{ n(manual.p75_myr) }}, typical RM {{ n(manual.median_myr) }} ({{ manual.as_of }})</div>

      <div class="grid charts">
        <div class="card"><h2>Asking prices</h2><PriceHistogram :prices="comps.map((c) => c.price_myr)" :median="stats!.median" :sell="manual ? manual.median_myr : null" /></div>
        <div class="card"><h2>Price against mileage</h2><PriceScatter :points="comps.map((c) => ({ km: c.km, price: c.price_myr, year: c.year }))" /></div>
      </div>

      <div class="card" style="margin-top: 14px; overflow-x: auto; padding: 4px 14px">
        <div class="row" style="padding: 12px 0 4px"><h2>Comparable listings</h2><span class="muted small">{{ comps.length }} · no dealer names are stored</span></div>
        <table class="t">
          <thead><tr><th v-for="c in cols" :key="c.key" class="sortable" @click="sortBy(c.key)">{{ c.label }}<span v-if="sort.key === c.key">{{ sort.dir > 0 ? ' ▲' : ' ▼' }}</span></th></tr></thead>
          <tr v-for="(r, i) in sorted" :key="i"><td>{{ r.year }}</td><td>{{ r.km != null ? n(r.km) + ' km' : '—' }}</td><td>RM {{ n(r.price_myr) }}</td><td>{{ r.days_listed != null ? r.days_listed + ' days' : '—' }}</td></tr>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { marketStats, compsFor, type CompRow } from '@aim/core'

const db = useDb()
const route = useRoute()
const index = ref<any[]>([]), brand = ref(''), model = ref(''), variantId = ref(''), year = ref(new Date().getFullYear() - 2)
const comps = ref<CompRow[]>([]), manual = ref<any>(null), shown = ref(false), busy = ref(false), err = ref('')
const sort = reactive({ key: 'price_myr', dir: 1 })
const n = (v: number) => Math.round(v).toLocaleString('en-US')
const years = Array.from({ length: 14 }, (_, i) => new Date().getFullYear() + 1 - i)
const cols = [{ key: 'year', label: 'Year' }, { key: 'km', label: 'Mileage' }, { key: 'price_myr', label: 'Asking price' }, { key: 'days_listed', label: 'Days listed' }]

const brands = computed(() => [...new Set(index.value.map((r) => r.brand))].sort())
const models = computed(() => [...new Set(index.value.filter((r) => r.brand === brand.value).map((r) => r.model))].sort())
const variants = computed(() => index.value.filter((r) => r.level === 'variant' && r.brand === brand.value && r.model === model.value).sort((a, b) => String(a.variant).localeCompare(String(b.variant))))
const pick = computed(() => variantId.value ? index.value.find((r) => r.level === 'variant' && r.ref_id === variantId.value) : index.value.find((r) => r.level === 'model' && r.brand === brand.value && r.model === model.value))
const stats = computed(() => marketStats(comps.value.map((c) => c.price_myr)))
const avg = (v: (number | null)[]) => { const a = v.filter((x): x is number => x != null); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null }
const avgKm = computed(() => avg(comps.value.map((c) => c.km)))
const avgDays = computed(() => avg(comps.value.map((c) => c.days_listed)))
const levelLabel = computed(() => (variantId.value ? 'this variant' : 'all variants of the model') + ', ' + (year.value - 1) + '–' + (year.value + 1))
const sorted = computed(() => [...comps.value].sort((a: any, b: any) => ((a[sort.key] ?? Infinity) - (b[sort.key] ?? Infinity)) * sort.dir))
const sortBy = (k: string) => { if (sort.key === k) sort.dir *= -1; else { sort.key = k; sort.dir = 1 } }

async function run() {
  if (!pick.value) return
  busy.value = true; err.value = ''; shown.value = false
  try {
    const p = pick.value, level = p.level as 'variant' | 'model'
    const latest = await db.from('market_comps').select('as_of').order('as_of', { ascending: false }).limit(1)
    const asOf = latest.data?.[0]?.as_of
    let rows: any[] = []
    if (asOf) {
      const col = level === 'variant' ? 'variant_id' : 'model_id'
      const { data, error } = await db.from('market_comps').select('*').eq(col, p.ref_id).eq('as_of', asOf).gte('year', year.value - 1).lte('year', year.value + 1).limit(2000)
      if (error) throw error
      rows = data || []
    }
    comps.value = compsFor(rows.map((r) => ({ ...r, price_myr: Number(r.price_myr) })), { variantId: level === 'variant' ? p.ref_id : null, modelId: level === 'model' ? p.ref_id : null, year: year.value }, level)
    const m = await db.from('market_stats').select('*').eq('source', 'manual').eq('level', level).eq('ref_id', p.ref_id).eq('year_from', year.value - 1).order('as_of', { ascending: false }).limit(1)
    manual.value = m.data?.[0] ? { ...m.data[0], p25_myr: Number(m.data[0].p25_myr), median_myr: Number(m.data[0].median_myr), p75_myr: Number(m.data[0].p75_myr) } : null
    shown.value = true
    navigateTo({ query: { v: level === 'variant' ? p.ref_id : undefined, m: level === 'model' ? p.ref_id : undefined, y: String(year.value) } }, { replace: true })
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}

onMounted(async () => {
  try {
    const { data, error } = await db.from('catalog_index').select('*').order('brand').limit(5000)
    if (error) throw error
    index.value = data || []
    // opened from a car: ?v=<variant id> or ?m=<model id>, ?y=<year>
    const v = String(route.query.v || ''), m = String(route.query.m || ''), y = Number(route.query.y)
    const hit = v ? index.value.find((r) => r.level === 'variant' && r.ref_id === v) : m ? index.value.find((r) => r.level === 'model' && r.ref_id === m) : null
    if (hit) { brand.value = hit.brand; model.value = hit.model; variantId.value = hit.level === 'variant' ? hit.ref_id : ''; if (y) year.value = y; await run() }
  } catch (e: any) { err.value = e.message }
})
</script>

<style scoped>
.sel { display: grid; grid-template-columns: repeat(4, 1fr) auto; gap: 12px; align-items: end; }
.f { display: grid; gap: 5px; color: var(--mu); font-size: 12px; } .f select { width: 100%; }
.kpis { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
.kpi { display: grid; gap: 2px; } .kpi small { color: var(--mu); } .kpi b { font-size: 17px; }
.charts { grid-template-columns: 1fr 1fr; align-items: start; }
.t { width: 100%; border-collapse: collapse; } .t th { text-align: left; color: var(--mu); font-weight: 500; font-size: 12px; padding: 10px 6px; }
.t th.sortable { cursor: pointer; user-select: none; } .t td { padding: 8px 6px; border-top: 1px solid var(--line); }
@media (max-width: 900px) { .sel { grid-template-columns: 1fr 1fr; } .charts { grid-template-columns: 1fr; } }
</style>

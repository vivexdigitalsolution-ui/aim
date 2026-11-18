
<template>
  <div>
    <h1>History price</h1>
    <p class="sub">What cars like this really sold for at the Japanese auctions in the last {{ weeks }} weeks. Sold prices, in yen, before shipping and tax: the number to compare with your bid.</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>

    <div class="card filters">
      <label class="f">Make<input v-model="f.brand" placeholder="TOYOTA" @input="debounced" /></label>
      <label class="f">Model<input v-model="f.model" placeholder="ALPHARD" @input="debounced" /></label>
      <label class="f">Year from<input v-model.number="f.yearMin" type="number" inputmode="numeric" @input="debounced" /></label>
      <label class="f">Year to<input v-model.number="f.yearMax" type="number" inputmode="numeric" @input="debounced" /></label>
      <label class="f">Grade from
        <select v-model="f.gradeMin" @change="load"><option value="">Any</option><option v-for="g in ['3', '3.5', '4', '4.5', '5']" :key="g" :value="g">{{ g }}+</option></select>
      </label>
      <label class="f">Period
        <select v-model.number="f.weeks" @change="load"><option v-for="w in weekOptions" :key="w" :value="w">Last {{ w }} week{{ w > 1 ? 's' : '' }}</option></select>
      </label>
    </div>

    <div v-if="loading" class="muted" style="margin-top: 14px">Loading ...</div>
    <div v-else-if="!rows.length" class="card muted" style="margin-top: 14px">No results. Try fewer filters{{ f.brand || f.model ? ' or a shorter model name' : '' }}.</div>

    <template v-else>
      <div v-if="sold.length" class="grid kpis" style="margin: 14px 0">
        <div class="card kpi"><small>Sold cars</small><b>{{ sold.length }}</b><span class="muted small">{{ rows.length - sold.length }} not sold · sold {{ soldPct }}%</span></div>
        <div class="card kpi"><small>Typical price (median)</small><b>{{ yen(stats!.median) }}</b></div>
        <div class="card kpi"><small>Average</small><b>{{ yen(avg) }}</b></div>
        <div class="card kpi"><small>Middle half</small><b>{{ yen(stats!.p25) }} – {{ yen(stats!.p75) }}</b></div>
        <div class="card kpi"><small>Lowest – highest</small><b>{{ yen(stats!.min) }} – {{ yen(stats!.max) }}</b></div>
        <div class="card kpi"><small>Trend</small><b :class="trend.cls">{{ trend.label }}</b><span class="muted small">{{ trend.note }}</span></div>
      </div>

      <div v-if="sold.length" class="grid charts">
        <div class="card"><h2>Price by week</h2><WeekBars :weeks="byWeek" /></div>
        <div class="card" style="overflow-x: auto">
          <h2>By auction grade</h2>
          <table class="t">
            <thead><tr><th>Grade</th><th class="r">Sold</th><th class="r">Average</th><th class="r">Lowest</th><th class="r">Highest</th></tr></thead>
            <tr v-for="g in byGrade" :key="g.grade"><td><b>{{ g.grade }}</b></td><td class="r">{{ g.n }}</td><td class="r">{{ yen(g.avg) }}</td><td class="r">{{ yen(g.min) }}</td><td class="r">{{ yen(g.max) }}</td></tr>
          </table>
        </div>
      </div>

      <div class="card" style="margin-top: 14px; overflow-x: auto; padding: 4px 14px">
        <div class="row" style="padding: 12px 0 4px"><h2>Every result</h2><span class="muted small">{{ rows.length }}{{ rows.length >= LIMIT ? ' (latest ' + LIMIT + ', add filters to narrow)' : '' }}</span></div>
        <table class="t">
          <thead><tr><th v-for="c in cols" :key="c.key" :class="[c.right ? 'r' : '', 'sortable']" @click="sortBy(c.key)">{{ c.label }}<span v-if="sort.key === c.key">{{ sort.dir > 0 ? ' ▲' : ' ▼' }}</span></th></tr></thead>
          <tr v-for="r in sorted" :key="r.id">
            <td class="nowrap">{{ r.auction_date }}</td><td>{{ r.venue }}</td><td>{{ r.brand }} {{ r.model }}</td><td>{{ r.grade || '—' }}</td><td>{{ r.mfg_year || '—' }}</td>
            <td class="r nowrap">{{ r.mileage_km != null ? r.mileage_km.toLocaleString('en-US') + ' km' : '—' }}</td><td>{{ r.transmission || '' }}</td>
            <td class="r nowrap"><b v-if="r.result === 'sold'">{{ yen(r.sold_price_jpy) }}</b><span v-else class="muted">Not sold</span></td>
          </tr>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { marketStats } from '@aim/core'

const db = useDb()
const route = useRoute()
const LIMIT = 1000
const weeks = ref(4)
const weekOptions = computed(() => Array.from({ length: weeks.value }, (_, i) => i + 1))
const f = reactive({ brand: String(route.query.brand || ''), model: String(route.query.model || ''), yearMin: (Number(route.query.from) || null) as number | null, yearMax: (Number(route.query.to) || null) as number | null, gradeMin: '', weeks: 4 })
const rows = ref<any[]>([])
const loading = ref(true), err = ref('')
const sort = reactive({ key: 'auction_date', dir: -1 })
const yen = (v: number | null) => (v == null ? '—' : '¥' + Math.round(v).toLocaleString('en-US'))
const cols = [
  { key: 'auction_date', label: 'Date' }, { key: 'venue', label: 'Venue' }, { key: 'model', label: 'Car' }, { key: 'grade_num', label: 'Grade' }, { key: 'mfg_year', label: 'Year' },
  { key: 'mileage_km', label: 'Mileage', right: true }, { key: 'transmission', label: 'Trans.' }, { key: 'sold_price_jpy', label: 'Result', right: true },
]
const sold = computed(() => rows.value.filter((r) => r.result === 'sold' && r.sold_price_jpy))
const prices = computed(() => sold.value.map((r) => Number(r.sold_price_jpy)))
const stats = computed(() => marketStats(prices.value))
const avg = computed(() => (prices.value.length ? prices.value.reduce((a, b) => a + b, 0) / prices.value.length : null))
const soldPct = computed(() => (rows.value.length ? Math.round((sold.value.length / rows.value.length) * 100) : 0))

// the price by auction week (Monday of the week), oldest first
const weekKey = (d: string) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10) }
const byWeek = computed(() => {
  const m = new Map<string, number[]>()
  for (const r of sold.value) { const k = weekKey(r.auction_date); (m.get(k) || m.set(k, []).get(k)!).push(Number(r.sold_price_jpy)) }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, v]) => ({ week, n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length }))
})
// does the price go up or down: the newest week against the oldest one, only when both have at least 3 sales
const trend = computed(() => {
  const w = byWeek.value
  if (w.length < 2) return { label: '—', cls: '', note: 'needs two weeks of sales' }
  const a = w[0], b = w[w.length - 1]
  if (a.n < 3 || b.n < 3) return { label: '—', cls: '', note: 'too few sales to say' }
  const pct = Math.round(((b.avg - a.avg) / a.avg) * 1000) / 10
  return { label: (pct > 0 ? '+' : '') + pct + '%', cls: pct > 1 ? 'up' : pct < -1 ? 'down' : '', note: 'newest week vs oldest, same filters' }
})
const byGrade = computed(() => {
  const m = new Map<string, number[]>()
  for (const r of sold.value) { const k = String(r.grade || '—').toUpperCase(); (m.get(k) || m.set(k, []).get(k)!).push(Number(r.sold_price_jpy)) }
  return [...m.entries()].map(([grade, v]) => ({ grade, n: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v) })).sort((a, b) => b.n - a.n).slice(0, 12)
})
const sorted = computed(() => [...rows.value].sort((a: any, b: any) => {
  const x = a[sort.key], y = b[sort.key]
  if (x == null && y == null) return 0
  if (x == null) return 1
  if (y == null) return -1
  return (typeof x === 'number' || sort.key.endsWith('_jpy') || sort.key.endsWith('_km') ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * sort.dir
}))
const sortBy = (k: string) => { if (sort.key === k) sort.dir *= -1; else { sort.key = k; sort.dir = -1 } }

async function load() {
  loading.value = true; err.value = ''
  const since = new Date(Date.now() - f.weeks * 7 * 86400000).toISOString().slice(0, 10)
  let q = db.from('lot_history').select('*').gte('auction_date', since)
  if (f.brand.trim()) q = q.ilike('brand', `%${f.brand.trim()}%`)
  if (f.model.trim()) q = q.ilike('model', `%${f.model.trim()}%`)
  if (f.yearMin) q = q.gte('mfg_year', f.yearMin)
  if (f.yearMax) q = q.lte('mfg_year', f.yearMax)
  if (f.gradeMin) q = q.gte('grade_num', Number(f.gradeMin))
  const { data, error } = await q.order('auction_date', { ascending: false }).limit(LIMIT)
  loading.value = false
  if (error) { err.value = error.message; return }
  rows.value = data || []
}
let timer: any
const debounced = () => { clearTimeout(timer); timer = setTimeout(load, 350) }

onMounted(async () => {
  const { data } = await db.from('app_settings').select('history_weeks').maybeSingle()
  if (data?.history_weeks) { weeks.value = data.history_weeks; f.weeks = data.history_weeks }
  await load()
})
onBeforeUnmount(() => clearTimeout(timer))
</script>

<style scoped>
.filters { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
.f { display: grid; gap: 5px; color: var(--mu); font-size: 12px; } .f input, .f select { width: 100%; }
.kpis { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
.kpi { display: grid; gap: 2px; } .kpi small { color: var(--mu); } .kpi b { font-size: 17px; }
.charts { grid-template-columns: 1fr 1fr; align-items: start; }
.t { width: 100%; border-collapse: collapse; } .t th { text-align: left; color: var(--mu); font-weight: 500; font-size: 12px; padding: 10px 6px; }
.t th.sortable { cursor: pointer; user-select: none; } .t td { padding: 8px 6px; border-top: 1px solid var(--line); }
.r { text-align: right; } .t th.r { text-align: right; } .nowrap { white-space: nowrap; }
.up { color: var(--ok); } .down { color: var(--bad); }
@media (max-width: 900px) { .filters { grid-template-columns: 1fr 1fr; } .charts { grid-template-columns: 1fr; } }
</style>

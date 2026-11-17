<template>
  <div>
    <h1>Find by feature</h1>
    <p class="sub">Every auction sheet is read, so you can search what is on the car, not only the model.</p>

    <div class="row wrap" style="margin-bottom: 12px; gap: 10px">
      <input v-model="q" class="grow" style="max-width: 420px" placeholder="Search the sheet text: Vellfire, Executive Lounge, TRD ..." @keyup.enter="runText" />
      <select v-model="brand"><option value="">All makes</option><option v-for="b in brands" :key="b" :value="b">{{ b }}</option></select>
      <button v-if="selected.size || q || brand" class="btn ghost sm" @click="clearAll">Clear</button>
    </div>

    <div class="row wrap" style="gap: 6px; margin-bottom: 14px">
      <span v-for="f in chips" :key="f.key" class="chip tag" :class="{ on: selected.has(f.key) }" @click="toggle(f.key)">{{ f.label }} <small>{{ f.n }}</small></span>
    </div>

    <div v-if="err" class="err">{{ err }}</div>
    <div class="row" style="margin-bottom: 10px">
      <b>{{ loading ? 'Loading ...' : summary }}</b>
      <span class="chip ac">Read from auction sheets by Claude</span>
    </div>

    <div class="grid cars">
      <div v-for="c in cars" :key="c.id" class="card car">
        <div class="ph"><img v-if="c.photo" :src="c.photo" loading="lazy" alt="" /><span v-else>no photo</span></div>
        <div style="min-width: 0">
          <div class="row"><h2>{{ c.brand }} {{ c.model }}</h2><b v-if="c.start_price_jpy">¥{{ c.start_price_jpy.toLocaleString('en-US') }}</b></div>
          <div class="muted small">{{ [c.grade, c.mfg_year, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null, c.transmission].filter(Boolean).join(' · ') }}</div>
          <div class="muted small">{{ c.venue }} · {{ c.auction_date }} · lot {{ c.lot_no }}</div>
          <div class="row wrap" style="gap: 6px; margin-top: 8px">
            <span v-for="f in c.features" :key="f.key" class="chip" :class="chipClass(f)" :title="f.evidence || ''">{{ f.label }}<small v-if="f.source === 'aftermarket'"> · aftermarket</small></span>
          </div>
        </div>
      </div>
      <div v-if="!loading && !cars.length" class="card muted">No open car has all of those. Remove a feature, or clear the search.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CATALOG, featureLabel } from '@aim/core'

interface Feat { lot_id: string; key: string; label: string; source: string; evidence?: string }
const db = useDb()
const route = useRoute()
const selected = ref(new Set<string>((String(route.query.f || '')).split(',').filter(Boolean)))
const q = ref(String(route.query.q || '')), brand = ref(''), loading = ref(true), err = ref('')
const byLot = ref(new Map<string, Feat[]>())
const cars = ref<any[]>([])
const lotMeta = ref(new Map<string, any>())
let textIds: Set<string> | null = null

const now = () => new Date().toISOString()
async function loadFeatures() {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('lot_features').select('lot_id,key,label,source,evidence,lots!inner(bid_deadline,brand)').gt('lots.bid_deadline', now()).range(from, from + 999)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  const m = new Map<string, Feat[]>(), meta = new Map<string, any>()
  for (const r of rows) { (m.get(r.lot_id) || m.set(r.lot_id, []).get(r.lot_id)!).push(r); meta.set(r.lot_id, r.lots) }
  byLot.value = m; lotMeta.value = meta
}

const counts = computed(() => {
  const c = new Map<string, number>()
  for (const [id, fs] of byLot.value) { if (brand.value && lotMeta.value.get(id)?.brand !== brand.value) continue; for (const f of fs) c.set(f.key, (c.get(f.key) || 0) + 1) }
  return c
})
const chips = computed(() => [...counts.value.entries()].filter(([k]) => CATALOG.some((d) => d.key === k)).sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, n, label: featureLabel(key) })))
const brands = computed(() => [...new Set([...lotMeta.value.values()].map((m) => m.brand))].sort())

const matchIds = computed(() => {
  const out: string[] = []
  for (const [id, fs] of byLot.value) {
    if (brand.value && lotMeta.value.get(id)?.brand !== brand.value) continue
    if (textIds && !textIds.has(id)) continue
    const keys = new Set(fs.map((f) => f.key))
    if ([...selected.value].every((k) => keys.has(k))) out.push(id)
  }
  return out
})

async function showCars() {
  loading.value = true; err.value = ''
  try {
    let ids = matchIds.value
    // a text-only search can match cars without any feature row
    if (textIds && !selected.value.size) ids = [...textIds]
    const lots: any[] = []
    for (let i = 0; i < ids.length && i < 400; i += 100) {
      const { data, error } = await db.from('lots').select('id,brand,model,grade,mfg_year,mileage_km,transmission,venue,auction_date,lot_no,start_price_jpy,photos,bid_deadline').in('id', ids.slice(i, i + 100)).gt('bid_deadline', now())
      if (error) throw error
      lots.push(...(data || []))
    }
    lots.sort((a, b) => (byLot.value.get(b.id)?.length || 0) - (byLot.value.get(a.id)?.length || 0) || String(a.bid_deadline).localeCompare(String(b.bid_deadline)))
    cars.value = lots.slice(0, 60).map((l) => ({ ...l, photo: Array.isArray(l.photos) ? l.photos[0] : null, features: byLot.value.get(l.id) || [] }))
    total.value = lots.length
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
}
const total = ref(0)
const summary = computed(() => {
  const w = [...selected.value].map(featureLabel).join(' + ')
  return `${total.value} car${total.value === 1 ? '' : 's'}${w ? ' with ' + w : ''}${total.value > 60 ? ' (showing 60)' : ''}`
})

async function runText() {
  textIds = null
  if (q.value.trim()) {
    const { data, error } = await db.from('lots').select('id').textSearch('search', q.value.trim(), { config: 'simple', type: 'websearch' }).gt('bid_deadline', now()).limit(500)
    if (error) { err.value = error.message; return }
    textIds = new Set((data || []).map((r: any) => r.id))
  }
  await showCars()
}
function toggle(k: string) { const s = new Set(selected.value); s.has(k) ? s.delete(k) : s.add(k); selected.value = s }
function clearAll() { selected.value = new Set(); q.value = ''; brand.value = ''; textIds = null }
const chipClass = (f: Feat) => (f.source === 'aftermarket' ? 'warn' : f.source === 'factory' ? 'ok' : selected.value.has(f.key) ? 'ac' : '')
watch([selected, brand], () => { navigateTo({ query: { f: [...selected.value].join(',') || undefined, q: q.value || undefined } }, { replace: true }); showCars() })

onMounted(async () => {
  try { await loadFeatures(); if (q.value) await runText(); else await showCars() } catch (e: any) { err.value = e.message; loading.value = false }
})
</script>

<style scoped>
.cars { grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }
.car { display: grid; grid-template-columns: 120px 1fr; gap: 12px; }
.ph { border-radius: 10px; background: var(--s2); display: grid; place-items: center; color: var(--mu2); font-size: 11px; min-height: 90px; overflow: hidden; align-self: start; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.chip small { opacity: .7; }
@media (max-width: 760px) { .cars { grid-template-columns: 1fr; } .car { grid-template-columns: 96px 1fr; } }
</style>

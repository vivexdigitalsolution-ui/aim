<template>
  <div>
    <h1>Market prices</h1>
    <p class="sub">Type in a Malaysian price you have checked yourself. It is used for Today for you and Margin analysis straight away, and it overrides the CarzNexus figure for the same car and year. Delete it to fall back to CarzNexus.</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>
    <div v-if="done" class="okmsg" style="margin-bottom: 12px">{{ done }}</div>
    <div v-if="loading" class="muted">Loading ...</div>

    <template v-else>
      <!-- cars waiting for a price -->
      <div class="card" style="margin-bottom: 16px">
        <div class="row"><h2>Cars waiting for a price</h2><span class="muted small">{{ waiting.length }} cars or models, biggest first</span></div>
        <div v-if="!index.length" class="muted small" style="margin-top: 8px">The catalog names are not loaded yet. Run <code>node link-lots.js --write</code> on the scraper PC (and migration 25).</div>
        <div v-else-if="!waiting.length" class="muted small" style="margin-top: 8px">Every linked open car already has a market price.</div>
        <div class="wl">
          <div v-for="w in waiting.slice(0, 12)" :key="w.key" class="wrow">
            <div><b>{{ w.brand }} {{ w.model }}<span v-if="w.variant"> · {{ w.variant }}</span></b><span v-if="!w.variant" class="chip" style="margin-left: 6px">all variants</span>
              <div class="muted small">{{ w.lots }} open car{{ w.lots === 1 ? '' : 's' }} · {{ w.years }}</div></div>
            <button class="btn ghost sm" @click="prefill(w)">Add price</button>
          </div>
        </div>
      </div>

      <!-- the form -->
      <div ref="formEl" class="card" style="margin-bottom: 16px">
        <h2>Add or replace a price</h2>
        <div class="grid3">
          <label class="f">Brand<select v-model="f.brand" @change="f.model = ''; f.variantId = ''"><option value="">Choose ...</option><option v-for="b in brands" :key="b" :value="b">{{ b }}</option></select></label>
          <label class="f">Model<select v-model="f.model" :disabled="!f.brand" @change="f.variantId = ''"><option value="">Choose ...</option><option v-for="m in models" :key="m" :value="m">{{ m }}</option></select></label>
          <label class="f">Variant<select v-model="f.variantId" :disabled="!f.model"><option value="">All variants of this model</option><option v-for="v in variants" :key="v.ref_id" :value="v.ref_id">{{ v.variant }}{{ v.model_code ? ' (' + v.model_code + ')' : '' }}</option></select></label>
          <label class="f">Year from<input v-model.number="f.yearFrom" type="number" min="2000" max="2035" /></label>
          <label class="f">Year to<input v-model.number="f.yearTo" type="number" min="2000" max="2035" /></label>
          <label class="f">Comparable cars you checked<NumInput v-model="f.n" /></label>
          <label class="f">Low (RM)<NumInput v-model="f.low" /></label>
          <label class="f">Typical (RM)<NumInput v-model="f.mid" /></label>
          <label class="f">High (RM)<NumInput v-model="f.high" /></label>
          <label class="f" style="grid-column: 1 / -1">Note (where you checked, mileage, condition)<input v-model="f.note" placeholder="e.g. carlist.my and mudah, low mileage cars" /></label>
        </div>
        <p class="muted small" style="margin: 8px 0 0">Low and High are the usual range for a car like this, not the extremes. The cautious sell price used for margin is between Low and Typical.</p>
        <div class="row wrap" style="gap: 8px; margin-top: 12px; justify-content: flex-start">
          <button class="btn" :disabled="busy || !valid" @click="save">Save price{{ yearsCount > 1 ? 's for ' + yearsCount + ' years' : '' }}</button>
          <span v-if="problem" class="muted small">{{ problem }}</span>
        </div>
      </div>

      <!-- what is entered -->
      <div class="card" style="overflow-x: auto; padding: 4px 14px">
        <div class="row" style="padding: 12px 0 4px"><h2>Hand-checked prices</h2><span class="muted small">{{ manual.length }}</span></div>
        <table class="t">
          <thead><tr><th>Car</th><th>Year</th><th>Low – High (RM)</th><th>Typical</th><th>Cars</th><th>Checked</th><th>Note</th><th /></tr></thead>
          <tr v-for="r in manual" :key="r.level + r.ref_id + r.year_from">
            <td><b>{{ r.brand }} {{ r.model_key }}</b><span v-if="r.variant_name"> · {{ r.variant_name }}</span><span v-else class="chip" style="margin-left: 6px">all variants</span></td>
            <td>{{ r.year_from + 1 }}</td><td>{{ n(r.p25_myr) }} – {{ n(r.p75_myr) }}</td><td>{{ n(r.median_myr) }}</td><td>{{ r.n }}</td><td class="small">{{ r.as_of }}</td><td class="small muted">{{ r.note }}</td>
            <td class="r"><button class="btn ghost sm down" @click="remove(r)">Delete</button></td>
          </tr>
          <tr v-if="!manual.length"><td colspan="8" class="muted" style="padding: 16px 4px">None yet.</td></tr>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const { user } = useAuth()
const { load, lots, marketRows } = useMarginBoard()
const index = ref<any[]>([]), manual = ref<any[]>([]), loading = ref(true), err = ref(''), done = ref(''), busy = ref(false), formEl = ref<HTMLElement | null>(null)
const thisYear = new Date().getFullYear()
const f = reactive({ brand: '', model: '', variantId: '', yearFrom: thisYear - 2, yearTo: thisYear - 2, n: 3, low: null as number | null, mid: null as number | null, high: null as number | null, note: '' })
const n = (v: number) => Math.round(v).toLocaleString('en-US')

const brands = computed(() => [...new Set(index.value.map((r) => r.brand))].sort())
const models = computed(() => [...new Set(index.value.filter((r) => r.brand === f.brand).map((r) => r.model))].sort())
const variants = computed(() => index.value.filter((r) => r.level === 'variant' && r.brand === f.brand && r.model === f.model).sort((a, b) => String(a.variant).localeCompare(String(b.variant))))
const yearsCount = computed(() => Math.max(0, (f.yearTo || 0) - (f.yearFrom || 0) + 1))
const problem = computed(() => {
  if (!f.brand || !f.model) return 'Choose the car'
  if (!(f.yearFrom >= 2000 && f.yearTo >= f.yearFrom && yearsCount.value <= 12)) return 'Check the years (up to 12 at once)'
  if (!f.low || !f.mid || !f.high) return 'Fill in low, typical and high'
  if (!(f.low <= f.mid && f.mid <= f.high)) return 'It must be low ≤ typical ≤ high'
  if (f.low < 10000 || f.high > 5_000_000) return 'These prices do not look like RM car prices'
  return ''
})
const valid = computed(() => !problem.value)

// open cars with a catalog link but no market price yet, grouped by the car they are (variant, else model)
const waiting = computed(() => {
  const name = new Map(index.value.map((r) => [r.level + r.ref_id, r]))
  const g = new Map<string, { key: string; level: string; ref: string; lots: number; years: number[] }>()
  for (const l of lots.value) {
    if (l.market || l.level === 'none') continue
    const level = l.variant_id ? 'variant' : 'model', ref = (l.variant_id || l.model_id)!
    const x = g.get(level + ref) || g.set(level + ref, { key: level + ref, level, ref, lots: 0, years: [] }).get(level + ref)!
    x.lots++; if (l.mfg_year) x.years.push(l.mfg_year)
  }
  return [...g.values()].map((x) => { const nm = name.get(x.key); const ys = [...new Set(x.years)].sort(); return { ...x, brand: nm?.brand || '?', model: nm?.model || '?', variant: nm?.variant || null, years: ys.length ? (ys.length === 1 ? String(ys[0]) : ys[0] + '–' + ys[ys.length - 1]) : '', yearList: ys } })
    .filter((x) => x.brand !== '?').sort((a, b) => b.lots - a.lots)
})
function prefill(w: any) {
  f.brand = w.brand; f.model = w.model; f.variantId = w.level === 'variant' ? w.ref : ''
  f.yearFrom = w.yearList[0] || f.yearFrom; f.yearTo = w.yearList[w.yearList.length - 1] || f.yearTo
  formEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function refresh() {
  const [ix, mn] = await Promise.all([
    db.from('catalog_index').select('*').order('brand').limit(5000),
    db.from('market_stats').select('*').eq('source', 'manual').order('as_of', { ascending: false }).order('brand').limit(2000),
  ])
  if (ix.error) throw ix.error
  if (mn.error) throw mn.error
  index.value = ix.data || []; manual.value = mn.data || []
}
async function save() {
  busy.value = true; err.value = ''; done.value = ''
  try {
    const pick = f.variantId ? index.value.find((r) => r.level === 'variant' && r.ref_id === f.variantId) : index.value.find((r) => r.level === 'model' && r.brand === f.brand && r.model === f.model)
    if (!pick) throw new Error('That car is not in the catalog index')
    const today = new Date().toISOString().slice(0, 10)
    const rows: any[] = []
    for (let y = f.yearFrom; y <= f.yearTo; y++) {
      rows.push({
        level: pick.level, ref_id: pick.ref_id, brand_id: pick.brand_id, model_id: pick.model_id, variant_id: pick.level === 'variant' ? pick.ref_id : null,
        brand: pick.brand, model_key: pick.model, variant_name: pick.variant || null, year_from: y - 1, year_to: y + 1, n: f.n || 1, sellers: 1,
        min_myr: f.low, p25_myr: f.low, median_myr: f.mid, p75_myr: f.high, max_myr: f.high, avg_km: null, as_of: today, source: 'manual', note: f.note.trim() || null, entered_by: user.value?.id || null,
      })
    }
    // one current hand-checked price per car and year: replace the old one
    for (const r of rows) {
      const d = await db.from('market_stats').delete().eq('source', 'manual').eq('level', r.level).eq('ref_id', r.ref_id).eq('year_from', r.year_from)
      if (d.error) throw d.error
    }
    const ins = await db.from('market_stats').insert(rows)
    if (ins.error) throw ins.error
    done.value = `Saved ${rows.length} price${rows.length === 1 ? '' : 's'} for ${pick.brand} ${pick.model}${pick.variant ? ' ' + pick.variant : ''}.`
    Object.assign(f, { low: null, mid: null, high: null, note: '' })
    await refresh(); await load(true)
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
async function remove(r: any) {
  if (!confirm(`Delete this price for ${r.brand} ${r.model_key} ${r.year_from + 1}? CarzNexus will be used again if it has one.`)) return
  const { error } = await db.from('market_stats').delete().eq('source', 'manual').eq('level', r.level).eq('ref_id', r.ref_id).eq('year_from', r.year_from).eq('as_of', r.as_of)
  if (error) { err.value = error.message; return }
  await refresh(); await load(true)
}

onMounted(async () => { try { await load(); await refresh() } catch (e: any) { err.value = e.message } finally { loading.value = false } })
void marketRows
</script>

<style scoped>
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 12px; }
.f { display: grid; gap: 5px; color: var(--mu); font-size: 12px; } .f input, .f select { width: 100%; }
.wl { display: grid; gap: 8px; margin-top: 12px; }
.wrow { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--s2); border-radius: 10px; padding: 9px 12px; }
.t { width: 100%; border-collapse: collapse; } .t th { text-align: left; color: var(--mu); font-weight: 500; font-size: 12px; padding: 10px 6px; }
.t td { padding: 9px 6px; border-top: 1px solid var(--line); vertical-align: top; } .r { text-align: right; }
.down { color: var(--bad); }
@media (max-width: 760px) { .grid3 { grid-template-columns: 1fr; } }
</style>

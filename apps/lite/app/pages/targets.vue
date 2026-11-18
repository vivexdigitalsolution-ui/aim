<template>
  <div>
    <h1>Scrape targets</h1>
    <p class="sub">Choose what the scraper fetches from USS and ASNET: make, model, model codes, first-registered year and auction score. The scraper PC picks these up on its next run.</p>

    <div v-if="err" class="err" style="margin-bottom: 10px">{{ err }}</div>
    <div v-if="msg" class="okmsg" style="margin-bottom: 10px">{{ msg }}</div>

    <div class="card" style="margin-bottom: 18px">
      <h2>Add targets</h2>
      <div class="seg"><button :class="{ on: f.source === 'uss' }" @click="f.source = 'uss'">USS</button><button :class="{ on: f.source === 'asnet' }" @click="f.source = 'asnet'">ASNET</button></div>

      <template v-if="f.source === 'uss'">
        <label class="f">Make
          <select v-model="f.brand" @change="onBrand"><option value="">Choose a make</option><option v-for="b in brands" :key="b.code" :value="b.code">{{ b.name }}</option></select>
        </label>
        <div v-if="f.brand" class="models">
          <div class="row" style="margin-bottom: 6px"><span class="muted small">Models ({{ f.models.length }} picked)</span>
            <span><button class="btn ghost sm" @click="f.models = models.map((m) => m.code)">All</button> <button class="btn ghost sm" @click="f.models = []">None</button></span></div>
          <input v-model="modelSearch" placeholder="Filter the models" />
          <div class="chips"><label v-for="m in shownModels" :key="m.code" class="chip tag" :class="{ on: f.models.includes(m.code) }"><input v-model="f.models" type="checkbox" :value="m.code" hidden />{{ m.name }}</label></div>
        </div>
      </template>
      <template v-else>
        <div class="two">
          <label class="f">Make name<input v-model="f.aBrand" placeholder="Toyota" /></label>
          <label class="f">Model name<input v-model="f.aModel" placeholder="Alphard" /></label>
          <label class="f">ASNET make code<input v-model="f.aMaker" placeholder="from node asnet.js --probe" /></label>
          <label class="f">ASNET model code<input v-model="f.aCar" placeholder="from node asnet.js --probe" /></label>
        </div>
        <p class="muted small">ASNET has its own codes. Run <code>node asnet.js --probe</code> on the scraper PC to list them (<code>out/asnet-codes.json</code>). ASNET takes one lowest score, so the lowest score you tick below is used.</p>
      </template>

      <label class="f">Model codes to keep (chassis codes, comma separated, empty = every code)
        <input v-model="f.codes" placeholder="e.g. AGH30W, AGH35W" />
      </label>
      <div class="two">
        <label class="f">First registered from (year)<input v-model.number="f.yearFrom" type="number" :min="2000" :max="thisYear" /></label>
        <label class="f">to (year, empty = this year)<input v-model.number="f.yearTo" type="number" :min="2000" :max="thisYear" /></label>
      </div>
      <div class="f">Auction score to take
        <div class="chips"><label v-for="s in SCORES" :key="s" class="chip tag" :class="{ on: f.scores.includes(s) }"><input v-model="f.scores" type="checkbox" :value="s" hidden />{{ s }}</label></div>
        <small class="muted">None ticked = the scraper's own default from its .env. USS has no box for 3 and R on the bid list, so those only count for ASNET and the sold history.</small>
      </div>
      <label v-if="f.source === 'uss'" class="chk"><input v-model="f.history" type="checkbox" /> Also scrape the sold prices (History price)</label>
      <div style="margin-top: 12px"><button class="btn" :disabled="busy || !canAdd" @click="add">Add {{ addCount }} target{{ addCount === 1 ? '' : 's' }}</button></div>
    </div>

    <div class="card">
      <div class="row wrap" style="gap: 10px">
        <h2>Current targets <small class="muted">({{ total }})</small></h2>
        <div class="row wrap" style="gap: 8px">
          <select v-model="fSource" @change="reload"><option value="">USS and ASNET</option><option value="uss">USS</option><option value="asnet">ASNET</option></select>
          <select v-model="fType" @change="reload"><option value="">Cars + history</option><option value="bid">Cars (bid)</option><option value="history">History</option></select>
          <input v-model="fSearch" placeholder="Search make or model" @keyup.enter="reload" />
          <button class="btn ghost sm" @click="reload">Search</button>
        </div>
      </div>
      <div v-if="loading" class="muted" style="margin-top: 10px">Loading ...</div>
      <div class="scroll"><table class="tbl" v-if="rows.length">
        <thead><tr><th>On</th><th>Source</th><th>Type</th><th>Make / model</th><th>Years</th><th>Scores</th><th>Model codes</th><th>Last run</th><th></th></tr></thead>
        <tbody>
          <tr v-for="t in rows" :key="t.id" :class="{ off: !t.enabled }">
            <td data-label="On"><input type="checkbox" :checked="t.enabled" @change="patch(t, { enabled: ($event.target as HTMLInputElement).checked })" /></td>
            <td data-label="Source">{{ t.source.toUpperCase() }}</td><td data-label="Type">{{ t.lot_type === 'bid' ? 'Cars' : 'History' }}</td>
            <td class="ttl"><b>{{ t.brand_name }}</b> {{ t.model_name }}</td>
            <td data-label="Years">{{ t.year_from || '?' }}–{{ t.year_to || 'now' }}</td>
            <td data-label="Scores">{{ t.scores?.length ? t.scores.join(' ') : (t.score_min != null ? t.score_min + '+' : 'default') }}</td>
            <td data-label="Model codes">{{ t.model_codes?.length ? t.model_codes.join(', ') : 'all' }}</td>
            <td class="muted small" data-label="Last run">{{ t.last_run_at ? new Date(t.last_run_at).toLocaleDateString('en-GB') : 'never' }}</td>
            <td class="nw acts"><button class="btn ghost sm" @click="startEdit(t)">Edit</button> <button class="btn ghost sm" :disabled="busy" @click="remove(t)">Delete</button></td>
          </tr>
        </tbody>
      </table></div>
      <div v-if="!loading && !rows.length" class="muted" style="margin-top: 10px">No target matches.</div>
      <button v-if="rows.length < total" class="btn ghost" style="margin-top: 12px" :disabled="loading" @click="more">Show more ({{ total - rows.length }} left)</button>
    </div>

    <div v-if="ed" class="modal" @click.self="ed = null">
      <div class="card box">
        <h2>{{ ed.brand_name }} {{ ed.model_name }} ({{ ed.source.toUpperCase() }}, {{ ed.lot_type === 'bid' ? 'cars' : 'history' }})</h2>
        <div class="two">
          <label class="f">Year from<input v-model.number="ed.year_from" type="number" /></label>
          <label class="f">Year to<input v-model.number="ed.year_to" type="number" /></label>
        </div>
        <label class="f">Model codes (comma separated, empty = all)<input v-model="ed.codes" /></label>
        <div class="f">Scores<div class="chips"><label v-for="s in SCORES" :key="s" class="chip tag" :class="{ on: ed.scoresArr.includes(s) }"><input v-model="ed.scoresArr" type="checkbox" :value="s" hidden />{{ s }}</label></div></div>
        <div class="row" style="margin-top: 12px; justify-content: flex-end; gap: 8px"><button class="btn ghost" @click="ed = null">Cancel</button><button class="btn" :disabled="busy" @click="saveEdit">Save</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const thisYear = new Date().getFullYear()
const SCORES = ['S', '6', '5', '4.5', '4', '3.5', '3', 'R']
const err = ref(''), msg = ref(''), busy = ref(false), loading = ref(true)
const brands = ref<{ code: string; name: string }[]>([]), models = ref<{ code: string; name: string }[]>([]), modelSearch = ref('')
const f = reactive({ source: 'uss' as 'uss' | 'asnet', brand: '', models: [] as string[], aBrand: '', aModel: '', aMaker: '', aCar: '', codes: '', yearFrom: thisYear - 4 as number | null, yearTo: null as number | null, scores: ['S', '6', '5', '4.5', '4'] as string[], history: true })
const shownModels = computed(() => { const s = modelSearch.value.trim().toUpperCase(); return s ? models.value.filter((m) => m.name.toUpperCase().includes(s)) : models.value })
const codesArr = (s: string) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)
const addCount = computed(() => f.source === 'uss' ? f.models.length * (f.history ? 2 : 1) : (f.aMaker && f.aCar ? 1 : 0))
const canAdd = computed(() => addCount.value > 0 && (f.source === 'asnet' ? !!(f.aBrand && f.aModel) : true))

async function onBrand() {
  f.models = []; models.value = []
  if (!f.brand) return
  const { data, error } = await db.from('scraper_models').select('code,name').eq('brand_code', f.brand).order('name').limit(2000)
  if (error) err.value = error.message
  models.value = data || []
}

async function add() {
  busy.value = true; err.value = ''; msg.value = ''
  try {
    const base = { year_from: f.yearFrom || null, year_to: f.yearTo || null, scores: f.scores.length ? f.scores : null, model_codes: codesArr(f.codes).length ? codesArr(f.codes) : null, enabled: true, source: f.source }
    const rows: any[] = []
    if (f.source === 'uss') {
      const b = brands.value.find((x) => x.code === f.brand)!
      for (const code of f.models) {
        const m = models.value.find((x) => x.code === code)!
        for (const t of f.history ? ['bid', 'history'] : ['bid']) rows.push({ ...base, label: `${b.name} / ${m.name} (${t})`, lot_type: t, maker_code: b.code, car_code: m.code, brand_name: b.name, model_name: m.name })
      }
    } else {
      rows.push({ ...base, label: `${f.aBrand} / ${f.aModel} (ASNET)`, lot_type: 'bid', maker_code: f.aMaker.trim(), car_code: f.aCar.trim(), brand_name: f.aBrand.trim(), model_name: f.aModel.trim() })
    }
    // a target that already exists is updated with the new years / scores / codes, so there is one place to change them
    const { data, error } = await db.from('scrape_targets').upsert(rows, { onConflict: 'source,lot_type,maker_code,car_code' }).select('id')
    if (error) throw error
    msg.value = `${(data || []).length} target(s) saved.`
    f.models = []; await reload()
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}

// ── the current targets ──
const rows = ref<any[]>([]), total = ref(0), fSource = ref(''), fType = ref(''), fSearch = ref('')
const PAGE = 100
async function page(from: number) {
  let q = db.from('scrape_targets').select('id,source,lot_type,brand_name,model_name,year_from,year_to,scores,score_min,model_codes,enabled,last_run_at,maker_code,car_code', { count: 'exact' })
  if (fSource.value) q = q.eq('source', fSource.value)
  if (fType.value) q = q.eq('lot_type', fType.value)
  const s = fSearch.value.trim().replace(/[,()%]/g, ' ')
  if (s) q = q.or(`brand_name.ilike.%${s}%,model_name.ilike.%${s}%`)
  const { data, error, count } = await q.order('brand_name').order('model_name').range(from, from + PAGE - 1)
  if (error) throw error
  total.value = count || 0
  return data || []
}
async function reload() { loading.value = true; try { rows.value = await page(0) } catch (e: any) { err.value = e.message } finally { loading.value = false } }
async function more() { loading.value = true; try { rows.value = [...rows.value, ...(await page(rows.value.length))] } catch (e: any) { err.value = e.message } finally { loading.value = false } }
async function patch(t: any, p: Record<string, unknown>) { const { error } = await db.from('scrape_targets').update(p).eq('id', t.id); if (error) err.value = error.message; else Object.assign(t, p) }
async function remove(t: any) {
  if (!confirm(`Delete the target ${t.brand_name} ${t.model_name}?`)) return
  busy.value = true
  try { const { error } = await db.from('scrape_targets').delete().eq('id', t.id); if (error) throw error; rows.value = rows.value.filter((r) => r.id !== t.id); total.value-- } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
const ed = ref<any>(null)
function startEdit(t: any) { ed.value = { ...t, codes: (t.model_codes || []).join(', '), scoresArr: [...(t.scores || [])] } }
async function saveEdit() {
  const e = ed.value; busy.value = true
  try {
    const p = { year_from: e.year_from || null, year_to: e.year_to || null, scores: e.scoresArr.length ? e.scoresArr : null, model_codes: codesArr(e.codes).length ? codesArr(e.codes) : null }
    const { error } = await db.from('scrape_targets').update(p).eq('id', e.id)
    if (error) throw error
    Object.assign(rows.value.find((r) => r.id === e.id) || {}, p); ed.value = null
  } catch (x: any) { err.value = x.message } finally { busy.value = false }
}

onMounted(async () => {
  try {
    const { data, error } = await db.from('scraper_brands').select('code,name').order('name').limit(1000)
    if (error) throw error
    brands.value = data || []
  } catch (e: any) { err.value = e.message }
  await reload()
})
</script>

<style scoped>
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-bottom: 10px; }
.seg button { background: transparent; border: 0; color: inherit; padding: 8px 18px; cursor: pointer; font-weight: 600; }
.seg button.on { background: var(--ac); color: #fff; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.models { margin: 10px 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; max-height: 220px; overflow: auto; }
.chips .chip { cursor: pointer; user-select: none; }
.scroll { overflow-x: auto; margin-top: 10px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 14px; } .tbl th { text-align: left; color: var(--mu); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--line); } .tbl td { padding: 7px 8px; border-bottom: 1px solid var(--line); }
.tbl tr.off { opacity: .5; } .nw { white-space: nowrap; }
.chk { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; cursor: pointer; }
.modal { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: grid; place-items: center; z-index: 50; padding: 16px; }
.box { width: min(520px, 100%); }
@media (max-width: 640px) { .two { grid-template-columns: 1fr; } }
@media (max-width: 760px) {
  .scroll { overflow: visible; }
  .tbl thead { display: none; }
  .tbl, .tbl tbody, .tbl tr { display: block; width: 100%; }
  .tbl tr { border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; margin: 0 0 10px; background: var(--card); }
  .tbl td { display: flex; justify-content: space-between; align-items: center; gap: 14px; border: 0 !important; padding: 5px 0 !important; text-align: right; }
  .tbl td[data-label]::before { content: attr(data-label); color: var(--mu); font-size: 12.5px; flex: none; text-align: left; }
  .tbl td.ttl { justify-content: flex-start; font-size: 15px; text-align: left; border-bottom: 1px solid var(--line) !important; padding-bottom: 8px !important; margin-bottom: 4px; }
  .tbl td.acts { justify-content: flex-end; padding-top: 10px !important; }
}
</style>

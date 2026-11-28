<template>
  <div class="tg">
    <h1>Scrape targets</h1>
    <p class="sub">Choose what the scraper fetches. One line below = one make + model; it can scrape the bidding cars, the one-price cars and the sold prices (history) together. The scraper PC picks the changes up on its next run.</p>

    <div v-if="err" class="err" style="margin-bottom: 10px">{{ err }}</div>
    <div v-if="msg" class="okmsg" style="margin-bottom: 10px">{{ msg }}</div>

    <!-- ─────────── add ─────────── -->
    <section class="card add">
      <h2>Add targets</h2>

      <div class="step">
        <div class="lbl">Source</div>
        <div class="seg"><button :class="{ on: source === 'uss' }" @click="source = 'uss'">USS</button><button :class="{ on: source === 'asnet' }" @click="source = 'asnet'">ASNET</button></div>
      </div>

      <div class="cols">
        <div class="step">
          <div class="lbl">Make <small>one or more</small></div>
          <MultiPick v-model="selBrands" :groups="brandGroups" placeholder="Choose makes" noun="makes" search-placeholder="Search makes" :loading="loadingBrands"
            :empty-text="source === 'asnet' ? 'The ASNET list is empty: run  node asnet.js --probe  on the scraper PC (after migration 41).' : 'No makes yet: run  node brand-model-scraper.js en'" />
        </div>
        <div class="step">
          <div class="lbl">Model <small>grouped by make</small></div>
          <MultiPick v-model="selModels" :groups="modelGroups" :disabled="!selBrands.length" :loading="loadingModels" placeholder="Choose models" noun="models" search-placeholder="Search models" empty-text="Choose a make first." />
        </div>
      </div>

      <div class="step">
        <div class="lbl">Narrow down <small>optional · {{ source === 'uss' ? 'a model is narrowed by variants OR by model codes, not both' : 'ASNET has no standard variant names, so only model codes' }}</small></div>
        <div class="cols">
          <div v-if="source === 'uss'">
            <div class="sublbl">Variant (grade)</div>
            <MultiPick v-model="selVariants" :groups="variantGroups" :disabled="!selModels.length" :loading="loadingDetail" placeholder="Every variant" noun="variants" search-placeholder="Search variants"
              empty-text="No variant seen yet for these models: it is filled after the first bidding scrape." />
          </div>
          <div>
            <div class="sublbl">Model code</div>
            <MultiPick v-model="selCodes" :groups="codeGroups" :disabled="!selModels.length" :loading="loadingDetail" placeholder="Every model code" noun="codes" search-placeholder="Search model codes"
              empty-text="No model code list for these models." />
          </div>
        </div>
        <p v-if="source === 'uss' && (varModels.size || codeModels.size)" class="note">
          <template v-if="varModels.size">{{ varModels.size }} model{{ varModels.size === 1 ? '' : 's' }} narrowed by variant (their model codes are greyed out). </template>
          <template v-if="codeModels.size">{{ codeModels.size }} model{{ codeModels.size === 1 ? '' : 's' }} narrowed by model code (their variants are greyed out). </template>
          Untick everything of a model to free the other choice.
        </p>
      </div>

      <div class="cols">
        <div class="step">
          <div class="lbl">First registered</div>
          <div class="yrs">
            <input v-model.number="yearFrom" type="number" inputmode="numeric" :min="2000" :max="thisYear" placeholder="from" />
            <span class="muted">to</span>
            <input v-model.number="yearTo" type="number" inputmode="numeric" :min="2000" :max="thisYear" placeholder="this year" />
          </div>
        </div>
        <div class="step">
          <div class="lbl">Auction score</div>
          <div class="scs"><label v-for="s in SCORES" :key="s" class="sc" :class="{ on: scores.includes(s) }"><input v-model="scores" type="checkbox" :value="s" hidden />{{ s }}</label></div>
        </div>
      </div>
      <p class="note">No score ticked = the scraper's default from its .env. USS has no box for 3 and R on the bid and one-price lists, so those only count for ASNET and the sold history.{{ source === 'asnet' ? ' For ASNET the ticked scores are kept from the results (with R unticked, the lowest ticked number is also set on its search).' : '' }}</p>

      <div class="step">
        <div class="lbl">What to scrape</div>
        <div class="types">
          <label v-if="source === 'uss'" class="ty" :class="{ on: types.bid }"><input v-model="types.bid" type="checkbox" /><span><b>Bidding</b><small>cars up for auction</small></span></label>
          <label class="ty" :class="{ on: source === 'asnet' || types.one_price }"><input v-if="source === 'uss'" v-model="types.one_price" type="checkbox" /><input v-else type="checkbox" checked disabled /><span><b>One price</b><small>fixed-price cars</small></span></label>
          <label v-if="source === 'uss'" class="ty" :class="{ on: types.history }"><input v-model="types.history" type="checkbox" /><span><b>History price</b><small>sold prices · every variant</small></span></label>
        </div>
        <p v-if="source === 'uss' && types.one_price && selVariants.length" class="note warn">One price is read from the Japanese site, so variants cannot narrow it: it takes every variant of the model (model codes do work).</p>
      </div>

      <div class="go"><button class="btn" :disabled="busy || !canAdd" @click="add">{{ busy ? 'Saving ...' : `Add ${addCount} target${addCount === 1 ? '' : 's'}` }}</button><span class="muted small">{{ selModels.length }} model{{ selModels.length === 1 ? '' : 's' }} × {{ typeCount }} type{{ typeCount === 1 ? '' : 's' }}</span></div>
    </section>

    <!-- ─────────── list ─────────── -->
    <section class="card list">
      <div class="lh">
        <h2>Current targets <small class="muted">({{ groups.length }}{{ rows.length < total ? '+' : '' }} models)</small></h2>
        <div class="filters">
          <select v-model="fSource" @change="reload"><option value="">USS and ASNET</option><option value="uss">USS</option><option value="asnet">ASNET</option></select>
          <select v-model="fStatus" @change="reload"><option value="">All models</option><option value="new">New (found by the weekly check)</option><option value="warn">Warning: 0 cars found</option></select>
          <span class="sbox"><input v-model="fSearch" placeholder="Search make or model" @keyup.enter="reload" /><button v-if="fSearch" type="button" class="x" aria-label="Clear" @click="fSearch = ''; reload()">×</button></span>
        </div>
      </div>

      <div v-if="loading" class="muted" style="margin-top: 10px">Loading ...</div>
      <div v-if="groups.length" class="scroll">
        <table class="tbl">
          <thead><tr><th>Source</th><th>Make / model</th><th>Years</th><th>Scores</th><th>Narrowed by</th><th>Scrapes · last run</th><th></th></tr></thead>
          <tbody>
            <tr v-for="g in groups" :key="g.key">
              <td data-label="Source" class="src">{{ g.source.toUpperCase() }}</td>
              <td class="ttl"><b>{{ g.brand_name }}</b> {{ g.model_name }}
                <span v-if="newOf(g).length" class="tag new" :title="'Found by the weekly model check: USS has cars of this model for ' + newOf(g).join(', ') + '. Off until you switch it on.'">New · {{ newOf(g).join(', ') }}</span>
                <span v-if="warnOf(g).length" class="tag warn" :title="'The weekly check found 0 cars ' + warnOf(g).map((w) => w.label + ' x' + w.n).join(', ') + ' in a row. A scrape type is switched off automatically after more than 8.'">0 cars × {{ Math.max(...warnOf(g).map((w) => w.n)) }}</span>
                <span v-if="autoOff(g).length" class="tag off" :title="autoOff(g).join(' / ')">Auto-off</span></td>
              <td data-label="Years">{{ g.year_from || '?' }}–{{ g.year_to || 'now' }}</td>
              <td data-label="Scores">{{ g.scores?.length ? g.scores.join(' ') : (g.score_min != null ? g.score_min + '+' : 'default') }}</td>
              <td data-label="Narrowed by" class="nar">
                <template v-if="g.grades?.length"><span class="k">Variant</span> {{ g.grades.join(', ') }}</template>
                <template v-else-if="g.model_codes?.length"><span class="k">Code</span> {{ g.model_codes.join(', ') }}</template>
                <span v-else class="muted">Everything</span>
              </td>
              <td class="runs" data-label="Scrapes">
                <button v-for="t in typesOf(g)" :key="t.k" class="run" :class="{ on: g.types[t.k]?.enabled, none: !g.types[t.k] }" :disabled="busy" :title="runTitle(g, t)" @click="togglePill(g, t.k)">
                  <span class="rn">{{ t.label }}</span>
                  <span class="rd">{{ g.types[t.k] ? (g.types[t.k].enabled ? lastRun(g.types[t.k]) : (g.types[t.k].status === 'new' ? 'new · off' : 'off')) : '+ add' }}</span>
                </button>
              </td>
              <td class="nw acts"><button class="btn ghost sm" @click="startEdit(g)">Edit</button> <button class="btn ghost sm" :disabled="busy" @click="removeGroup(g)">Delete</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="!loading && !groups.length" class="muted" style="margin-top: 10px">No target matches.</div>
      <button v-if="rows.length < total" class="btn ghost" style="margin-top: 12px" :disabled="loading" @click="more">Show more ({{ total - rows.length }} lines left)</button>
    </section>

    <!-- ─────────── edit one model ─────────── -->
    <div v-if="ed" class="modal" @click.self="ed = null">
      <div class="card box">
        <h2>{{ ed.g.brand_name }} {{ ed.g.model_name }} <small class="muted">({{ ed.g.source.toUpperCase() }})</small></h2>
        <p class="note" style="margin-top: 4px">The years, scores and narrowing below apply to every scrape type of this model.</p>
        <div class="step"><div class="lbl">First registered</div>
          <div class="yrs"><input v-model.number="ed.year_from" type="number" inputmode="numeric" placeholder="from" /><span class="muted">to</span><input v-model.number="ed.year_to" type="number" inputmode="numeric" placeholder="this year" /></div></div>
        <div class="step"><div class="lbl">Auction score</div><div class="scs"><label v-for="s in SCORES" :key="s" class="sc" :class="{ on: ed.scores.includes(s) }"><input v-model="ed.scores" type="checkbox" :value="s" hidden />{{ s }}</label></div></div>
        <div class="step"><div class="lbl">Narrow down</div>
          <div class="seg wide">
            <button :class="{ on: ed.mode === 'none' }" @click="setMode('none')">Everything</button>
            <button :class="{ on: ed.mode === 'codes' }" @click="setMode('codes')">Model codes</button>
            <button v-if="ed.g.source === 'uss'" :class="{ on: ed.mode === 'grades' }" @click="setMode('grades')">Variants</button>
          </div>
          <div v-if="ed.mode !== 'none'" style="margin-top: 8px">
            <MultiPick v-model="ed.picks" as-sheet :groups="edGroups" :loading="loadingDetail" :placeholder="ed.mode === 'codes' ? 'Choose model codes' : 'Choose variants'" :noun="ed.mode === 'codes' ? 'codes' : 'variants'" search-placeholder="Search" empty-text="Nothing listed for this model yet." />
          </div>
        </div>
        <div class="foot"><button class="btn ghost" @click="ed = null">Cancel</button><button class="btn" :disabled="busy" @click="saveEdit">Save</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// ASNET models named differently from USS: the same list the ASNET scraper uses
import asnetAliases from '../../../../services/scraper/lib/asnet/aliases.json'
type Opt = { code: string; name: string }
type Item = { value: string; label: string; hint?: string; disabled?: boolean; why?: string }
type Group = { key: string; label?: string; sub?: string; items: Item[] }

const db = useDb()
const thisYear = new Date().getFullYear()
const SCORES = ['S', '6', '5', '4.5', '4', '3.5', '3', 'R']
const TYPES = [{ k: 'bid', label: 'Bidding' }, { k: 'one_price', label: 'One price' }, { k: 'history', label: 'History' }] as const
const err = ref(''), msg = ref(''), busy = ref(false), loading = ref(true)
const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' })
const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })

/** Supabase hands out 1000 rows per request: read a query page by page. */
async function pageAll(make: () => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ═══════════════ add: the choices ═══════════════
const source = ref<'uss' | 'asnet'>('uss')
const brandsBy = reactive<Record<string, Opt[]>>({ uss: [], asnet: [] })
const modelCache = reactive<Record<string, Opt[]>>({})            // "uss:<maker>" -> models
const selBrands = ref<string[]>([]), selModels = ref<string[]>([]), selVariants = ref<string[]>([]), selCodes = ref<string[]>([])
const yearFrom = ref<number | null>(thisYear - 4), yearTo = ref<number | null>(null)
const scores = ref<string[]>([...SCORES])      // every score by default
const types = reactive({ bid: true, one_price: false, history: true })
const loadingBrands = ref(false), loadingModels = ref(false), loadingDetail = ref(false)

const brandName = (code: string, src = source.value) => brandsBy[src].find((b) => b.code === code)?.name || code
const modelName = (mk: string, src = source.value) => (modelCache[`${src}:${mk.split('|')[0]}`] || []).find((m) => m.code === mk.split('|')[1])?.name || mk.split('|')[1]

async function loadBrands(src: 'uss' | 'asnet') {
  if (brandsBy[src].length) return
  loadingBrands.value = true
  try {
    if (src === 'uss') brandsBy.uss = (await pageAll(() => db.from('scraper_brands').select('code,name').order('name'))) as Opt[]
    else {
      const rows = await pageAll(() => db.from('asnet_catalog').select('maker_code,maker').order('maker'))
      brandsBy.asnet = [...new Map(rows.map((r: any) => [r.maker_code, { code: r.maker_code, name: r.maker }])).values()] as Opt[]
    }
  } catch (e: any) { err.value = e.message } finally { loadingBrands.value = false }
}
async function loadModels(src: 'uss' | 'asnet', brand: string) {
  const key = `${src}:${brand}`
  if (modelCache[key]) return
  if (src === 'uss') modelCache[key] = (await pageAll(() => db.from('scraper_models').select('code,name').eq('brand_code', brand).order('name'))) as Opt[]
  else modelCache[key] = (await pageAll(() => db.from('asnet_catalog').select('car_code,car').eq('maker_code', brand).order('car'))).map((r: any) => ({ code: r.car_code, name: r.car }))
}

const brandGroups = computed<Group[]>(() => [{ key: 'b', items: brandsBy[source.value].map((b) => ({ value: b.code, label: b.name })).sort((a, b) => cmp(a.label, b.label)) }])
const modelGroups = computed<Group[]>(() => [...selBrands.value].sort((a, b) => cmp(brandName(a), brandName(b))).map((b) => ({
  key: b, label: brandName(b), sub: `${(modelCache[`${source.value}:${b}`] || []).length} models`,
  items: [...(modelCache[`${source.value}:${b}`] || [])].sort(byName).map((m) => ({ value: `${b}|${m.code}`, label: m.name })),
})))

watch(source, async (s) => { selBrands.value = []; selModels.value = []; selVariants.value = []; selCodes.value = []; await loadBrands(s) })
watch(selBrands, async (bs) => {
  loadingModels.value = true
  try { await Promise.all(bs.map((b) => loadModels(source.value, b))) } catch (e: any) { err.value = e.message } finally { loadingModels.value = false }
  selModels.value = selModels.value.filter((m) => bs.includes(m.split('|')[0]))
})

// ── variants and model codes of the chosen models ──
const codeCache = reactive<Record<string, string[]>>({})            // "<uss maker>|<uss car>" -> codes
const gradeCache = reactive<Record<string, { name: string; seen: number }[]>>({})
const ussKeyCache = reactive<Record<string, string[]>>({})          // asnet model key -> the matching USS "<maker>|<car>" ("MINI" covers both 3HB and 5HB)

/** The USS models that are the same car as an ASNET model (the model code list only exists for USS). */
async function ussKeysOf(mk: string, src: 'uss' | 'asnet' = source.value): Promise<string[]> {
  if (src === 'uss') return [mk]
  if (mk in ussKeyCache) return ussKeyCache[mk]
  await loadBrands('uss')
  const asnetMake = brandName(mk.split('|')[0], 'asnet').toUpperCase()
  // ASNET writes some names with the make in front ("MINI CLUBMAN" for "CLUBMAN"): try both
  const name = modelName(mk, 'asnet').toUpperCase(), front = asnetMake + ' '
  const names = [name, name.startsWith(front) ? name.slice(front.length) : name].map(norm)
  const makes: Record<string, { make: string; model?: string }> = asnetAliases.makes
  const modelAliases: Record<string, Record<string, string[]>> = asnetAliases.models
  const found: string[] = []
  for (const ub of brandsBy.uss) {
    // the same make, or one of ours that ASNET files under this make (Abarth under Fiat, Mercedes Maybach as Maybach)
    const ourMake = ub.name.toUpperCase(), moved = makes[ourMake]
    if (norm(moved?.make || ourMake) !== norm(asnetMake)) continue
    await loadModels('uss', ub.code)
    for (const m of modelCache[`uss:${ub.code}`] || []) {
      const ours = m.name.toUpperCase().replace(/\s*\(\d+\)\s*$/, '')      // some names carry a count: "CT5 (7)"
      const asnet = moved?.model ? [moved.model] : [ours, ...(modelAliases[ourMake]?.[ours] || [])]
      if (asnet.some((n) => names.includes(norm(n)))) found.push(`${ub.code}|${m.code}`)
    }
  }
  ussKeyCache[mk] = found
  return found
}
async function fetchDetail(keys: string[], withGrades: boolean) {
  const need = [...new Set(keys)].filter((k) => !(k in codeCache) || (withGrades && !(k in gradeCache)))
  const byMaker = new Map<string, string[]>()
  for (const k of need) { const [m, c] = k.split('|'); (byMaker.get(m) || byMaker.set(m, []).get(m)!).push(c) }
  for (const [maker, cars] of byMaker) for (let i = 0; i < cars.length; i += 40) {
    const chunk = cars.slice(i, i + 40)
    for (const c of chunk) { codeCache[`${maker}|${c}`] = []; if (withGrades) gradeCache[`${maker}|${c}`] = [] }
    const codes = await pageAll(() => db.from('scraper_model_codes').select('car_code,code').eq('maker_code', maker).in('car_code', chunk))
    for (const r of codes) codeCache[`${maker}|${r.car_code}`].push(r.code)
    if (withGrades) { const gs = await pageAll(() => db.from('scraper_grades').select('car_code,name,seen').eq('maker_code', maker).in('car_code', chunk)); for (const r of gs) gradeCache[`${maker}|${r.car_code}`].push({ name: r.name, seen: r.seen }) }
  }
}
watch(selModels, async (ms) => {
  // forget picks of a model that is no longer chosen
  const keep = (v: string) => ms.includes(v.split('|').slice(0, 2).join('|'))
  selVariants.value = selVariants.value.filter(keep); selCodes.value = selCodes.value.filter(keep)
  if (!ms.length) return
  loadingDetail.value = true
  try { const ks = (await Promise.all(ms.map(ussKeysOf))).flat(); await fetchDetail(ks, source.value === 'uss') } catch (e: any) { err.value = e.message } finally { loadingDetail.value = false }
}, { deep: false })

const modelOf = (v: string) => v.split('|').slice(0, 2).join('|')
const tail = (v: string) => v.split('|').slice(2).join('|')
const varModels = computed(() => new Set(selVariants.value.map(modelOf)))
const codeModels = computed(() => new Set(selCodes.value.map(modelOf)))
const orderedModels = computed(() => [...selModels.value].sort((a, b) => cmp(brandName(a.split('|')[0]), brandName(b.split('|')[0])) || cmp(modelName(a), modelName(b))))
const gLabel = (mk: string) => `${brandName(mk.split('|')[0])} › ${modelName(mk)}`

const variantGroups = computed<Group[]>(() => orderedModels.value.map((mk) => ({
  key: mk, label: gLabel(mk),
  items: [...(gradeCache[mk] || [])].sort((a, b) => cmp(a.name, b.name)).map((g) => ({ value: `${mk}|${g.name}`, label: g.name, hint: g.seen > 1 ? `· ${g.seen}` : '', disabled: codeModels.value.has(mk), why: 'Model codes are chosen for this model: untick them first.' })),
})))
const codeGroups = computed<Group[]>(() => orderedModels.value.map((mk) => {
  const uks = source.value === 'uss' ? [mk] : ussKeyCache[mk] || []
  return { key: mk, label: gLabel(mk), items: [...new Set(uks.flatMap((k) => codeCache[k] || []))].sort(cmp).map((c) => ({ value: `${mk}|${c}`, label: c, disabled: varModels.value.has(mk), why: 'Variants are chosen for this model: untick them first.' })) }
}))

const typeCount = computed(() => (source.value === 'asnet' ? 1 : [types.bid, types.one_price, types.history].filter(Boolean).length))
const addCount = computed(() => selModels.value.length * typeCount.value)
const canAdd = computed(() => addCount.value > 0 && (source.value === 'asnet' || typeCount.value > 0))

async function add() {
  busy.value = true; err.value = ''; msg.value = ''
  try {
    const wanted = source.value === 'asnet' ? ['one_price'] : TYPES.map((t) => t.k).filter((k) => types[k])
    const out: any[] = []
    for (const mk of selModels.value) {
      const [maker, car] = mk.split('|')
      const codes = selCodes.value.filter((v) => modelOf(v) === mk).map(tail), grades = selVariants.value.filter((v) => modelOf(v) === mk).map(tail)
      for (const t of wanted) out.push({
        label: `${brandName(maker)} / ${modelName(mk)} (${t})`, lot_type: t, maker_code: maker, car_code: car, brand_name: brandName(maker), model_name: modelName(mk),
        year_from: yearFrom.value || null, year_to: yearTo.value || null, scores: scores.value.length ? scores.value : null,
        model_codes: codes.length ? codes : null, grades: grades.length ? grades : null, enabled: true, source: source.value,
      })
    }
    // a target that already exists is updated with the new years / scores / narrowing, so there is one place to change them
    for (let i = 0; i < out.length; i += 200) {
      const { error } = await db.from('scrape_targets').upsert(out.slice(i, i + 200), { onConflict: 'source,lot_type,maker_code,car_code' })
      if (error) throw error
    }
    msg.value = `${out.length} target${out.length === 1 ? '' : 's'} saved for ${selModels.value.length} model${selModels.value.length === 1 ? '' : 's'}.`
    selModels.value = []; selVariants.value = []; selCodes.value = []
    await reload()
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}

// ═══════════════ the current targets, one line per model ═══════════════
const rows = ref<any[]>([]), total = ref(0), fSource = ref(''), fSearch = ref(''), fStatus = ref('')
const PAGE = 300
const COLS = 'id,source,lot_type,brand_name,model_name,year_from,year_to,scores,score_min,model_codes,grades,enabled,last_run_at,maker_code,car_code,status,zero_count,disabled_reason'
async function page(from: number) {
  let q = db.from('scrape_targets').select(COLS, { count: 'exact' })
  if (fSource.value) q = q.eq('source', fSource.value)
  if (fStatus.value === 'new') q = q.eq('status', 'new')
  if (fStatus.value === 'warn') q = q.gt('zero_count', 0)
  const s = fSearch.value.trim().replace(/[,()%]/g, ' ')
  if (s) q = q.or(`brand_name.ilike.%${s}%,model_name.ilike.%${s}%`)
  const { data, error, count } = await q.order('brand_name').order('model_name').order('source').order('maker_code').order('car_code').range(from, from + PAGE - 1)
  if (error) throw error
  total.value = count || 0
  return data || []
}
async function reload() { loading.value = true; try { rows.value = await page(0) } catch (e: any) { err.value = e.message } finally { loading.value = false } }
async function more() { loading.value = true; try { rows.value = [...rows.value, ...(await page(rows.value.length))] } catch (e: any) { err.value = e.message } finally { loading.value = false } }

type G = { key: string; source: string; maker_code: string; car_code: string; brand_name: string; model_name: string; year_from: number | null; year_to: number | null; scores: string[] | null; score_min: number | null; model_codes: string[] | null; grades: string[] | null; types: Record<string, any> }
const groups = computed<G[]>(() => {
  const m = new Map<string, G>()
  for (const r of rows.value) {
    const key = `${r.source}|${r.maker_code}|${r.car_code}`
    let g = m.get(key)
    if (!g) { g = { key, source: r.source, maker_code: r.maker_code, car_code: r.car_code, brand_name: r.brand_name, model_name: r.model_name, year_from: r.year_from, year_to: r.year_to, scores: r.scores, score_min: r.score_min, model_codes: r.model_codes, grades: r.grades, types: {} }; m.set(key, g) }
    g.types[r.lot_type] = r
    if (r.lot_type === (r.source === 'asnet' ? 'one_price' : 'bid')) Object.assign(g, { year_from: r.year_from, year_to: r.year_to, scores: r.scores, score_min: r.score_min, model_codes: r.model_codes, grades: r.grades })
  }
  return [...m.values()]
})
const newOf = (g: G) => TYPES.filter((t) => g.types[t.k]?.status === 'new').map((t) => t.label)
const warnOf = (g: G) => TYPES.filter((t) => g.types[t.k]?.enabled && g.types[t.k]?.zero_count > 0).map((t) => ({ label: t.label, n: g.types[t.k].zero_count }))
const autoOff = (g: G) => TYPES.filter((t) => g.types[t.k]?.disabled_reason && !g.types[t.k]?.enabled).map((t) => t.label + ': ' + g.types[t.k].disabled_reason)
const typesOf = (g: G) => (g.source === 'asnet' ? TYPES.filter((t) => t.k === 'one_price') : TYPES)
const lastRun = (r: any) => (r.last_run_at ? new Date(r.last_run_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'never run')
const runTitle = (g: G, t: { k: string; label: string }) => { const r = g.types[t.k]; return !r ? `Add ${t.label} for this model` : r.enabled ? `${t.label} is on (click to switch off). Last run: ${r.last_run_at ? new Date(r.last_run_at).toLocaleString('en-GB') : 'never'}` : `${t.label} is off (click to switch on)` }

async function togglePill(g: G, k: string) {
  busy.value = true; err.value = ''
  try {
    const r = g.types[k]
    if (r) {
      const patch: any = { enabled: !r.enabled }
      if (patch.enabled) Object.assign(patch, { status: 'live', zero_count: 0, disabled_reason: null })      // switched on by hand: live, the weekly check starts counting again from 0
      const { error } = await db.from('scrape_targets').update(patch).eq('id', r.id); if (error) throw error; Object.assign(r, patch)
      if (patch.enabled && k !== 'history') await historyOn(g)
      return
    }
    const base = g.types.bid || Object.values(g.types)[0]
    const row = { label: `${g.brand_name} / ${g.model_name} (${k})`, lot_type: k, maker_code: g.maker_code, car_code: g.car_code, brand_name: g.brand_name, model_name: g.model_name, year_from: base?.year_from ?? null, year_to: base?.year_to ?? null, scores: base?.scores ?? null, model_codes: base?.model_codes ?? null, grades: base?.grades ?? null, enabled: true, source: g.source }
    const { data, error } = await db.from('scrape_targets').insert(row).select(COLS).single()
    if (error) throw error
    rows.value = [...rows.value, data]
    if (k !== 'history') await historyOn(g)
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
/** Bidding or One price switched on: History goes on with it (a car's usual selling price comes from History). */
async function historyOn(g: G) {
  if (g.source === 'asnet') return      // ASNET has no sold history to read
  const h = g.types.history
  if (h) {
    if (h.enabled) return
    const patch = { enabled: true, status: 'live', zero_count: 0, disabled_reason: null }
    const { error } = await db.from('scrape_targets').update(patch).eq('id', h.id); if (error) throw error
    Object.assign(h, patch); return
  }
  const base = g.types.bid || Object.values(g.types)[0]
  const row = { label: `${g.brand_name} / ${g.model_name} (history)`, lot_type: 'history', maker_code: g.maker_code, car_code: g.car_code, brand_name: g.brand_name, model_name: g.model_name, year_from: base?.year_from ?? null, year_to: base?.year_to ?? null, scores: base?.scores ?? null, enabled: true, source: g.source }
  const { data, error } = await db.from('scrape_targets').insert(row).select(COLS).single()
  if (error) throw error
  rows.value = [...rows.value, data]
}
async function removeGroup(g: G) {
  if (!confirm(`Delete ${g.brand_name} ${g.model_name} (${Object.keys(g.types).length} scrape type${Object.keys(g.types).length === 1 ? '' : 's'})?`)) return
  busy.value = true
  try {
    const { error } = await db.from('scrape_targets').delete().eq('source', g.source).eq('maker_code', g.maker_code).eq('car_code', g.car_code)
    if (error) throw error
    rows.value = rows.value.filter((r) => !(r.source === g.source && r.maker_code === g.maker_code && r.car_code === g.car_code)); total.value -= Object.keys(g.types).length
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}

// ── edit one model ──
const ed = ref<any>(null)
const edGroups = computed<Group[]>(() => {
  if (!ed.value) return []
  const e = ed.value
  const have = e.mode === 'codes' ? (e.codes as string[]) : (e.grades as { name: string }[]).map((x) => x.name)
  const list = [...new Set([...have, ...e.picks])].sort(cmp)
  return [{ key: 'one', items: list.map((v) => ({ value: v, label: v })) }]
})
async function startEdit(g: G) {
  ed.value = { g, year_from: g.year_from, year_to: g.year_to, scores: [...(g.scores || [])], mode: g.grades?.length ? 'grades' : g.model_codes?.length ? 'codes' : 'none', picks: [...(g.grades?.length ? g.grades : g.model_codes || [])], codes: [], grades: [] }
  loadingDetail.value = true
  try {
    const own = `${g.maker_code}|${g.car_code}`
    if (g.source === 'asnet') { await loadBrands('asnet'); await loadModels('asnet', g.maker_code) }
    const uks = await ussKeysOf(own, g.source as 'uss' | 'asnet')
    await fetchDetail(uks, g.source === 'uss')
    ed.value.codes = [...new Set(uks.flatMap((k) => codeCache[k] || []))]
    ed.value.grades = g.source === 'uss' ? [...(gradeCache[own] || [])] : []
  } catch (x: any) { err.value = x.message } finally { loadingDetail.value = false }
}
function setMode(m: string) { ed.value.mode = m; ed.value.picks = [] }
async function saveEdit() {
  const e = ed.value, g = e.g; busy.value = true
  try {
    const p = {
      year_from: e.year_from || null, year_to: e.year_to || null, scores: e.scores.length ? e.scores : null,
      model_codes: e.mode === 'codes' && e.picks.length ? e.picks : null, grades: e.mode === 'grades' && e.picks.length ? e.picks : null,
    }
    const { error } = await db.from('scrape_targets').update(p).eq('source', g.source).eq('maker_code', g.maker_code).eq('car_code', g.car_code)
    if (error) throw error
    rows.value = rows.value.map((r) => (r.source === g.source && r.maker_code === g.maker_code && r.car_code === g.car_code ? { ...r, ...p } : r)); ed.value = null
  } catch (x: any) { err.value = x.message } finally { busy.value = false }
}

onMounted(async () => { await Promise.all([loadBrands('uss'), reload()]) })
</script>

<style scoped>
.tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 700; vertical-align: middle; white-space: nowrap; }
.tag.new { background: rgba(80, 160, 255, 0.18); color: #6db3ff; }
.tag.warn { background: rgba(255, 180, 60, 0.18); color: #ffb43c; }
.tag.off { background: rgba(255, 90, 90, 0.18); color: #ff7a7a; }
.tg { max-width: 1100px; }
.card { margin-bottom: 18px; }
.step { margin-top: 14px; min-width: 0; }
.lbl { font-weight: 600; font-size: 13.5px; margin-bottom: 6px; } .lbl small { color: var(--mu); font-weight: 400; margin-left: 6px; }
.sublbl { color: var(--mu); font-size: 12.5px; margin-bottom: 4px; }
.cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 16px; }
.note { color: var(--mu); font-size: 12.5px; margin: 8px 0 0; line-height: 1.4; } .note.warn { color: var(--warn); }
.muted { color: var(--mu); } .small { font-size: 12.5px; }
input[type='number'], .tg select, .sbox input { height: 40px; padding: 0 10px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; color: var(--tx); font-size: 16px; min-width: 0; }
input[type='number']:focus, .tg select:focus, .sbox input:focus { border-color: var(--ac); outline: none; }
.yrs { display: flex; align-items: center; gap: 10px; } .yrs input { width: 100%; max-width: 150px; }
.scs { display: flex; flex-wrap: wrap; gap: 6px; }
.sc { min-width: 42px; height: 36px; padding: 0 12px; display: inline-grid; place-items: center; border: 1px solid var(--line); border-radius: 10px; background: var(--s2); color: var(--tx); font-weight: 600; cursor: pointer; user-select: none; }
.sc.on { background: var(--ac); border-color: var(--ac); color: #fff; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
.seg button { background: transparent; border: 0; color: var(--tx); padding: 9px 18px; cursor: pointer; font-weight: 600; white-space: nowrap; } .seg button.on { background: var(--ac); color: #fff; }
.seg.wide { display: flex; } .seg.wide button { flex: 1; padding: 9px 6px; }
.types { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; }
.ty { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; cursor: pointer; background: var(--s2); }
.ty.on { border-color: var(--ac); background: var(--acbg); }
.ty input { width: 18px; height: 18px; accent-color: var(--ac); flex: none; margin: 0; }
.ty span { display: grid; line-height: 1.25; } .ty small { color: var(--mu); font-size: 12px; }
.go { margin-top: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.lh { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; }
.sbox { position: relative; display: inline-flex; } .sbox input { padding-right: 32px; width: 230px; }
.x { position: absolute; right: 6px; top: 7px; width: 26px; height: 26px; border: 0; border-radius: 50%; background: var(--line); color: var(--tx); font-size: 17px; line-height: 1; cursor: pointer; padding: 0; }
.scroll { overflow-x: auto; margin-top: 10px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
.tbl th { text-align: left; color: var(--mu); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.tbl td { padding: 9px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.src { color: var(--mu); font-size: 12.5px; font-weight: 600; } .nw { white-space: nowrap; }
.nar { max-width: 240px; overflow-wrap: anywhere; font-size: 13px; } .nar .k { color: var(--mu); font-size: 11.5px; text-transform: uppercase; letter-spacing: .3px; margin-right: 4px; white-space: nowrap; }
.runs { white-space: nowrap; }
.run { display: inline-grid; gap: 1px; text-align: left; min-width: 82px; padding: 5px 10px; margin: 0 6px 0 0; border: 1px solid var(--line); border-radius: 10px; background: var(--s2); color: var(--mu); cursor: pointer; line-height: 1.2; }
.run .rn { font-weight: 600; font-size: 12.5px; } .run .rd { font-size: 11.5px; }
.run.on { background: var(--okbg); border-color: transparent; color: var(--ok); }
.run.none { border-style: dashed; background: transparent; }
.run:disabled { opacity: .6; cursor: default; }

.modal { position: fixed; inset: 0; background: rgba(0, 0, 0, .6); display: grid; place-items: center; z-index: 70; padding: 16px; }
.box { width: min(560px, 100%); max-height: 92vh; overflow-y: auto; margin: 0; }
.foot { margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px; }

@media (max-width: 760px) {
  .cols { grid-template-columns: minmax(0, 1fr); }
  .sbox input, .sbox { width: 100%; } .filters { width: 100%; } .filters select { flex: 1; } .sbox { flex: 1 1 100%; }
  .go .btn { width: 100%; }
  .scroll { overflow: visible; }
  .tbl thead { display: none; }
  .tbl, .tbl tbody, .tbl tr { display: block; width: 100%; }
  .tbl tr { border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; margin: 0 0 10px; background: var(--s1); }
  .tbl td { display: flex; justify-content: space-between; align-items: center; gap: 14px; border: 0; padding: 5px 0; text-align: right; }
  .tbl td[data-label]::before { content: attr(data-label); color: var(--mu); font-size: 12.5px; flex: none; text-align: left; }
  .tbl td.nar { max-width: none; text-align: right; }
  .tbl td.ttl { justify-content: flex-start; font-size: 16px; text-align: left; border-bottom: 1px solid var(--line); padding-bottom: 8px; margin-bottom: 4px; }
  .tbl td.runs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 8px 0; white-space: normal; }
  .tbl td.runs::before { grid-column: 1 / -1; }
  .run { margin: 0; min-width: 0; } .tbl td.acts { justify-content: flex-end; padding-top: 10px; }
  .modal { place-items: end center; padding: 0; } .box { border-radius: 18px 18px 0 0; width: 100%; max-height: 94vh; padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
}
</style>

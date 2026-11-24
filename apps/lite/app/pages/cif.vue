<template>
  <div>
    <div class="row wrap between noprint" style="margin-bottom: 14px">
      <div><h1>CIF rates</h1><p class="sub" style="margin: 0">What we charge to bring in a bidding car, by the price of the car.</p></div>
      <div class="row" style="gap: 8px">
        <button class="btn ghost" @click="printPage">Print / save as PDF</button>
        <button v-if="isStaff && !editing" class="btn" @click="startEdit">Edit rates</button>
      </div>
    </div>

    <div v-if="err" class="err noprint" style="margin-bottom: 10px">{{ err }}</div>
    <div v-if="msg" class="okmsg noprint" style="margin-bottom: 10px">{{ msg }}</div>
    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="missing" class="card muted">The CIF table is not set up yet. Run <b>supabase/migrations/51_cif_rates.sql</b> in the Supabase SQL editor.</div>

    <!-- the poster: what a dealer sees and prints -->
    <section v-else-if="!editing" class="poster">
      <img class="hd" src="/cif/head.jpg" alt="CIF rate table, Japan vehicle import" />

      <div class="tbw">
        <table class="cif">
          <thead><tr><th>CAR PRICE (JPY)</th><th>CIF (BIDDING)</th><th>CIF (ONE PRICE)</th></tr></thead>
          <tbody>
            <tr v-for="r in shown" :key="r.id" :class="{ pct: r.mode === 'percent' }">
              <td>{{ labelJpy(r) }}</td>
              <td class="cifc">{{ r.mode === 'percent' ? `${num(r.value)}% of Car Cost` : yen(r.value) }}</td>
              <td class="cifc">{{ r.mode === 'percent' ? `${num(r.value)}% of Car Cost + ${yen(onePriceExtra)}` : yen(Number(r.value) + onePriceExtra) }}</td>
            </tr>
            <tr v-if="!shown.length"><td colspan="3" class="muted">No rate is set yet.</td></tr>
          </tbody>
        </table>
      </div>

      <div class="fw">
        <div class="fbg" />
        <div class="nw">
          <div class="nh"><span class="nic"><svg viewBox="0 0 24 24" fill="none" stroke="#14284b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9zM9 12h6M9 16h6" /></svg></span><span class="nt">Notes:</span></div>
          <ul class="nb">
            <li v-for="(n, i) in noteLines" :key="i">{{ n }}</li>
            <li v-if="onePriceExtra > 0">CIF (One Price) is the bidding CIF plus {{ yen(onePriceExtra) }}.</li>
            <li v-for="r in shown.filter((x) => x.mode === 'percent')" :key="'p' + r.id">{{ r.to_jpy == null ? `For car prices of ${yen(r.from_jpy)} and above` : `For car prices from ${yen(r.from_jpy)} to below ${yen(r.to_jpy)}` }}, CIF is calculated at {{ num(r.value) }}% of the car cost.</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- staff: change the rows and the rules -->
    <section v-else class="card">
      <h2>Edit the CIF rates</h2>
      <p class="muted small" style="margin: 4px 0 12px">Each row is a price band: from (included) up to (not included; leave "up to" empty for "and above"). Choose a fixed yen amount or a % of the car price. Untick <b>Show</b> to hide a band we do not offer: a car in a hidden band has no CIF rate. The % row above ¥14,000,000 is off until you tick Show.</p>
      <div class="scroll">
        <table class="ed">
          <thead><tr><th>From (¥)</th><th>Up to (¥)</th><th>CIF is</th><th>Amount</th><th>Show</th><th /></tr></thead>
          <tbody>
            <tr v-for="(r, i) in draft" :key="r.key">
              <td><NumInput v-model="r.from_jpy" /></td>
              <td><NumInput v-model="r.to_jpy" placeholder="and above" /></td>
              <td><select v-model="r.mode"><option value="fixed">a fixed amount (¥)</option><option value="percent">a % of the car price</option></select></td>
              <td><span class="amt"><NumInput v-model="r.value" decimal />{{ r.mode === 'percent' ? ' %' : ' ¥' }}</span></td>
              <td class="c"><input v-model="r.active" type="checkbox" /></td>
              <td class="r"><button class="btn ghost sm" title="Remove this row" @click="draft.splice(i, 1)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="row" style="justify-content: flex-start; margin: 10px 0"><button class="btn ghost sm" @click="addRow">+ Add a band</button></div>
      <div v-if="warnings.length" class="warnbox" style="margin-bottom: 10px"><div v-for="w in warnings" :key="w">{{ w }}</div></div>

      <label class="f">One Price: extra charge added to the bidding CIF (¥)<NumInput v-model="draftExtra" /></label>
      <label class="f">Notes (one line each)<textarea v-model="draftNotes" rows="4" /></label>
      <p class="muted small">A line for each shown % band is added to the notes by itself.</p>
      <div class="row" style="justify-content: flex-start; gap: 8px; margin-top: 12px">
        <button class="btn" :disabled="busy" @click="save">Save</button>
        <button class="btn ghost" :disabled="busy" @click="editing = false">Cancel</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const { isStaff, isCustomer } = useAuth()
if (isCustomer.value) await navigateTo('/')

interface Band { id?: string; key: string; from_jpy: number | null; to_jpy: number | null; mode: 'fixed' | 'percent'; value: number | null; active: boolean }
const rows = ref<any[]>([]), settings = reactive<{ notes: string; one_price_extra_jpy: number }>({ notes: '', one_price_extra_jpy: 50000 })
const loading = ref(true), missing = ref(false), busy = ref(false), editing = ref(false), err = ref(''), msg = ref('')
const draft = ref<Band[]>([]), draftNotes = ref(''), draftExtra = ref<number | null>(50000)
let seq = 0

const shown = computed(() => rows.value.filter((r) => r.active).sort((a, b) => a.from_jpy - b.from_jpy))
const noteLines = computed(() => settings.notes.split('\n').map((s) => s.trim()).filter(Boolean))
const onePriceExtra = computed(() => Number(settings.one_price_extra_jpy) || 0)
const num = (n: number | string) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
const yen = (n: number | string) => '¥' + Math.round(Number(n)).toLocaleString('en-US')
const labelJpy = (r: any) => (r.to_jpy == null ? `${yen(r.from_jpy)} and above` : Number(r.from_jpy) === 0 ? `Below ${yen(r.to_jpy)}` : `${yen(r.from_jpy)} – below ${yen(r.to_jpy)}`)

const warnings = computed(() => {
  const w: string[] = [], on = draft.value.filter((r) => r.active && r.from_jpy != null).sort((a, b) => a.from_jpy! - b.from_jpy!)
  on.forEach((r, i) => {
    const nx = on[i + 1]
    if (nx && (r.to_jpy == null || r.to_jpy > nx.from_jpy!)) w.push(`${yen(r.from_jpy!)} overlaps the band that starts at ${yen(nx.from_jpy!)}.`)
    else if (nx && r.to_jpy != null && r.to_jpy < nx.from_jpy!) w.push(`Gap: cars from ${yen(r.to_jpy)} to below ${yen(nx.from_jpy!)} have no rate.`)
  })
  if (on.length && on[0]!.from_jpy! > 0) w.push(`Cars below ${yen(on[0]!.from_jpy!)} have no rate.`)
  return w
})

async function load() {
  loading.value = true
  const [a, b] = await Promise.all([db.from('cif_rates').select('*').order('from_jpy'), db.from('cif_settings').select('*').maybeSingle()])
  if (a.error) { missing.value = /relation|cif_rates|schema cache/i.test(a.error.message); if (!missing.value) err.value = a.error.message; loading.value = false; return }
  rows.value = a.data || []
  if (b.data) Object.assign(settings, b.data)
  loading.value = false
}
function startEdit() {
  draft.value = rows.value.map((r) => ({ id: r.id, key: r.id, from_jpy: Number(r.from_jpy), to_jpy: r.to_jpy == null ? null : Number(r.to_jpy), mode: r.mode, value: Number(r.value), active: r.active }))
  draftNotes.value = settings.notes; draftExtra.value = onePriceExtra.value
  err.value = ''; msg.value = ''; editing.value = true
}
function addRow() { const last = draft.value[draft.value.length - 1]; draft.value.push({ key: 'n' + ++seq, from_jpy: last?.to_jpy ?? null, to_jpy: null, mode: 'fixed', value: null, active: true }) }

async function save() {
  err.value = ''; msg.value = ''
  for (const r of draft.value) {
    if (r.from_jpy == null) { err.value = 'Every band needs a "From" price.'; return }
    if (!r.value || r.value <= 0) { err.value = `The band from ${yen(r.from_jpy)} needs an amount.`; return }
    if (r.to_jpy != null && r.to_jpy <= r.from_jpy) { err.value = `"Up to" must be above "From" (band from ${yen(r.from_jpy)}).`; return }
  }
  busy.value = true
  try {
    const keep = new Set(draft.value.filter((r) => r.id).map((r) => r.id))
    const gone = rows.value.filter((r) => !keep.has(r.id)).map((r) => r.id)
    if (gone.length) { const { error } = await db.from('cif_rates').delete().in('id', gone); if (error) throw error }
    const now = new Date().toISOString()
    const body = (r: Band) => ({ from_jpy: r.from_jpy, to_jpy: r.to_jpy, mode: r.mode, value: r.value, active: r.active, updated_at: now })
    for (const r of draft.value.filter((x) => x.id)) { const { error } = await db.from('cif_rates').update(body(r)).eq('id', r.id!); if (error) throw error }
    const fresh = draft.value.filter((x) => !x.id).map(body)
    if (fresh.length) { const { error } = await db.from('cif_rates').insert(fresh); if (error) throw error }
    const { error: se } = await db.from('cif_settings').upsert({ id: true, notes: draftNotes.value, one_price_extra_jpy: draftExtra.value ?? 0, updated_at: now })
    if (se) throw se
    editing.value = false; msg.value = 'Saved.'
    await load()
  } catch (e: any) { err.value = /one_price_extra_jpy/.test(e.message) ? 'Run supabase/migrations/52_cif_one_price.sql first (it adds the One Price charge).' : e.message } finally { busy.value = false }
}
function printPage() { window.print() }
onMounted(() => { document.body.classList.add('cif-print'); load() })
onBeforeUnmount(() => document.body.classList.remove('cif-print'))
</script>

<style scoped>
.between { justify-content: space-between; }
.poster { container-type: inline-size; max-width: 920px; margin: 0 auto !important; overflow: hidden; border-radius: 14px; border: 1px solid #c9d8ea;
  background: linear-gradient(180deg, #cfe3f6 0%, #e2eefa 30%, #eaf3fc 65%, #e3eef9 100%); }
/* the header and footer pictures fade softly into the page colour instead of ending on a line */
.hd { display: block; width: 100%; -webkit-mask-image: linear-gradient(180deg, #000 93%, transparent); mask-image: linear-gradient(180deg, #000 93%, transparent); }
.tbw { margin: .6cqw 2.2cqw 0; border-radius: 2.2cqw; overflow: hidden; border: .25cqw solid #fff; box-shadow: 0 1cqw 2.4cqw #14284b33, 0 0 0 .2cqw #cdd9ea; background: #fff; position: relative; }
.cif { width: 100%; border-collapse: collapse; table-layout: auto; }
.cif th { background: linear-gradient(180deg, #1b3a74, #0d2656); color: #fff; padding: 1.3cqw 1cqw; font-size: 2.45cqw; font-weight: 800; letter-spacing: .1cqw; border-right: .2cqw solid #ffffff55; } .cif th:last-child { border-right: 0; }
.cif td { padding: 1.15cqw .8cqw; text-align: center; font-size: 2.15cqw; white-space: nowrap; font-weight: 700; color: #111c33; border-bottom: .2cqw solid #cfd8e6; border-right: .2cqw solid #d9e1ec; background: linear-gradient(180deg, #fff, #f1f4f9); font-variant-numeric: tabular-nums; } .cif td:last-child { border-right: 0; }
.cif td.cifc { color: #d3141b; font-weight: 900; font-size: 2.5cqw; background: linear-gradient(180deg, #ffeceb, #fdd3d1); }
.cif tbody tr:last-child td { border-bottom: 0; }
.cif tr.pct td, .cif tr.pct td.cifc { background: linear-gradient(180deg, #e0242a, #b50d14); color: #fff; font-weight: 900; text-shadow: 0 .15cqw .3cqw #0004; }

/* footer: the original picture, with the Notes sitting where the exchange-rate box was (it covers it) */
.fw { position: relative; display: flow-root; margin-top: 1.4cqw; min-height: 23.9cqw; }
.fbg { position: absolute; left: 0; right: 0; bottom: 0; aspect-ratio: 1170 / 280; background: url('/cif/foot.jpg') center / 100% 100% no-repeat; -webkit-mask-image: linear-gradient(180deg, transparent, #000 16%); mask-image: linear-gradient(180deg, transparent, #000 16%); }
.nw { position: relative; width: 52.6%; margin: 0 0 12.2cqw 1.7%; }
.nh { display: flex; align-items: center; position: relative; z-index: 1; margin-left: .4cqw; }
.nic { width: 4.4cqw; height: 4.4cqw; border-radius: 1cqw; background: #fff; border: .22cqw solid #1b3a74; display: grid; place-items: center; margin-right: -.9cqw; position: relative; z-index: 2; box-shadow: 0 .3cqw .7cqw #0a1c4533; } .nic svg { width: 2.9cqw; height: 2.9cqw; }
.nt { display: inline-block; transform: skewX(-14deg); background: linear-gradient(180deg, #1b3a74, #0d2656); color: #fff; font-style: italic; font-weight: 900; font-size: 2.8cqw; padding: .55cqw 6cqw .55cqw 2.6cqw; border-bottom: .25cqw solid #d6a840; }
.nb { list-style: none; margin: -1cqw 0 0; padding: 2.3cqw 2.2cqw 1.8cqw; background: #f9fbfe; border: .22cqw solid #c9d8ea; border-radius: 1.6cqw; box-shadow: 0 .6cqw 1.6cqw #14284b22; display: grid; gap: .7cqw; }
.nb li { position: relative; padding-left: 2.6cqw; font-size: 1.8cqw; line-height: 1.38; color: #1a2540; font-weight: 500; }
.nb li::before { content: ''; position: absolute; left: .3cqw; top: .65cqw; width: 1cqw; height: 1cqw; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #f1cf73, #a87818); }
@container (max-width: 640px) {
  .cif th { font-size: 3.1cqw; } .cif td { font-size: 2.9cqw; white-space: normal; padding: 2cqw .8cqw; } .cif td.cifc { font-size: 3.2cqw; }
  .fw { min-height: 0; display: flex; flex-direction: column-reverse; }
  .fbg { position: relative; aspect-ratio: 540 / 280; background-image: url('/cif/foot-ship.jpg'); background-size: 100% 100%; margin-top: -6cqw; }
  .nw { width: auto; margin: 0 2.2cqw; position: relative; z-index: 1; } .nic { width: 7cqw; height: 7cqw; } .nic svg { width: 4.6cqw; } .nt { font-size: 4.4cqw; padding: 1cqw 8cqw 1cqw 3.4cqw; }
  .nb { padding: 4cqw 3.4cqw 3.4cqw; gap: 1.8cqw; } .nb li { font-size: 3.1cqw; padding-left: 4cqw; } .nb li::before { width: 1.7cqw; height: 1.7cqw; top: 1.1cqw; }
}
.scroll { overflow-x: auto; } .ed { width: 100%; border-collapse: collapse; min-width: 640px; } .ed th { text-align: left; font-size: 12.5px; color: var(--mu); padding: 6px 6px; } .ed td { padding: 5px 6px; border-top: 1px solid var(--line); }
.ed input:not([type='checkbox']), .ed select { width: 100%; } .amt { display: flex; align-items: center; gap: 4px; white-space: nowrap; } .c { text-align: center; } .r { text-align: right; }
@media print { .poster, .poster * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .poster { border: 0; border-radius: 0; max-width: none; } .noprint { display: none !important; } }
</style>

<style>
/* printing: no page margin, so the browser has no room for its own header and footer (date, page title, address, page number) */
@page cif { size: A4 portrait; margin: 0; }
@media print {
  html, body { margin: 0 !important; width: 100% !important; background: #fff !important; }
  /* the page must not be taller than the poster, and nothing outside the app (the dev tools button in development) may print: either one gives a blank second page */
  body.cif-print #__nuxt { height: auto !important; }
  body.cif-print > :not(#__nuxt) { display: none !important; }
  html:has(body.cif-print) > :not(head):not(body) { display: none !important; }      /* things a browser extension adds next to the page */
  html:has(body.cif-print), body.cif-print { height: 296mm !important; max-height: 296mm !important; overflow: hidden !important; }   /* one A4 sheet: anything that would spill is cut, never a second page */
  .page { margin: 0 !important; padding: 0 !important; }
  body.cif-print { page: cif; }          /* the named page goes on the whole document, not on the poster: a poster-only page name forces a page break after it */
  .poster { margin: 0 !important; width: 100% !important; max-width: none !important; border: 0 !important; border-radius: 0 !important; }
}
</style>

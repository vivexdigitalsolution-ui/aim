<template>
  <div>
  <div class="card">
    <h2>Marketing poster</h2>
    <p class="muted small" style="margin: 4px 0 10px">A promo picture for this car. What you key in is kept for this car.</p>
    <div class="row wrap" style="gap: 10px; justify-content: flex-start; align-items: center">
      <button class="btn" :disabled="!cost" :title="cost ? '' : 'Needs the estimated import price first'" @click="openDialog">Generate poster</button>
      <span v-if="!cost" class="muted small">Available once the estimated import price is worked out (choose the docket and the month first).</span>
      <span v-else-if="saved" class="muted small">Saved<template v-if="saved.posting_price_myr"> · posting {{ rm(saved.posting_price_myr) }}</template><template v-if="saved.phone"> · {{ saved.phone }}</template></span>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="open" class="pd-overlay" @click.self="open = false">
      <div class="pd-box" role="dialog" aria-label="Car poster">
        <div class="pd-head">
          <h2 class="pd-title">Poster</h2>
          <button class="pd-x" title="Close" @click="open = false">&times;</button>
        </div>

        <div class="pd-body">
          <div class="pd-preview">
            <div v-if="busy" class="pd-state">Drawing the poster…</div>
            <div v-else-if="error" class="pd-state pd-err">{{ error }}</div>
            <img v-else-if="previewUrl" :src="previewUrl" alt="Poster preview" />
          </div>
          <div class="pd-side">
            <div class="pd-kinds" role="group" aria-label="Poster type">
              <button type="button" :class="['pd-kind', { on: kind === 'b2c' }]" @click="kind = 'b2c'">A Slide · Customer</button>
              <button type="button" :class="['pd-kind', { on: kind === 'b2b' }]" @click="kind = 'b2b'">B Slide · Broker</button>
            </div>
            <div class="pd-note"><b>Title:</b> {{ pc.title }}</div>
            <div class="pd-cost"><span class="muted small">Estimate cost <small>({{ onePrice ? 'the import price at the One price' : 'the import price at the suggested bid' }})</small></span><b>{{ cost ? rm(cost) : '–' }}</b></div>
            <div class="pd-margin">
              <span class="muted small">Posting price on the cost</span>
              <button type="button" :class="['pd-pct', { on: isPct(3) }]" @click="applyPct(3)">+3%</button>
              <button type="button" :class="['pd-pct', { on: isPct(6) }]" @click="applyPct(6)">+6%</button>
              <span class="pd-pctbox"><NumInput v-model="pctIn" decimal class="pd-input pd-pctin" aria-label="Margin percent on the cost" /><span class="pd-sy">%</span></span>
              <span v-if="marginText" class="muted small">{{ marginText }}</span>
            </div>
            <div class="pd-two">
              <label v-if="kind === 'b2c'" class="pd-field"><span>Market price <small>(struck through when it is higher)</small></span>
                <NumInput v-model="market" class="pd-input" placeholder="RM" /></label>
              <label class="pd-field"><span>{{ kind === 'b2b' ? 'Selling price' : 'Posting price' }} <small>(the price on the poster)</small></span>
                <NumInput v-model="posting" class="pd-input" placeholder="RM" /></label>
            </div>
            <div class="pd-two">
              <label class="pd-field"><span>Colour <small>(change it if the sheet's colour is in Japanese)</small></span>
                <input v-model="colour" type="text" class="pd-input" placeholder="e.g. PEARL WHITE" /></label>
              <label class="pd-field"><span>Chassis <small>(key it in)</small></span>
                <input v-model="chassis" type="text" class="pd-input" placeholder="e.g. TAHA45-0004589" /></label>
            </div>
            <label v-if="kind === 'b2c'" class="pd-field"><span>WhatsApp / phone number <small>(shown in the footer)</small></span>
              <input v-model="phone" type="text" class="pd-input" placeholder="e.g. +60 18-773 8872" /></label>
            <label class="pd-field"><span>Selling point note <small>(shown above the price; separate the points with a comma or a new line)</small></span>
              <textarea v-model="note" class="pd-input" rows="3" placeholder="e.g. Genuine Display Audio, Back Camera, Sunroof, Leather Seats…"></textarea></label>
            <label v-if="kind === 'b2c'" class="pd-check"><input v-model="footer" type="checkbox" /><span><b>Show the PublicGo footer</b><small>The PublicGo logo on the left, with the message, phone number, email and website beside it</small></span></label>
            <div class="pd-note"><b>Photos:</b> the car's photos in order: 1 big cover, then 2 to 6 ({{ pc.photos.length }} found).</div>
            <div class="pd-actions">
              <button class="pd-btn pd-primary" :disabled="saving" @click="save">{{ saving ? 'Saving …' : 'Save details' }}</button>
              <button class="pd-btn" :disabled="busy || !canvas" @click="downloadJpg">Download JPG</button>
              <button class="pd-btn" :disabled="busy || !canvas" @click="savePdf">Save as PDF</button>
              <button class="pd-btn" :disabled="busy || !canvas" @click="copyImage">{{ copiedImage ? 'Image copied' : 'Copy image' }}</button>
            </div>
            <div v-if="saveMsg" :class="saveOk ? 'pd-ok' : 'pd-bad'">{{ saveMsg }}</div>
          </div>
        </div>

      </div>
    </div>
  </Teleport>
  </div>
</template>

<script setup lang="ts">
// Marketing poster of one car (PAW-J Partner, staff only): a button, and a window with the poster preview, the fields, Save, and JPG / PDF / copy.
// What is keyed in is saved in lot_posters (migration 61), one row per car, removed together with the car (ON DELETE CASCADE).
import { renderPoster, posterToJpgBlob, posterPrintHtml, type PosterCar } from '../utils/lotPoster'
import { carTitle } from '../utils/carTitle'
const props = defineProps<{ car: any; onePrice?: boolean; est?: number | null }>()
const db = useDb()
const { user } = useAuth()

const open = ref(false)
const colour = ref(''), chassis = ref('')
const kind = ref<'b2c' | 'b2b'>('b2c'), market = ref<number | null>(null), posting = ref<number | null>(null), phone = ref(''), note = ref(''), footer = ref(true)
const saved = ref<any>(null), saving = ref(false), saveMsg = ref(''), saveOk = ref(false)
const PHONE_KEY = 'lite.poster.phone'
const cost = computed(() => (props.est && props.est > 0 ? Math.round(props.est) : null))      // the estimate cost: the import price at the suggested bid / at the One price
const pctIn = ref<number | null>(null)
let fromPct = false
function applyPct(p: number | null) {
  pctIn.value = p
  if (!cost.value || p == null) return
  fromPct = true; posting.value = Math.round(cost.value * (1 + p / 100)); nextTick(() => { fromPct = false })
}
watch(pctIn, (p) => { if (!fromPct && p != null) applyPct(p) })
watch(posting, () => { if (!fromPct) pctIn.value = null })      // a price typed by hand: the % box empties, the margin line below still tells the margin
const isPct = (p: number) => !!cost.value && !!posting.value && Math.abs((posting.value / cost.value - 1) * 100 - p) < 0.05
const marginText = computed(() => (cost.value && posting.value ? `Margin ${rm(posting.value - cost.value)} (${Math.round((posting.value / cost.value - 1) * 1000) / 10}%)` : ''))
const col = computed(() => (props.onePrice ? 'one_price_id' : 'lot_id'))
const rm = (n: number) => `RM ${Math.round(Number(n)).toLocaleString('en-MY')}`

const JP_COLOURS: [string, string][] = [['ツートン', 'Two-tone'], ['ガンメタ', 'Gunmetal'], ['メタリック', 'Metallic'], ['パール', 'Pearl'], ['ホワイト', 'White'], ['ブラック', 'Black'], ['シルバー', 'Silver'], ['グレー', 'Grey'], ['レッド', 'Red'], ['ブルー', 'Blue'], ['ネイビー', 'Navy'], ['グリーン', 'Green'], ['ブラウン', 'Brown'], ['ベージュ', 'Beige'], ['ゴールド', 'Gold'], ['オレンジ', 'Orange'], ['イエロー', 'Yellow'], ['パープル', 'Purple'], ['ピンク', 'Pink'], ['ワイン', 'Wine'], ['白', 'White'], ['黒', 'Black'], ['銀', 'Silver'], ['灰', 'Grey'], ['赤', 'Red'], ['青', 'Blue'], ['緑', 'Green'], ['茶', 'Brown'], ['金', 'Gold'], ['黄', 'Yellow'], ['紫', 'Purple']]
function colourGuess(raw: string | null | undefined): string {
  let t = String(raw || '').trim()
  if (!/[\u3040-\u30ff\u4e00-\u9fff]/.test(t)) return t
  for (const [jp, en] of JP_COLOURS) t = t.split(jp).join(en + ' ')
  return t.replace(/\s+/g, ' ').trim()
}
const pc = computed<PosterCar>(() => {
  const c = props.car || {}
  return {
    title: [carTitle(c), c.mfg_year].filter(Boolean).join(' '),
    photos: Array.isArray(c.photos) ? c.photos.filter(Boolean) : [],
    grade: c.grade ?? c.auction_grade ?? null, modelCode: c.model_code ?? null, mfgYear: c.mfg_year ?? null, mileageKm: c.mileage_km ?? null,
    engineCc: c.engine_cc ?? null, fuel: c.fuel ?? null, transmission: c.transmission ?? null, drive: c.drive ?? null, color: colour.value || null,
    chassis: chassis.value || null,
  }
})

function apply(row: any | null) {
  kind.value = row?.kind === 'b2b' ? 'b2b' : 'b2c'
  market.value = row?.market_price_myr != null ? Number(row.market_price_myr) : null
  posting.value = row?.posting_price_myr != null ? Number(row.posting_price_myr) : null
  note.value = row?.selling_note || ''
  colour.value = row?.colour ?? colourGuess(props.car?.color)      // nothing saved: the sheet's colour (English as far as it can be guessed), then the user's own wording
  chassis.value = row?.chassis ?? props.car?.chassis_no ?? ''      // the chassis number of the sheet when it is known, then whatever the user keys in
  footer.value = row ? row.show_footer !== false : true
  let remembered = ''
  try { remembered = localStorage.getItem(PHONE_KEY) || '' } catch { /* private mode */ }
  phone.value = row?.phone ?? (remembered || '+60 13-878 8872')      // a car with nothing saved starts with the last number used
  pctIn.value = null
  if (!row && cost.value) applyPct(3)      // nothing saved yet: the posting price starts at the cost + 3%
}
async function loadSaved() {
  const { data, error } = await db.from('lot_posters').select('*').eq(col.value, props.car.id).maybeSingle()
  if (!error) saved.value = data
  return data
}
async function openDialog() {
  saveMsg.value = ''
  apply(await loadSaved())
  open.value = true
}
onMounted(() => { loadSaved().catch(() => {}) })
// the number is remembered in this browser as soon as it is typed, so the next car starts with it (Save details keeps it for this car)
watch(phone, (v) => { try { if (v.trim()) localStorage.setItem(PHONE_KEY, v.trim()) } catch { /* private mode */ } })

async function save() {
  saving.value = true; saveMsg.value = ''
  try {
    const row = { [col.value]: props.car.id, kind: kind.value, market_price_myr: market.value || null, posting_price_myr: posting.value || null, phone: phone.value.trim() || null, selling_note: note.value.trim() || null, colour: colour.value.trim() || null, chassis: chassis.value.trim() || null, show_footer: footer.value, updated_by: user.value?.id, updated_at: new Date().toISOString() }
    const { error } = await db.from('lot_posters').upsert(row, { onConflict: col.value })
    if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? 'Run migration 62 in the Supabase SQL editor first (supabase/migrations/62_lot_posters_colour_chassis.sql).' : error.message)
    try { if (phone.value.trim()) localStorage.setItem(PHONE_KEY, phone.value.trim()) } catch { /* private mode */ }
    saved.value = row; saveOk.value = true; saveMsg.value = 'Saved. It stays with this car until the car is removed.'
  } catch (e: any) { saveOk.value = false; saveMsg.value = e.message } finally { saving.value = false }
}

// ── poster drawing (redrawn a moment after the last keystroke) ──
const busy = ref(false), error = ref(''), canvas = shallowRef<HTMLCanvasElement | null>(null), previewUrl = ref('')
let token = 0
async function draw() {
  if (!open.value) return
  const mine = ++token
  busy.value = true; error.value = ''
  try {
    const c = await renderPoster(pc.value, { kind: kind.value, footer: footer.value, note: note.value, marketPrice: market.value, postingPrice: posting.value, phone: phone.value })
    if (mine !== token) return
    canvas.value = c; previewUrl.value = c.toDataURL('image/jpeg', 0.8)
  } catch (e: any) { if (mine === token) error.value = e?.message || 'Could not draw the poster' } finally { if (mine === token) busy.value = false }
}
let timer: ReturnType<typeof setTimeout> | null = null
watch([open, kind, footer, note, market, posting, phone, colour, chassis], () => { if (timer) clearTimeout(timer); timer = setTimeout(draw, 350) })

const stem = () => ((chassis.value || props.car?.lot_no || '') + '_' + [props.car?.mfg_year, props.car?.brand].filter(Boolean).join('_')).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '') || 'poster'
async function downloadJpg() {
  if (!canvas.value) return
  const blob = await posterToJpgBlob(canvas.value)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = `poster_${kind.value === 'b2b' ? 'B-Slide' : 'A-Slide'}_${stem()}.jpg`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
function savePdf() {
  if (!canvas.value) return
  const w = window.open('', '_blank')
  if (!w) { error.value = 'Allow pop-ups to save the PDF, or use Download JPG.'; return }
  w.document.write(posterPrintHtml(canvas.value, `Poster_${stem()}`)); w.document.close()
  w.onload = () => w.print()
  setTimeout(() => { try { w.print() } catch { /* already printing */ } }, 600)
}

const copiedImage = ref(false)
async function copyImage() {
  if (!canvas.value) return
  try {
    const blob: Blob = await new Promise((resolve, reject) => canvas.value!.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    copiedImage.value = true; setTimeout(() => (copiedImage.value = false), 2000)
  } catch { /* the browser may not allow copying pictures: use Download JPG instead */ }
}
</script>

<style scoped>
.pd-overlay { position: fixed; inset: 0; z-index: 10050; background: rgba(0, 0, 0, .55); display: flex; align-items: center; justify-content: center; padding: 16px; }
.pd-box { background: var(--card, #fff); color: var(--tx, #111); border-radius: 12px; width: min(1040px, 100%); max-height: 94vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0, 0, 0, .4); }
.pd-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 0; border-bottom: 1px solid var(--line, #ddd); }
.pd-title { margin: 0; padding: 10px 6px; font-size: 15px; }
.pd-x { border: none; background: transparent; font-size: 24px; line-height: 1; cursor: pointer; color: inherit; }
.pd-body { display: flex; gap: 18px; padding: 16px; min-height: 0; overflow: auto; }
.pd-preview { flex: 0 0 auto; width: 360px; max-width: 45%; background: #0b131c; border-radius: 8px; display: flex; align-items: center; justify-content: center; min-height: 300px; overflow: hidden; align-self: flex-start; }
.pd-preview img { width: 100%; display: block; }
.pd-state { color: #9aa7b4; font-size: 13px; padding: 20px; text-align: center; } .pd-err { color: #ff8a8a; }
.pd-side { flex: 1; display: flex; flex-direction: column; gap: 12px; min-width: 220px; }
.pd-cost { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; background: var(--s2, #f3f5f8); border: 1px solid var(--line, #ddd); border-radius: 8px; padding: 8px 12px; } .pd-cost b { font-size: 17px; }
.pd-margin { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pd-pct { padding: 6px 14px; border: 1px solid var(--line, #ccc); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; } .pd-pct.on { background: var(--ac, #2268b8); border-color: var(--ac, #2268b8); color: #fff; }
.pd-pctbox { position: relative; display: inline-block; width: 84px; } .pd-pctbox .pd-pctin { padding: 8px 26px 8px 10px; text-align: right; } .pd-sy { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: var(--mu, #666); font-size: 13px; pointer-events: none; }
.pd-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pd-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
.pd-field small { font-weight: 400; color: var(--mu, #666); font-size: 11.5px; }
.pd-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--line, #ccc); border-radius: 8px; background: var(--s2, #fff); color: var(--tx, #111); font: inherit; font-size: 13px; font-weight: 400; resize: vertical; }
.pd-input:focus { outline: none; border-color: var(--ac, #2268b8); }
.pd-link { align-self: flex-start; border: none; background: transparent; color: var(--ac, #2268b8); font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; padding: 0; }
.pd-kinds { display: flex; flex-wrap: wrap; gap: 8px; }
.pd-kind { flex: 1 1 150px; padding: 9px 12px; border: 1px solid var(--line, #ccc); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; }
.pd-kind.on { background: var(--ac, #2268b8); border-color: var(--ac, #2268b8); color: #fff; }
.pd-check { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; font-size: 13.5px; } .pd-check input { margin-top: 3px; }
.pd-check small { display: block; color: var(--mu, #666); font-size: 12px; margin-top: 2px; }
.pd-note, .pd-hint { font-size: 12.5px; color: var(--mu, #555); line-height: 1.6; }
.pd-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
.pd-btn { padding: 8px 14px; border: 1px solid var(--line, #ccc); border-radius: 8px; background: transparent; color: inherit; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
.pd-btn:disabled { opacity: .5; cursor: default; }
.pd-primary { background: var(--ac, #2268b8); border-color: var(--ac, #2268b8); color: #fff; }
.pd-ok { color: #1f9d55; font-size: 13px; } .pd-bad { color: #d33; font-size: 13px; }
@media (max-width: 720px) { .pd-body { flex-direction: column; } .pd-preview { width: 100%; max-width: 100%; } .pd-two { grid-template-columns: 1fr; } }
</style>

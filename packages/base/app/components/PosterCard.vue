<template>
  <div>
  <div class="card">
    <h2>Marketing poster</h2>
    <p class="muted small" style="margin: 4px 0 10px">A promo picture and a WhatsApp message for this car. What you key in is kept for this car.</p>
    <div class="row wrap" style="gap: 10px; justify-content: flex-start; align-items: center">
      <button class="btn" @click="openDialog">Generate poster</button>
      <span v-if="saved" class="muted small">Saved<template v-if="saved.posting_price_myr"> · posting {{ rm(saved.posting_price_myr) }}</template><template v-if="saved.phone"> · {{ saved.phone }}</template></span>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="open" class="pd-overlay" @click.self="open = false">
      <div class="pd-box" role="dialog" aria-label="Car poster">
        <div class="pd-head">
          <div class="pd-tabs">
            <button :class="['pd-tab', { on: tab === 'poster' }]" @click="tab = 'poster'">Poster</button>
            <button :class="['pd-tab', { on: tab === 'message' }]" @click="tab = 'message'">WhatsApp message</button>
          </div>
          <button class="pd-x" title="Close" @click="open = false">&times;</button>
        </div>

        <div v-show="tab === 'poster'" class="pd-body">
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
            <div class="pd-two">
              <label v-if="kind === 'b2c'" class="pd-field"><span>Market price <small>(struck through when it is higher)</small></span>
                <NumInput v-model="market" class="pd-input" placeholder="RM" /></label>
              <label class="pd-field"><span>{{ kind === 'b2b' ? 'Selling price' : 'Posting price' }} <small>(the price on the poster)</small></span>
                <NumInput v-model="posting" class="pd-input" placeholder="RM" /></label>
            </div>
            <button v-if="est && !posting" class="pd-link" type="button" @click="posting = Math.round(est)">Use the estimated import price {{ rm(est) }}</button>
            <label v-if="kind === 'b2c'" class="pd-field"><span>WhatsApp / phone number <small>(shown in the footer)</small></span>
              <input v-model="phone" type="text" class="pd-input" placeholder="e.g. +60 18-773 8872" /></label>
            <label class="pd-field"><span>Selling point note <small>(shown above the price; separate the points with a comma or a new line)</small></span>
              <textarea v-model="note" class="pd-input" rows="3" placeholder="e.g. Genuine Display Audio, Back Camera, Sunroof, Leather Seats…"></textarea></label>
            <label v-if="kind === 'b2c'" class="pd-check"><input v-model="footer" type="checkbox" /><span><b>Show the PAW-J footer</b><small>The PAW-J name with the message, phone number and website</small></span></label>
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

        <div v-show="tab === 'message'" class="pd-body">
          <div class="pd-msgcol">
            <label class="pd-field"><span>Template <small>(edit freely; it is remembered in this browser)</small></span>
              <textarea v-model="template" class="pd-input pd-mono" rows="14" spellcheck="false"></textarea></label>
            <div class="pd-hint">Type a word in double braces to fill in the car's data:
              <code v-for="p in chips" :key="p.name" class="pd-chip" title="Add to the template" @click="insertVar(p.name)">{{ p.tag }}</code>
              <br /><b>*text*</b> makes it bold in WhatsApp. A line with no data is left out, and <b v-text="specTag"></b> becomes the list of ✅ selling points.</div>
            <div class="pd-actions"><button class="pd-btn" @click="template = DEFAULT_TEMPLATE">Reset to default template</button></div>
          </div>
          <div class="pd-msgcol">
            <div class="pd-field"><span>Message for this car</span></div>
            <pre class="pd-msg">{{ message }}</pre>
            <div class="pd-actions">
              <button class="pd-btn pd-primary" @click="copyMessage">{{ copiedMsg ? 'Message copied' : 'Copy message' }}</button>
              <button class="pd-btn" @click="openWhatsApp">Open WhatsApp</button>
              <button class="pd-btn" :disabled="busy || !canvas" @click="copyImage">{{ copiedImage ? 'Image copied' : 'Copy image' }}</button>
            </div>
            <div class="pd-hint">In WhatsApp choose the chat, paste the picture (Ctrl+V) and the message. “Open WhatsApp” opens WhatsApp Web with the message already typed.</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
  </div>
</template>

<script setup lang="ts">
// Marketing poster of one car (PAW-J Partner, staff only): a button, and a window with the poster preview, the fields, Save, JPG / PDF / copy, and the WhatsApp message.
// What is keyed in is saved in lot_posters (migration 61), one row per car, removed together with the car (ON DELETE CASCADE).
import { renderPoster, posterToJpgBlob, posterPrintHtml, type PosterCar } from '../utils/lotPoster'
import { DEFAULT_TEMPLATE, PLACEHOLDERS, loadTemplate, saveTemplate, messageVars, buildMessage } from '../utils/posterMessage'
import { carTitle } from '../utils/carTitle'
const props = defineProps<{ car: any; onePrice?: boolean; est?: number | null }>()
const db = useDb()
const { user } = useAuth()

const open = ref(false), tab = ref<'poster' | 'message'>('poster')
const kind = ref<'b2c' | 'b2b'>('b2c'), market = ref<number | null>(null), posting = ref<number | null>(null), phone = ref(''), note = ref(''), footer = ref(true)
const saved = ref<any>(null), saving = ref(false), saveMsg = ref(''), saveOk = ref(false)
const template = ref(DEFAULT_TEMPLATE)
const PHONE_KEY = 'lite.poster.phone'
const col = computed(() => (props.onePrice ? 'one_price_id' : 'lot_id'))
const rm = (n: number) => `RM ${Math.round(Number(n)).toLocaleString('en-MY')}`

const pc = computed<PosterCar>(() => {
  const c = props.car || {}
  return {
    title: [carTitle(c), c.mfg_year].filter(Boolean).join(' '),
    photos: Array.isArray(c.photos) ? c.photos.filter(Boolean) : [],
    grade: c.grade ?? c.auction_grade ?? null, modelCode: c.model_code ?? null, mfgYear: c.mfg_year ?? null, mileageKm: c.mileage_km ?? null,
    engineCc: c.engine_cc ?? null, fuel: c.fuel ?? null, transmission: c.transmission ?? null, drive: c.drive ?? null, color: c.color ?? null,
    lotRef: c.lot_no ? 'LOT ' + c.lot_no : null,
  }
})

function apply(row: any | null) {
  kind.value = row?.kind === 'b2b' ? 'b2b' : 'b2c'
  market.value = row?.market_price_myr != null ? Number(row.market_price_myr) : null
  posting.value = row?.posting_price_myr != null ? Number(row.posting_price_myr) : null
  note.value = row?.selling_note || ''
  footer.value = row ? row.show_footer !== false : true
  let remembered = ''
  try { remembered = localStorage.getItem(PHONE_KEY) || '' } catch { /* private mode */ }
  phone.value = row?.phone ?? remembered      // a car with nothing saved starts with the last number used
}
async function loadSaved() {
  const { data, error } = await db.from('lot_posters').select('*').eq(col.value, props.car.id).maybeSingle()
  if (!error) saved.value = data
  return data
}
async function openDialog() {
  saveMsg.value = ''; tab.value = 'poster'
  apply(await loadSaved())
  open.value = true
}
onMounted(() => { template.value = loadTemplate(); loadSaved().catch(() => {}) })
watch(template, (t) => saveTemplate(t))

async function save() {
  saving.value = true; saveMsg.value = ''
  try {
    const row = { [col.value]: props.car.id, kind: kind.value, market_price_myr: market.value || null, posting_price_myr: posting.value || null, phone: phone.value.trim() || null, selling_note: note.value.trim() || null, show_footer: footer.value, updated_by: user.value?.id, updated_at: new Date().toISOString() }
    const { error } = await db.from('lot_posters').upsert(row, { onConflict: col.value })
    if (error) throw new Error(/does not exist|schema cache/i.test(error.message) ? 'Run migration 61 in the Supabase SQL editor first (supabase/migrations/61_lot_posters.sql).' : error.message)
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
watch([open, kind, footer, note, market, posting, phone], () => { if (timer) clearTimeout(timer); timer = setTimeout(draw, 350) })

const stem = () => ((props.car?.lot_no || '') + '_' + [props.car?.mfg_year, props.car?.brand].filter(Boolean).join('_')).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '') || 'poster'
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

// ── WhatsApp message ──
const message = computed(() => buildMessage(template.value, messageVars(pc.value, { note: note.value, marketPrice: market.value, postingPrice: posting.value, phone: phone.value, kind: kind.value })))
const copiedMsg = ref(false), copiedImage = ref(false)
async function copyMessage() { try { await navigator.clipboard.writeText(message.value); copiedMsg.value = true; setTimeout(() => (copiedMsg.value = false), 2000) } catch { /* clipboard blocked */ } }
function openWhatsApp() { window.open(`https://web.whatsapp.com/send?text=${encodeURIComponent(message.value)}`, '_blank', 'noopener') }
async function copyImage() {
  if (!canvas.value) return
  try {
    const blob: Blob = await new Promise((resolve, reject) => canvas.value!.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    copiedImage.value = true; setTimeout(() => (copiedImage.value = false), 2000)
  } catch { /* the browser may not allow copying pictures: use Download JPG instead */ }
}
const specTag = '{{spec}}'
const chips = PLACEHOLDERS.map((name) => ({ name, tag: '{{' + name + '}}' }))
function insertVar(name: string) { template.value = `${template.value}${template.value.endsWith('\n') || !template.value ? '' : ' '}{{${name}}}` }
</script>

<style scoped>
.pd-overlay { position: fixed; inset: 0; z-index: 10050; background: rgba(0, 0, 0, .55); display: flex; align-items: center; justify-content: center; padding: 16px; }
.pd-box { background: var(--card, #fff); color: var(--tx, #111); border-radius: 12px; width: min(1040px, 100%); max-height: 94vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0, 0, 0, .4); }
.pd-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px 0; border-bottom: 1px solid var(--line, #ddd); }
.pd-tabs { display: flex; gap: 4px; }
.pd-tab { border: none; background: transparent; padding: 9px 14px; font-size: 13.5px; font-weight: 700; color: var(--mu, #666); cursor: pointer; border-bottom: 3px solid transparent; font-family: inherit; }
.pd-tab.on { color: var(--tx, #111); border-bottom-color: var(--ac, #2268b8); }
.pd-x { border: none; background: transparent; font-size: 24px; line-height: 1; cursor: pointer; color: inherit; }
.pd-body { display: flex; gap: 18px; padding: 16px; min-height: 0; overflow: auto; }
.pd-preview { flex: 0 0 auto; width: 360px; max-width: 45%; background: #0b131c; border-radius: 8px; display: flex; align-items: center; justify-content: center; min-height: 300px; overflow: hidden; align-self: flex-start; }
.pd-preview img { width: 100%; display: block; }
.pd-state { color: #9aa7b4; font-size: 13px; padding: 20px; text-align: center; } .pd-err { color: #ff8a8a; }
.pd-side { flex: 1; display: flex; flex-direction: column; gap: 12px; min-width: 220px; }
.pd-msgcol { flex: 1; display: flex; flex-direction: column; gap: 10px; min-width: 260px; }
.pd-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pd-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; }
.pd-field small { font-weight: 400; color: var(--mu, #666); font-size: 11.5px; }
.pd-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--line, #ccc); border-radius: 8px; background: var(--s2, #fff); color: var(--tx, #111); font: inherit; font-size: 13px; font-weight: 400; resize: vertical; }
.pd-input:focus { outline: none; border-color: var(--ac, #2268b8); }
.pd-mono { font-family: Consolas, 'Courier New', monospace; font-size: 12.5px; line-height: 1.5; }
.pd-link { align-self: flex-start; border: none; background: transparent; color: var(--ac, #2268b8); font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; padding: 0; }
.pd-kinds { display: flex; flex-wrap: wrap; gap: 8px; }
.pd-kind { flex: 1 1 150px; padding: 9px 12px; border: 1px solid var(--line, #ccc); border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; text-align: center; }
.pd-kind.on { background: var(--ac, #2268b8); border-color: var(--ac, #2268b8); color: #fff; }
.pd-check { display: flex; gap: 10px; align-items: flex-start; cursor: pointer; font-size: 13.5px; } .pd-check input { margin-top: 3px; }
.pd-check small { display: block; color: var(--mu, #666); font-size: 12px; margin-top: 2px; }
.pd-note, .pd-hint { font-size: 12.5px; color: var(--mu, #555); line-height: 1.6; }
.pd-chip { display: inline-block; margin: 2px 3px 2px 0; padding: 1px 6px; border-radius: 5px; background: var(--s2, #f1f1f1); border: 1px solid var(--line, #ddd); font-size: 11.5px; cursor: pointer; color: var(--tx, #222); }
.pd-chip:hover { border-color: var(--ac, #2268b8); }
.pd-msg { margin: 0; flex: 1; min-height: 240px; max-height: 52vh; overflow: auto; white-space: pre-wrap; word-break: break-word; background: #e7f3e4; color: #111; border-radius: 10px; padding: 12px 14px; font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; line-height: 1.5; border: 1px solid #cfe5c8; }
.pd-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: auto; }
.pd-btn { padding: 8px 14px; border: 1px solid var(--line, #ccc); border-radius: 8px; background: transparent; color: inherit; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
.pd-btn:disabled { opacity: .5; cursor: default; }
.pd-primary { background: var(--ac, #2268b8); border-color: var(--ac, #2268b8); color: #fff; }
.pd-ok { color: #1f9d55; font-size: 13px; } .pd-bad { color: #d33; font-size: 13px; }
@media (max-width: 720px) { .pd-body { flex-direction: column; } .pd-preview { width: 100%; max-width: 100%; } .pd-two { grid-template-columns: 1fr; } }
</style>

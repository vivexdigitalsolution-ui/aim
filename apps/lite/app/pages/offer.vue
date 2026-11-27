<template>
  <div>
    <h1>Offer report</h1>
    <p class="sub">The cars you picked with <b>＋ Recommend</b> on the Cars page. Send this list to AP holders who are not our customers yet: each car shows the body price, the CIF, and the import price. They add their own margin.</p>

    <div v-if="err" class="err" style="margin-bottom: 10px">{{ err }}</div>
    <div v-if="msg" class="okmsg" style="margin-bottom: 10px">{{ msg }}</div>
    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!rows.length" class="card muted">No car picked yet. Open <NuxtLink to="/cars" class="ac">Cars</NuxtLink> and press <b>＋ Recommend</b> on the cars you want to offer.</div>

    <template v-else>
      <div class="card row wrap" style="gap: 10px; margin-bottom: 14px; justify-content: flex-start">
        <label class="f" style="margin: 0">Offer title<input v-model="title" style="width: 260px" /></label>
        <button class="btn" @click="copyText">{{ copied ? 'Copied' : 'Copy as message' }}</button>
        <button class="btn ghost" @click="printPage">Print / save as PDF</button>
        <button class="btn ghost" :disabled="busy" @click="saveBatch">Save this offer</button>
        <button class="btn ghost" :disabled="busy" @click="clearAll">Clear the list</button>
        <span class="muted small">¥1 = RM {{ board.rate.value }} · port RM {{ board.fees.value.portMyr }} + carrier fee RM {{ board.fees.value.inlandMyr }} + AP fee RM {{ board.fees.value.apFeeMyr }}</span>
      </div>

      <div class="grid offer">
        <div v-for="r in rows" :key="r.lot.id" class="card car">
          <div class="ph"><img v-if="r.lot.photos?.[0]" :src="r.lot.photos[0]" loading="lazy" alt="" /><span v-else class="muted small">no photo</span></div>
          <div class="body">
            <div class="row"><b>{{ r.lot.brand }} {{ r.lot.model }}</b><button class="btn ghost sm noprint" title="Take off the list" @click="remove(r.lot.id)">✕</button></div>
            <div class="muted small">{{ [r.lot.mfg_year, r.lot.mileage_km != null ? r.lot.mileage_km.toLocaleString('en-US') + ' km' : null, r.lot.grade ? 'Grade ' + r.lot.grade : null, r.lot.venue].filter(Boolean).join(' · ') }}</div>
            <table v-if="r.p.importMyr != null" class="spec">
              <tr><td>Body price</td><td class="r">RM {{ myr(r.p.bodyMyr) }}</td></tr>
              <tr><td>CIF</td><td class="r">RM {{ myr(r.p.agentMyr) }}</td></tr>
              <tr class="sum"><td><b>Import price</b></td><td class="r"><b>RM {{ myr(r.p.importMyr) }}</b></td></tr>
            </table>
            <div v-else class="warnbox">No price yet: {{ r.why }}</div>
            <div class="muted small" style="margin-top: 4px">{{ r.basis }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { offerPricing } from '@aim/core'

const db = useDb()
const { user } = useAuth()
const recs = useRecommend()
const board = useMarginBoard()
const rows = ref<any[]>([]), loading = ref(true), busy = ref(false), err = ref(''), msg = ref(''), copied = ref(false)
const title = ref('Japan auction cars: import prices')
const myr = (n: number | null) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'))

async function build() {
  await Promise.all([board.load(), recs.load(true)])
  const ids = recs.ids.value
  const lots: any[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('lots').select('id,brand,model,grade,mfg_year,mileage_km,venue,photos,start_price_jpy,bid_deadline').in('id', ids.slice(i, i + 100)).gt('bid_deadline', new Date().toISOString())
    if (error) throw error
    lots.push(...(data || []))
  }
  const byId = new Map(board.lots.value.map((l) => [l.id, l]))
  rows.value = lots.map((lot) => {
    const b = byId.get(lot.id), hist = b?.history?.price || null
    const body = hist || (lot.start_price_jpy > 0 ? lot.start_price_jpy : null)
    const p = offerPricing({ historyJpy: body, rate: board.rate.value, dutyMyr: b?.dutyMyr ?? null, portMyr: board.fees.value.portMyr, inlandMyr: board.fees.value.inlandMyr, apFeeMyr: board.fees.value.apFeeMyr })
    const why = !body ? 'no usual winning price or starting price' : b?.dutyMyr == null ? 'no docket yet (open the car and choose one)' : 'no exchange rate'
    return { lot, p, why, basis: hist ? `Body price = usual winning price (${b!.history!.n} recent sales)` : body ? 'Body price = starting price' : '' }
  }).sort((a, b) => (a.lot.brand + a.lot.model).localeCompare(b.lot.brand + b.lot.model))
}

async function remove(id: string) { try { await recs.toggle(id); rows.value = rows.value.filter((r) => r.lot.id !== id) } catch (e: any) { err.value = e.message } }
async function clearAll() {
  if (!confirm('Take every car off the list?')) return
  busy.value = true
  try { const { error } = await db.from('recommend_picks').delete().in('lot_id', recs.ids.value); if (error) throw error; recs.ids.value = []; rows.value = [] } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
function text() {
  const ok = rows.value.filter((r) => r.p.importMyr != null)
  return [title.value, '', ...ok.map((r, i) => `${i + 1}. ${r.lot.brand} ${r.lot.model} ${r.lot.mfg_year || ''}${r.lot.grade ? ' · grade ' + r.lot.grade : ''}${r.lot.mileage_km != null ? ' · ' + r.lot.mileage_km.toLocaleString('en-US') + ' km' : ''}\n   Body RM ${myr(r.p.bodyMyr)} + CIF RM ${myr(r.p.agentMyr)} = import price RM ${myr(r.p.importMyr)}`), '', 'Import price includes duty, port clearance, carrier fee and AP fee. Add your own margin.'].join('\n')
}
async function copyText() { try { await navigator.clipboard.writeText(text()); copied.value = true; setTimeout(() => (copied.value = false), 2000) } catch { err.value = 'Could not copy. Select the cars and copy by hand.' } }
function printPage() { window.print() }
async function saveBatch() {
  busy.value = true; err.value = ''; msg.value = ''
  try {
    const b = await db.from('offer_batches').insert({ car_count: rows.value.length }).select('id').single()
    if (b.error) throw b.error
    const cars = rows.value.map((r) => ({ batch_id: b.data.id, lot_id: r.lot.id, tier: 'top', model_brand: r.lot.brand, model_name: r.lot.model, lot: r.lot, cost: { body_myr: r.p.bodyMyr, agent_myr: r.p.agentMyr, import_myr: r.p.importMyr, title: title.value, by: user.value?.id } }))
    const c = await db.from('offer_batch_cars').insert(cars)
    if (c.error) throw c.error
    msg.value = `Saved: ${cars.length} car(s).`
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
onMounted(async () => { try { await build() } catch (e: any) { err.value = e.message } finally { loading.value = false } })
</script>

<style scoped>
.offer { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.car { padding: 0; overflow: hidden; display: flex; flex-direction: column; }
.ph { aspect-ratio: 4 / 3; background: var(--s2); display: grid; place-items: center; overflow: hidden; }
.ph img { width: 100%; height: 100%; object-fit: cover; }
.body { padding: 12px 14px 14px; }
.spec { width: 100%; border-collapse: collapse; margin-top: 8px; } .spec td { padding: 5px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); }
.r { text-align: right; } .sum td { border-top: 2px solid var(--line); color: inherit !important; }
.warnbox { background: rgba(255, 170, 0, .12); border: 1px solid rgba(255, 170, 0, .4); border-radius: 8px; padding: 8px 10px; margin-top: 8px; font-size: 13px; }
@media print { .noprint, .sub { display: none !important; } }
</style>

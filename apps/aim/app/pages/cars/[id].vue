
<template>
  <div>
    <a href="/cars" class="small ac" @click.prevent="back">← All cars</a>
    <div v-if="err" class="err" style="margin-top: 10px">{{ err }}</div>
    <div v-if="loading" class="muted" style="margin-top: 14px">Loading ...</div>
    <div v-else-if="!car" class="card muted" style="margin-top: 14px">This car is no longer available.</div>

    <div v-else class="grid two" style="margin-top: 10px">
      <div>
        <div class="card" style="padding: 10px">
          <div class="hero"><img v-if="photos[pi]" :src="photos[pi]" alt="" /><span v-else class="muted">no photo</span></div>
          <div v-if="photos.length > 1" class="thumbs"><img v-for="(p, i) in photos" :key="p" :src="p" :class="{ on: i === pi }" loading="lazy" alt="" @click="pi = i" /></div>
        </div>
        <div v-if="car.sheet_url" class="card" style="margin-top: 14px">
          <h2>Auction sheet</h2>
          <a :href="car.sheet_url" target="_blank" rel="noopener"><img :src="car.sheet_url" class="sheet" loading="lazy" alt="Auction sheet" /></a>
        </div>
      </div>

      <div class="grid" style="align-content: start">
        <div class="card">
          <div class="muted small">{{ car.venue }} · lot {{ car.lot_no }} · {{ car.auction_date }}</div>
          <h1 style="margin-top: 4px">{{ car.brand }} {{ car.model }}</h1>
          <div class="price">{{ car.start_price_jpy > 0 ? rm(car.start_price_jpy) : 'Price at auction' }}</div>
          <div v-if="car.start_price_jpy > 0" class="muted small">Starting price ¥{{ car.start_price_jpy.toLocaleString('en-US') }}<template v-if="rate"> at ¥1 = RM {{ rate }}</template></div>
          <div class="row wrap" style="gap: 6px; margin-top: 10px; justify-content: flex-start"><span class="chip ac">closes in {{ left(car.bid_deadline) }}</span><span class="chip">{{ fmtMytDateTime(car.bid_deadline) }} MYT</span></div>
          <div class="row wrap" style="gap: 8px; margin-top: 12px; justify-content: flex-start">
            <button class="btn ghost sm" :class="{ starred: watching }" @click="star">{{ watching ? '★ On your watchlist' : '☆ Watch this car' }}</button>
            <button v-if="isStaff" class="btn ghost sm" :class="{ starred: recs.has(car.id) }" @click="recommend">{{ recs.has(car.id) ? '✔ Recommended' : '＋ Recommend this car' }}</button>
            <NuxtLink v-if="hasTier('member')" :to="`/history?brand=${encodeURIComponent(car.brand)}&model=${encodeURIComponent(String(car.model).split(' ')[0])}`" class="btn ghost sm" style="display: inline-flex; align-items: center; text-decoration: none">What it sold for</NuxtLink>
          </div>
          <div style="margin-top: 14px">
            <NuxtLink v-if="hasTier('member')" :to="`/margin?lot=${car.id}`" class="btn" style="display: inline-flex; align-items: center; text-decoration: none">See the margin and bid</NuxtLink>
            <div v-else class="muted small">Margin, the Malaysian market price and bidding are part of the Member plan. <NuxtLink to="/upgrade" class="ac">See the plans</NuxtLink></div>
          </div>
        </div>

        <div v-if="recBid" class="card">
          <h2>Recommended bid</h2>
          <div class="price">¥{{ recBid.price_jpy.toLocaleString('en-US') }}<small v-if="rate > 0" class="muted" style="font-size: 14px; font-weight: 500"> · {{ rm(recBid.price_jpy) }}</small></div>
          <div class="muted small">What cars like this usually sell for: the average of {{ recBid.sales }} recent sale{{ recBid.sales === 1 ? '' : 's' }} of the same model and grade ({{ recBid.basis }}), rounded up to the next ¥5,000. A guide, not a promise.</div>
          <NuxtLink v-if="!hasTier('member')" to="/upgrade" class="small ac" style="display: inline-block; margin-top: 6px">See the import cost and margin with the Member plan</NuxtLink>
        </div>

        <div v-if="hasTier('member')" class="card">
          <h2>Import price breakdown</h2>
          <div v-if="costMsg" class="muted small" style="margin-top: 6px">{{ costMsg }}</div>
          <template v-else>
            <label class="f" style="margin-top: 8px">Car price (¥) <small class="muted">{{ priceBasis }}</small>
              <input v-model.number="bodyJpy" type="number" step="10000" min="0" />
            </label>
            <table v-if="pricing.importMyr != null" class="spec">
              <tr><td>Car price</td><td class="r">{{ rmf(pricing.bodyMyr) }}</td></tr>
              <tr><td>Agent fee &amp; shipping</td><td class="r">{{ rmf(pricing.agentMyr) }}</td></tr>
              <tr><td>Customs duty</td><td class="r">{{ rmf(dutyMyr) }}</td></tr>
              <tr><td>Port clearance + inland</td><td class="r">{{ rmf(fees.portMyr + fees.inlandMyr) }}</td></tr>
              <tr><td>AP fee</td><td class="r">{{ rmf(fees.apFeeMyr) }}</td></tr>
              <tr class="sum"><td><b>Import price</b></td><td class="r"><b>{{ rmf(pricing.importMyr) }}</b></td></tr>
              <tr v-if="marketMyr"><td>Malaysian market price (typical)</td><td class="r">{{ rmf(marketMyr) }}</td></tr>
              <tr v-if="marketMyr"><td><b>Margin</b></td><td class="r" :class="marketMyr - pricing.importMyr >= 0 ? 'up' : 'down'"><b>{{ rmf(marketMyr - pricing.importMyr) }}</b></td></tr>
            </table>
            <p class="muted small" style="margin-top: 8px">An estimate at ¥1 = RM {{ rate }}. Recon and prep are not included.</p>
          </template>

          <div v-if="docket || isStaff" class="dk">
            <div class="muted small">Docket used (Customs price guide)</div>
            <template v-if="docket">
              <div><b>{{ docket.model }}</b> <span class="muted small">{{ docket.cc ? docket.cc + ' cc' : '' }} · edition {{ docket.year }}</span></div>
              <div class="muted small">{{ dline?.jpy != null ? 'Customs value ¥' + dline.jpy.toLocaleString('en-US') + ' for this age · ' : '' }}{{ decisionNote }}</div>
            </template>
            <div v-else class="warnbox">No docket yet, so no duty. Choose one below.</div>
            <button v-if="isStaff" class="btn ghost sm" style="margin-top: 8px" @click="pickOpen = !pickOpen">{{ pickOpen ? 'Close' : docket ? 'Change docket' : 'Choose docket' }}</button>
            <div v-if="isStaff && pickOpen" class="panel">
              <input v-model="pickSearch" placeholder="Search this make's dockets (name or code)" />
              <button v-for="d in candidates" :key="d.id" class="opt" :disabled="busy" @click="useDocket(d)"><b>{{ d.model }}</b><span class="muted small">{{ d.cc ? d.cc + ' cc' : '' }}</span></button>
              <p v-if="!candidates.length" class="muted small">No docket found.</p>
            </div>
            <div v-if="dMsg" class="okmsg" style="margin-top: 8px">{{ dMsg }}</div>
          </div>
        </div>

        <div v-if="features.length" class="card">
          <h2>On this car</h2>
          <div class="row wrap" style="gap: 6px; margin-top: 8px; justify-content: flex-start">
            <span v-for="f in features" :key="f.key" class="chip" :class="f.source === 'aftermarket' ? 'warn' : f.source === 'factory' ? 'ok' : ''" :title="f.evidence || ''">{{ f.label }}<small v-if="f.source === 'aftermarket'"> · aftermarket</small></span>
          </div>
        </div>

        <div class="card">
          <h2>Details</h2>
          <table class="spec"><tr v-for="r in specs" :key="r[0]"><td>{{ r[0] }}</td><td>{{ r[1] }}</td></tr></table>
          <div v-if="car.equipment" style="margin-top: 12px"><div class="muted small">Equipment</div><div>{{ car.equipment }}</div></div>
          <div v-if="car.notes_en || car.notes" style="margin-top: 12px"><div class="muted small">Seller notes</div><div>{{ car.notes_en || car.notes }}</div></div>
          <div v-if="car.inspector_report_en || car.inspector_report" style="margin-top: 12px"><div class="muted small">Inspector report</div><div>{{ car.inspector_report_en || car.inspector_report }}</div></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime, timeLeft, offerPricing, sellFromRow, docketLine, docketPool, docketBrand, confirmKey, dutyCostRow, type Docket } from '@aim/core'

const db = useDb()
const route = useRoute()
const router = useRouter()
/** Back to the list as it was (filters and all); a car opened from a link goes to the plain list. */
function back() { if (import.meta.client && (window.history.state as any)?.back) router.back(); else navigateTo('/cars') }
const now = useNow()
const { hasTier, isStaff, user } = useAuth()
const { rate, loadRate, rm } = useRate()
const watch = useWatch()
const watching = computed(() => !!car.value && watch.has(car.value.id))
const recs = useRecommend()
async function recommend() { try { await recs.toggle(car.value.id) } catch (e: any) { err.value = e.message } }
async function star() { try { await watch.toggle(car.value.id) } catch (e: any) { err.value = e.message } }
const car = ref<any>(null), features = ref<any[]>([]), loading = ref(true), err = ref(''), pi = ref(0)
const left = (iso: string) => timeLeft(iso, now.value).label
const photos = computed<string[]>(() => (Array.isArray(car.value?.photos) ? car.value.photos : []))
const specs = computed(() => {
  const c = car.value
  if (!c) return []
  return ([
    ['Year', c.mfg_year ? c.mfg_year + (c.mfg_month ? '/' + String(c.mfg_month).padStart(2, '0') : '') : null], ['Mileage', c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null],
    ['Auction grade', c.grade], ['Interior grade', c.interior_grade], ['Engine', c.engine_cc ? c.engine_cc.toLocaleString('en-US') + ' cc' : null], ['Transmission', c.transmission],
    ['Fuel', c.fuel], ['Drive', c.drive], ['Colour', c.color], ['Chassis code', c.model_code],
  ] as [string, string | null][]).filter((r) => r[1])
})
// ── import price breakdown (Member plan and staff) ──
const board = useMarginBoard()
const refs = useReference()
const bodyJpy = ref(0), dutyMyr = ref<number | null>(null), marketMyr = ref<number | null>(null), priceBasis = ref(''), costMsg = ref('')
const docket = ref<Docket | null>(null), decisionNote = ref(''), pickOpen = ref(false), pickSearch = ref(''), busy = ref(false), dMsg = ref('')
const apPort = ref(0), apInland = ref(0), recBid = ref<{ price_jpy: number; sales: number; basis: string } | null>(null)
const fees = computed(() => (isStaff.value ? board.fees.value : { ...board.fees.value, portMyr: apPort.value, inlandMyr: apInland.value }))
const rmf = (n: number | null | undefined) => (n == null ? '–' : (n < 0 ? '-RM ' : 'RM ') + Math.abs(Math.round(n)).toLocaleString('en-US'))
const pricing = computed(() => offerPricing({ historyJpy: bodyJpy.value || null, rate: rate.value, dutyMyr: dutyMyr.value, portMyr: fees.value.portMyr, inlandMyr: fees.value.inlandMyr, apFeeMyr: fees.value.apFeeMyr }))
const dline = computed(() => (docket.value && car.value ? docketLine(docket.value, car.value.mfg_year, car.value.mfg_month || car.value.first_reg_month) : null))
const candidates = computed<Docket[]>(() => {
  const r = refs.data.value, lot = car.value
  if (!r || !lot) return []
  const s = pickSearch.value.trim().toUpperCase(), brand = docketBrand(lot.brand)
  if (!s) { const p = docketPool(r.dockets, lot).pool; if (p.length) return p.slice(0, 30) }
  return r.dockets.filter((d) => docketBrand(d.brand) === brand && (!d.currency_code || d.currency_code === 'JPY') && (!s || d.model.toUpperCase().includes(s))).slice(0, 30)
})

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
async function loadBid(lot: any) { const r = await db.rpc('recommended_bid', { p_lot_id: lot.id }); if (!r.error && r.data) recBid.value = r.data }
async function loadCost(lot: any) {
  try {
    await board.load()
    const l = board.lots.value.find((x) => x.id === lot.id)
    dutyMyr.value = l?.dutyMyr ?? null
    if (!isStaff.value) {
      // a dealer sees the docket and the duty, port and inland lines on their own (the report shows them too)
      const bd = await db.rpc('ap_lot_breakdown', { p_lot_id: lot.id })
      if (!bd.error && bd.data) { dutyMyr.value = Number(bd.data.duty_myr); apPort.value = Number(bd.data.port_myr); apInland.value = Number(bd.data.inland_myr); if (bd.data.docket) docket.value = { ...bd.data.docket, amt_12m_24m: num(bd.data.docket.amt_12m_24m), amt_24m_36m: num(bd.data.docket.amt_24m_36m), amt_36m_48m: num(bd.data.docket.amt_36m_48m), amt_48m_60m: num(bd.data.docket.amt_48m_60m), amt_60m_plus: num(bd.data.docket.amt_60m_plus) }; decisionNote.value = '' }
    }
    marketMyr.value = l?.market ? (sellFromRow(l.market.row, l.market.wider).sellMyr || null) : null
    const hist = l?.history?.price
    bodyJpy.value = hist || (lot.start_price_jpy > 0 ? lot.start_price_jpy : 0)
    priceBasis.value = hist ? '(usual winning price of this car)' : lot.start_price_jpy > 0 ? '(starting price)' : '(type the price you expect)'
    if (dutyMyr.value == null && !isStaff.value) costMsg.value = 'The import cost of this car is not worked out yet. Our team is checking its customs docket.'
    if (isStaff.value) {
      const r = await refs.load()
      const { data: dec } = await db.from('lot_docket_decisions').select('*').eq('lot_id', lot.id).maybeSingle()
      docket.value = dec?.docket_id ? r.dockets.find((d) => d.id === dec.docket_id) || null : null
      decisionNote.value = dec ? (dec.reason || dec.status) : 'no decision yet'
    }
  } catch (e: any) { costMsg.value = e.message }
}
async function useDocket(d: Docket) {
  busy.value = true; dMsg.value = ''; err.value = ''
  try {
    const lot = car.value, r = await refs.load()
    const { error: de } = await db.from('lot_docket_decisions').upsert({ lot_id: lot.id, status: 'confirmed', docket_id: d.id, reason: 'changed by staff on the car page', decided_at: new Date().toISOString() }, { onConflict: 'lot_id' })
    if (de) throw de
    const { error: ce } = await db.from('docket_confirmations').upsert({ key: confirmKey(lot), docket_id: d.id, confirmed_by: user.value?.id, example_lot: lot.id }, { onConflict: 'key' })
    if (ce) throw ce
    const { cost } = dutyCostRow({ docket: d, regYear: lot.mfg_year, regMonth: lot.mfg_month || lot.first_reg_month, ref: r })
    if (cost) { const { error: le } = await db.from('lot_costs').upsert({ lot_id: lot.id, ...cost, updated_at: new Date().toISOString() }, { onConflict: 'lot_id' }); if (le) throw le; dutyMyr.value = cost.duty_myr } else { await db.from('lot_costs').delete().eq('lot_id', lot.id); dutyMyr.value = null }
    docket.value = d; decisionNote.value = 'changed by staff'; pickOpen.value = false
    dMsg.value = cost ? `Docket changed. Duty is now ${rmf(cost.duty_myr)}. Remembered for the same car next time.` : 'Docket changed, but duty could not be worked out (register date or exchange rate missing).'
    board.loaded.value = false
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}

onMounted(async () => {
  try {
    await Promise.all([loadRate().catch(() => {}), watch.load().catch(() => {}), recs.load().catch(() => {})])
    const { data, error } = await db.from('lots').select('*').eq('id', route.params.id as string).eq('my_eligible', true).maybeSingle()
    if (error) throw error
    car.value = data
    if (data) loadBid(data)
    if (data && hasTier('member')) loadCost(data)
    if (data) { const f = await db.from('lot_features').select('key,label,source,evidence').eq('lot_id', data.id); features.value = f.data || [] }
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.two { grid-template-columns: 1.15fr 1fr; align-items: start; }
.hero { aspect-ratio: 4 / 3; background: var(--s2); border-radius: 10px; overflow: hidden; display: grid; place-items: center; }
.hero img { width: 100%; height: 100%; object-fit: contain; background: #0b0b0d; }
.thumbs { display: flex; gap: 6px; overflow-x: auto; margin-top: 8px; padding-bottom: 2px; }
.thumbs img { width: 72px; height: 54px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; flex: none; }
.thumbs img.on { border-color: var(--ac); }
.starred { color: var(--ac); border-color: var(--ac); }
.r { text-align: right; } .sum td { border-top: 2px solid var(--line); } .up { color: #3ecf8e; } .down { color: #ff6b6b; }
.dk { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
.panel { display: grid; gap: 6px; margin-top: 10px; max-height: 300px; overflow: auto; }
.opt { display: flex; justify-content: space-between; gap: 10px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; cursor: pointer; text-align: left; color: inherit; }
.opt:hover { border-color: var(--ac); }
.warnbox { background: rgba(255, 170, 0, .12); border: 1px solid rgba(255, 170, 0, .4); border-radius: 8px; padding: 8px 10px; }
.sheet { width: 100%; border-radius: 8px; margin-top: 10px; }
.price { font-size: 28px; font-weight: 800; margin-top: 4px; }
.spec { width: 100%; border-collapse: collapse; margin-top: 8px; } .spec td { padding: 6px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); width: 42%; }
@media (max-width: 860px) { .two { grid-template-columns: 1fr; } }
</style>

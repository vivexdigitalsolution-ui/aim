<template>
  <div>
    <a href="/cars" class="small" @click.prevent="back">← All cars</a>
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
          <div class="row wrap" style="gap: 10px; justify-content: space-between; align-items: center">
            <div class="price">{{ money(car.start_price_jpy) }}</div>
            <div class="cur" role="group" aria-label="Currency"><button :class="{ on: cur === 'RM' }" @click="setCur('RM')">RM</button><button :class="{ on: cur === 'JPY' }" @click="setCur('JPY')">¥</button></div>
          </div>
          <div v-if="car.start_price_jpy > 0" class="muted small">Starting price {{ yen(car.start_price_jpy) }} at ¥1 = RM {{ rate }}</div>
          <div class="row wrap" style="gap: 8px; margin-top: 10px; justify-content: flex-start"><button class="btn ghost sm" :class="{ starred: watching }" @click="star">{{ watching ? '★ On your watchlist' : '☆ Watch this car' }}</button></div>
          <div class="row wrap" style="gap: 6px; margin-top: 10px"><span class="chip" :class="soon ? 'warn' : 'ac'">closes in {{ left(car.bid_deadline, now) }}</span><span class="chip">{{ fmtMyt(car.bid_deadline) }} MYT</span></div>
        </div>

        <div v-if="recBid" class="card">
          <h2>Suggested bid</h2>
          <div class="price">{{ money2(recBid.price_jpy) }}</div>
          <div class="muted small">What cars like this usually sell for: the average of {{ recBid.sales }} recent sale{{ recBid.sales === 1 ? '' : 's' }} of the same model and grade ({{ recBid.basis }}), rounded up to the next ¥5,000. A guide, not a promise.</div>
          <button v-if="!isStaff && (!open || open.status === 'pending')" class="btn ghost sm" style="margin-top: 8px" @click="useSuggested">Use it as my bid</button>
        </div>

        <div v-if="costDone" class="card">
          <h2>Import price breakdown</h2>
          <div v-if="!bd" class="muted small" style="margin-top: 6px">The import cost of this car is not worked out yet. Our team is checking its customs docket.</div>
          <template v-else>
            <label class="fld">Car price ({{ unit }})<NumInput v-model="bodyInput" /></label>
            <div class="muted small">{{ priceBasis }}</div>
            <table v-if="pricing.importMyr != null" class="spec">
              <tr><td>Car price</td><td class="r">{{ rmf(pricing.bodyMyr) }}</td></tr>
              <tr><td>Agent fee &amp; shipping</td><td class="r">{{ rmf(pricing.agentMyr) }}</td></tr>
              <tr><td>Customs duty</td><td class="r">{{ rmf(Number(bd.duty_myr)) }}</td></tr>
              <tr><td>Port clearance + inland</td><td class="r">{{ rmf(Number(bd.port_myr) + Number(bd.inland_myr)) }}</td></tr>
              <tr><td>AP fee</td><td class="r">{{ rmf(Number(bd.ap_fee_myr)) }}</td></tr>
              <tr class="sum"><td><b>Import price</b></td><td class="r"><b>{{ rmf(pricing.importMyr) }}</b></td></tr>
            </table>
            <div v-if="docket" class="dk">
              <div class="muted small">Docket used (Customs price guide)</div>
              <div><b>{{ docket.model }}</b> <span class="muted small">{{ docket.cc ? docket.cc + ' cc' : '' }} · edition {{ docket.year }}</span></div>
              <div v-if="dline?.jpy != null" class="muted small">Customs value ¥{{ dline.jpy.toLocaleString('en-US') }} for this age of car</div>
            </div>
            <p class="muted small" style="margin-top: 8px">An estimate at ¥1 = RM {{ rate }}. It does not include your own prep or margin.</p>
          </template>
        </div>

        <div v-if="isStaff" class="card muted small">Bid orders from dealers are placed and tracked in the <NuxtLink to="/bids">Bid queue</NuxtLink>.</div>
        <div v-else class="card">
          <h2>Your bid order</h2>
          <div v-if="open" class="okmsg" style="margin: 10px 0">
            You have an order of <b>{{ rm(open.max_bid_jpy) }}</b> ({{ yen(open.max_bid_jpy) }}) —
            {{ open.status === 'placed' ? 'placed by our team, it can no longer be changed.' : 'waiting for our team. You can change or cancel it until it is placed.' }}
          </div>
          <template v-if="!open || open.status === 'pending'">
            <label class="fld">Your highest bid ({{ unit }})
              <NumInput v-model="bidInput" :placeholder="'e.g. ' + examples" />
            </label>
            <div class="muted small" style="margin: 6px 0 10px">
              <template v-if="bidJpy > 0">We bid in yen steps of ¥5,000: your order will be <b>{{ yen(bidJpy) }}</b> (about {{ rm(bidJpy) }}). It is the most we will bid; the car is bought for the lowest price that wins.</template>
              <template v-else>Type the most you want to pay, in {{ unit }}.</template>
            </div>
            <textarea v-model="note" rows="2" placeholder="Note for our team (optional)" style="width: 100%"></textarea>
            <div v-if="msg" :class="msgOk ? 'okmsg' : 'err'" style="margin-top: 10px">{{ msg }}</div>
            <div class="row wrap" style="gap: 8px; margin-top: 12px">
              <button class="btn" :disabled="busy || bidJpy <= 0 || closed" @click="submit">{{ open ? 'Update order' : 'Place bid order' }}</button>
              <button v-if="open" class="btn danger" :disabled="busy" @click="cancel">Cancel order</button>
            </div>
          </template>
          <div v-if="closed" class="err" style="margin-top: 10px">The bid deadline for this car has passed.</div>
        </div>

        <div class="card">
          <h2>Details</h2>
          <table class="spec">
            <tr v-for="r in specs" :key="r[0]"><td>{{ r[0] }}</td><td>{{ r[1] }}</td></tr>
          </table>
          <div v-if="car.equipment" style="margin-top: 12px"><div class="muted small">Equipment</div><div>{{ car.equipment }}</div></div>
          <div v-if="car.notes" style="margin-top: 12px"><div class="muted small">Seller notes</div><div>{{ car.notes }}</div></div>
          <div v-if="car.inspector_report" style="margin-top: 12px"><div class="muted small">Inspector report</div><div>{{ car.inspector_report }}</div></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch as vueWatch } from 'vue'
import { fmtMyt, offerPricing, docketLine, BID_STEP, type Docket } from '@aim/core'

const db = useDb()
const route = useRoute()
const now = useNow()
const router = useRouter()
const { rate, loadRate, rm, yen, rmToBidJpy, left, cur, loadCur, setCur, money } = useLite()
const { isStaff } = useAuth()
/** Back to the list as it was (filters and all); a car opened from a link goes to the plain list. */
function back() { if (import.meta.client && (window.history.state as any)?.back) router.back(); else navigateTo('/cars') }
const watch = useWatch()
const watching = computed(() => !!car.value && watch.has(car.value.id))
async function star() { try { await watch.toggle(car.value.id) } catch (e: any) { err.value = e.message } }
// suggested bid and import price breakdown
const recBid = ref<{ price_jpy: number; sales: number; basis: string } | null>(null), bd = ref<any>(null), costDone = ref(false)
const bodyInput = ref(0), priceBasis = ref('')
const money2 = (jpy: number) => (cur.value === 'JPY' ? yen(jpy) : rm(jpy) + ' · ' + yen(jpy))
const rmf = (n: number | null | undefined) => fmtMoney(n)
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const docket = computed<Docket | null>(() => (bd.value?.docket ? { ...bd.value.docket, amt_12m_24m: num(bd.value.docket.amt_12m_24m), amt_24m_36m: num(bd.value.docket.amt_24m_36m), amt_36m_48m: num(bd.value.docket.amt_36m_48m), amt_48m_60m: num(bd.value.docket.amt_48m_60m), amt_60m_plus: num(bd.value.docket.amt_60m_plus) } : null))
const dline = computed(() => (docket.value && car.value ? docketLine(docket.value, car.value.mfg_year, car.value.mfg_month || car.value.first_reg_month) : null))
const pricing = computed(() => offerPricing({ historyJpy: bodyInput.value > 0 && (cur.value === 'JPY' || rate.value > 0) ? (cur.value === 'JPY' ? Math.round(bodyInput.value) : Math.round(bodyInput.value / rate.value)) : null, rate: rate.value, dutyMyr: bd.value ? Number(bd.value.duty_myr) : null, portMyr: Number(bd.value?.port_myr || 0), inlandMyr: Number(bd.value?.inland_myr || 0), apFeeMyr: Number(bd.value?.ap_fee_myr || 0) }))
function useSuggested() { if (recBid.value) bidInput.value = fromJpy(recBid.value.price_jpy) }
// switching RM / yen converts what is already typed, so the same bid and price stay the same
vueWatch(cur, (now, was) => {
  const toJpy = (v: number) => (was === 'JPY' ? v : rate.value > 0 ? v / rate.value : 0)
  const conv = (v: number | null, step: number) => { if (!v) return v; const jpy = toJpy(v); return now === 'JPY' ? Math.round(jpy / step) * step : Math.round((jpy * rate.value) / 1000) * 1000 }
  bidInput.value = conv(bidInput.value, BID_STEP)
  bodyInput.value = conv(bodyInput.value, 1000) || 0
})
async function loadCost(lot: any) {
  const [r, b] = await Promise.all([db.rpc('recommended_bid', { p_lot_id: lot.id }), db.rpc('ap_lot_breakdown', { p_lot_id: lot.id })])
  if (!r.error && r.data) recBid.value = r.data
  if (!b.error && b.data) bd.value = b.data
  costDone.value = true
  const base = recBid.value?.price_jpy || (lot.start_price_jpy > 0 ? lot.start_price_jpy : 0)
  bodyInput.value = base ? fromJpy(base) : 0
  priceBasis.value = recBid.value ? '(the suggested bid; change it to try another price)' : lot.start_price_jpy > 0 ? '(the starting price; change it to try another price)' : '(type the price you expect)'
}
const car = ref<any>(null), open = ref<any>(null), loading = ref(true), err = ref(''), pi = ref(0)
const bidInput = ref<number | null>(null), note = ref(''), busy = ref(false), msg = ref(''), msgOk = ref(false)

const photos = computed<string[]>(() => (Array.isArray(car.value?.photos) ? car.value.photos : []))
const closed = computed(() => !car.value || new Date(car.value.bid_deadline).getTime() <= now.value)
const soon = computed(() => !!car.value && new Date(car.value.bid_deadline).getTime() - now.value < 6 * 3600_000)
const unit = computed(() => (cur.value === 'JPY' ? '¥' : 'RM'))
// the bid and the car price are typed in the chosen currency; the order itself is always in yen steps of 5,000
const bidJpy = computed(() => (cur.value === 'JPY' ? Math.floor((Number(bidInput.value) || 0) / BID_STEP) * BID_STEP : rmToBidJpy(Number(bidInput.value) || 0)))
const fromJpy = (jpy: number) => (cur.value === 'JPY' ? Math.round(jpy) : Math.round((jpy * rate.value) / 1000) * 1000)
const examples = computed(() => (fromJpy(car.value?.start_price_jpy || 0)).toLocaleString('en-US'))
// the money lines of the breakdown, in the chosen currency
const fmtMoney = (myr: number | null | undefined) => (myr == null ? '–' : cur.value === 'JPY' ? '¥' + Math.round(rate.value > 0 ? myr / rate.value : 0).toLocaleString('en-US') : 'RM ' + Math.round(myr).toLocaleString('en-US'))
const specs = computed(() => {
  const c = car.value
  if (!c) return []
  const cc = c.engine_cc ? c.engine_cc.toLocaleString('en-US') + ' cc' : null
  return ([
    ['Year', c.mfg_year ? c.mfg_year + (c.mfg_month ? '/' + String(c.mfg_month).padStart(2, '0') : '') : null], ['Mileage', c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null],
    ['Auction grade', c.grade], ['Interior grade', c.interior_grade], ['Engine', cc], ['Transmission', c.transmission], ['Fuel', c.fuel], ['Drive', c.drive], ['Colour', c.color], ['Chassis code', c.model_code],
  ] as [string, string | null][]).filter((r) => r[1])
})

async function loadOpen() {
  const { data } = await db.from('bids').select('id,max_bid_jpy,status').eq('lot_id', route.params.id as string).in('status', ['pending', 'placed']).maybeSingle()
  open.value = data || null
}
async function submit() {
  msg.value = ''; busy.value = true
  try {
    const { error } = await db.rpc('place_bid', { p_lot: car.value.id, p_max: bidJpy.value, p_note: note.value.trim() || null })
    if (error) throw error
    await loadOpen(); msgOk.value = true; msg.value = 'Your bid order is saved. Our team will place it at the auction.'
  } catch (e: any) { msgOk.value = false; msg.value = e.message } finally { busy.value = false }
}
async function cancel() {
  if (!open.value || !confirm('Cancel this bid order?')) return
  busy.value = true; msg.value = ''
  try { const { error } = await db.rpc('cancel_bid', { p_bid: open.value.id }); if (error) throw error; open.value = null; bidInput.value = null; msgOk.value = true; msg.value = 'Order cancelled.' }
  catch (e: any) { msgOk.value = false; msg.value = e.message } finally { busy.value = false }
}

onMounted(async () => {
  try {
    loadCur(); watch.load().catch(() => {})
    await loadRate()
    const { data, error } = await db.from('lots').select('*').eq('id', route.params.id as string).eq('my_eligible', true).maybeSingle()
    if (error) throw error
    car.value = data
    if (data) loadCost(data).catch(() => { costDone.value = true })
    if (data) { await loadOpen(); if (open.value) bidInput.value = fromJpy(open.value.max_bid_jpy) }
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.two { grid-template-columns: 1.15fr 1fr; align-items: start; }
.hero { aspect-ratio: 4 / 3; background: #e9edf3; border-radius: 10px; overflow: hidden; display: grid; place-items: center; }
.hero img { width: 100%; height: 100%; object-fit: contain; background: #0f1115; }
.thumbs { display: flex; gap: 6px; overflow-x: auto; margin-top: 8px; padding-bottom: 2px; }
.thumbs img { width: 72px; height: 54px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; flex: none; }
.thumbs img.on { border-color: var(--ac); }
.starred { color: var(--ac); border-color: var(--ac); }
.cur { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.cur button { background: transparent; border: 0; color: inherit; padding: 6px 14px; cursor: pointer; font-weight: 600; }
.cur button.on { background: var(--ac); color: #fff; }
.r { text-align: right; } .sum td { border-top: 2px solid var(--line); color: inherit !important; }
.dk { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--line); }
.sheet { width: 100%; border-radius: 8px; margin-top: 10px; }
.price { font-size: 28px; font-weight: 800; margin-top: 4px; }
.fld { display: grid; gap: 5px; color: var(--mu); font-size: 13px; margin-top: 10px; } .fld input { width: 100%; }
.spec { width: 100%; border-collapse: collapse; margin-top: 8px; } .spec td { padding: 6px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); width: 42%; }
@media (max-width: 860px) { .two { grid-template-columns: 1fr; } }
</style>

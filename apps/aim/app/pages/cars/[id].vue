
<template>
  <div>
    <BackLink to="/cars">All cars</BackLink>
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
        <div v-if="car.needs_review" class="card review">
          <b>Check the auction sheet</b>
          <div class="small">Some details of this car could not be read clearly from the sheet and may be wrong<template v-if="car.review_note"> ({{ car.review_note }})</template>. Please check the sheet before you bid.</div>
        </div>
        <div class="card">
          <div class="muted small">{{ car.venue }}<template v-if="isStaff"> · <b title="Where this car was found (staff only)">{{ car.source === 'asnet' ? 'ASNET' : 'USS' }}</b></template> · lot {{ car.lot_no }} · {{ car.auction_date }} · {{ closingTimeText(car.bid_deadline) }}</div>
          <h1 style="margin-top: 4px">{{ car.brand }} {{ car.model }}</h1>
          <div class="toprow">
            <div>
              <div class="muted small">Start price</div>
              <div class="price" style="margin-top: 0">{{ car.start_price_jpy > 0 ? yenf(car.start_price_jpy) : 'Price at auction' }}<small v-if="car.start_price_jpy > 0 && rateUsed > 0" class="muted rmsmall"> · {{ rmUsed(car.start_price_jpy) }}</small></div>
            </div>
            <div v-if="estTop != null" class="estb" title="Estimated import price at the recommended bid: the car, agent fee and shipping, duty, port, inland and AP fee"><span>Est. import price</span><b>{{ rmf(estTop) }}</b></div>
          </div>
          <div v-if="car.start_price_jpy > 0" class="muted small" style="margin-top: 4px">The final price is set at the auction.</div>
          <div class="row wrap" style="gap: 6px; margin-top: 10px; justify-content: flex-start"><span class="chip" :class="chipCls(car.bid_deadline)">{{ closes(car.bid_deadline) }}</span><span v-if="!isPlaceholderDeadline(car.bid_deadline)" class="chip">{{ fmtMytDateTime(car.bid_deadline) }} MYT</span><span v-if="rateUsed > 0" class="chip ac" title="Exchange rate used on this page (change it in the breakdown)">¥1 = RM {{ rateUsed }}</span></div>
          <div class="actrow">
            <button class="btn ghost sm" :class="{ starred: watching }" @click="star"><StarIcon :filled="watching" />{{ watching ? 'On your watchlist' : 'Watch this car' }}</button>
            <button v-if="isStaff" class="btn ghost sm" :class="{ starred: recs.has(car.id) }" @click="recommend">{{ recs.has(car.id) ? '✔ Recommended' : '＋ Recommend this car' }}</button>
            <NuxtLink v-if="hasTier('member')" :to="`/history?brand=${encodeURIComponent(car.brand)}&model=${encodeURIComponent(String(car.model).split(' ')[0])}`" class="btn ghost sm" style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none; white-space: nowrap"><svg class="gicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></svg>What it sold for</NuxtLink>
          </div>
          <div style="margin-top: 14px">
            <NuxtLink v-if="hasTier('member')" :to="`/margin?lot=${car.id}`" class="btn" style="display: inline-flex; align-items: center; text-decoration: none">See the margin and bid</NuxtLink>
            <div v-else class="muted small">Margin, the Malaysian market price and bidding are part of the Member plan. <NuxtLink to="/upgrade" class="ac">See the plans</NuxtLink></div>
          </div>
        </div>

        <div v-if="recBid" class="card">
          <h2>Recommended bid</h2>
          <div class="price">{{ yenf(recBid.price_jpy) }}<small v-if="rateUsed > 0" class="muted rmsmall"> · {{ rmUsed(recBid.price_jpy) }}</small></div>
          <div class="muted small">What cars like this usually sell for: the average of {{ recBid.sales }} recent sale{{ recBid.sales === 1 ? '' : 's' }} of the same model and grade ({{ recBid.basis }}), rounded up to the next ¥5,000. A guide, not a promise.</div>
          <NuxtLink v-if="!hasTier('member')" to="/upgrade" class="small ac" style="display: inline-block; margin-top: 6px">See the import cost and margin with the Member plan</NuxtLink>
        </div>

        <div v-if="hasTier('member')" class="card">
          <h2>Import price breakdown</h2>
          <div v-if="costMsg || selfCalc">
            <ImportCalc :car="car" :price-jpy="recBid?.price_jpy || (car.start_price_jpy > 0 ? car.start_price_jpy : 0)" :docket-id="docket?.id || null" :price-note="recBid ? '(the recommended bid; change it to try another price)' : '(the starting price; change it to try another price)'" />
            <button v-if="selfCalc" class="btn ghost sm" style="margin-top: 8px" @click="selfCalc = false">Back to the standard breakdown</button>
          </div>
          <template v-else>
            <label class="f" style="margin-top: 8px">Car price
              <span class="inbox wide"><span class="sy">¥</span><NumInput v-model="bodyJpy" class="fee" aria-label="Car price in yen" /></span>
            </label>
            <div class="muted small" style="margin-top: 4px">{{ priceBasis }}</div>
            <div class="ratebar">
              <span class="inbox wide grow"><span class="sy">Exchange rate ¥1 = RM</span><NumInput v-model="rateIn" decimal class="fee rateinp" aria-label="Exchange rate, RM for ¥1" /></span>
              <button v-if="!customRate" class="btn ghost sm" title="Round the rate up to 3 decimals, e.g. 0.026465 becomes 0.027" @click="roundRate">Round up</button>
              <button v-else class="btn ghost sm" @click="customRate = null">Back to {{ rate }}</button>
            </div>
            <table v-if="pricing.importMyr != null" class="spec bk">
              <tr><td>Car price<span v-if="pricing.bodyJpy != null" class="yn">{{ yenf(pricing.bodyJpy) }}</span></td><td class="r"><span class="cell"><span class="sy">RM</span><span>{{ amt(pricing.bodyMyr) }}</span></span></td></tr>
              <tr><td>Agent fee &amp; shipping<span v-if="pricing.agentJpy != null" class="yn">{{ yenf(pricing.agentJpy) }}</span></td><td class="r"><span class="cell"><span class="sy">RM</span><span>{{ amt(pricing.agentMyr) }}</span></span></td></tr>
              <tr><td>Customs duty</td><td class="r"><span class="cell"><span class="sy">RM</span><span>{{ amt(dutyMyr) }}</span></span></td></tr>
              <tr><td>Port clearance</td><td class="r"><span class="inbox"><span class="sy">RM</span><NumInput v-model="portIn" class="fee" aria-label="Port clearance in RM" /></span></td></tr>
              <tr><td>Inland transfer</td><td class="r"><span class="inbox"><span class="sy">RM</span><NumInput v-model="inlandIn" class="fee" aria-label="Inland transfer in RM" /></span></td></tr>
              <tr><td>AP fee</td><td class="r"><span class="inbox"><span class="sy">RM</span><NumInput v-model="apFeeIn" class="fee" aria-label="AP fee in RM" /></span></td></tr>
              <tr class="sum"><td><b>Import price</b></td><td class="r"><span class="cell b"><span class="sy">RM</span><span>{{ amt(pricing.importMyr) }}</span></span></td></tr>
              <tr v-if="marketMyr"><td>Malaysian market price (typical)</td><td class="r"><span class="cell"><span class="sy">RM</span><span>{{ amt(marketMyr) }}</span></span></td></tr>
              <tr v-if="marketMyr"><td><b>Margin</b></td><td class="r" :class="marketMyr - pricing.importMyr >= 0 ? 'up' : 'down'"><span class="cell b"><span class="sy">{{ marketMyr - pricing.importMyr < 0 ? '-RM' : 'RM' }}</span><span>{{ amt(marketMyr - pricing.importMyr) }}</span></span></td></tr>
            </table>
            <div class="feebar">
              <span class="muted small">Port, inland and AP fee are yours to change: the import price recounts as you type.</span>
              <span class="feeacts">
                <button v-if="feesChanged" class="btn ghost sm" @click="resetFees">Reset</button>
                <button v-if="!isStaff && feesChanged" class="btn sm" :disabled="feeBusy" @click="saveFees">Save as my default</button>
              </span>
            </div>
            <div v-if="feeMsg" :class="feeOk ? 'okmsg' : 'err'" style="margin-top: 6px">{{ feeMsg }}</div>
            <p class="muted small" style="margin-top: 8px">An estimate at ¥1 = RM {{ rateUsed }}. Recon and prep are not included.</p>
          </template>

          <div v-if="docket || isStaff" class="dk">
            <div class="muted small">Docket used (Customs price guide)</div>
            <template v-if="docket">
              <div><b>{{ docket.model }}</b> <span class="muted small">{{ docket.cc ? docket.cc + ' cc' : '' }} · edition {{ docket.year }}</span></div>
              <div class="muted small">{{ dline?.jpy != null ? 'Customs value ¥' + dline.jpy.toLocaleString('en-US') + ' for this age · ' : '' }}{{ decisionNote }}</div>
            </template>
            <div v-else class="warnbox">No docket yet, so no duty. Choose one below.</div>
            <button v-if="isStaff" class="btn ghost sm" style="margin-top: 8px" @click="pickOpen = !pickOpen">{{ pickOpen ? 'Close' : docket ? 'Change docket' : 'Choose docket' }}</button>
            <button v-if="!isStaff && docket" class="btn ghost sm" style="margin-top: 8px" @click="selfCalc = true">Try another docket</button>
            <div v-if="isStaff && pickOpen" class="panel">
              <input v-model="pickSearch" placeholder="Search this make's dockets (name or code)" />
              <button v-for="d in candidates" :key="d.id" class="opt" :disabled="busy" @click="useDocket(d)"><b>{{ d.model }}</b><span class="muted small">{{ d.cc ? d.cc + ' cc' : '' }}</span></button>
              <p v-if="!candidates.length" class="muted small">No docket found.</p>
            </div>
            <div v-if="dMsg" class="okmsg" style="margin-top: 8px">{{ dMsg }}</div>
          </div>
        </div>

        <div v-if="features.length && hasTier('member')" class="card">
          <h2>On this car</h2>
          <div class="row wrap" style="gap: 6px; margin-top: 8px; justify-content: flex-start">
            <span v-for="f in features" :key="f.key" class="chip" :title="f.evidence || ''">{{ f.label }}</span>
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
import { watch as vueWatch } from 'vue'
import { calcDuty, type DutyRate, fmtMytDateTime, timeLeft, offerPricing, sellFromRow, docketLine, docketPool, docketBrand, confirmKey, dutyCostRow, type Docket, closesInfo, closingTimeText, isPlaceholderDeadline } from '@aim/core'

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
const selfCalc = ref(false)
const yenf = (jpy: number) => '¥' + Math.round(jpy).toLocaleString('en-US')
const rmUsed = (jpy: number) => 'RM ' + Math.round(jpy * rateUsed.value).toLocaleString('en-US')
// a rate typed in the breakdown (e.g. the rate you really pay); empty = the live rate. It drives every RM figure on this page
const customRate = ref<number | null>(null)
const rateUsed = computed(() => (customRate.value && customRate.value > 0 ? customRate.value : rate.value))
const rateIn = computed<number | null>({ get: () => rateUsed.value || null, set: (v) => { customRate.value = v && v > 0 && v !== rate.value ? v : null } })
const roundRate = () => { rateIn.value = Math.ceil(rateUsed.value * 1000 - 1e-9) / 1000 }      // 0.026465 -> 0.027
const car = ref<any>(null), features = ref<any[]>([]), loading = ref(true), err = ref(''), pi = ref(0)
const left = (iso: string) => timeLeft(iso, now.value).label
const closes = (iso: string) => closesInfo(iso, now.value).text
const chipCls = (iso: string) => { const c = closesInfo(iso, now.value).cls; return c === 'late' || c === 'soon' ? 'warn' : c === 'unknown' || c === 'closed' ? '' : 'ac' }
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
const bodyJpy = ref(0), baseDuty = ref<number | null>(null), ageMonths = ref<number | null>(null), marketMyr = ref<number | null>(null), priceBasis = ref(''), costMsg = ref('')
const docket = ref<Docket | null>(null), decisionNote = ref(''), pickOpen = ref(false), pickSearch = ref(''), busy = ref(false), dMsg = ref('')
const apPort = ref(0), apInland = ref(0), recBid = ref<{ price_jpy: number; sales: number; basis: string } | null>(null)
const apFeeRpc = ref(0)
const fees = computed(() => (isStaff.value ? board.fees.value : { ...board.fees.value, portMyr: apPort.value, inlandMyr: apInland.value, apFeeMyr: apFeeRpc.value }))
// port clearance, inland transfer and AP fee (RM): start from the AP holder's own default (or the team's), can be changed here and saved
const portIn = ref<number>(0), inlandIn = ref<number>(0), apFeeIn = ref<number>(0)
const feeBusy = ref(false), feeMsg = ref(''), feeOk = ref(false)
const baseFees = computed(() => fees.value)
const feesChanged = computed(() => Number(portIn.value || 0) !== baseFees.value.portMyr || Number(inlandIn.value || 0) !== baseFees.value.inlandMyr || Number(apFeeIn.value || 0) !== baseFees.value.apFeeMyr)
function resetFees() { portIn.value = baseFees.value.portMyr; inlandIn.value = baseFees.value.inlandMyr; apFeeIn.value = baseFees.value.apFeeMyr; feeMsg.value = '' }
async function saveFees() {
  feeBusy.value = true; feeMsg.value = ''
  const v = { port: Number(portIn.value || 0), inland: Number(inlandIn.value || 0), ap: Number(apFeeIn.value || 0) }
  const { error } = await db.rpc('save_my_import_fees', { p_port: v.port, p_inland: v.inland, p_ap_fee: v.ap })
  feeOk.value = !error; feeMsg.value = error ? error.message : 'Saved. These are now your starting figures on every car and in the calculator.'
  if (!error) { apPort.value = v.port; apInland.value = v.inland; apFeeRpc.value = v.ap }
  feeBusy.value = false
}
const amt = (n: number | null | undefined) => (n == null ? '–' : Math.abs(Math.round(n)).toLocaleString('en-US'))      // the number alone: the RM sits in its own column so every line lines up
// Customs duty with a typed rate: the docket (yen) is converted at the rate, loaded and added to the standard fare, so the duty is NOT in proportion to the rate.
// Worked out at the live rate and at the typed rate with the same rules as the calculator, for the vehicle type whose live duty is closest to the saved one.
const dutyRef = ref<{ rates: DutyRate[]; currencies: any[] } | null>(null)
vueWatch(customRate, async (v) => {
  if (!v || dutyRef.value) return
  try { const { data } = await db.rpc('car_duty_reference'); if (data) dutyRef.value = { rates: (data.rates || []).map((r: any) => ({ ...r, multiplier: Number(r.multiplier) })), currencies: data.currencies || [] } } catch { /* the duty then stays at the live rate */ }
})
const dutyMyr = computed(() => {
  const base = baseDuty.value, d = docket.value, c = car.value, ref = dutyRef.value
  if (base == null || !customRate.value || !(rate.value > 0) || !d || !c || !ref || (d.currency_code && d.currency_code !== 'JPY')) return base
  const age = ageMonths.value, t = new Date().getFullYear() * 12 + new Date().getMonth() - Number(age)
  const year = age != null ? Math.floor(t / 12) : c.first_reg_year || c.mfg_year, month = age != null ? (t % 12) + 1 : c.mfg_month || c.first_reg_month
  if (!year || !month) return base
  const standardFare = ref.currencies.find((x: any) => x.code === (d.currency_code || 'JPY'))?.standard_fare_myr ?? undefined
  const at = (r: number, vehicleType: 'car' | 'non_car') => calcDuty({ docket: d, mfgYear: year, mfgMonth: month, rate: r, rates: ref.rates, standardFare, vehicleType, cc: d.cc ? undefined : c.engine_cc || undefined }).dutyMyr
  const types = (['car', 'non_car'] as const).map((t) => ({ live: at(rate.value, t), typed: at(customRate.value!, t) })).filter((x) => x.live != null && x.typed != null)
  if (!types.length) return base
  return types.sort((a, b) => Math.abs(a.live! - base) - Math.abs(b.live! - base))[0]!.typed
})
const rmf = (n: number | null | undefined) => (n == null ? '–' : (n < 0 ? '-RM ' : 'RM ') + Math.abs(Math.round(n)).toLocaleString('en-US'))
const pricing = computed(() => offerPricing({ historyJpy: bodyJpy.value || null, rate: rateUsed.value, dutyMyr: dutyMyr.value, portMyr: Number(portIn.value || 0), inlandMyr: Number(inlandIn.value || 0), apFeeMyr: Number(apFeeIn.value || 0) }))
// the estimate shown by the start price: at the recommended bid (the same figure as the cars page card), else at the price in the box
const estTop = computed(() => {
  if (!hasTier('member') || dutyMyr.value == null) return null
  const jpy = recBid.value?.price_jpy || bodyJpy.value
  if (!(jpy > 0)) return null
  return offerPricing({ historyJpy: jpy, rate: rateUsed.value, dutyMyr: dutyMyr.value, portMyr: Number(portIn.value || 0), inlandMyr: Number(inlandIn.value || 0), apFeeMyr: Number(apFeeIn.value || 0) }).importMyr
})
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
    baseDuty.value = l?.dutyMyr ?? null
    if (!isStaff.value) {
      // a dealer sees the docket and the duty, port and inland lines on their own (the report shows them too)
      const bd = await db.rpc('ap_lot_breakdown', { p_lot_id: lot.id })
      if (!bd.error && bd.data) { baseDuty.value = Number(bd.data.duty_myr); ageMonths.value = bd.data.age_months != null ? Number(bd.data.age_months) : null; apPort.value = Number(bd.data.port_myr); apInland.value = Number(bd.data.inland_myr); apFeeRpc.value = Number(bd.data.ap_fee_myr); if (bd.data.docket) docket.value = { ...bd.data.docket, amt_12m_24m: num(bd.data.docket.amt_12m_24m), amt_24m_36m: num(bd.data.docket.amt_24m_36m), amt_36m_48m: num(bd.data.docket.amt_36m_48m), amt_48m_60m: num(bd.data.docket.amt_48m_60m), amt_60m_plus: num(bd.data.docket.amt_60m_plus) }; decisionNote.value = '' }
    }
    marketMyr.value = l?.market ? (sellFromRow(l.market.row, l.market.wider).sellMyr || null) : null
    const hist = l?.history?.price, rec = recBid.value?.price_jpy
    bodyJpy.value = rec || hist || (lot.start_price_jpy > 0 ? lot.start_price_jpy : 0)
    priceBasis.value = rec ? '(the recommended bid; change it to try another price)' : hist ? '(usual winning price of this car)' : lot.start_price_jpy > 0 ? '(starting price)' : '(type the price you expect)'
    if (baseDuty.value == null && !isStaff.value) costMsg.value = 'The import cost of this car is not worked out yet. Our team is checking its customs docket.'
    if (isStaff.value) {
      const r = await refs.load()
      const { data: dec } = await db.from('lot_docket_decisions').select('*').eq('lot_id', lot.id).maybeSingle()
      docket.value = dec?.docket_id ? r.dockets.find((d) => d.id === dec.docket_id) || null : null
      decisionNote.value = dec ? (dec.reason || dec.status) : 'no decision yet'
    }
  } catch (e: any) { costMsg.value = e.message }
  resetFees()
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
    if (cost) { const { error: le } = await db.from('lot_costs').upsert({ lot_id: lot.id, ...cost, updated_at: new Date().toISOString() }, { onConflict: 'lot_id' }); if (le) throw le; baseDuty.value = cost.duty_myr } else { await db.from('lot_costs').delete().eq('lot_id', lot.id); baseDuty.value = null }
    docket.value = d; decisionNote.value = 'changed by staff'; pickOpen.value = false
    dMsg.value = cost ? `Docket changed. Duty is now ${rmf(cost.duty_myr)}. Remembered for the same car next time.` : 'Docket changed, but duty could not be worked out (register date or exchange rate missing).'
    board.loaded.value = false
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}

onMounted(async () => {
  useViewed().mark(route.params.id as string)      // cars page: the title of a car already opened turns accent
  try {
    await Promise.all([loadRate().catch(() => {}), watch.load().catch(() => {}), recs.load().catch(() => {})])
    const { data, error } = await db.from('lots').select('*').eq('id', route.params.id as string).eq('my_eligible', true).maybeSingle()
    if (error) throw error
    car.value = data
    if (data) await loadBid(data).catch(() => {})
    if (data && hasTier('member')) loadCost(data)
    if (data) { const f = await db.from('lot_features').select('key,label,source,evidence').eq('lot_id', data.id); features.value = f.data || [] }
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.review { border-color: var(--warn); background: var(--warnbg); color: var(--warn); } .review .small { margin-top: 4px; }
.toprow { display: flex; justify-content: space-between; align-items: stretch; gap: 12px; } .toprow > div:first-child { min-width: 0; } .estb { flex: none; }
.spec.bk td:first-child { width: auto; white-space: nowrap; } .spec.bk td.r { width: 1%; white-space: nowrap; }
.two > div { min-width: 0; }
@media (max-width: 560px) {
  .spec.bk td:first-child { white-space: normal; }
  .toprow { flex-wrap: wrap; } .price { font-size: 24px; }
  .estb { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; }
  .ratebar { flex-wrap: wrap; } .inbox.wide.grow { flex: 1 1 100%; } .ratebar .btn { width: 100%; }
  .feebar { flex-direction: column; align-items: stretch; } .feeacts { justify-content: flex-end; }
}
.gicon { width: 15px; height: 15px; flex: none; }
.yn { margin-left: 8px; font-size: 12.5px; color: var(--mu2); }
.rmsmall { font-size: 14px; font-weight: 500; }
.estb { display: flex; flex-direction: column; justify-content: center; align-items: flex-end; gap: 1px; background: var(--acbg); color: var(--ac2); border-radius: 12px; padding: 6px 12px; line-height: 1.25; } .estb span { font-size: 11.5px; font-weight: 600; } .estb b { font-size: 17px; }
.actrow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; } .actrow .btn { padding-left: 10px; padding-right: 10px; white-space: nowrap; }
@media (min-width: 520px) { .actrow { flex-wrap: nowrap; } }
.ratebar { display: flex; align-items: center; gap: 8px; margin: 8px 0 4px; } .ratebar .btn { flex: none; white-space: nowrap; width: 150px; justify-content: center; text-align: center; }
.inbox.wide { display: block; width: 100%; margin-top: 4px; } .inbox.wide.grow { flex: 1; min-width: 0; margin-top: 0; }
.inbox.wide .fee { height: 38px; text-align: left; padding-left: 30px; } .inbox.wide .rateinp { padding-left: 160px; } .inbox.wide .sy { font-size: 13px; }
.cell { display: inline-flex; justify-content: space-between; align-items: center; width: 130px; padding: 0 9px; box-sizing: border-box; white-space: nowrap; } .cell .sy { color: var(--mu); }
.cell.b, .cell.b .sy { font-weight: 800; color: inherit; }
.inbox { position: relative; display: inline-block; width: 130px; } .inbox .sy { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--mu); pointer-events: none; z-index: 1; }
.inbox .fee { width: 100%; box-sizing: border-box; padding: 0 9px 0 34px; }
.fee { width: 110px; height: 34px; text-align: right; padding: 0 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--s2); color: var(--tx); font: inherit; }
.feebar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; } .feeacts { display: inline-flex; gap: 8px; }
.two { grid-template-columns: 1.15fr 1fr; align-items: start; }
.hero { aspect-ratio: 4 / 3; background: var(--s2); border-radius: 10px; overflow: hidden; display: grid; place-items: center; }
.hero img { width: 100%; height: 100%; object-fit: contain; background: #0b0b0d; }
.thumbs { display: flex; gap: 6px; overflow-x: auto; margin-top: 8px; padding-bottom: 2px; }
.thumbs img { width: 72px; height: 54px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; flex: none; }
.thumbs img.on { border-color: var(--ac); }
.starred { color: var(--ac); border-color: var(--ac); }
.btn:has(.staricon) { display: inline-flex; align-items: center; gap: 6px; }
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

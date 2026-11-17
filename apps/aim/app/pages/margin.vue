<template>
  <div>
    <h1>Margin analysis</h1>
    <div v-if="err" class="err">{{ err }}</div>
    <div v-if="loading" class="muted">Loading ...</div>

    <!-- ONE CAR: what a bid earns -->
    <template v-else-if="car">
      <p class="sub"><NuxtLink to="/today" class="ac">← Today for you</NuxtLink> · {{ car.brand }} {{ car.model }} · {{ [car.grade, car.mfg_year, car.mileage_km != null ? car.mileage_km.toLocaleString('en-US') + ' km' : null].filter(Boolean).join(' · ') }}</p>

      <div v-if="!ev.market" class="card muted">No market price yet for this car ({{ car.level === 'none' ? 'it is not linked to the catalog' : 'CarzNexus has no linked listing for it' }}). Nothing to compare against, so no margin is shown.</div>
      <div v-else-if="car.dutyMyr == null" class="card muted">No docket is used for this car yet (see Docket review), so the duty and the margin are unknown.</div>
      <div v-else class="grid two">
        <div class="card">
          <div class="row"><h2>If you win at</h2><b class="big">{{ yen(bid) }}</b></div>
          <input v-model.number="bid" type="range" :min="0" :max="sliderMax" :step="5000" style="width: 100%; margin: 10px 0" />
          <div class="row wrap" style="gap: 6px; margin-bottom: 10px">
            <button class="btn ghost sm" @click="bid = ev.maxBid || 0">Max bid {{ yen(ev.maxBid || 0) }}</button>
            <button v-if="car.history" class="btn ghost sm" @click="bid = car.history.price">Usual price {{ yen(car.history.price) }}</button>
            <button v-if="car.start_price_jpy" class="btn ghost sm" @click="bid = car.start_price_jpy">Start {{ yen(car.start_price_jpy) }}</button>
          </div>
          <table class="t">
            <tr><td>Car at auction</td><td>RM {{ myr(p.bodyMyr) }}</td></tr>
            <tr><td>Agent fee & shipping</td><td>RM {{ myr(p.agentMyr) }}</td></tr>
            <tr v-if="isStaff"><td>Duty (docket)</td><td>RM {{ myr(car.dutyMyr) }}</td></tr>
            <tr v-if="isStaff"><td>Port, inland, AP fee</td><td>RM {{ myr(fees.portMyr + fees.inlandMyr + apFeeMyr) }}</td></tr>
            <tr v-if="!isStaff"><td>Duty, port clearance & inland transfer</td><td>RM {{ myr(car.dutyMyr) }}</td></tr>
            <tr v-if="!isStaff"><td>Your AP fee</td><td>RM {{ myr(apFeeMyr) }}</td></tr>
            <tr class="sum"><td>Landed cost</td><td>RM {{ myr(m.landedMyr) }}</td></tr>
            <tr><td>Recon / prep</td><td>RM {{ myr(reconMyr) }}</td></tr>
            <tr><td>Sell price (cautious)</td><td>RM {{ myr(ev.sellMyr!) }}</td></tr>
            <tr class="sum"><td>Profit</td><td :class="m.profitMyr >= 0 ? 'up' : 'down'">RM {{ myr(m.profitMyr) }}</td></tr>
            <tr class="sum"><td>Margin on cost</td><td :class="m.marginPct >= targetPct ? 'up' : 'down'">{{ m.marginPct }}%</td></tr>
          </table>
          <div class="row wrap" style="gap: 14px; margin-top: 12px">
            <label class="fld">Target margin %<input v-model.number="targetPct" type="number" min="0" max="60" /></label>
            <label class="fld">Recon (RM)<input v-model.number="reconMyr" type="number" min="0" step="500" /></label>
            <label class="fld">AP fee (RM)<input v-model.number="apFeeMyr" type="number" min="0" step="500" /></label>
          </div>
        </div>

        <div class="card">
          <h2>Malaysian market</h2>
          <div class="muted small" style="margin-bottom: 12px">{{ ev.market.row.n }} CarzNexus listing{{ ev.market.row.n === 1 ? '' : 's' }} from {{ ev.market.row.sellers }} dealer{{ ev.market.row.sellers === 1 ? '' : 's' }}, years {{ ev.market.row.year_from }}–{{ ev.market.row.year_to }}, asking prices{{ marketAsOf ? ' as of ' + marketAsOf : '' }}.</div>
          <div class="bar">
            <div class="rng" :style="{ left: pos(ev.market.row.p25_myr) + '%', width: pos(ev.market.row.p75_myr) - pos(ev.market.row.p25_myr) + '%' }" />
            <div class="whisk" :style="{ left: pos(ev.market.row.min_myr) + '%', width: pos(ev.market.row.max_myr) - pos(ev.market.row.min_myr) + '%' }" />
            <div class="mk med" :style="{ left: pos(ev.market.row.median_myr) + '%' }"><i>median</i></div>
            <div class="mk sell" :style="{ left: pos(ev.sellMyr!) + '%' }"><i>sell</i></div>
          </div>
          <div class="row small muted" style="margin-top: 6px"><span>RM {{ myr(ev.market.row.min_myr) }}</span><span>RM {{ myr(ev.market.row.max_myr) }}</span></div>
          <table class="t" style="margin-top: 12px">
            <tr><td>Middle half of listings</td><td>RM {{ myr(ev.market.row.p25_myr) }} – {{ myr(ev.market.row.p75_myr) }}</td></tr>
            <tr><td>Median</td><td>RM {{ myr(ev.market.row.median_myr) }}</td></tr>
            <tr><td>Average mileage</td><td>{{ ev.market.row.avg_km != null ? ev.market.row.avg_km.toLocaleString('en-US') + ' km' : '—' }}</td></tr>
            <tr><td>Confidence</td><td><span class="chip" :class="ev.confidence === 'high' ? 'ok' : ev.confidence === 'medium' ? 'warn' : ''">{{ ev.confidence }}</span></td></tr>
          </table>
          <p v-if="ev.market.wider" class="chip warn" style="margin-top: 10px">Model price · wider range: no listing is linked to this exact variant yet.</p>
          <p class="muted small" style="margin-top: 10px">The sell price is cautious: the median, pulled towards the lower quartile unless the range is tight. Asking prices run above what cars finally sell for.</p>
        </div>
      </div>
    </template>

    <!-- NO CAR: the market table -->
    <template v-else>
      <p class="sub">What CarzNexus dealers ask in Malaysia, by catalog variant. Open a car from Today for you to see its margin.</p>
      <div v-if="!marketRows.length" class="card muted">No market prices yet. They appear once CarzNexus has linked its listings and the snapshot has been run.</div>
      <div v-else class="card" style="overflow-x: auto">
        <table class="t wide">
          <thead><tr><th>Car</th><th>Years</th><th>Listings</th><th>Dealers</th><th>Middle half (RM)</th><th>Median (RM)</th><th>Confidence</th></tr></thead>
          <tr v-for="r in table" :key="r.level + r.ref_id + r.year_from">
            <td>{{ r.brand }} {{ r.model_key }}<span v-if="r.variant_name"> · {{ r.variant_name }}</span><span v-else class="chip" style="margin-left: 6px">all variants</span></td>
            <td>{{ r.year_from + 1 }}</td><td>{{ r.n }}</td><td>{{ r.sellers }}</td>
            <td>{{ myr(r.p25_myr) }} – {{ myr(r.p75_myr) }}</td><td>{{ myr(r.median_myr) }}</td>
            <td><span class="chip" :class="conf(r) === 'high' ? 'ok' : conf(r) === 'medium' ? 'warn' : ''">{{ conf(r) }}</span></td>
          </tr>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { offerPricing, marginAtBid, sellFromRow } from '@aim/core'

const route = useRoute()
const { isStaff } = useAuth()
const { load, lots, rate, fees, evaluate, marketRows, marketAsOf } = useMarginBoard()
const targetPct = ref(12), reconMyr = ref(3000), apFeeMyr = ref(10500), loading = ref(true), err = ref(''), bid = ref(0)
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('en-US')
const myr = (n: number) => Math.round(n).toLocaleString('en-US')

const car = computed(() => lots.value.find((l) => l.id === route.query.lot) || null)
const ev = computed(() => evaluate(car.value!, { targetPct: targetPct.value || 0, reconMyr: reconMyr.value || 0, apFeeMyr: apFeeMyr.value || 0 }))
const p = computed(() => offerPricing({ historyJpy: bid.value || 0, rate: rate.value, dutyMyr: car.value?.dutyMyr ?? 0, portMyr: fees.value.portMyr, inlandMyr: fees.value.inlandMyr, apFeeMyr: apFeeMyr.value || 0 }))
const m = computed(() => marginAtBid({ bodyJpy: bid.value || 0, sellMyr: ev.value.sellMyr || 0, rate: rate.value, dutyMyr: car.value?.dutyMyr ?? 0, reconMyr: reconMyr.value || 0, portMyr: fees.value.portMyr, inlandMyr: fees.value.inlandMyr, apFeeMyr: apFeeMyr.value || 0 })!)
const sliderMax = computed(() => Math.max(2_000_000, Math.ceil(((ev.value.maxBid || 0) * 1.6) / 100000) * 100000))

// the range bar: min..max of the market row, with a little margin either side
const span = computed(() => { const r = ev.value.market?.row; if (!r) return { lo: 0, hi: 1 }; const pad = (r.max_myr - r.min_myr) * 0.08 || r.median_myr * 0.05; return { lo: Math.min(r.min_myr, ev.value.sellMyr || r.min_myr) - pad, hi: r.max_myr + pad } })
const pos = (v: number) => Math.max(0, Math.min(100, ((v - span.value.lo) / (span.value.hi - span.value.lo)) * 100))

const conf = (r: any) => sellFromRow(r, r.level === 'model').confidence
const table = computed(() => [...marketRows.value].sort((a, b) => (a.brand + a.model_key + (a.variant_name || '')).localeCompare(b.brand + b.model_key + (b.variant_name || '')) || b.year_from - a.year_from).slice(0, 300))

watch(() => [car.value?.id, rate.value], () => { if (car.value) bid.value = ev.value.maxBid || car.value.history?.price || car.value.start_price_jpy || 0 })
onMounted(async () => {
  try { await load(); apFeeMyr.value = fees.value.apFeeMyr } catch (e: any) { err.value = e.message } finally { loading.value = false }
  if (car.value) bid.value = ev.value.maxBid || car.value.history?.price || car.value.start_price_jpy || 0
})
</script>

<style scoped>
.two { grid-template-columns: 1fr 1fr; align-items: start; }
.big { font-size: 22px; color: var(--ac2); }
.fld { display: flex; flex-direction: column; gap: 4px; color: var(--mu); font-size: 12px; } .fld input { width: 120px; }
.t { width: 100%; border-collapse: collapse; } .t td, .t th { padding: 7px 4px; border-bottom: 1px solid var(--line); text-align: left; }
.t td:last-child { text-align: right; } .t.wide td:last-child { text-align: left; } .t th { color: var(--mu); font-weight: 500; font-size: 12px; }
.t .sum td { font-weight: 700; }
.bar { position: relative; height: 46px; background: var(--s2); border-radius: 10px; margin-top: 18px; }
.rng { position: absolute; top: 14px; height: 18px; background: var(--acbg); border: 1px solid var(--ac); border-radius: 6px; }
.whisk { position: absolute; top: 22px; height: 2px; background: var(--mu2); }
.mk { position: absolute; top: 6px; width: 2px; height: 34px; } .mk i { position: absolute; top: -16px; left: -16px; font-size: 10px; font-style: normal; color: var(--mu); width: 34px; text-align: center; }
.mk.med { background: var(--tx); } .mk.sell { background: var(--ok); } .mk.sell i { color: var(--ok); top: 40px; }
@media (max-width: 860px) { .two { grid-template-columns: 1fr; } }
</style>

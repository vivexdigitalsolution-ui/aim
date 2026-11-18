<template>
  <div>
    <h1>Import calculator</h1>
    <p class="sub">Work out what a Japan car costs landed in Malaysia, or the highest price you can pay for a target margin. Customs docket, duty, agent fee, port, inland and AP fee are added for you.</p>

    <div v-if="status && !status.allowed" class="card" style="border-color: var(--ac)">
      <b>{{ status.reason || 'You have used your calculation.' }}</b>
      <p class="muted small" style="margin-top: 6px">{{ limitText }} <NuxtLink to="/upgrade" class="ac">See the plans</NuxtLink></p>
    </div>
    <div v-if="err" class="err" style="margin-bottom: 10px">{{ err }}</div>
    <div v-if="loading" class="muted">Loading the customs list ...</div>

    <div v-else-if="status?.allowed" class="grid two">
      <div class="card">
        <h2>1. The car</h2>
        <label class="f">Search the customs docket (make, model or code)
          <input v-model="search" placeholder="e.g. ALPHARD 3BA-AGH40W" />
        </label>
        <div v-if="!docket" class="list">
          <button v-for="d in matches" :key="d.id" class="opt" @click="pick(d)"><b>{{ d.brand }} · {{ d.model }}</b><span class="muted small">{{ d.cc ? d.cc + ' cc' : '' }}</span></button>
          <p v-if="search.trim().length > 1 && !matches.length" class="muted small">No docket found. Try fewer words.</p>
        </div>
        <div v-else class="picked">
          <div><b>{{ docket.brand }} {{ docket.model }}</b><div class="muted small">{{ docket.cc ? docket.cc + ' cc' : '' }} · guide edition {{ docket.year }}</div></div>
          <button class="btn ghost sm" @click="docket = null; result = null">Change</button>
        </div>
        <div class="two2">
          <label class="f">First registered (year)<input v-model.number="year" type="number" :min="2000" :max="thisYear" /></label>
          <label class="f">Month<select v-model.number="month"><option v-for="m in 12" :key="m" :value="m">{{ m }}</option></select></label>
        </div>
        <label class="f">Type
          <select v-model="vtype"><option value="car">Saloon (sedan, hatchback, coupe)</option><option value="non_car">Non-saloon (MPV, SUV, pick-up, van)</option></select>
        </label>

        <h2 style="margin-top: 16px">2. What do you know?</h2>
        <div class="seg"><button :class="{ on: mode === 'landed' }" @click="mode = 'landed'; result = null">I know the car price</button><button :class="{ on: mode === 'maxbid' }" @click="mode = 'maxbid'; result = null">I know the selling price</button></div>
        <label v-if="mode === 'landed'" class="f">Car price at auction (¥)<input v-model.number="bodyJpy" type="number" step="10000" min="0" /></label>
        <template v-else>
          <label class="f">Selling price in Malaysia (RM)<input v-model.number="sellMyr" type="number" step="1000" min="0" /></label>
          <label class="f">Margin you want (%)<input v-model.number="targetPct" type="number" min="0" max="60" /></label>
        </template>
        <label v-if="mode === 'landed'" class="f">Selling price in Malaysia (RM, optional, to see your margin)<input v-model.number="sellMyr" type="number" step="1000" min="0" /></label>

        <details style="margin-top: 10px">
          <summary class="small ac" style="cursor: pointer">Rate and fees (change if yours differ)</summary>
          <div class="two2">
            <label class="f">¥1 = RM<input v-model.number="rate" type="number" step="0.0001" min="0" /></label>
            <label class="f">AP fee (RM)<input v-model.number="apFee" type="number" step="500" min="0" /></label>
            <label class="f">Port clearance (RM)<input v-model.number="port" type="number" step="100" min="0" /></label>
            <label class="f">Inland transfer (RM)<input v-model.number="inland" type="number" step="50" min="0" /></label>
            <label class="f">Recon / prep (RM)<input v-model.number="recon" type="number" step="500" min="0" /></label>
          </div>
        </details>

        <button class="btn" style="margin-top: 14px" :disabled="busy || !docket || !year || (mode === 'landed' ? !bodyJpy : !sellMyr)" @click="calculate">{{ busy ? 'Working ...' : 'Calculate' }}</button>
        <p v-if="status.left != null" class="muted small" style="margin-top: 8px">{{ status.left }} calculation{{ status.left === 1 ? '' : 's' }} left on your plan.</p>
      </div>

      <div class="card">
        <h2>Result</h2>
        <div v-if="!result" class="muted">Fill in the car and press Calculate.</div>
        <template v-else>
          <div v-for="w in result.warnings" :key="w" class="warnbox" style="margin-bottom: 8px">{{ w }}</div>
          <div v-if="result.maxBid != null" class="big">Highest price to pay: <b>¥{{ result.maxBid.toLocaleString('en-US') }}</b><small class="muted"> (RM {{ myr(result.maxBid * rate) }}, in ¥5,000 steps)</small></div>
          <table class="spec">
            <tr><td>Car price</td><td class="r">¥{{ result.bodyJpy.toLocaleString('en-US') }} · RM {{ myr(result.p.bodyMyr) }}</td></tr>
            <tr><td>Agent fee &amp; shipping</td><td class="r">¥{{ (result.p.agentJpy || 0).toLocaleString('en-US') }} · RM {{ myr(result.p.agentMyr) }}</td></tr>
            <tr><td>Customs value (docket ¥{{ (result.duty.docketAmountForeign || 0).toLocaleString('en-US') }}, {{ result.duty.band }})</td><td class="r">RM {{ myr(result.duty.customsValueMyr) }}</td></tr>
            <tr><td>Customs duty (× {{ result.duty.multiplier }})</td><td class="r">RM {{ myr(result.duty.dutyMyr) }}</td></tr>
            <tr><td>Port clearance + inland</td><td class="r">RM {{ myr(port + inland) }}</td></tr>
            <tr><td>AP fee</td><td class="r">RM {{ myr(apFee) }}</td></tr>
            <tr class="sum"><td><b>Landed price</b></td><td class="r"><b>RM {{ myr(result.p.importMyr) }}</b></td></tr>
            <tr v-if="recon"><td>Recon / prep</td><td class="r">RM {{ myr(recon) }}</td></tr>
            <tr v-if="result.m"><td><b>Profit</b></td><td class="r" :class="result.m.profitMyr >= 0 ? 'up' : 'down'"><b>RM {{ myr(result.m.profitMyr) }} · {{ result.m.marginPct }}%</b></td></tr>
          </table>
          <p class="muted small" style="margin-top: 8px">An estimate. Duty follows the Customs docket for the car's age; the real figure is set by Customs.</p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { calcDuty, offerPricing, marginAtBid, maxBidJpy, docketBrand, type Docket, type DutyRate } from '@aim/core'

const db = useDb()
const thisYear = new Date().getFullYear()
const loading = ref(true), busy = ref(false), err = ref('')
const status = ref<any>(null)
const ref_ = ref<{ dockets: Docket[]; rates: DutyRate[]; currencies: any[] } | null>(null)
const search = ref(''), docket = ref<Docket | null>(null)
const year = ref<number>(thisYear - 3), month = ref(6), vtype = ref<'car' | 'non_car'>('car')
const mode = ref<'landed' | 'maxbid'>('landed')
const bodyJpy = ref(0), sellMyr = ref(0), targetPct = ref(12)
const rate = ref(0), apFee = ref(10500), port = ref(2500), inland = ref(250), recon = ref(3000)
const result = ref<any>(null)
const myr = (n: number | null | undefined) => (n == null ? '–' : Math.round(n).toLocaleString('en-US'))
const limitText = computed(() => status.value?.period === 'once' ? 'The Free plan includes one calculation.' : status.value?.period ? `Your plan includes ${status.value.uses} calculation(s) per ${status.value.period}.` : '')

const matches = computed<Docket[]>(() => {
  const words = search.value.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (!ref_.value || !words.length || words.join('').length < 2) return []
  return ref_.value.dockets.filter((d) => !d.currency_code || d.currency_code === 'JPY').filter((d) => {
    const hay = (docketBrand(d.brand) + ' ' + d.brand + ' ' + d.model).toUpperCase()
    return words.every((w) => hay.includes(w))
  }).slice(0, 30)
})
function pick(d: Docket) { docket.value = d; result.value = null }

onMounted(async () => {
  try {
    const st = await db.rpc('calculator_status')
    if (st.error) throw st.error
    status.value = st.data
    if (!st.data?.allowed) return
    const { data, error } = await db.rpc('calculator_reference')
    if (error) throw error
    ref_.value = { dockets: (data.dockets || []).map((d: any) => ({ ...d, amt_12m_24m: n(d.amt_12m_24m), amt_24m_36m: n(d.amt_24m_36m), amt_36m_48m: n(d.amt_36m_48m), amt_48m_60m: n(d.amt_48m_60m), amt_60m_plus: n(d.amt_60m_plus) })), rates: (data.rates || []).map((r: any) => ({ ...r, multiplier: Number(r.multiplier) })), currencies: data.currencies || [] }
    rate.value = Number(data.jpy_rate) || 0; port.value = Number(data.port_myr); inland.value = Number(data.inland_myr); apFee.value = Number(data.ap_fee_myr)
  } catch (e: any) { err.value = /calculator_limit/.test(e.message) ? 'Your plan has no calculations left.' : e.message } finally { loading.value = false }
})
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

async function calculate() {
  err.value = ''; busy.value = true
  try {
    const d = docket.value!
    if (!(rate.value > 0)) throw new Error('Type the exchange rate (¥1 = RM ...) under "Rate and fees".')
    const used = await db.rpc('calculator_use', { p_input: { docket: d.id, year: year.value, month: month.value, mode: mode.value } })
    if (used.error) throw new Error(/calculator_limit/.test(used.error.message) ? 'Your plan has no calculations left.' : used.error.message)
    status.value = used.data
    const standardFare = ref_.value!.currencies.find((c: any) => c.code === (d.currency_code || 'JPY'))?.standard_fare_myr ?? undefined
    const duty = calcDuty({ docket: d, mfgYear: year.value, mfgMonth: month.value, rate: rate.value, rates: ref_.value!.rates, standardFare, vehicleType: vtype.value })
    const costs = { rate: rate.value, dutyMyr: duty.dutyMyr || 0, reconMyr: recon.value || 0, portMyr: port.value, inlandMyr: inland.value, apFeeMyr: apFee.value }
    let body = bodyJpy.value, maxBid: number | null = null
    if (mode.value === 'maxbid') { maxBid = maxBidJpy({ sellMyr: sellMyr.value, targetPct: targetPct.value || 0, ...costs }); body = maxBid }
    const p = offerPricing({ historyJpy: body || null, rate: rate.value, dutyMyr: duty.dutyMyr, portMyr: port.value, inlandMyr: inland.value, apFeeMyr: apFee.value })
    const m = sellMyr.value > 0 && body ? marginAtBid({ bodyJpy: body, sellMyr: sellMyr.value, ...costs }) : null
    const warnings = [...duty.warnings]
    if (mode.value === 'maxbid' && !maxBid) warnings.push('Even a ¥0 price cannot reach that margin: duty and fees alone are too high for this selling price.')
    result.value = { duty, p, m, bodyJpy: body || 0, maxBid: mode.value === 'maxbid' ? maxBid : null, warnings }
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
</script>

<style scoped>
.two { grid-template-columns: 1fr 1fr; align-items: start; }
.two2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.list { display: grid; gap: 6px; max-height: 260px; overflow: auto; margin: 8px 0; }
.opt { display: flex; justify-content: space-between; gap: 10px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; cursor: pointer; text-align: left; color: inherit; }
.opt:hover { border-color: var(--ac); }
.picked { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--s2); border: 1px solid var(--ac); border-radius: 10px; padding: 10px 12px; margin: 8px 0; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin: 8px 0; }
.seg button { background: transparent; border: 0; color: inherit; padding: 8px 14px; cursor: pointer; }
.seg button.on { background: var(--ac); color: #000; font-weight: 700; }
.spec { width: 100%; border-collapse: collapse; margin-top: 10px; } .spec td { padding: 7px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); }
.r { text-align: right; } .sum td { border-top: 2px solid var(--line); color: inherit !important; } .up { color: #3ecf8e; } .down { color: #ff6b6b; }
.big { font-size: 18px; margin-bottom: 6px; }
.warnbox { background: rgba(255, 170, 0, .12); border: 1px solid rgba(255, 170, 0, .4); border-radius: 8px; padding: 8px 10px; }
@media (max-width: 860px) { .two { grid-template-columns: 1fr; } }
</style>

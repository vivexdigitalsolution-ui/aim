<template>
  <div>
    <div v-if="err" class="muted small">{{ err }}</div>
    <div v-else-if="!ref_" class="muted small">Loading the customs list ...</div>
    <template v-else>
      <label class="f" style="margin-top: 8px">Car price (¥)<NumInput v-model="price" :disabled="lockPrice" /></label>
      <div v-if="priceNote" class="muted small" style="margin-top: 4px">{{ priceNote }}</div>

      <div class="dk">
        <div class="muted small">Customs docket (Customs price guide)</div>
        <div v-if="docket && !picking" class="picked">
          <div><b>{{ docket.model }}</b> <span class="muted small">{{ docket.cc ? docket.cc + ' cc' : '' }} · edition {{ docket.year }}</span>
            <div v-if="line?.jpy != null" class="muted small">Customs value ¥{{ line.jpy.toLocaleString('en-US') }} for this age of car</div></div>
          <button class="btn ghost sm" type="button" @click="picking = true">Change</button>
        </div>
        <template v-else>
          <input v-model="search" placeholder="Search the docket (name or code)" style="width: 100%; margin-top: 6px" />
          <div class="list">
            <button v-for="d in candidates" :key="d.id" type="button" class="opt" @click="choose(d)"><b>{{ d.model }}</b><span class="muted small">{{ d.cc ? d.cc + ' cc' : '' }}</span></button>
            <p v-if="!candidates.length" class="muted small">No docket found. Try fewer words.</p>
          </div>
          <button v-if="docket" class="btn ghost sm" type="button" @click="picking = false">Keep {{ docket.model }}</button>
        </template>
      </div>

      <label v-if="!knownMonth" class="f">Month first registered (the sheet does not say)
        <select v-model.number="monthPick"><option :value="0">Choose the month</option><option v-for="m in 12" :key="m" :value="m">{{ m }}</option></select>
      </label>
      <div v-for="w in duty?.warnings || []" :key="w" class="warnbox" style="margin-top: 8px">{{ w }}</div>

      <table v-if="pricing.importMyr != null" class="spec">
        <tr><td>Car price</td><td class="r">{{ rmf(pricing.bodyMyr) }}</td></tr>
        <tr><td>Agent fee &amp; shipping</td><td class="r">{{ rmf(pricing.agentMyr) }}</td></tr>
        <tr><td>Customs duty</td><td class="r">{{ rmf(duty?.dutyMyr) }}</td></tr>
        <tr><td>Port clearance</td><td class="r feecell"><span>RM</span><NumInput v-model="port" class="fee" aria-label="Port clearance in RM" /></td></tr>
        <tr><td>Inland transfer</td><td class="r feecell"><span>RM</span><NumInput v-model="inland" class="fee" aria-label="Inland transfer in RM" /></td></tr>
        <tr><td>AP fee</td><td class="r feecell"><span>RM</span><NumInput v-model="apFee" class="fee" aria-label="AP fee in RM" /></td></tr>
        <tr class="sum"><td><b>Import price</b></td><td class="r"><b>{{ rmf(pricing.importMyr) }}</b></td></tr>
      </table>
      <div v-else class="muted small" style="margin-top: 10px">{{ !docket ? 'Choose a docket to see the duty and the import price.' : !price ? 'Type the car price.' : !regMonth ? 'Choose the month first registered.' : 'The duty could not be worked out for this docket.' }}</div>
      <p class="muted small" style="margin-top: 8px">An estimate at ¥1 = RM {{ rate }}. Port, inland and AP fee are yours to change. Recon and prep are not included. The real duty is set by Customs.</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { calcDuty, offerPricing, docketPool, docketBrand, docketLine, type Docket, type DutyRate } from '@aim/core'

// The import price of one car: pick the customs docket, the duty is worked out in the browser. Used for One price cars and for cars with no docket yet.
const props = defineProps<{ car: any; priceJpy: number; priceNote?: string; docketId?: string | null; lockPrice?: boolean }>()
const db = useDb()
const ref_ = ref<{ dockets: Docket[]; rates: DutyRate[]; currencies: any[] } | null>(null)
const err = ref(''), rate = ref(0)
const price = ref<number | null>(props.priceJpy || null)
const docket = ref<Docket | null>(null), picking = ref(false), search = ref(''), monthPick = ref(0)
const port = ref<number | null>(0), inland = ref<number | null>(0), apFee = ref<number | null>(0)
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const rmf = (v: number | null | undefined) => (v == null ? '–' : (v < 0 ? '-RM ' : 'RM ') + Math.abs(Math.round(v)).toLocaleString('en-US'))
const knownMonth = computed<number | null>(() => props.car?.mfg_month || props.car?.first_reg_month || null)
const regMonth = computed<number | null>(() => knownMonth.value || monthPick.value || null)
const regYear = computed<number | null>(() => props.car?.first_reg_year || props.car?.mfg_year || null)
watch(() => props.priceJpy, (v) => { price.value = v || null })

const candidates = computed<Docket[]>(() => {
  const r = ref_.value
  if (!r) return []
  const words = search.value.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (!words.length) { const p = docketPool(r.dockets, props.car).pool; if (p.length) return p.slice(0, 30) }
  const brand = docketBrand(props.car.brand)
  if (!words.length) {                                   // no docket carries the chassis code: list the same model first (NX before LS), then the rest of the make
    const first = String(props.car.model || '').trim().split(/\s+/)[0]!.toUpperCase()
    const same = first ? r.dockets.filter((d) => (!d.currency_code || d.currency_code === 'JPY') && docketBrand(d.brand) === brand && d.model.toUpperCase().startsWith(first)) : []
    if (same.length) return same.slice(0, 30)
  }
  return r.dockets.filter((d) => (!d.currency_code || d.currency_code === 'JPY') && (words.length ? words.every((w) => (docketBrand(d.brand) + ' ' + d.brand + ' ' + d.model).toUpperCase().includes(w)) : docketBrand(d.brand) === brand)).slice(0, 30)
})
function choose(d: Docket) { docket.value = d; picking.value = false; search.value = '' }
const line = computed(() => (docket.value && regYear.value && regMonth.value ? docketLine(docket.value, regYear.value, regMonth.value) : null))
const duty = computed(() => {
  const r = ref_.value, d = docket.value
  if (!r || !d || !regYear.value || !regMonth.value) return null
  const standardFare = r.currencies.find((c: any) => c.code === (d.currency_code || 'JPY'))?.standard_fare_myr ?? undefined
  return calcDuty({ docket: d, mfgYear: regYear.value, mfgMonth: regMonth.value, rate: rate.value, rates: r.rates, standardFare, vehicleType: 'car', cc: d.cc ? undefined : props.car?.engine_cc || undefined })
})
const pricing = computed(() => offerPricing({ historyJpy: price.value || null, rate: rate.value, dutyMyr: duty.value?.dutyMyr ?? null, portMyr: Number(port.value || 0), inlandMyr: Number(inland.value || 0), apFeeMyr: Number(apFee.value || 0) }))

onMounted(async () => {
  try {
    const { data, error } = await db.rpc('car_duty_reference')
    if (error) throw error
    ref_.value = { dockets: (data.dockets || []).map((d: any) => ({ ...d, amt_12m_24m: n(d.amt_12m_24m), amt_24m_36m: n(d.amt_24m_36m), amt_36m_48m: n(d.amt_36m_48m), amt_48m_60m: n(d.amt_48m_60m), amt_60m_plus: n(d.amt_60m_plus) })), rates: (data.rates || []).map((r: any) => ({ ...r, multiplier: Number(r.multiplier) })), currencies: data.currencies || [] }
    rate.value = Number(data.jpy_rate) || 0; port.value = Number(data.port_myr) || 0; inland.value = Number(data.inland_myr) || 0; apFee.value = Number(data.ap_fee_myr) || 0
    const byId = props.docketId ? ref_.value.dockets.find((d) => d.id === props.docketId) : null
    if (byId) docket.value = byId
    else { const p = docketPool(ref_.value.dockets, props.car).pool; if (p.length === 1) docket.value = p[0]!; else picking.value = true }
  } catch (e: any) { err.value = /not allowed|42501/.test(e.message) ? 'The import price is not available for your account.' : /car_duty_reference/.test(e.message) ? 'The import price is not set up yet (database update 47 is missing).' : e.message }
})
</script>

<style scoped>
.dk { margin-top: 12px; }
.picked { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-top: 6px; }
.list { display: grid; gap: 6px; max-height: 240px; overflow: auto; margin: 8px 0; }
.opt { display: flex; justify-content: space-between; gap: 10px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; cursor: pointer; text-align: left; color: inherit; } .opt:hover { border-color: var(--ac); }
.spec { width: 100%; border-collapse: collapse; margin-top: 10px; } .spec td { padding: 7px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); }
.r { text-align: right; white-space: nowrap; padding-left: 10px; } .sum td { border-top: 2px solid var(--line); color: inherit !important; }
.feecell { display: flex; align-items: center; justify-content: flex-end; gap: 6px; } .feecell span { color: var(--mu); } .fee { width: 110px; text-align: right; height: 32px; }
.warnbox { background: rgba(255, 170, 0, .12); border: 1px solid rgba(255, 170, 0, .4); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
</style>

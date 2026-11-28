<template>
  <div>
    <div v-if="err" class="muted small">{{ err }}</div>
    <div v-else-if="!ref_" class="muted small">Loading the customs list ...</div>
    <template v-else>
      <label v-if="isLite" class="f" style="margin-top: 8px">Car price (¥)<NumInput v-model="price" :disabled="lockPrice" /></label>
      <label v-else class="f" style="margin-top: 8px">Car price<span class="inbox wide"><span class="sy">¥</span><NumInput v-model="price" :disabled="lockPrice" class="fee" aria-label="Car price in yen" /></span></label>
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

      <div class="vt">
        <span class="muted small">Vehicle type (sets the duty rate)</span>
        <select v-if="isStaff" v-model="vtype" :disabled="vtBusy" @change="saveType"><option value="car">Saloon (sedan, hatchback, coupe)</option><option value="non_car">Non-saloon (MPV, SUV, pick-up, van)</option></select>
        <b v-else class="small">{{ vtype === 'non_car' ? 'Non-saloon (MPV, SUV, pick-up, van)' : 'Saloon (sedan, hatchback, coupe)' }}</b>
        <span v-if="vtNote" class="muted small">{{ vtNote }}</span>
      </div>

      <label v-if="!knownMonth" class="f">Month first registered (not filled in yet: check the sheet)
        <select v-model.number="monthPick"><option :value="0">Choose the month</option><option v-for="m in 12" :key="m" :value="m">{{ m }}</option></select>
      </label>
      <div v-for="w in duty?.warnings || []" :key="w" class="warnbox" style="margin-top: 8px">{{ w }}</div>

      <div v-if="!isLite" class="ratebar">
        <span class="inbox wide grow"><span class="sy">Exchange rate ¥1 = RM</span><NumInput v-model="rateIn" decimal class="fee rateinp" aria-label="Exchange rate, RM for ¥1" /></span>
        <button v-if="!customRate" class="btn ghost sm tog" title="Round the rate up to 3 decimals, e.g. 0.026465 becomes 0.027" @click="roundRate">Round up</button>
        <button v-else class="btn ghost sm tog" @click="customRate = null">Back to {{ rate }}</button>
      </div>
      <div v-else class="ratebar">
        <label class="muted small" for="rateIn2">Exchange rate ¥1 = RM</label>
        <NumInput id="rateIn2" v-model="rateIn" decimal class="fee rateinp" aria-label="Exchange rate, RM for ¥1" />
        <button class="btn ghost sm" title="Round the rate up to 3 decimals, e.g. 0.026465 becomes 0.027" @click="roundRate">Round up</button>
        <button v-if="customRate" class="btn ghost sm" @click="customRate = null">Back to {{ rate }}</button>
      </div>
      <table v-if="!isLite && pricing.importMyr != null" class="spec bk">
        <tr><td>Car price<span v-if="pricing.bodyJpy != null" class="yn">¥{{ Math.round(pricing.bodyJpy).toLocaleString('en-US') }}</span></td><td class="r"><span class="cell"><span class="sy">RM</span><span>{{ amt(pricing.bodyMyr) }}</span></span></td></tr>
        <tr><td>{{ L.agent }}<span v-if="pricing.agentJpy != null" class="yn">¥{{ Math.round(pricing.agentJpy).toLocaleString('en-US') }}</span></td><td class="r"><span class="cell"><span class="sy">RM</span><span>{{ amt(pricing.agentMyr) }}</span></span></td></tr>
        <tr><td>Customs duty<span v-if="duty?.multiplier" class="muted small"> ({{ Math.round(duty.multiplier * 10000) / 100 }}%)</span></td><td class="r"><span class="cell"><span class="sy">RM</span><span>{{ amt(duty?.dutyMyr) }}</span></span></td></tr>
        <tr><td>Port clearance</td><td class="r"><span class="inbox"><span class="sy">RM</span><NumInput v-model="port" class="fee" aria-label="Port clearance in RM" /></span></td></tr>
        <tr><td>{{ L.inland }}</td><td class="r"><span class="inbox"><span class="sy">RM</span><NumInput v-model="inland" class="fee" :aria-label="L.inland + ' in RM'" /></span></td></tr>
        <tr><td>AP fee</td><td class="r"><span class="inbox"><span class="sy">RM</span><NumInput v-model="apFee" class="fee" aria-label="AP fee in RM" /></span></td></tr>
        <tr class="sum"><td><b>Import price</b></td><td class="r"><span class="cell b"><span class="sy">RM</span><span>{{ amt(pricing.importMyr) }}</span></span></td></tr>
      </table>
      <table v-else-if="pricing.importMyr != null" class="spec">
        <tr><td>Car price<span v-if="isLite && pricing.bodyJpy != null" class="yn">¥{{ Math.round(pricing.bodyJpy).toLocaleString('en-US') }}</span></td><td class="r" :class="{ feecell: isLite }"><template v-if="isLite"><span>RM</span><span class="amt">{{ amt(pricing.bodyMyr) }}</span></template><template v-else>{{ rmf(pricing.bodyMyr) }}</template></td></tr>
        <tr><td>{{ L.agent }}<span v-if="isLite && pricing.agentJpy != null" class="yn">¥{{ Math.round(pricing.agentJpy).toLocaleString('en-US') }}</span></td><td class="r" :class="{ feecell: isLite }"><template v-if="isLite"><span>RM</span><span class="amt">{{ amt(pricing.agentMyr) }}</span></template><template v-else>{{ rmf(pricing.agentMyr) }}</template></td></tr>
        <tr><td>Customs duty<span v-if="duty?.multiplier" class="muted small"> ({{ Math.round(duty.multiplier * 10000) / 100 }}%)</span></td><td class="r" :class="{ feecell: isLite }"><template v-if="isLite"><span>RM</span><span class="amt">{{ amt(duty?.dutyMyr) }}</span></template><template v-else>{{ rmf(duty?.dutyMyr) }}</template></td></tr>
        <tr><td>Port clearance</td><td class="r feecell"><span>RM</span><NumInput v-model="port" class="fee" aria-label="Port clearance in RM" /></td></tr>
        <tr><td>{{ L.inland }}</td><td class="r feecell"><span>RM</span><NumInput v-model="inland" class="fee" :aria-label="L.inland + ' in RM'" /></td></tr>
        <tr><td>AP fee</td><td class="r feecell"><span>RM</span><NumInput v-model="apFee" class="fee" aria-label="AP fee in RM" /></td></tr>
        <tr class="sum"><td><b>Import price</b></td><td class="r" :class="{ feecell: isLite }"><template v-if="isLite"><span>RM</span><b class="amt">{{ amt(pricing.importMyr) }}</b></template><b v-else>{{ rmf(pricing.importMyr) }}</b></td></tr>
      </table>
      <div v-else class="muted small" style="margin-top: 10px">{{ !docket ? 'Choose a docket to see the duty and the import price.' : !price ? 'Type the car price.' : !regMonth ? 'Choose the month first registered.' : 'The duty could not be worked out for this docket.' }}</div>
      <p class="muted small" style="margin-top: 8px">An estimate at ¥1 = RM {{ rateUsed }}. Port, {{ L.inland.toLowerCase() }} and AP fee are yours to change. Recon and prep are not included. The real duty is set by Customs.</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { calcDuty, offerPricing, docketPool, docketBrand, docketLine, type Docket, type DutyRate } from '@aim/core'

// The import price of one car: pick the customs docket, the duty is worked out in the browser. Used for One price cars and for cars with no docket yet.
const emit = defineEmits<{ (e: 'result', v: { importMyr: number | null; rate: number }): void }>()      // the page shows the estimate and the rate used up by the price
const props = defineProps<{ car: any; priceJpy: number; priceNote?: string; docketId?: string | null; lockPrice?: boolean }>()
const db = useDb()
const { isStaff } = useAuth()
const ref_ = ref<{ dockets: Docket[]; rates: DutyRate[]; currencies: any[] } | null>(null)
const err = ref(''), rate = ref(0)
const price = ref<number | null>(props.priceJpy || null)
const docket = ref<Docket | null>(null), picking = ref(false), search = ref(''), monthPick = ref(0)
// the model's vehicle type (lots.vehicle_type, set from the model; staff can correct it here and it is kept for every car of that model)
const vtype = ref<'car' | 'non_car'>(props.car?.vehicle_type === 'non_car' ? 'non_car' : 'car'), vtBusy = ref(false), vtNote = ref('')
watch(() => props.car?.vehicle_type, (v) => { vtype.value = v === 'non_car' ? 'non_car' : 'car' })
async function saveType() {
  vtBusy.value = true; vtNote.value = ''
  try {
    if (!props.car?.maker_code || !props.car?.car_code) { vtNote.value = 'Used for this price only (the car has no model code).'; return }
    const { error } = await db.from('scraper_models').update({ vehicle_type: vtype.value, vehicle_type_by: 'staff' }).eq('brand_code', props.car.maker_code).eq('code', props.car.car_code)
    vtNote.value = error ? 'Could not save: ' + error.message : 'Saved for every car of this model. Run node recalc-duty.js to update the saved duty of the open cars.'
  } finally { vtBusy.value = false }
}
const isLite = useRuntimeConfig().public.appKind === 'lite'
const L = isLite ? { inland: 'Carrier fee', agent: 'CIF' } : { inland: 'Inland transfer', agent: 'Agent fee & shipping' }
const amt = (n: number | null | undefined) => rmf(n).replace(/^(RM|¥)\s*/, '')      // the number alone: the RM sits in its own column so every line lines up
const customRate = ref<number | null>(null)      // a rate typed here (e.g. the rate you really pay); empty = the live rate
const rateUsed = computed(() => (customRate.value && customRate.value > 0 ? customRate.value : rate.value))
const rateIn = computed<number | null>({ get: () => rateUsed.value || null, set: (v) => { customRate.value = v && v > 0 && v !== rate.value ? v : null } })
const roundRate = () => { rateIn.value = Math.ceil(rateUsed.value * 1000 - 1e-9) / 1000 }      // 0.026465 -> 0.027
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
  return calcDuty({ docket: d, mfgYear: regYear.value, mfgMonth: regMonth.value, rate: rateUsed.value, rates: r.rates, standardFare, vehicleType: vtype.value, cc: d.cc ? undefined : props.car?.engine_cc || undefined })
})
const pricing = computed(() => offerPricing({ historyJpy: price.value || null, rate: rateUsed.value, dutyMyr: duty.value?.dutyMyr ?? null, portMyr: Number(port.value || 0), inlandMyr: Number(inland.value || 0), apFeeMyr: Number(apFee.value || 0) }))

watch([() => pricing.value.importMyr, rateUsed], ([m, r]) => emit('result', { importMyr: m as number | null, rate: r as number }), { immediate: true })
onMounted(async () => {
  try {
    const { data, error } = await db.rpc('car_duty_reference')
    if (error) throw error
    ref_.value = { dockets: (data.dockets || []).map((d: any) => ({ ...d, amt_12m_24m: n(d.amt_12m_24m), amt_24m_36m: n(d.amt_24m_36m), amt_36m_48m: n(d.amt_36m_48m), amt_48m_60m: n(d.amt_48m_60m), amt_60m_plus: n(d.amt_60m_plus) })), rates: (data.rates || []).map((r: any) => ({ ...r, multiplier: Number(r.multiplier) })), currencies: data.currencies || [] }
    rate.value = Number(data.jpy_rate) || 0; port.value = Number(data.port_myr) || 0; inland.value = Number(data.inland_myr) || 0; apFee.value = Number(data.ap_fee_myr) || 0
    if (isLite) { const lf = (await db.rpc('import_fees_lite')).data; if (lf) { port.value = Number(lf.effective.port_myr) || 0; inland.value = Number(lf.effective.inland_myr) || 0; apFee.value = Number(lf.effective.ap_fee_myr) || 0 } }
    const byId = props.docketId ? ref_.value.dockets.find((d) => d.id === props.docketId) : null
    if (byId) docket.value = byId
    else { const p = docketPool(ref_.value.dockets, props.car).pool; if (p.length === 1) docket.value = p[0]!; else picking.value = true }
  } catch (e: any) { err.value = /not allowed|42501/.test(e.message) ? 'The import price is not available for your account.' : /car_duty_reference/.test(e.message) ? 'The import price is not set up yet (database update 47 is missing).' : e.message }
})
</script>

<style scoped>
.dk { margin-top: 12px; }
.vt { display: grid; gap: 4px; margin-top: 12px; } .vt select { width: 100%; }
.picked { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-top: 6px; }
.list { display: grid; gap: 6px; max-height: 240px; overflow: auto; margin: 8px 0; }
.opt { display: flex; justify-content: space-between; gap: 10px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; cursor: pointer; text-align: left; color: inherit; } .opt:hover { border-color: var(--ac); }
.spec { width: 100%; border-collapse: collapse; margin-top: 10px; } .spec td { padding: 7px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); }
.r { text-align: right; white-space: nowrap; padding-left: 10px; } .sum td { border-top: 2px solid var(--line); color: inherit !important; }
.feecell { display: flex; align-items: center; justify-content: flex-end; gap: 6px; } .feecell span { color: var(--mu); } .ratebar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 10px 0 0; } .rateinp { width: 120px; }
.yn { margin-left: 8px; font-size: 12.5px; color: var(--mu); } .feecell .amt { color: var(--tx); } .amt { display: inline-block; width: 110px; text-align: right; padding-right: 9px; box-sizing: border-box; } .fee { width: 110px; text-align: right; height: 32px; }
.cell { display: inline-flex; justify-content: space-between; align-items: center; width: 130px; padding: 0 9px; box-sizing: border-box; white-space: nowrap; } .cell .sy { color: var(--mu); } .cell.b, .cell.b .sy { font-weight: 800; color: inherit; }
.inbox { position: relative; display: inline-block; width: 130px; } .inbox .sy { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--mu); pointer-events: none; z-index: 1; }
.inbox .fee { width: 100%; box-sizing: border-box; padding: 0 9px 0 34px; height: 34px; }
.inbox.wide { display: block; width: 100%; margin-top: 4px; } .inbox.wide.grow { flex: 1; min-width: 0; margin-top: 0; }
.inbox.wide .fee { height: 38px; text-align: left; padding-left: 30px; } .inbox.wide .rateinp { padding-left: 160px; } .inbox.wide .sy { font-size: 13px; }
.ratebar .tog { flex: none; white-space: nowrap; width: 150px; justify-content: center; text-align: center; }
.spec.bk td:first-child { width: auto; white-space: nowrap; } .spec.bk td.r { width: 1%; white-space: nowrap; }
@media (max-width: 560px) { .spec.bk td:first-child { white-space: normal; } .ratebar { flex-wrap: wrap; } .inbox.wide.grow { flex: 1 1 100%; } .ratebar .tog { width: 100%; } }
.warnbox { background: rgba(255, 170, 0, .12); border: 1px solid rgba(255, 170, 0, .4); border-radius: 8px; padding: 8px 10px; font-size: 13px; }
</style>

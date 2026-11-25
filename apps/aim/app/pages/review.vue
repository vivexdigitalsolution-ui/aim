<template>
  <div>
    <h1>Docket review</h1>
    <p class="sub">The rule and Claude did not agree on these cars, so no docket is used and no duty is shown until you confirm one. A confirmed docket is remembered for the same car.</p>

    <div v-if="err" class="err" style="margin-bottom: 10px">{{ err }}</div>
    <div v-if="done" class="okmsg" style="margin-bottom: 10px">{{ done }}</div>
    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!rows.length" class="card muted">Nothing to check. Every car either has a trusted docket or none.</div>

    <div class="grid">
      <div v-for="r in rows" :key="r.lot.id" class="card">
        <div class="row">
          <h2>{{ r.lot.brand }} {{ r.lot.model }}</h2>
          <span class="chip warn">{{ r.reason }}</span>
        </div>
        <div class="facts">
          <div v-for="f in facts(r.lot)" :key="f[0]"><small class="muted">{{ f[0] }}</small><b :class="{ miss: f[1] === '—' }">{{ f[1] }}</b></div>
        </div>
        <div class="small" style="margin-top: 6px"><NuxtLink :to="`/cars/${r.lot.id}`">Open the car page</NuxtLink><template v-if="r.lot.sheet_url"> · <a :href="r.lot.sheet_url" target="_blank" rel="noopener">Open the auction sheet</a></template></div>
        <div v-if="r.lot.sales_points" class="small" style="margin-top: 6px; white-space: pre-line">{{ r.lot.sales_points }}</div>

        <div class="opts">
          <div v-for="s in r.suggestions" :key="s.docket.id" class="opt">
            <div style="min-width: 0">
              <span class="chip" :class="s.who === 'AI' ? 'ac' : ''">{{ s.who }}</span>
              <b style="margin-left: 8px">{{ s.docket.model }}</b>
              <div class="muted small">{{ s.docket.cc ? s.docket.cc + ' cc' : '' }} · edition {{ s.docket.year }}<template v-if="s.note"> · {{ s.note }}</template></div>
            </div>
            <button class="btn sm" :disabled="busy" @click="confirm(r, s.docket)">Use this</button>
          </div>
          <div v-if="r.suggestions.length === 0" class="muted small">Neither the rule nor Claude had a suggestion.</div>
        </div>

        <div class="row wrap" style="gap: 8px; margin-top: 10px">
          <button class="btn ghost sm" @click="r.open = !r.open">{{ r.open ? 'Close list' : 'Choose another docket' }}</button>
          <button class="btn ghost sm" :disabled="busy" @click="noDocket(r)">No docket for this car</button>
        </div>
        <div v-if="r.open" class="panel">
          <input v-model="r.search" placeholder="Search this make's dockets (name or code)" />
          <button v-for="d in candidates(r)" :key="d.id" class="opt pick" :disabled="busy" @click="confirm(r, d)">
            <b>{{ d.model }}</b><span class="muted small">{{ d.cc ? d.cc + ' cc' : '' }}</span>
          </button>
          <p v-if="!candidates(r).length" class="muted small">No docket found.</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { confirmKey, docketPool, docketBrand, dutyCostRow, type Docket } from '@aim/core'

const db = useDb()
const { user } = useAuth()
const { load } = useReference()
const reviewCount = useState<number | null>('review-count', () => null)
const rows = ref<any[]>([]), loading = ref(true), busy = ref(false), err = ref(''), done = ref('')
// what the scrape read for the car, so a docket can be checked against it ("—" = the site / sheet did not give it)
const facts = (l: any): [string, string][] => [
  ['Model code', l.model_code || '—'], ['Chassis no.', l.chassis_no || '—'], ['Grade', l.grade || '—'], ['Year / month', l.mfg_year ? l.mfg_year + (l.mfg_month || l.first_reg_month ? ' / ' + (l.mfg_month || l.first_reg_month) : '') : '—'],
  ['Engine', l.engine_cc ? l.engine_cc + ' cc' : '—'], ['Gearbox', l.transmission || '—'], ['Drive', l.drive || '—'], ['Fuel', l.fuel || '—'],
  ['Seats / doors', (l.seats || '—') + ' / ' + (l.doors || '—')], ['Mileage', l.mileage_km != null ? Number(l.mileage_km).toLocaleString('en-US') + ' km' : '—'], ['Colour', l.color || '—'], ['Venue · lot', [l.venue, l.lot_no].filter(Boolean).join(' · ') || '—'],
]
let ref_: Awaited<ReturnType<typeof load>>

onMounted(async () => {
  try {
    ref_ = await load()
    const dockById = new Map(ref_.dockets.map((d) => [d.id, d]))
    const { data: decs, error } = await db.from('lot_docket_decisions').select('*').eq('status', 'review').order('decided_at', { ascending: false }).limit(300)
    if (error) throw error
    const ids = (decs || []).map((d) => d.lot_id), lots: any[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error: e2 } = await db.from('lots').select('*').in('id', ids.slice(i, i + 100)).gt('bid_deadline', new Date().toISOString())
      if (e2) throw e2
      lots.push(...(data || []))
    }
    const lotById = new Map(lots.map((l) => [l.id, l]))
    rows.value = (decs || []).filter((d) => lotById.has(d.lot_id)).map((d) => {
      const lot = lotById.get(d.lot_id), sug: any[] = []
      const rule = d.rule_docket_id ? dockById.get(d.rule_docket_id) : null, ai = d.ai_docket_id ? dockById.get(d.ai_docket_id) : null
      if (rule) sug.push({ who: 'Rule', docket: rule })
      if (ai) sug.push({ who: 'AI', docket: ai, note: [d.ai_confidence, d.ai_reason].filter(Boolean).join(': ') })
      return { dec: d, lot, reason: d.reason, suggestions: sug, open: false, search: '', key: confirmKey(lot) }
    }).sort((a: any, b: any) => (a.lot.brand + a.lot.model).localeCompare(b.lot.brand + b.lot.model))
    reviewCount.value = rows.value.length
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})

function candidates(r: any): Docket[] {
  const lot = r.lot, s = r.search.trim().toUpperCase()
  const brand = docketBrand(lot.brand)
  if (!s) { const p = docketPool(ref_.dockets, lot).pool; if (p.length) return p.slice(0, 30) }
  return ref_.dockets.filter((d) => docketBrand(d.brand) === brand && (!d.currency_code || d.currency_code === 'JPY') && (!s || d.model.toUpperCase().includes(s))).slice(0, 30)
}

async function confirm(r: any, docket: Docket) {
  busy.value = true; err.value = ''; done.value = ''
  try {
    // the same car (same key) waiting in this list gets the same docket
    const same = rows.value.filter((x) => x.key === r.key)
    const { error: ce } = await db.from('docket_confirmations').upsert({ key: r.key, docket_id: docket.id, confirmed_by: user.value?.id, example_lot: r.lot.id }, { onConflict: 'key' })
    if (ce) throw ce
    let noDuty = 0
    for (const x of same) {
      const { error: de } = await db.from('lot_docket_decisions').upsert({ lot_id: x.lot.id, status: 'confirmed', docket_id: docket.id, rule_docket_id: x.dec.rule_docket_id, ai_docket_id: x.dec.ai_docket_id, ai_confidence: x.dec.ai_confidence, ai_reason: x.dec.ai_reason, reason: 'confirmed by staff', decided_at: new Date().toISOString() }, { onConflict: 'lot_id' })
      if (de) throw de
      const { cost } = dutyCostRow({ docket, regYear: x.lot.mfg_year, regMonth: x.lot.mfg_month || x.lot.first_reg_month, ref: ref_, vehicleType: x.lot.vehicle_type })
      if (cost) { const { error: le } = await db.from('lot_costs').upsert({ lot_id: x.lot.id, ...cost, updated_at: new Date().toISOString() }, { onConflict: 'lot_id' }); if (le) throw le } else noDuty++
    }
    rows.value = rows.value.filter((x) => !same.includes(x))
    reviewCount.value = rows.value.length
    done.value = `Confirmed ${docket.model} for ${same.length} car${same.length === 1 ? '' : 's'}${noDuty ? ` (${noDuty} without duty: register date or exchange rate missing)` : ''}. Remembered for the same car next time.`
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}

async function noDocket(r: any) {
  busy.value = true; err.value = ''; done.value = ''
  try {
    const { error: de } = await db.from('lot_docket_decisions').upsert({ lot_id: r.lot.id, status: 'none', docket_id: null, rule_docket_id: r.dec.rule_docket_id, ai_docket_id: r.dec.ai_docket_id, reason: 'staff: no docket fits this car', decided_at: new Date().toISOString() }, { onConflict: 'lot_id' })
    if (de) throw de
    await db.from('lot_costs').delete().eq('lot_id', r.lot.id)
    rows.value = rows.value.filter((x) => x !== r); reviewCount.value = rows.value.length
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
</script>

<style scoped>
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px 14px; margin-top: 10px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.facts small { display: block; } .facts b { font-weight: 600; word-break: break-word; } .facts b.miss { color: var(--mu2); font-weight: 400; }
.opts { display: grid; gap: 8px; margin-top: 12px; }
.opt { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.opt.pick { width: 100%; text-align: left; cursor: pointer; }
.opt.pick:hover { border-color: var(--ac); }
.panel { display: grid; gap: 6px; margin-top: 10px; max-height: 320px; overflow: auto; }
</style>

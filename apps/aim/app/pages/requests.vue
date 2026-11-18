
<template>
  <div>
    <h1>{{ isStaff ? 'Sourcing requests' : 'Find me a car' }}</h1>
    <p class="sub">{{ isStaff ? 'Dealers ask us to find a car. Reply, link a car from the auction list if you have one, then mark the request found or closed. The dealer gets an alert on every change.' : 'Cannot find what you want in the list? Tell us the car and your budget and we will look for it. You get an alert when we reply.' }}</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>

    <!-- dealer: new request -->
    <div v-if="!isStaff" class="card" style="max-width: 760px; margin-bottom: 16px">
      <div class="row"><h2>New request</h2><span v-if="quotaLeft != null" class="chip" :class="quotaLeft ? 'ac' : 'warn'">{{ quotaLeft }} free request{{ quotaLeft === 1 ? '' : 's' }} left</span></div>
      <div v-if="quotaLeft === 0" class="muted small" style="margin: 8px 0">You used the 2 requests of the Free plan. <NuxtLink to="/upgrade" class="ac">Upgrade to Member</NuxtLink> for unlimited requests.</div>
      <div class="grid2" style="margin-top: 10px">
        <label class="f">Make<input v-model="form.brand" placeholder="Toyota" /></label>
        <label class="f">Model *<input v-model="form.model" placeholder="Alphard 2.5 Z" /></label>
        <label class="f">Not older than (year)<input v-model.number="form.year_from" type="number" placeholder="e.g. 2021" /></label>
        <label class="f">Budget (RM, all in)<input v-model.number="form.budget_myr" type="number" step="10000" placeholder="optional" /></label>
        <div v-if="isPartner" class="f" style="grid-column: 1 / -1; border: 1px solid var(--line); border-radius: 10px; padding: 10px">
          <label class="row" style="justify-content: flex-start; gap: 8px; color: var(--tx)"><input v-model="form.presold" type="checkbox" style="width: auto; height: auto" /> <b>Pre-sold: I have a customer waiting and I will buy a matching car</b></label>
          <label v-if="form.presold" class="f" style="margin-top: 8px">Customer needs it by<input v-model="form.needed_by" type="date" style="max-width: 200px" /></label>
          <span class="small muted">Partner requests are answered first. Pre-sold means we source against a sure sale.</span>
        </div>
        <div v-else-if="hasTier('member')" class="small muted" style="grid-column: 1 / -1">Partner plan: your requests are answered first, and you can send pre-sold requests for a customer who is waiting. <NuxtLink to="/upgrade" class="ac">See the plans</NuxtLink></div>
        <label class="f" style="grid-column: 1 / -1">Anything else<textarea v-model="form.notes" rows="2" placeholder="Colour, mileage, grade, when you need it ..." /></label>
      </div>
      <div style="margin-top: 12px"><button class="btn" :disabled="busy || !form.model.trim() || quotaLeft === 0" @click="submit">Send request</button></div>
    </div>

    <div class="row wrap" style="gap: 8px; margin-bottom: 12px; justify-content: flex-start">
      <span v-for="t in tabs" :key="t.key" class="chip tag" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }} ({{ count(t.key) }})</span>
    </div>
    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!shown.length" class="card muted">{{ isStaff ? 'Nothing here.' : 'No requests yet.' }}</div>

    <div class="grid">
      <div v-for="r in shown" :key="r.id" class="card">
        <div class="row" style="align-items: flex-start">
          <div style="min-width: 0">
            <b>{{ [r.brand, r.model].filter(Boolean).join(' ') }}</b>
            <div class="muted small">
              <template v-if="isStaff">{{ r.ap?.company_name || r.ap?.contact_name || r.ap?.email }} <span class="chip">{{ r.ap?.tier }}</span> · </template>
              {{ [r.year_from ? r.year_from + '+' : null, r.budget_myr ? 'up to RM ' + Number(r.budget_myr).toLocaleString('en-US') : null].filter(Boolean).join(' · ') || 'no year or budget given' }} · {{ fmtMytDateTime(r.created_at) }}
            </div>
          </div>
          <div class="row wrap" style="gap: 6px; flex: none; justify-content: flex-end">
            <span v-if="r.presold" class="chip ac">pre-sold{{ r.needed_by ? ' · by ' + r.needed_by : '' }}</span>
            <span v-if="r.priority" class="chip ac">priority</span>
            <span class="chip" :class="r.status === 'found' ? 'ok' : r.status === 'open' ? 'warn' : ''">{{ r.status }}</span>
          </div>
        </div>
        <div v-if="isStaff && r.status === 'open'" class="small muted" style="margin-top: 6px">waiting {{ waited(r.created_at) }}</div>
        <div v-if="r.notes" class="small" style="margin-top: 8px">“{{ r.notes }}”</div>
        <div v-if="r.staff_reply && !isStaff" class="okmsg" style="margin-top: 10px"><b>Our reply:</b> {{ r.staff_reply }}</div>
        <NuxtLink v-if="r.found_lot_id && !isStaff" :to="`/cars/${r.found_lot_id}`" class="btn ghost sm" style="display: inline-flex; margin-top: 8px; align-items: center; text-decoration: none">Open the car we found</NuxtLink>

        <template v-if="isStaff">
          <textarea v-model="reply[r.id]" rows="2" style="width: 100%; margin-top: 10px" placeholder="Reply to the dealer ..." />
          <div class="row wrap" style="gap: 6px; margin-top: 8px; justify-content: flex-start">
            <input v-model="search[r.id]" placeholder="Link a car: search the auction list" style="width: 230px" @input="searchLots(r.id)" />
            <span v-if="r.found_lot_id" class="chip ok">car linked <a class="x" @click="unlink(r)">×</a></span>
          </div>
          <div v-if="hits[r.id]?.length" class="small" style="margin-top: 6px">
            <div v-for="h in hits[r.id]" :key="h.id" class="hit"><span>{{ h.brand }} {{ h.model }} · {{ h.mfg_year }} · {{ h.venue }} lot {{ h.lot_no }}</span><button class="btn ghost sm" @click="link(r, h.id)">Link</button></div>
          </div>
          <div class="row wrap" style="gap: 8px; margin-top: 10px; justify-content: flex-start">
            <button class="btn sm" :disabled="busy" @click="staffSet(r, 'found')">Reply, mark found</button>
            <button class="btn ghost sm" :disabled="busy" @click="staffSet(r, 'open')">Reply, keep open</button>
            <button class="btn ghost sm" :disabled="busy" @click="staffSet(r, 'closed')">Reply, close</button>
          </div>
        </template>
        <div v-else-if="r.status === 'open'" style="margin-top: 10px"><button class="btn ghost sm" :disabled="busy" @click="closeMine(r)">Close this request</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime } from '@aim/core'

const db = useDb()
const { user, isStaff, profile, hasTier } = useAuth()
const isPartner = computed(() => !isStaff.value && profile.value?.tier === 'partner')
const now = useNow()
const waited = (iso: string) => { const m = Math.max(0, Math.round((now.value - new Date(iso).getTime()) / 60000)); return m < 60 ? m + ' min' : m < 1440 ? Math.floor(m / 60) + ' h' : Math.floor(m / 1440) + ' days' }
const rows = ref<any[]>([]), loading = ref(true), busy = ref(false), err = ref('')
const tab = ref('open')
const tabs = [{ key: 'open', label: 'Open' }, { key: 'found', label: 'Found' }, { key: 'closed', label: 'Closed' }]
const form = reactive({ brand: '', model: '', year_from: null as number | null, budget_myr: null as number | null, notes: '', presold: false, needed_by: '' })
const reply = reactive<Record<string, string>>({}), search = reactive<Record<string, string>>({}), hits = reactive<Record<string, any[]>>({})
const count = (k: string) => rows.value.filter((r) => r.status === k).length
// priority (Partner) first, then pre-sold with the nearest date, then oldest first among open requests
const shown = computed(() => rows.value.filter((r) => r.status === tab.value).sort((a, b) => tab.value === 'open'
  ? Number(b.priority) - Number(a.priority) || Number(b.presold) - Number(a.presold) || (a.needed_by || '9999').localeCompare(b.needed_by || '9999') || a.created_at.localeCompare(b.created_at)
  : b.created_at.localeCompare(a.created_at)))
const FREE_LIMIT = 2
const quotaLeft = computed(() => (profile.value?.tier === 'free' && !isStaff.value ? Math.max(0, FREE_LIMIT - rows.value.length) : null))

async function load() {
  const { data, error } = await db.from('sourcing_requests').select(isStaff.value ? '*, ap:profiles!ap_id(company_name,contact_name,email,tier)' : '*').order('created_at', { ascending: false }).limit(500)
  if (error) throw error
  rows.value = data || []
  for (const r of rows.value) if (reply[r.id] === undefined) reply[r.id] = r.staff_reply || ''
}
async function submit() {
  busy.value = true; err.value = ''
  const { error } = await db.from('sourcing_requests').insert({ ap_id: user.value!.id, brand: form.brand.trim() || null, model: form.model.trim(), year_from: form.year_from || null, budget_myr: form.budget_myr || null, notes: form.notes.trim() || null, presold: isPartner.value && form.presold, needed_by: isPartner.value && form.presold && form.needed_by ? form.needed_by : null })
  busy.value = false
  if (error) { err.value = error.message; return }
  Object.assign(form, { brand: '', model: '', year_from: null, budget_myr: null, notes: '', presold: false, needed_by: '' })
  tab.value = 'open'; await load()
}
async function closeMine(r: any) {
  if (!confirm('Close this request?')) return
  busy.value = true
  const { error } = await db.from('sourcing_requests').update({ status: 'closed' }).eq('id', r.id)
  busy.value = false
  if (error) { err.value = error.message; return }
  await load()
}
async function staffSet(r: any, status: string) {
  busy.value = true; err.value = ''
  const { error } = await db.from('sourcing_requests').update({ status, staff_reply: (reply[r.id] || '').trim() || null }).eq('id', r.id)
  busy.value = false
  if (error) { err.value = error.message; return }
  await load()
}
let timer: any
function searchLots(id: string) {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    const q = (search[id] || '').trim()
    if (q.length < 2) { hits[id] = []; return }
    const { data } = await db.from('lots').select('id,brand,model,mfg_year,venue,lot_no').gt('bid_deadline', new Date().toISOString()).or(`model.ilike.%${q.replace(/[,()%]/g, ' ')}%,brand.ilike.%${q.replace(/[,()%]/g, ' ')}%`).order('bid_deadline').limit(8)
    hits[id] = data || []
  }, 300)
}
async function link(r: any, lotId: string) {
  const { error } = await db.from('sourcing_requests').update({ found_lot_id: lotId }).eq('id', r.id)
  if (error) { err.value = error.message; return }
  hits[r.id] = []; search[r.id] = ''; await load()
}
async function unlink(r: any) { const { error } = await db.from('sourcing_requests').update({ found_lot_id: null }).eq('id', r.id); if (error) err.value = error.message; else await load() }

onMounted(async () => { try { await load() } catch (e: any) { err.value = e.message } finally { loading.value = false } })
onBeforeUnmount(() => clearTimeout(timer))
</script>

<style scoped>
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.f { display: grid; gap: 5px; color: var(--mu); font-size: 12px; } .f input { width: 100%; }
textarea { background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; color: var(--tx); font: inherit; outline: none; resize: vertical; }
.hit { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 4px 0; border-top: 1px solid var(--line); }
.x { cursor: pointer; margin-left: 4px; }
@media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
</style>


<template>
  <div>
    <h1>Walk-in customers</h1>
    <p class="sub">A customer in the shop wants a car. Enter their email and what they are looking for, and for how long they may look. We send them an invitation email; they choose a password and browse those cars on their own phone. The time starts at their first visit, and when it is up their access ends by itself.</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>

    <div class="card" style="margin-bottom: 18px">
      <h2>New viewing pass</h2>
      <div class="grid2" style="margin-top: 10px">
        <label class="f">Customer name *<input v-model="f.label" placeholder="Mr Tan" /></label>
        <label class="f">Customer email * (the invitation goes here)<input v-model="f.email" type="email" placeholder="name@example.com" /></label>
        <label class="f">Phone (optional)<input v-model="f.phone" placeholder="012-345 6789" /></label>
        <label class="f">Make (comma separated, empty = any)<input v-model="f.brands" placeholder="Toyota" /></label>
        <label class="f">Model (comma separated, empty = any)<input v-model="f.models" placeholder="Vellfire, Alphard" /></label>
        <label class="f">Year from<input v-model.number="f.year_from" type="number" placeholder="2020" /></label>
        <label class="f">Year to<input v-model.number="f.year_to" type="number" placeholder="optional" /></label>
        <label class="f">Mileage up to (km)<input v-model.number="f.max_mileage" type="number" step="5000" placeholder="optional" /></label>
        <label class="f">Access time (hours)
          <div class="row wrap" style="gap: 6px; justify-content: flex-start">
            <input v-model.number="f.hours" type="number" min="1" max="720" style="width: 90px" />
            <span v-for="h in [6, 24, 48, 72]" :key="h" class="chip tag" :class="{ on: f.hours === h }" @click="f.hours = h">{{ h }} h</span>
          </div>
        </label>
      </div>
      <div class="f" style="margin-top: 12px">Features the customer wants (the car must have all of them)
        <div class="row wrap" style="gap: 6px; justify-content: flex-start">
          <span v-for="d in catalog" :key="d.key" class="chip tag" :class="{ on: f.features.includes(d.key) }" @click="toggle(d.key)">{{ d.label }}</span>
        </div>
      </div>
      <div class="row wrap" style="gap: 10px; margin-top: 14px; justify-content: flex-start">
        <button class="btn ghost" :disabled="busy" @click="preview">Preview the cars</button>
        <button class="btn" :disabled="busy || !f.label.trim() || !f.email.trim()" @click="create">Send the invitation</button>
        <span v-if="previewCount != null" class="chip ac">{{ previewCount }} open car{{ previewCount === 1 ? '' : 's' }} match now</span>
        <label v-if="isAdmin" class="small muted" style="margin-left: auto">Default hours <input v-model.number="defaultHours" type="number" min="1" max="720" style="width: 70px" @change="saveDefault" /></label>
      </div>
      <div v-if="made" class="okmsg" style="margin-top: 14px">
        <b>Invitation sent to {{ made.email }}.</b> {{ made.label }} opens the email, chooses a password, and has {{ made.hours }} hours from the first visit. If it does not arrive in a few minutes, ask them to look in spam, or press Send again below.
      </div>
    </div>

    <h2 style="margin-bottom: 10px">Passes</h2>
    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!rows.length" class="card muted">None yet.</div>
    <div class="grid">
      <div v-for="p in rows" :key="p.id" class="card">
        <div class="row" style="align-items: flex-start">
          <div style="min-width: 0">
            <b>{{ p.label }}</b> <span class="muted small">{{ [p.email, p.phone].filter(Boolean).join(' · ') }}</span>
            <div class="muted small">{{ describe(p.filters) }} · {{ p.hours }} h · made {{ fmtMytDateTime(p.created_at) }}</div>
          </div>
          <span class="chip" :class="state(p).cls">{{ state(p).label }}</span>
        </div>
        <div v-if="p.cust?.length" class="small" style="margin-top: 8px">
          <b>Likes:</b> {{ p.cust.length }} car{{ p.cust.length === 1 ? '' : 's' }} — {{ p.cust.map((x: any) => x.lots ? x.lots.brand + ' ' + x.lots.model + (x.lots.mfg_year ? ' ' + x.lots.mfg_year : '') : '?').join(' · ') }}
        </div>
        <div class="row wrap" style="gap: 8px; margin-top: 10px; justify-content: flex-start">
          <template v-if="p.redeemed_by">
            <button v-if="!p.cust_profile?.expires_at" class="btn ghost sm" :disabled="busy" @click="invite(p)">Send the invitation again</button>
            <button v-if="p.cust_profile?.expires_at" class="btn ghost sm" :disabled="busy" @click="extend(p, 24)">+24 h</button>
            <button v-if="p.cust_profile?.expires_at" class="btn ghost sm" :disabled="busy" @click="extend(p, 48)">+48 h</button>
            <button v-if="!ended(p)" class="btn ghost sm down" :disabled="busy" @click="endNow(p)">End access now</button>
          </template>
          <button v-else-if="!p.revoked" class="btn ghost sm" :disabled="busy" @click="invite(p)">Send the invitation</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CATALOG, fmtMytDateTime } from '@aim/core'

const db = useDb()
const { isAdmin } = useAuth()
const catalog = CATALOG.map((d) => ({ key: d.key, label: d.label }))
const f = reactive({ label: '', email: '', phone: '', brands: '', models: '', year_from: null as number | null, year_to: null as number | null, max_mileage: null as number | null, hours: 48, features: [] as string[] })
const defaultHours = ref(48)
const rows = ref<any[]>([]), loading = ref(true), busy = ref(false), err = ref('')
const made = ref<any>(null), previewCount = ref<number | null>(null)
const split = (s: string) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)
const toggle = (k: string) => { f.features = f.features.includes(k) ? f.features.filter((x) => x !== k) : [...f.features, k] }
const filters = () => ({ brands: split(f.brands), models: split(f.models), year_from: f.year_from || null, year_to: f.year_to || null, max_mileage: f.max_mileage || null, features: f.features })
const describe = (x: any) => [[...(x.brands || []), ...(x.models || [])].join(' ') || 'any car', x.year_from ? x.year_from + '+' : null, x.year_to ? 'to ' + x.year_to : null, x.max_mileage ? '≤ ' + x.max_mileage.toLocaleString('en-US') + ' km' : null, (x.features || []).length ? (x.features as string[]).map((k) => CATALOG.find((d) => d.key === k)?.label || k).join(', ') : null].filter(Boolean).join(' · ')
const live = (p: any) => !!p.cust_profile?.expires_at && new Date(p.cust_profile.expires_at).getTime() > Date.now()
const ended = (p: any) => !!p.cust_profile?.expires_at && new Date(p.cust_profile.expires_at).getTime() <= Date.now()
function state(p: any) {
  if (p.revoked) return { label: 'cancelled', cls: '' }
  if (!p.redeemed_by) return { label: 'invitation not sent', cls: 'warn' }
  if (!p.cust_profile?.expires_at) return { label: 'invited, not opened yet', cls: 'warn' }
  return live(p) ? { label: 'viewing until ' + fmtMytDateTime(p.cust_profile.expires_at), cls: 'ok' } : { label: 'ended', cls: '' }
}

async function load() {
  const { data, error } = await db.from('customer_passes').select('*').order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  const ids = (data || []).map((p: any) => p.redeemed_by).filter(Boolean)
  const [pr, pk] = ids.length ? await Promise.all([db.from('profiles').select('id,expires_at').in('id', ids), db.from('customer_picks').select('customer_id,lot_id,lots(brand,model,mfg_year)').in('customer_id', ids)]) : [{ data: [] as any[] }, { data: [] as any[] }]
  rows.value = (data || []).map((p: any) => ({ ...p, cust_profile: (pr.data || []).find((x: any) => x.id === p.redeemed_by) || null, cust: (pk.data || []).filter((x: any) => x.customer_id === p.redeemed_by) }))
}
async function preview() {
  busy.value = true; err.value = ''
  const { data, error } = await db.rpc('customer_cars', { p_filters: filters() })
  busy.value = false
  if (error) { err.value = error.message; return }
  previewCount.value = (data || []).length
}
async function sendInvite(id: string) {
  const { data, error } = await db.functions.invoke('invite-customer', { body: { pass_id: id, redirect_to: location.origin + '/reset' } })
  if (error) {
    // the function answers with a plain message in its body when it refuses
    let msg = error.message
    try { const b = await (error as any).context?.json?.(); if (b?.error) msg = b.error } catch { /* keep the generic message */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
async function create() {
  busy.value = true; err.value = ''; made.value = null
  try {
    const email = f.email.trim().toLowerCase()
    const { data, error } = await db.from('customer_passes').insert({ label: f.label.trim(), email, phone: f.phone.trim() || null, filters: filters(), hours: f.hours }).select('id,label,email,hours').single()
    if (error) throw error
    try { await sendInvite(data.id); made.value = data; Object.assign(f, { label: '', email: '', phone: '' }) }
    catch (e: any) { await db.from('customer_passes').delete().eq('id', data.id); throw e }   // no invitation went out: do not keep a pass nobody can use
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
  await load()
}
async function invite(p: any) {
  busy.value = true; err.value = ''
  try { await sendInvite(p.id); made.value = { ...p, hours: p.hours } } catch (e: any) { err.value = e.message } finally { busy.value = false }
  await load()
}
async function extend(p: any, hours: number) {
  busy.value = true; err.value = ''
  const base = live(p) ? new Date(p.cust_profile.expires_at).getTime() : Date.now()
  const { error } = await db.from('profiles').update({ expires_at: new Date(base + hours * 3600_000).toISOString() }).eq('id', p.redeemed_by)
  busy.value = false
  if (error) { err.value = error.message; return }
  await load()
}
async function endNow(p: any) {
  if (!confirm(`End ${p.label}'s access now?`)) return
  const { error } = await db.from('profiles').update({ expires_at: new Date().toISOString() }).eq('id', p.redeemed_by)
  if (error) { err.value = error.message; return }
  await load()
}
async function saveDefault() { const { error } = await db.from('app_settings').update({ customer_default_hours: defaultHours.value }).eq('id', true); if (error) err.value = error.message }

onMounted(async () => {
  try {
    const s = await db.from('app_settings').select('customer_default_hours').maybeSingle()
    if (s.data?.customer_default_hours) { defaultHours.value = s.data.customer_default_hours; f.hours = s.data.customer_default_hours }
    await load()
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.f { display: grid; gap: 5px; color: var(--mu); font-size: 12px; } .f input { width: 100%; }
.down { color: var(--bad); }
@media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
</style>

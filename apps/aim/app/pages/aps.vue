<template>
  <div>
    <h1>AP holders</h1>
    <p class="sub">Approve dealers, set their plan, bid limits and agent fee. Fee rules and settings can be changed by an admin only.</p>

    <div class="row wrap" style="gap: 8px; margin-bottom: 14px">
      <span v-for="t in tabs" :key="t.key" class="chip tag" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</span>
    </div>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>

    <!-- ── AP HOLDERS ── -->
    <template v-if="tab === 'aps'">
      <div class="row wrap" style="gap: 8px; margin-bottom: 12px">
        <span v-for="s in statuses" :key="s.key" class="chip tag" :class="{ on: filter === s.key }" @click="filter = s.key">{{ s.label }} <small>{{ countOf(s.key) }}</small></span>
        <span class="grow" />
        <input v-model="search" placeholder="Search company, name, phone, email" style="width: 280px; max-width: 100%" />
      </div>
      <div class="card" style="overflow-x: auto; padding: 4px 14px">
        <table class="t">
          <thead><tr><th>Company</th><th>Contact</th><th>Status</th><th>Plan</th><th class="r">Bid limit</th><th class="r">Open orders</th><th>Won</th><th>Last order</th></tr></thead>
          <tr v-for="a in shown" :key="a.id" class="click" @click="select(a)">
            <td><b>{{ a.company_name || '—' }}</b></td>
            <td>{{ a.contact_name }}<div class="small muted">{{ a.phone || a.email }}</div></td>
            <td><span class="chip" :class="a.status === 'active' ? 'ok' : a.status === 'pending' ? 'warn' : 'bad'">{{ a.status === 'pending' ? 'waiting approval' : a.status }}</span></td>
            <td><span class="chip" :class="a.tier === 'partner' ? 'ac' : a.tier === 'member' ? 'ok' : ''">{{ a.tier }}</span></td>
            <td class="r">{{ yen(a.bid_limit_jpy) }}</td>
            <td class="r">{{ stat(a).open ? stat(a).open + ' · ' + yen(stat(a).openJpy) : '—' }}</td>
            <td>{{ stat(a).won || '—' }}</td>
            <td class="small">{{ a.last_order_at ? fmtMytDateTime(a.last_order_at) : 'never' }}</td>
          </tr>
          <tr v-if="!shown.length"><td colspan="8" class="muted" style="padding: 18px 4px">No one here.</td></tr>
        </table>
      </div>
    </template>

    <!-- ── AGENT FEES ── -->
    <template v-if="tab === 'fees'">
      <div class="row" style="margin-bottom: 10px">
        <p class="muted small" style="margin: 0; max-width: 720px">The fee is charged when a bid is <b>won</b> and saved on that bid, so changing a rule never changes old bids. A dealer with their own rule uses it; everyone else uses the default rule whose price band matches the winning price.</p>
        <button v-if="isAdmin" class="btn" @click="newRule">Add fee rule</button>
      </div>
      <div v-if="!isAdmin" class="chip warn" style="margin-bottom: 10px">Read only: only an admin can change fee rules</div>
      <div class="card" style="overflow-x: auto; padding: 4px 14px">
        <table class="t">
          <thead><tr><th>Name</th><th>Fee</th><th>Winning price band</th><th>Default</th><th>Active</th><th /></tr></thead>
          <tr v-for="r in rules" :key="r.id">
            <td><b>{{ r.name }}</b></td>
            <td>{{ r.fee_type === 'percent' ? r.fee_value + '% of price' : yen(r.fee_value) + ' flat' }}</td>
            <td>{{ yen(r.min_price_jpy) }} – {{ r.max_price_jpy ? yen(r.max_price_jpy) : 'no limit' }}</td>
            <td><span class="chip" :class="r.is_default ? 'ok' : ''">{{ r.is_default ? 'yes' : 'no' }}</span></td>
            <td><span class="chip" :class="r.active ? 'ok' : ''">{{ r.active ? 'yes' : 'no' }}</span></td>
            <td class="r nowrap"><template v-if="isAdmin"><button class="btn ghost sm" @click="editRule(r)">Edit</button> <button class="btn ghost sm down" @click="removeRule(r)">Delete</button></template></td>
          </tr>
          <tr v-if="!rules.length"><td colspan="6" class="muted" style="padding: 18px 4px">No fee rules yet.</td></tr>
        </table>
      </div>
    </template>

    <!-- ── SETTINGS ── -->
    <template v-if="tab === 'settings' && settings">
      <div class="card col">
        <h2>Rules</h2>
        <div class="grid2">
          <label class="f">Car age limit (years)<input v-model.number="settings.max_car_age_years" type="number" min="0" :disabled="!isAdmin" /></label>
          <label class="f">Suspend dealers with no order for (days)<input v-model.number="settings.inactive_suspend_days" type="number" min="1" :disabled="!isAdmin" /></label>
          <label class="f">History price period (weeks)<input v-model.number="settings.history_weeks" type="number" min="1" :disabled="!isAdmin" /></label>
        </div>
        <p class="small muted" style="margin: 0">The car age limit is applied when a car is loaded; changing it does not re-check cars already loaded.</p>
        <div v-if="msg" class="okmsg">{{ msg }}</div>
        <div><button v-if="isAdmin" class="btn" :disabled="busy" @click="saveSettings">Save settings</button><span v-else class="chip warn">Read only: only an admin can change settings</span></div>
      </div>
      <div class="card col" style="margin-top: 14px">
        <h2>Housekeeping</h2>
        <p class="small muted" style="margin: 0">Runs every day on its own: deletes cars from past auction days that nobody ordered, deletes old history, and suspends dealers with no order for the number of days above. You can run it now.</p>
        <div v-if="hk" class="okmsg">{{ hk.lots_deleted }} old cars deleted · {{ hk.history_deleted }} old history rows deleted · {{ hk.ap_suspended }} dealer(s) suspended</div>
        <div><button class="btn ghost" :disabled="busy" @click="runHousekeeping">Run housekeeping now</button></div>
      </div>
    </template>

    <!-- ── ONE AP HOLDER ── -->
    <div v-if="sel" class="overlay" @click.self="sel = null">
      <div class="dialog">
        <div class="row"><h2>{{ sel.company_name || sel.email }}</h2><button class="btn ghost sm" @click="sel = null">Close</button></div>
        <div class="small muted">{{ [sel.contact_name, sel.phone, sel.whatsapp ? 'WhatsApp ' + sel.whatsapp : null, sel.email].filter(Boolean).join(' · ') }}<br v-if="sel.address" />{{ sel.address }}</div>
        <div v-if="sel.suspended_reason" class="err">Suspended: {{ sel.suspended_reason }}</div>

        <div class="row wrap" style="gap: 8px; justify-content: flex-start">
          <button v-if="sel.status !== 'active'" class="btn" :disabled="busy" @click="setStatus('active')">{{ sel.status === 'pending' ? 'Approve' : 'Reactivate' }}</button>
          <button v-if="sel.status === 'active'" class="btn ghost down" :disabled="busy" @click="setStatus('suspended', 'Suspended by staff')">Suspend</button>
          <span v-if="sel.status === 'pending'" class="muted small">A new dealer starts on the plan chosen below.</span>
        </div>

        <div class="grid2">
          <label class="f">Plan
            <select v-model="edit.tier"><option value="free">Free</option><option value="member">Member</option><option value="partner">Partner</option></select>
          </label>
          <label class="f">History price until<input v-model="edit.history_until" type="date" /></label>
          <label class="f">Highest bid per car (¥)<input v-model.number="edit.bid_limit_jpy" type="number" inputmode="numeric" step="100000" /></label>
          <label class="f">Total open orders cap (¥, empty = none)<input v-model.number="edit.open_limit_jpy" type="number" inputmode="numeric" step="100000" /></label>
          <label class="f" style="grid-column: 1 / -1">Agent fee rule
            <select v-model="edit.fee_rule_id"><option :value="null">Default rules (by winning price)</option><option v-for="r in rules.filter((x) => x.active)" :key="r.id" :value="r.id">{{ r.name }} ({{ r.fee_type === 'percent' ? r.fee_value + '%' : yen(r.fee_value) }})</option></select>
          </label>
        </div>
        <div class="small muted">{{ stat(sel).open }} open order{{ stat(sel).open === 1 ? '' : 's' }} · {{ stat(sel).won }} won · {{ stat(sel).total }} in total</div>
        <label class="f">Internal notes (never shown to the dealer)<textarea v-model="edit.notes" rows="2" /></label>
        <div v-if="msg" class="okmsg">{{ msg }}</div>
        <div><button class="btn" :disabled="busy" @click="save">Save</button></div>

        <div class="contacts">
          <h2 style="font-size: 14px">Other contacts</h2>
          <div v-for="c in contacts" :key="c.id" class="row small" style="padding: 4px 0">
            <span><b>{{ c.name }}</b> {{ [c.position, c.phone, c.email].filter(Boolean).join(' · ') }}</span>
            <button class="btn ghost sm down" @click="removeContact(c)">Remove</button>
          </div>
          <div v-if="!contacts.length" class="muted small">None.</div>
          <div class="row wrap" style="gap: 6px; margin-top: 6px; justify-content: flex-start">
            <input v-model="nc.name" placeholder="Name" style="width: 140px" /><input v-model="nc.position" placeholder="Position" style="width: 120px" /><input v-model="nc.phone" placeholder="Phone" style="width: 130px" />
            <button class="btn ghost sm" :disabled="!nc.name.trim()" @click="addContact">Add</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── ONE FEE RULE ── -->
    <div v-if="form" class="overlay" @click.self="form = null">
      <div class="dialog">
        <h2>{{ form.id ? 'Edit fee rule' : 'New fee rule' }}</h2>
        <label class="f">Name<input v-model="form.name" /></label>
        <div class="grid2">
          <label class="f">Type<select v-model="form.fee_type"><option value="flat_jpy">Flat amount (¥)</option><option value="percent">Percent of winning price</option></select></label>
          <label class="f">{{ form.fee_type === 'percent' ? 'Percent (%)' : 'Amount (¥)' }}<input v-model.number="form.fee_value" type="number" step="any" /></label>
          <label class="f">Winning price from (¥)<input v-model.number="form.min_price_jpy" type="number" /></label>
          <label class="f">Winning price below (¥, empty = no limit)<input v-model.number="form.max_price_jpy" type="number" /></label>
        </div>
        <label class="row small" style="justify-content: flex-start"><input v-model="form.is_default" type="checkbox" style="width: auto; height: auto" /> Default rule (used when the dealer has none of their own)</label>
        <label class="row small" style="justify-content: flex-start"><input v-model="form.active" type="checkbox" style="width: auto; height: auto" /> Active</label>
        <div v-if="formErr" class="err">{{ formErr }}</div>
        <div class="row wrap" style="gap: 8px; justify-content: flex-start"><button class="btn" @click="saveRule">Save</button><button class="btn ghost" @click="form = null">Cancel</button></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime } from '@aim/core'

const db = useDb()
const { isAdmin } = useAuth()
const tab = ref('aps'), err = ref(''), msg = ref(''), busy = ref(false)
const tabs = [{ key: 'aps', label: 'AP holders' }, { key: 'fees', label: 'Agent fees' }, { key: 'settings', label: 'Settings' }]
const aps = ref<any[]>([]), rules = ref<any[]>([]), bids = ref<any[]>([]), settings = ref<any>(null), hk = ref<any>(null)
const filter = ref('all'), search = ref('')
const sel = ref<any>(null), edit = reactive<any>({}), contacts = ref<any[]>([]), nc = reactive({ name: '', position: '', phone: '' })
const form = ref<any>(null), formErr = ref('')
const statuses = [{ key: 'all', label: 'All' }, { key: 'pending', label: 'Waiting approval' }, { key: 'active', label: 'Active' }, { key: 'suspended', label: 'Suspended' }]
const yen = (n: unknown) => (n == null || n === '' ? '—' : '¥' + Math.round(Number(n)).toLocaleString('en-US'))

const countOf = (k: string) => (k === 'all' ? aps.value.length : aps.value.filter((a) => a.status === k).length)
const shown = computed(() => {
  const s = search.value.trim().toLowerCase()
  return aps.value.filter((a) => (filter.value === 'all' || a.status === filter.value) && (!s || [a.company_name, a.contact_name, a.phone, a.email].some((v) => (v || '').toLowerCase().includes(s))))
})
const statMap = computed(() => {
  const m = new Map<string, { open: number; openJpy: number; won: number; total: number }>()
  for (const b of bids.value) {
    const s = m.get(b.ap_id) || m.set(b.ap_id, { open: 0, openJpy: 0, won: 0, total: 0 }).get(b.ap_id)!
    s.total++
    if (b.status === 'won') s.won++
    if (b.status === 'pending' || b.status === 'placed') { s.open++; s.openJpy += Number(b.max_bid_jpy) }
  }
  return m
})
const stat = (a: any) => statMap.value.get(a.id) || { open: 0, openJpy: 0, won: 0, total: 0 }

async function load() {
  err.value = ''
  const [a, r, b, s] = await Promise.all([
    db.from('profiles').select('*').eq('role', 'ap_holder').order('created_at', { ascending: false }),
    db.from('fee_rules').select('*').order('min_price_jpy').order('name'),
    db.from('bids').select('ap_id,status,max_bid_jpy').limit(20000),
    db.from('app_settings').select('*').maybeSingle(),
  ])
  const bad = [a, r, b, s].find((x) => x.error)
  if (bad) { err.value = bad.error!.message; return }
  aps.value = a.data || []; rules.value = r.data || []; bids.value = b.data || []; settings.value = s.data
  if (sel.value) select(aps.value.find((x) => x.id === sel.value.id) || null)
}
async function select(a: any | null) {
  sel.value = a; msg.value = ''
  if (!a) return
  const n = await db.from('ap_notes').select('notes').eq('ap_id', a.id).maybeSingle()   // staff-only table: a dealer can read their own profile row, never this
  Object.assign(edit, { tier: a.tier || 'free', bid_limit_jpy: a.bid_limit_jpy, open_limit_jpy: a.open_limit_jpy, fee_rule_id: a.fee_rule_id, history_until: a.history_until, notes: n.data?.notes || '' })
  const { data } = await db.from('ap_contacts').select('*').eq('ap_id', a.id).order('created_at')
  contacts.value = data || []
}
async function save() {
  busy.value = true; msg.value = ''; err.value = ''
  const { error } = await db.from('profiles').update({
    tier: edit.tier, bid_limit_jpy: Number(edit.bid_limit_jpy) || 0, open_limit_jpy: edit.open_limit_jpy === '' || edit.open_limit_jpy == null ? null : Number(edit.open_limit_jpy),
    fee_rule_id: edit.fee_rule_id || null, history_until: edit.history_until || null,
  }).eq('id', sel.value.id)
  const nt = error ? null : await db.from('ap_notes').upsert({ ap_id: sel.value.id, notes: edit.notes || null, updated_at: new Date().toISOString() }, { onConflict: 'ap_id' })
  busy.value = false
  if (error || nt?.error) { err.value = (error || nt!.error)!.message; return }
  msg.value = 'Saved'; await load()
}
async function setStatus(status: string, reason: string | null = null) {
  busy.value = true; err.value = ''
  // approving also saves the plan chosen in the form, so a new dealer never starts on a plan by accident
  const patch: any = { status, suspended_reason: reason }
  if (status === 'active') patch.tier = edit.tier
  const { error } = await db.from('profiles').update(patch).eq('id', sel.value.id)
  busy.value = false
  if (error) { err.value = error.message; return }
  await load()
}
async function addContact() {
  const { error } = await db.from('ap_contacts').insert({ ap_id: sel.value.id, name: nc.name.trim(), position: nc.position.trim() || null, phone: nc.phone.trim() || null })
  if (error) { err.value = error.message; return }
  Object.assign(nc, { name: '', position: '', phone: '' }); await select(sel.value)
}
async function removeContact(c: any) { await db.from('ap_contacts').delete().eq('id', c.id); await select(sel.value) }

const newRule = () => { form.value = { name: '', fee_type: 'flat_jpy', fee_value: 0, min_price_jpy: 0, max_price_jpy: null, is_default: true, active: true }; formErr.value = '' }
const editRule = (r: any) => { form.value = { ...r }; formErr.value = '' }
async function saveRule() {
  const f = form.value
  if (!f.name?.trim()) { formErr.value = 'Give it a name'; return }
  const row = { name: f.name.trim(), fee_type: f.fee_type, fee_value: Number(f.fee_value) || 0, min_price_jpy: Number(f.min_price_jpy) || 0, max_price_jpy: f.max_price_jpy === '' || f.max_price_jpy == null ? null : Number(f.max_price_jpy), is_default: !!f.is_default, active: !!f.active }
  const { error } = f.id ? await db.from('fee_rules').update(row).eq('id', f.id) : await db.from('fee_rules').insert(row)
  if (error) { formErr.value = error.message; return }
  form.value = null; await load()
}
async function removeRule(r: any) {
  if (!confirm(`Delete “${r.name}”? Dealers using it fall back to the default rules.`)) return
  const { error } = await db.from('fee_rules').delete().eq('id', r.id)
  if (error) { err.value = error.message; return }
  await load()
}
async function saveSettings() {
  busy.value = true; msg.value = ''; err.value = ''
  const s = settings.value
  const { error } = await db.from('app_settings').update({ max_car_age_years: s.max_car_age_years, inactive_suspend_days: s.inactive_suspend_days, history_weeks: s.history_weeks, updated_at: new Date().toISOString() }).eq('id', true)
  busy.value = false
  if (error) { err.value = error.message; return }
  msg.value = 'Saved'
}
async function runHousekeeping() {
  busy.value = true; err.value = ''; hk.value = null
  const { data, error } = await db.rpc('housekeeping')
  busy.value = false
  if (error) { err.value = error.message; return }
  hk.value = data
}
onMounted(load)
</script>

<style scoped>
.t { width: 100%; border-collapse: collapse; } .t th { text-align: left; color: var(--mu); font-weight: 500; font-size: 12px; padding: 10px 6px; }
.t td { padding: 10px 6px; border-top: 1px solid var(--line); vertical-align: top; } .r { text-align: right; } .nowrap { white-space: nowrap; }
.t tr.click { cursor: pointer; } .t tr.click:hover td { background: var(--s2); }
.col { display: grid; gap: 12px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.f { display: grid; gap: 5px; color: var(--mu); font-size: 12px; } .f input, .f select, .f textarea { width: 100%; }
textarea { background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; color: var(--tx); font: inherit; outline: none; resize: vertical; }
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .6); display: grid; place-items: center; z-index: 20; padding: 16px; overflow: auto; }
.dialog { background: var(--s1); border: 1px solid var(--line); border-radius: var(--r); padding: 20px; width: 100%; max-width: 640px; display: grid; gap: 14px; max-height: calc(100vh - 32px); overflow: auto; }
.contacts { border-top: 1px solid var(--line); padding-top: 12px; }
.down { color: var(--bad); }
@media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
</style>

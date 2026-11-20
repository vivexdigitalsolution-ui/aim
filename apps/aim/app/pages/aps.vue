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
        <button class="btn" @click="openAdd">+ Add user</button>
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

    <!-- SERVICE LEVELS -->
    <template v-if="tab === 'levels'">
      <div class="row" style="margin-bottom: 10px">
        <p class="muted small" style="margin: 0; max-width: 720px">A service level is a named package with its own agent fee, for example Basic, Professional or Premium. Give a dealer a level on their page. A fee rule pinned to a dealer beats their level; a dealer with no level uses the default fee rules.</p>
        <button v-if="isAdmin" class="btn" @click="lvForm = { name: '', description: '', fee_type: 'flat_jpy', fee_value: 0, active: true, sort_order: levels.length }; lvErr = ''">Add service level</button>
      </div>
      <div v-if="!isAdmin" class="chip warn" style="margin-bottom: 10px">Read only: only an admin can change service levels</div>
      <div class="card" style="overflow-x: auto; padding: 4px 14px">
        <table class="t">
          <thead><tr><th>Name</th><th>Agent fee</th><th>What is included</th><th>Dealers</th><th>Active</th><th /></tr></thead>
          <tr v-for="l in levels" :key="l.id">
            <td><b>{{ l.name }}</b></td><td>{{ l.fee_type === 'percent' ? l.fee_value + '% of price' : yen(l.fee_value) + ' flat' }}</td><td class="small muted">{{ l.description }}</td>
            <td>{{ aps.filter((a) => a.service_level_id === l.id).length }}</td><td><span class="chip" :class="l.active ? 'ok' : ''">{{ l.active ? 'yes' : 'no' }}</span></td>
            <td class="r nowrap"><template v-if="isAdmin"><button class="btn ghost sm" @click="lvForm = { ...l }; lvErr = ''">Edit</button> <button class="btn ghost sm down" @click="removeLevel(l)">Delete</button></template></td>
          </tr>
          <tr v-if="!levels.length"><td colspan="6" class="muted" style="padding: 18px 4px">No service levels yet. Fees work as before until you add some.</td></tr>
        </table>
      </div>
    </template>

    <!-- VOLUME REBATE -->
    <template v-if="tab === 'rebates'">
      <p class="muted small" style="margin: 0 0 10px; max-width: 720px">The more cars a dealer wins in one calendar month (Malaysia time), the bigger the discount on the agent fee of that win. Example: from 3 cars, 10% off. The car being recorded counts. No steps means no rebate.</p>
      <div v-if="!isAdmin" class="chip warn" style="margin-bottom: 10px">Read only: only an admin can change the rebate steps</div>
      <div class="card" style="overflow-x: auto; padding: 4px 14px">
        <table class="t">
          <thead><tr><th>From this many won cars in a month</th><th>Discount on the agent fee</th><th /></tr></thead>
          <tr v-for="r in rebates" :key="r.min_units"><td><b>{{ r.min_units }}</b> cars</td><td>{{ r.rebate_pct }}%</td><td class="r"><button v-if="isAdmin" class="btn ghost sm down" @click="removeRebate(r)">Delete</button></td></tr>
          <tr v-if="!rebates.length"><td colspan="3" class="muted" style="padding: 18px 4px">No rebate steps yet.</td></tr>
          <tr v-if="isAdmin"><td><input v-model.number="rb.min_units" type="number" min="2" placeholder="e.g. 3" style="width: 110px" /></td><td><input v-model.number="rb.rebate_pct" type="number" min="1" max="100" step="0.5" placeholder="e.g. 10" style="width: 110px" /> %</td><td class="r"><button class="btn sm" :disabled="!rb.min_units || !rb.rebate_pct" @click="addRebate">Add step</button></td></tr>
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
        <h2>Import calculator: who may use it</h2>
        <p class="small muted" style="margin: 0">Staff always can. Walk-in customers never can. Choose how often each plan may calculate.</p>
        <div v-for="l in calcLimits" :key="l.tier" class="row wrap" style="gap: 10px; justify-content: flex-start">
          <b style="width: 90px; text-transform: capitalize">{{ l.tier }}</b>
          <select v-model="l.period" :disabled="!isAdmin"><option value="once">in total (once)</option><option value="day">per day</option><option value="month">per month</option><option value="unlimited">unlimited</option></select>
          <label v-if="l.period !== 'unlimited'" class="small">up to <input v-model.number="l.uses" type="number" min="0" style="width: 70px" :disabled="!isAdmin" /> calculation(s)</label>
        </div>
        <div v-if="isAdmin"><button class="btn" :disabled="busy" @click="saveCalcLimits">Save calculator limits</button></div>
      </div>
      <div class="card col" style="margin-top: 14px">
        <h2>Housekeeping</h2>
        <p class="small muted" style="margin: 0">Runs every day on its own: deletes cars from past auction days that nobody ordered, deletes old history, and suspends dealers with no order for the number of days above. You can run it now.</p>
        <div v-if="hk" class="okmsg">{{ hk.lots_deleted }} old cars deleted · {{ hk.history_deleted }} old history rows deleted · {{ hk.ap_suspended }} dealer(s) suspended</div>
        <div><button class="btn ghost" :disabled="busy" @click="runHousekeeping">Run housekeeping now</button></div>
      </div>
    </template>

    <!-- ── ADD A USER ── -->
    <div v-if="nu" class="overlay" @click.self="nu = null">
      <div class="dialog">
        <div class="row"><h2>Add a user</h2><button class="btn ghost sm" @click="nu = null">Close</button></div>
        <p class="small muted" style="margin: 4px 0 10px">We email them an invitation. They choose their own password and the account is active straight away.</p>
        <div class="grid2">
          <label class="f">Email *<input v-model="nu.email" type="email" autocomplete="off" /></label>
          <label class="f">Role
            <select v-model="nu.role"><option value="ap_holder">AP holder</option><option v-if="isAdmin" value="staff">Staff</option><option v-if="isAdmin" value="admin">Admin</option></select>
          </label>
          <label class="f">Company<input v-model="nu.company_name" /></label>
          <label class="f">Contact name<input v-model="nu.contact_name" /></label>
          <label class="f">Phone<input v-model="nu.phone" /></label>
          <label class="f">WhatsApp<input v-model="nu.whatsapp" /></label>
          <template v-if="nu.role === 'ap_holder'">
            <label class="f">Plan<select v-model="nu.tier"><option value="free">Free</option><option value="member">Member</option><option value="partner">Partner</option></select></label>
            <label class="f">Bid limit per car (¥, 0 = cannot bid yet)<NumInput v-model="nu.bid_limit_jpy" /></label>
            <label class="f" style="grid-column: 1 / -1">Agent fee rule<select v-model="nu.fee_rule_id"><option value="">None yet</option><option v-for="r in rules" :key="r.id" :value="r.id">{{ r.name }}</option></select></label>
          </template>
        </div>
        <div v-if="nuErr" class="err" style="margin-top: 10px">{{ nuErr }}</div>
        <div v-if="nuOk" class="okmsg" style="margin-top: 10px">{{ nuOk }}</div>
        <div style="margin-top: 12px"><button class="btn" :disabled="busy || !nu.email" @click="addUser">Send invitation</button></div>
      </div>
    </div>

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
          <label class="f">Highest bid per car (¥)<NumInput v-model="edit.bid_limit_jpy" /></label>
          <label class="f">Total open orders cap (¥, empty = none)<NumInput v-model="edit.open_limit_jpy" /></label>
          <label class="f" style="grid-column: 1 / -1">Service level
            <select v-model="edit.service_level_id"><option :value="null">None</option><option v-for="l in levels.filter((x) => x.active)" :key="l.id" :value="l.id">{{ l.name }} ({{ l.fee_type === 'percent' ? l.fee_value + '%' : yen(l.fee_value) }})</option></select>
          </label>
          <label class="f" style="grid-column: 1 / -1">Agent fee rule (a negotiated rule beats the service level)
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

    <!-- ONE SERVICE LEVEL -->
    <div v-if="lvForm" class="overlay" @click.self="lvForm = null">
      <div class="dialog">
        <h2>{{ lvForm.id ? 'Edit service level' : 'New service level' }}</h2>
        <label class="f">Name<input v-model="lvForm.name" placeholder="e.g. Professional" /></label>
        <label class="f">What is included<textarea v-model="lvForm.description" rows="2" placeholder="e.g. pre-bid check, sheet translation, priority bidding" /></label>
        <div class="grid2">
          <label class="f">Fee type<select v-model="lvForm.fee_type"><option value="flat_jpy">Flat amount (¥)</option><option value="percent">Percent of winning price</option></select></label>
          <label class="f">{{ lvForm.fee_type === 'percent' ? 'Percent (%)' : 'Amount (¥)' }}<input v-model.number="lvForm.fee_value" type="number" step="any" /></label>
        </div>
        <label class="row small" style="justify-content: flex-start"><input v-model="lvForm.active" type="checkbox" style="width: auto; height: auto" /> Active</label>
        <div v-if="lvErr" class="err">{{ lvErr }}</div>
        <div class="row wrap" style="gap: 8px; justify-content: flex-start"><button class="btn" @click="saveLevel">Save</button><button class="btn ghost" @click="lvForm = null">Cancel</button></div>
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
          <label class="f">Winning price from (¥)<NumInput v-model="form.min_price_jpy" /></label>
          <label class="f">Winning price below (¥, empty = no limit)<NumInput v-model="form.max_price_jpy" /></label>
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
const tabs = [{ key: 'aps', label: 'AP holders' }, { key: 'fees', label: 'Agent fees' }, { key: 'levels', label: 'Service levels' }, { key: 'rebates', label: 'Volume rebate' }, { key: 'settings', label: 'Settings' }]
const levels = ref<any[]>([]), rebates = ref<any[]>([]), lvForm = ref<any>(null), lvErr = ref(''), rb = reactive({ min_units: null as number | null, rebate_pct: null as number | null })
const aps = ref<any[]>([]), rules = ref<any[]>([]), bids = ref<any[]>([]), settings = ref<any>(null), hk = ref<any>(null)
const filter = ref('all'), search = ref('')
const calcLimits = ref<any[]>([])
async function saveCalcLimits() {
  busy.value = true; err.value = ''; msg.value = ''
  try {
    for (const l of calcLimits.value) { const { error } = await db.from('calculator_limits').update({ period: l.period, uses: l.period === 'unlimited' ? 0 : Math.max(0, Number(l.uses) || 0) }).eq('tier', l.tier); if (error) throw error }
    msg.value = 'Calculator limits saved.'
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
onMounted(async () => { const { data } = await db.from('calculator_limits').select('*'); calcLimits.value = ['free', 'member', 'partner'].map((t) => (data || []).find((x: any) => x.tier === t)).filter(Boolean) })
const nu = ref<any>(null), nuErr = ref(''), nuOk = ref('')
function openAdd() { nu.value = { email: '', role: 'ap_holder', company_name: '', contact_name: '', phone: '', whatsapp: '', tier: 'free', bid_limit_jpy: 0, fee_rule_id: '' }; nuErr.value = ''; nuOk.value = '' }
async function addUser() {
  busy.value = true; nuErr.value = ''; nuOk.value = ''
  try {
    const { data, error } = await db.functions.invoke('create-user', { body: { ...nu.value, redirect_to: location.origin + '/reset' } })
    if (error) { let m = error.message; try { const b = await (error as any).context?.json?.(); if (b?.error) m = b.error } catch { /* keep */ } throw new Error(m) }
    if (data?.error) throw new Error(data.error)
    nuOk.value = `Invitation sent to ${data.email}.`
    await load()
  } catch (e: any) { nuErr.value = e.message } finally { busy.value = false }
}
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
  const [a, r, b, s, lv, rbt] = await Promise.all([
    db.from('profiles').select('*').eq('role', 'ap_holder').order('created_at', { ascending: false }),
    db.from('fee_rules').select('*').order('min_price_jpy').order('name'),
    db.from('bids').select('ap_id,status,max_bid_jpy').limit(20000),
    db.from('app_settings').select('*').maybeSingle(),
    db.from('service_levels').select('*').order('sort_order').order('name'),
    db.from('volume_rebates').select('*').order('min_units'),
  ])
  const bad = [a, r, b, s, lv, rbt].find((x) => x.error)
  if (bad) { err.value = bad.error!.message; return }
  aps.value = a.data || []; rules.value = r.data || []; bids.value = b.data || []; settings.value = s.data; levels.value = lv.data || []; rebates.value = rbt.data || []
  if (sel.value) select(aps.value.find((x) => x.id === sel.value.id) || null)
}
async function select(a: any | null) {
  sel.value = a; msg.value = ''
  if (!a) return
  const n = await db.from('ap_notes').select('notes').eq('ap_id', a.id).maybeSingle()   // staff-only table: a dealer can read their own profile row, never this
  Object.assign(edit, { tier: a.tier || 'free', bid_limit_jpy: a.bid_limit_jpy, open_limit_jpy: a.open_limit_jpy, fee_rule_id: a.fee_rule_id, service_level_id: a.service_level_id || null, history_until: a.history_until, notes: n.data?.notes || '' })
  const { data } = await db.from('ap_contacts').select('*').eq('ap_id', a.id).order('created_at')
  contacts.value = data || []
}
async function save() {
  busy.value = true; msg.value = ''; err.value = ''
  const { error } = await db.from('profiles').update({
    tier: edit.tier, bid_limit_jpy: Number(edit.bid_limit_jpy) || 0, open_limit_jpy: edit.open_limit_jpy === '' || edit.open_limit_jpy == null ? null : Number(edit.open_limit_jpy),
    fee_rule_id: edit.fee_rule_id || null, service_level_id: edit.service_level_id || null, history_until: edit.history_until || null,
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
async function saveLevel() {
  const f = lvForm.value
  if (!f.name?.trim()) { lvErr.value = 'Give it a name'; return }
  const row = { name: f.name.trim(), description: f.description?.trim() || null, fee_type: f.fee_type, fee_value: Number(f.fee_value) || 0, active: !!f.active, sort_order: f.sort_order ?? 0 }
  const { error } = f.id ? await db.from('service_levels').update(row).eq('id', f.id) : await db.from('service_levels').insert(row)
  if (error) { lvErr.value = error.message; return }
  lvForm.value = null; await load()
}
async function removeLevel(l: any) {
  if (!confirm('Delete "' + l.name + '"? Dealers on it go back to the default fee rules.')) return
  const { error } = await db.from('service_levels').delete().eq('id', l.id)
  if (error) { err.value = error.message; return }
  await load()
}
async function addRebate() {
  const { error } = await db.from('volume_rebates').upsert({ min_units: rb.min_units, rebate_pct: rb.rebate_pct }, { onConflict: 'min_units' })
  if (error) { err.value = error.message; return }
  rb.min_units = rb.rebate_pct = null; await load()
}
async function removeRebate(r: any) { const { error } = await db.from('volume_rebates').delete().eq('min_units', r.min_units); if (error) err.value = error.message; else await load() }
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

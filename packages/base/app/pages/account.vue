<template>
  <div class="acct">
    <h1>My account</h1>
    <p class="sub muted">Your details and your password. {{ isStaff ? 'Staff access' : 'Plan: ' + (profile?.tier || 'free') }}</p>

    <div class="card" style="margin-bottom: 16px">
      <h2>Contact details</h2>
      <div class="grid2">
        <label class="f">Company<input v-model="f.company_name" autocomplete="organization" /></label>
        <label class="f">Your name<input v-model="f.contact_name" autocomplete="name" /></label>
        <label class="f">Phone<input v-model="f.phone" autocomplete="tel" /></label>
        <label class="f">WhatsApp<input v-model="f.whatsapp" autocomplete="tel" /></label>
        <label class="f" style="grid-column: 1 / -1">Address<input v-model="f.address" autocomplete="street-address" /></label>
        <label class="f" style="grid-column: 1 / -1">Email (sign-in)<input :value="profile?.email" disabled /></label>
      </div>
      <div v-if="msg1" :class="ok1 ? 'okmsg' : 'err'" style="margin-top: 10px">{{ msg1 }}</div>
      <div style="margin-top: 12px"><button class="btn" :disabled="busy1" @click="saveDetails">Save details</button></div>
    </div>

    <div v-if="isStaff || profile?.role === 'ap_holder'" class="card" style="margin-bottom: 16px">
      <h2>{{ isStaff ? 'Import costs: default for every AP holder' : 'My import costs' }}</h2>
      <p class="muted small">{{ isStaff ? 'Port clearance, inland transfer and AP fee added to the import price of every car. AP holders start from these and can set their own.' : 'Added to the import price of every car and in the calculator. Change them here, or directly in the import price breakdown of any car. Leave a box empty to use the team default (shown inside the box).' }}</p>
      <div class="grid3">
        <label class="f">Port clearance (RM)<NumInput v-model="fees.port" :placeholder="isStaff ? '' : String(shared.port_myr)" /></label>
        <label class="f">Inland transfer (RM)<NumInput v-model="fees.inland" :placeholder="isStaff ? '' : String(shared.inland_myr)" /></label>
        <label class="f">AP fee (RM)<NumInput v-model="fees.apFee" :placeholder="isStaff ? '' : String(shared.ap_fee_myr)" /></label>
      </div>
      <div v-if="msgF" :class="okF ? 'okmsg' : 'err'" style="margin-top: 10px">{{ msgF }}</div>
      <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap"><button class="btn" :disabled="busyF" @click="saveFees">Save</button><button v-if="!isStaff" class="btn ghost" :disabled="busyF" @click="useTeam">Use the team defaults</button></div>
    </div>

    <div v-if="isStaff" class="card" style="margin-bottom: 16px">
      <h2>Agent fee &amp; shipping: default table for every AP holder</h2>
      <p class="muted small">What you charge to bring in a car, by the car price in yen (the same table as the CIF rates page). The Import calculator uses it for everyone who has not kept their own table. A car priced below "To" pays the fee; an empty "To" means that price and above. Untick "On" to stop offering a band.</p>
      <div v-if="!cif.length" class="muted small" style="margin: 8px 0">No bands yet. <a href="#" @click.prevent="addBand">Add the first band</a></div>
      <div v-for="(r, i) in cif" :key="r.id || 'n' + i" class="crow">
        <label class="f">From (¥)<NumInput v-model="r.from_jpy" /></label>
        <label class="f">To (¥, empty = and above)<NumInput v-model="r.to_jpy" /></label>
        <label class="f">Fee<NumInput v-model="r.value" /></label>
        <label class="f">Unit<select v-model="r.mode"><option value="fixed">¥ yen</option><option value="percent">% of car price</option></select></label>
        <label class="chk"><input v-model="r.active" type="checkbox" /> On</label>
        <button class="btn ghost" title="Remove band" @click="cif.splice(i, 1)">✕</button>
      </div>
      <div v-if="msgC" :class="okC ? 'okmsg' : 'err'" style="margin-top: 10px">{{ msgC }}</div>
      <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap"><button class="btn ghost" @click="addBand">+ Add a band</button><button class="btn" :disabled="busyC" @click="saveCif">Save the table</button></div>
    </div>

    <div v-if="profile?.role === 'ap_holder'" class="card" style="margin-bottom: 16px">
      <h2>My agent fee &amp; shipping</h2>
      <p class="muted small">The calculator adds an agent fee &amp; shipping (in yen) to the car price. By default it uses our standard table. If your own supplier charges differently, enter your rates here and the calculator uses them instead. Each row: cars priced below the yen amount pay that fee; the last row (empty amount) is for every car above.</p>
      <div v-if="!tiers.length" style="margin: 10px 0"><div class="muted small" style="margin-bottom: 8px">Now using: our standard table.</div><button class="btn" @click="startTiers">Set my own agent fee &amp; shipping</button></div>
      <div v-else>
        <div v-for="(t, i) in tiers" :key="i" class="trow">
          <span class="muted small">Car price below</span>
          <NumInput v-if="i < tiers.length - 1" v-model="t.upTo" placeholder="¥" />
          <span v-else class="muted small">and above (all other cars)</span>
          <span class="muted small">pays</span>
          <NumInput v-model="t.fee" />
          <select v-model="t.pct"><option :value="false">¥ yen</option><option :value="true">% of car price</option></select>
          <button class="btn ghost" :disabled="tiers.length < 2" title="Remove row" @click="tiers.splice(i, 1)">✕</button>
        </div>
        <button class="btn ghost" style="margin-top: 8px" @click="addTier">+ Add a price band</button>
      </div>
      <div v-if="msgT" :class="okT ? 'okmsg' : 'err'" style="margin-top: 10px">{{ msgT }}</div>
      <div v-if="tiers.length" style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap"><button class="btn" :disabled="busyT" @click="saveTiers">Save my table</button><button class="btn ghost" :disabled="busyT" @click="useAimTable">Use the standard table</button></div>
    </div>

    <div class="card" style="margin-bottom: 16px">
      <h2>Notifications on this device</h2>
      <p class="muted small">Get a notification on this phone or browser: new bid results, cars closing soon, and cars that fit your saved preferences.</p>
      <div class="muted small" style="margin: 8px 0">{{ pushText }}</div>
      <div v-if="pushErr" class="err" style="margin-bottom: 8px">{{ pushErr }}</div>
      <button v-if="push.state.value === 'off'" class="btn" :disabled="pushBusy" @click="pushOn">Turn on notifications</button>
      <button v-else-if="push.state.value === 'on'" class="btn ghost" :disabled="pushBusy" @click="pushOff">Turn off on this device</button>
    </div>

    <div class="card">
      <h2>Change password</h2>
      <div class="grid2">
        <label class="f" style="grid-column: 1 / -1">Current password<input v-model="cur" type="password" autocomplete="current-password" /></label>
        <label class="f">New password (at least 8 characters)<input v-model="next" type="password" autocomplete="new-password" /></label>
        <label class="f">New password again<input v-model="again" type="password" autocomplete="new-password" /></label>
      </div>
      <div v-if="msg2" :class="ok2 ? 'okmsg' : 'err'" style="margin-top: 10px">{{ msg2 }}</div>
      <div style="margin-top: 12px"><button class="btn" :disabled="busy2" @click="changePassword">Change password</button></div>
    </div>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const { profile, isStaff, loadProfile } = useAuth()
const push = useFcm()
const pushBusy = ref(false), pushErr = ref('')
const pushText = computed(() => ({ on: 'On for this device.', off: 'Off for this device.', blocked: 'Blocked. Allow notifications for this site in your browser or phone settings, then come back.', needs_install: 'On an iPhone, add this app to the Home Screen first, then turn notifications on.', not_configured: 'Not set up yet. The team still has to add the Google Firebase settings.', unsupported: 'This browser cannot receive notifications.' } as Record<string, string>)[push.state.value])
onMounted(() => push.refresh())
async function pushOn() { pushBusy.value = true; pushErr.value = ''; try { await push.enable() } catch (e: any) { pushErr.value = e.message } finally { pushBusy.value = false } }
async function pushOff() { pushBusy.value = true; try { await push.disable() } catch (e: any) { pushErr.value = e.message } finally { pushBusy.value = false } }
// ── import costs: staff set the team default (calc_presets), an AP holder keeps their own (empty = team default) ──
const fees = reactive<{ port: number | string | null; inland: number | string | null; apFee: number | string | null }>({ port: null, inland: null, apFee: null })
const shared = reactive({ port_myr: 2500, inland_myr: 250, ap_fee_myr: 10500 })
const busyF = ref(false), msgF = ref(''), okF = ref(false)
const numOrNull = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v))
async function loadFees() {
  if (isStaff.value) {
    const { data } = await db.from('calc_presets').select('preset_key,amount').in('preset_key', ['offer_port_myr', 'offer_inland_myr', 'offer_ap_fee_myr'])
    const m = Object.fromEntries((data || []).map((r: any) => [r.preset_key, Number(r.amount)]))
    fees.port = m.offer_port_myr ?? 2500; fees.inland = m.offer_inland_myr ?? 250; fees.apFee = m.offer_ap_fee_myr ?? 10500
  } else if (profile.value?.role === 'ap_holder') {
    const { data } = await db.rpc('import_fees')
    if (data) { Object.assign(shared, data.shared); fees.port = data.mine.port_myr; fees.inland = data.mine.inland_myr; fees.apFee = data.mine.ap_fee_myr }
  }
}
async function saveFees() {
  busyF.value = true; msgF.value = ''
  try {
    if (isStaff.value) {
      const rows = [['offer_port_myr', fees.port], ['offer_inland_myr', fees.inland], ['offer_ap_fee_myr', fees.apFee]].map(([preset_key, v]) => ({ preset_key, amount: numOrNull(v) }))
      if (rows.some((r) => r.amount == null || (r.amount as number) < 0)) throw new Error('Fill in all three amounts (0 or more).')
      const { error } = await db.from('calc_presets').upsert(rows, { onConflict: 'preset_key' })
      if (error) throw error
      msgF.value = 'Saved. Every AP holder without their own figures now starts from these.'
    } else {
      const { error } = await db.rpc('save_my_import_fees', { p_port: numOrNull(fees.port), p_inland: numOrNull(fees.inland), p_ap_fee: numOrNull(fees.apFee) })
      if (error) throw error
      msgF.value = 'Saved. These now start every import price and calculator you open.'
    }
    okF.value = true
  } catch (e: any) { okF.value = false; msgF.value = e.message } finally { busyF.value = false }
}
async function useTeam() { fees.port = fees.inland = fees.apFee = null; await saveFees() }
watch(() => [profile.value?.id, isStaff.value], () => { if (profile.value) loadFees() }, { immediate: true })

// ── staff: the team agent fee & shipping table (cif_rates, the same rows as the CIF rates page) ──
type CifRow = { id?: string; from_jpy: number | string | null; to_jpy: number | string | null; value: number | string | null; mode: 'fixed' | 'percent'; active: boolean }
const cif = ref<CifRow[]>([])
const busyC = ref(false), msgC = ref(''), okC = ref(false)
async function loadCif() {
  if (!isStaff.value) return
  const { data } = await db.from('cif_rates').select('*').order('from_jpy')
  cif.value = (data || []).map((r: any) => ({ id: r.id, from_jpy: Number(r.from_jpy), to_jpy: r.to_jpy == null ? null : Number(r.to_jpy), value: Number(r.value), mode: r.mode, active: r.active }))
}
const addBand = () => { const last = cif.value[cif.value.length - 1]; cif.value.push({ from_jpy: last ? Number(last.to_jpy) || null : 0, to_jpy: null, value: null, mode: 'fixed', active: true }) }
async function saveCif() {
  busyC.value = true; msgC.value = ''
  try {
    const rows = cif.value.map((r) => ({ id: r.id, from_jpy: numOrNull(r.from_jpy), to_jpy: numOrNull(r.to_jpy), value: numOrNull(r.value), mode: r.mode, active: r.active }))
    if (rows.some((r) => r.from_jpy == null || r.from_jpy < 0 || r.value == null || r.value <= 0)) throw new Error('Every band needs a "From" amount and a fee above 0.')
    if (rows.some((r) => r.to_jpy != null && r.to_jpy <= (r.from_jpy as number))) throw new Error('"To" must be more than "From".')
    const keep = rows.filter((r) => r.id).map((r) => r.id as string)
    const gone = ((await db.from('cif_rates').select('id')).data || []).map((r: any) => r.id as string).filter((id: string) => !keep.includes(id))
    if (gone.length) { const { error } = await db.from('cif_rates').delete().in('id', gone); if (error) throw error }
    const now = new Date().toISOString()
    for (const r of rows.filter((x) => x.id)) { const { error } = await db.from('cif_rates').update({ from_jpy: r.from_jpy, to_jpy: r.to_jpy, value: r.value, mode: r.mode, active: r.active, updated_at: now }).eq('id', r.id!); if (error) throw error }
    const fresh = rows.filter((x) => !x.id).map((r) => ({ from_jpy: r.from_jpy, to_jpy: r.to_jpy, value: r.value, mode: r.mode, active: r.active }))
    if (fresh.length) { const { error } = await db.from('cif_rates').insert(fresh); if (error) throw error }
    await loadCif()
    okC.value = true; msgC.value = 'Saved. The calculator and the CIF rates page now use this table.'
  } catch (e: any) { okC.value = false; msgC.value = e.message } finally { busyC.value = false }
}
watch(() => [profile.value?.id, isStaff.value], () => { if (profile.value) loadCif() }, { immediate: true })

// ── my own agent fee & shipping table (AP holders): empty = the AIM table ──
type TierRow = { upTo: number | string | null; fee: number | string | null; pct: boolean }
const tiers = ref<TierRow[]>([])
const busyT = ref(false), msgT = ref(''), okT = ref(false)
const BUILT_IN: TierRow[] = [{ upTo: 5000000, fee: 250000, pct: false }, { upTo: 8000000, fee: 300000, pct: false }, { upTo: 11000000, fee: 350000, pct: false }, { upTo: 14000000, fee: 400000, pct: false }, { upTo: 16000000, fee: 450000, pct: false }, { upTo: null, fee: 5, pct: true }]
const startTiers = async () => {      // copy the team table (or the built-in one if it is empty) as the starting point
  const { data } = await db.from('cif_rates').select('to_jpy,mode,value').eq('active', true).order('from_jpy')
  const rows: TierRow[] = (data || []).map((r: any) => ({ upTo: r.to_jpy == null ? null : Number(r.to_jpy), fee: Number(r.value), pct: r.mode === 'percent' }))
  tiers.value = rows.length ? rows : BUILT_IN.map((r) => ({ ...r }))
  const last = tiers.value[tiers.value.length - 1]!
  if (last.upTo != null) tiers.value.push({ upTo: null, fee: last.fee, pct: last.pct })      // the last row is always "and above"
}
async function loadTiers() {
  if (profile.value?.role !== 'ap_holder') return
  const { data } = await db.rpc('my_agent_tiers')
  tiers.value = Array.isArray(data) ? data.map((r: any) => ({ upTo: r.upTo ?? null, fee: r.fee, pct: !!r.pct })) : []
}
async function saveTiers() {
  busyT.value = true; msgT.value = ''
  try {
    const rows = tiers.value.map((r, i) => ({ upTo: i === tiers.value.length - 1 ? null : numOrNull(r.upTo), fee: numOrNull(r.fee), pct: !!r.pct }))
    if (rows.some((r) => r.fee == null || (r.fee as number) < 0)) throw new Error('Type a fee in every row (0 or more).')
    if (rows.slice(0, -1).some((r) => r.upTo == null || (r.upTo as number) <= 0)) throw new Error('Type the yen amount in every row except the last one.')
    const ups = rows.slice(0, -1).map((r) => r.upTo as number)
    if (ups.some((u, i) => i > 0 && u <= ups[i - 1]!)) throw new Error('The yen amounts must go up from one row to the next.')
    const { error } = await db.rpc('save_my_agent_tiers', { p_tiers: rows })
    if (error) throw error
    okT.value = true; msgT.value = 'Saved. The calculator now uses your own agent fee & shipping table.'
  } catch (e: any) { okT.value = false; msgT.value = e.message } finally { busyT.value = false }
}
async function useAimTable() {
  busyT.value = true; msgT.value = ''
  try { const { error } = await db.rpc('save_my_agent_tiers', { p_tiers: null }); if (error) throw error; tiers.value = []; okT.value = true; msgT.value = 'Back to the standard table.' } catch (e: any) { okT.value = false; msgT.value = e.message } finally { busyT.value = false }
}
watch(() => [profile.value?.id, isStaff.value], () => { if (profile.value) loadTiers() }, { immediate: true })

const f = reactive({ company_name: '', contact_name: '', phone: '', whatsapp: '', address: '' })
const cur = ref(''), next = ref(''), again = ref('')
const busy1 = ref(false), msg1 = ref(''), ok1 = ref(false), busy2 = ref(false), msg2 = ref(''), ok2 = ref(false)

watch(profile, (p) => { if (p) Object.assign(f, { company_name: p.company_name || '', contact_name: p.contact_name || '', phone: p.phone || '', whatsapp: p.whatsapp || '', address: p.address || '' }) }, { immediate: true })

async function saveDetails() {
  busy1.value = true; msg1.value = ''
  const t = (s: string) => s.trim() || null
  const { error } = await db.from('profiles').update({ company_name: t(f.company_name), contact_name: t(f.contact_name), phone: t(f.phone), whatsapp: t(f.whatsapp), address: t(f.address) }).eq('id', profile.value!.id)
  busy1.value = false
  ok1.value = !error; msg1.value = error ? error.message : 'Saved'
  if (!error) await loadProfile()
}

async function changePassword() {
  msg2.value = ''; ok2.value = false
  if (!cur.value) { msg2.value = 'Enter your current password'; return }
  if (next.value.length < 8) { msg2.value = 'The new password must be at least 8 characters'; return }
  if (next.value !== again.value) { msg2.value = 'The two new passwords are not the same'; return }
  if (next.value === cur.value) { msg2.value = 'The new password must be different from the current one'; return }
  busy2.value = true
  try {
    // check the current password first: someone at an unlocked screen cannot change it without knowing it
    const chk = await db.auth.signInWithPassword({ email: profile.value!.email!, password: cur.value })
    if (chk.error) throw new Error('The current password is not correct')
    const { error } = await db.auth.updateUser({ password: next.value })
    if (error) throw error
    cur.value = next.value = again.value = ''
    ok2.value = true; msg2.value = 'Password changed'
  } catch (e: any) { msg2.value = e.message } finally { busy2.value = false }
}
</script>

<style scoped>
.acct { max-width: 720px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
.crow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)) auto auto; gap: 8px; align-items: end; margin-top: 8px; } .crow .f { margin-top: 0; } .chk { display: flex; gap: 6px; align-items: center; padding-bottom: 10px; }
@media (max-width: 760px) { .crow { grid-template-columns: 1fr 1fr; } }
.trow { display: grid; grid-template-columns: auto minmax(110px, 1fr) auto minmax(110px, 1fr) auto auto; gap: 8px; align-items: center; margin-top: 8px; }
@media (max-width: 640px) { .trow { grid-template-columns: 1fr 1fr; } }
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 12px; }
.f { display: grid; gap: 5px; font-size: 12.5px; opacity: .9; } .f input { width: 100%; }
@media (max-width: 640px) { .grid2, .grid3 { grid-template-columns: 1fr; } }
</style>

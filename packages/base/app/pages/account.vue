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
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 12px; }
.f { display: grid; gap: 5px; font-size: 12.5px; opacity: .9; } .f input { width: 100%; }
@media (max-width: 640px) { .grid2, .grid3 { grid-template-columns: 1fr; } }
</style>

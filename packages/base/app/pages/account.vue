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
.f { display: grid; gap: 5px; font-size: 12.5px; opacity: .9; } .f input { width: 100%; }
@media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
</style>

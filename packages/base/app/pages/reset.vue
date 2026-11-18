<template>
  <div class="rbox card">
    <h1 style="font-size: 20px; margin: 0 0 6px">Choose your password</h1>
    <div v-if="state === 'checking'" class="muted">Checking your link ...</div>
    <template v-else-if="state === 'ready'">
      <label class="f">New password (at least 8 characters)<input v-model="pw" type="password" autocomplete="new-password" /></label>
      <label class="f">New password again<input v-model="pw2" type="password" autocomplete="new-password" @keyup.enter="save" /></label>
      <div v-if="err" class="err">{{ err }}</div>
      <button class="btn" :disabled="busy" @click="save">Save new password</button>
    </template>
    <template v-else-if="state === 'done'">
      <div class="okmsg">Your password is saved. You are signed in.</div>
      <NuxtLink to="/" class="btn" style="display: inline-flex; align-items: center; justify-content: center; text-decoration: none">Continue</NuxtLink>
    </template>
    <template v-else>
      <div class="err">This link is not valid any more. It may have expired or been used already.</div>
      <NuxtLink to="/login" class="small">Back to sign in, then use “Forgot password” again</NuxtLink>
    </template>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const route = useRoute()
const state = ref<'checking' | 'ready' | 'done' | 'bad'>('checking')
const pw = ref(''), pw2 = ref(''), err = ref(''), busy = ref(false)

// the e-mail link brings a recovery session: either in the address (#access_token ...) or as a one-time ?code=
onMounted(async () => {
  try {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ''))
    const code = typeof route.query.code === 'string' ? route.query.code : null
    if (hash.get('access_token') && hash.get('refresh_token')) {
      const { error } = await db.auth.setSession({ access_token: hash.get('access_token')!, refresh_token: hash.get('refresh_token')! })
      if (error) throw error
    } else if (code) {
      const { error } = await db.auth.exchangeCodeForSession(code)
      if (error) throw error
    }
    const { data } = await db.auth.getSession()
    state.value = data.session ? 'ready' : 'bad'
    history.replaceState(null, '', location.pathname)         // keep the token out of the address bar
  } catch { state.value = 'bad' }
})

async function save() {
  err.value = ''
  if (pw.value.length < 8) { err.value = 'The new password must be at least 8 characters'; return }
  if (pw.value !== pw2.value) { err.value = 'The two passwords are not the same'; return }
  busy.value = true
  try {
    const { error } = await db.auth.updateUser({ password: pw.value })
    if (error) throw error
    state.value = 'done'
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
</script>

<style scoped>
.rbox { width: 100%; max-width: 400px; display: grid; gap: 12px; }
.f { display: grid; gap: 5px; font-size: 12.5px; opacity: .9; } .f input { width: 100%; }
</style>

<template>
  <div class="login card">
    <div class="brand" style="padding: 0 0 8px"><div class="logo">AIM</div><div><b>Auction Import Margin</b><small>Sign in</small></div></div>
    <label>Email<input v-model="email" type="email" autocomplete="email" /></label>
    <label>Password<input v-model="password" type="password" autocomplete="current-password" @keyup.enter="submit" /></label>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="info" class="okmsg">{{ info }}</div>
    <button class="btn" :disabled="busy" @click="submit">Sign in</button>
    <a href="#" class="muted small" @click.prevent="forgot">Forgot your password?</a>
    <p class="muted small">New AP holder? Ask us to activate your account.</p>
  </div>
</template>

<script setup lang="ts">
const { signIn, hasTier, resetPassword } = useAuth()
const route = useRoute()
const email = ref(''), password = ref(''), busy = ref(false), error = ref(''), info = ref('')
async function forgot() {
  error.value = ''; info.value = ''
  if (!email.value.trim()) { error.value = 'Type your email above first, then press “Forgot your password?”'; return }
  try { await resetPassword(email.value.trim()); info.value = 'If that email has an account, we sent a link to choose a new password. Check your inbox.' } catch (e: any) { error.value = e.message }
}
async function submit() {
  error.value = ''
  if (!email.value || !password.value) { error.value = 'Enter your email and password'; return }
  busy.value = true
  try { await signIn(email.value.trim(), password.value); const next = String(route.query.next || ''); await navigateTo(next.startsWith('/') && !next.startsWith('//') ? next : hasTier('member') ? '/today' : '/search') }
  catch (e: any) { error.value = e.message || 'Something went wrong' } finally { busy.value = false }
}
</script>


<template>
  <div class="login card">
    <div class="brand" style="padding: 0 0 8px"><div class="logo">AIM</div><div><b>Auction Import Margin</b><small>Welcome</small></div></div>
    <template v-if="!done">
      <p class="muted small" style="margin: 0">Our team gave you a viewing code. Create your login to see the cars we picked for you. Your access lasts for the time we set.</p>
      <label>Viewing code<input v-model="code" autocapitalize="characters" autocomplete="off" placeholder="e.g. 7K2M9QX4AB" /></label>
      <label>Your name<input v-model="name" autocomplete="name" /></label>
      <label>Email<input v-model="email" type="email" autocomplete="email" /></label>
      <label>Choose a password (8 characters or more)<input v-model="password" type="password" autocomplete="new-password" @keyup.enter="submit" /></label>
      <div v-if="error" class="err">{{ error }}</div>
      <button class="btn" :disabled="busy" @click="submit">Start viewing</button>
      <NuxtLink to="/login" class="muted small">Already have a login? Sign in</NuxtLink>
    </template>
    <template v-else>
      <div class="okmsg">{{ doneMsg }}</div>
      <NuxtLink v-if="signedIn" to="/for-you" class="btn" style="text-align: center; text-decoration: none">See your cars</NuxtLink>
      <NuxtLink v-else to="/login" class="btn" style="text-align: center; text-decoration: none">Go to sign in</NuxtLink>
    </template>
  </div>
</template>

<script setup lang="ts">
const { signUp, redeemPass, user } = useAuth()
const route = useRoute()
const code = ref(String(route.query.code || '').toUpperCase()), name = ref(''), email = ref(''), password = ref('')
const busy = ref(false), error = ref(''), done = ref(false), doneMsg = ref(''), signedIn = ref(false)

async function submit() {
  error.value = ''
  if (!code.value.trim() || !name.value.trim() || !email.value.trim()) { error.value = 'Fill in the code, your name and your email'; return }
  if (password.value.length < 8) { error.value = 'The password needs 8 characters or more'; return }
  busy.value = true
  try {
    const r = await signUp(email.value.trim(), password.value, { contact_name: name.value.trim() })
    if (r.session) {
      user.value = r.session.user
      await redeemPass(code.value.trim())
      signedIn.value = true; done.value = true; doneMsg.value = 'You are in. Your viewing time has started.'
    } else {
      // the project asks for an email confirmation first: remember the code, finish it at the first sign-in
      try { localStorage.setItem('aim-pass', code.value.trim()) } catch { /* private window */ }
      done.value = true; doneMsg.value = 'Almost done: we sent you an email. Open the link in it, then sign in here. Your viewing time starts when you sign in.'
    }
  } catch (e: any) { error.value = e.message || 'Something went wrong' } finally { busy.value = false }
}
</script>

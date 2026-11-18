<template>
  <div class="loginpage">
    <div class="loginhero">
      <div class="logo">Dealer <b>PublicGo</b></div>
      <div><h2>Japan auction cars, priced in RM</h2><p>See the import price, a suggested bid and the closing time of every car. Place your bid order in a minute.</p></div>
      <div />
    </div>
    <div class="loginform">
  <div class="authbox">
    <h1>{{ register ? 'Create your account' : 'Welcome back' }}</h1>
    <p class="muted" style="margin: 0">{{ register ? 'Create your dealer account. We activate it after checking your details.' : 'Sign in to see the cars and place bid orders.' }}</p>
    <template v-if="register">
      <label>Company name<input v-model="company" autocomplete="organization" /></label>
      <label>Your name<input v-model="contact" autocomplete="name" /></label>
      <label>Phone / WhatsApp<input v-model="phone" autocomplete="tel" /></label>
    </template>
    <label>Email<input v-model="email" type="email" autocomplete="email" /></label>
    <label>Password<input v-model="password" type="password" :autocomplete="register ? 'new-password' : 'current-password'" @keyup.enter="submit" /></label>
    <div v-if="error" class="err">{{ error }}</div>
    <div v-if="done" class="okmsg">{{ done }}</div>
    <button class="btn" :disabled="busy" @click="submit">{{ register ? 'Create account' : 'Sign in' }}</button>
    <a v-if="!register" href="#" class="small" @click.prevent="forgot">Forgot your password?</a>
    <a href="#" class="small" @click.prevent="register = !register; error = ''; done = ''">{{ register ? 'I already have an account' : 'New dealer? Create an account' }}</a>
  </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { signIn, signUp, resetPassword } = useAuth()
const email = ref(''), password = ref(''), company = ref(''), contact = ref(''), phone = ref('')
const register = ref(false), busy = ref(false), error = ref(''), done = ref('')

async function forgot() {
  error.value = ''; done.value = ''
  if (!email.value.trim()) { error.value = 'Type your email above first, then press “Forgot your password?”'; return }
  try { await resetPassword(email.value.trim()); done.value = 'If that email has an account, we sent a link to choose a new password. Check your inbox.' } catch (e: any) { error.value = e.message }
}

async function submit() {
  error.value = ''; done.value = ''
  if (!email.value || !password.value) { error.value = 'Enter your email and password'; return }
  if (register.value && (!company.value || !contact.value)) { error.value = 'Enter your company and your name'; return }
  busy.value = true
  try {
    if (register.value) {
      await signUp(email.value.trim(), password.value, { company_name: company.value.trim(), contact_name: contact.value.trim(), phone: phone.value.trim(), whatsapp: phone.value.trim() })
      done.value = 'Account created. We will activate it soon; you can sign in once it is approved.'
      register.value = false
    } else {
      await signIn(email.value.trim(), password.value)
      await navigateTo('/')
    }
  } catch (e: any) { error.value = e.message || 'Something went wrong' } finally { busy.value = false }
}
</script>

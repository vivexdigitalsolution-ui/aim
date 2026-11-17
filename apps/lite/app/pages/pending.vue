<template>
  <div class="authbox card">
    <h1>Waiting for approval</h1>
    <p class="muted" style="margin: 0">Your account is not active yet. We will activate it after checking your details.</p>
    <button class="btn ghost" @click="logout">Sign out</button>
  </div>
</template>

<script setup lang="ts">
const { signOut } = useAuth()
async function logout() { await signOut(); await navigateTo('/login') }
</script>

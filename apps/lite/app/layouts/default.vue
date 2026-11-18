<template>
  <div v-if="!showShell" class="authwrap"><slot /></div>
  <div v-else>
    <header class="top">
      <div class="in">
        <div class="logo">Dealer <b>PublicGo</b></div>
        <nav class="tabs"><NuxtLink to="/" exact-active-class="router-link-active" :class="{ 'router-link-active': route.path === '/' || route.path.startsWith('/car') }">Cars</NuxtLink><NuxtLink to="/watchlist">Watchlist</NuxtLink><NuxtLink to="/orders">My bid orders</NuxtLink></nav>
        <div class="who"><NuxtLink to="/account" class="name">{{ profile?.company_name || profile?.contact_name || profile?.email }}</NuxtLink><button class="btn ghost sm" @click="logout">Sign out</button></div>
      </div>
    </header>
    <main class="page"><slot /></main>
  </div>
</template>

<script setup lang="ts">
const { user, profile, signOut } = useAuth()
const route = useRoute()
const showShell = computed(() => !!user.value && profile.value?.status === 'active' && route.path !== '/login' && route.path !== '/pending')
async function logout() { await signOut(); await navigateTo('/login') }
</script>

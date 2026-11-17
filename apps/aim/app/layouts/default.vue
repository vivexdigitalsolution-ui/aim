<template>
  <div v-if="!showShell" class="authshell"><slot /></div>
  <div v-else class="shell">
    <aside class="side">
      <div class="brand"><div class="logo">AIM</div><div><b>Auction Import Margin</b><small>{{ isStaff ? 'Staff' : 'AP holder' }}</small></div></div>
      <NavPill :items="items" />
      <div class="sidefoot">
        <b>{{ profile?.company_name || profile?.contact_name || profile?.email }}</b>
        {{ isStaff ? 'Staff access' : (profile?.tier || 'member') + ' tier' }}
        <div style="margin-top: 8px"><button class="btn ghost sm" @click="logout">Sign out</button></div>
      </div>
    </aside>
    <main class="main"><slot /></main>
    <nav class="tabbar"><NavPill :items="items" mobile /></nav>
  </div>
</template>

<script setup lang="ts">
import type { NavItem } from '~/components/NavPill.vue'
const { user, profile, isStaff, hasTier, signOut } = useAuth()
const route = useRoute()
const showShell = computed(() => !!user.value && profile.value?.status === 'active' && route.path !== '/login' && route.path !== '/pending')
const reviewCount = useState<number | null>('review-count', () => null)
const items = computed<NavItem[]>(() => [
  ...(hasTier('member') ? [{ to: '/today', label: 'Today for you', short: 'Today', icon: 'today' }, { to: '/margin', label: 'Margin analysis', short: 'Margin', icon: 'margin' }] : [{ to: '/upgrade', label: 'Upgrade', short: 'Upgrade', icon: 'today' }]),
  ...(isStaff.value ? [{ to: '/review', label: 'Docket review', short: 'Review', icon: 'review', badge: reviewCount.value || null }] : []),
  { to: '/search', label: 'Find by feature', short: 'Find', icon: 'search' },
])
async function logout() { await signOut(); await navigateTo('/login') }
</script>

<template>
  <div v-if="!showShell" class="authwrap" :class="{ full: route.path === '/login' }"><slot /></div>
  <div v-else>
    <header class="topbar">
      <NuxtLink to="/" class="logo">Dealer <b>PublicGo</b></NuxtLink>
      <div class="who"><NuxtLink to="/account" class="name">{{ profile?.company_name || profile?.contact_name || profile?.email }}</NuxtLink><button class="btn ghost sm" @click="logout">Sign out</button></div>
    </header>
    <nav class="rail">
      <a v-for="i in items" :key="i.to" :href="i.to" :class="{ on: isOn(i) }" :title="i.label" @click.prevent="navigateTo(i.to)">
        <RailIcon :name="i.icon" />{{ i.label }}<span v-if="i.badge" class="badge">{{ i.badge }}</span>
      </a>
    </nav>
    <main class="page"><slot /></main>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const { user, profile, signOut, isStaff } = useAuth()
const route = useRoute()
const showShell = computed(() => !!user.value && profile.value?.status === 'active' && route.path !== '/login' && route.path !== '/pending')
async function logout() { await signOut(); await navigateTo('/login') }

const toPlace = useState<number>('lite-to-place', () => 0)
async function loadBadge() {
  if (!isStaff.value) return
  const { count } = await db.from('bids').select('id', { count: 'exact', head: true }).eq('status', 'pending')
  toPlace.value = count || 0
}
watch(() => [isStaff.value, route.path], loadBadge, { immediate: true })

type Item = { to: string; label: string; icon: string; badge?: number | null; match?: (p: string) => boolean }
const items = computed<Item[]>(() => [
  { to: '/', label: 'Home', icon: 'home', match: (p) => p === '/' },
  { to: '/cars', label: 'Marketplace', icon: 'cars', match: (p) => p.startsWith('/cars') || p.startsWith('/car/') },
  { to: '/watchlist', label: 'Favourite', icon: 'heart' },
  { to: '/orders', label: 'My orders', icon: 'orders' },
  { to: '/calculator', label: 'Calculator', icon: 'calc' },
  ...(isStaff.value ? [
    { to: '/bids', label: 'Bid queue', icon: 'queue', badge: toPlace.value || null },
    { to: '/aps', label: 'AP holders', icon: 'users', match: (p: string) => p === '/aps' && !route.query.tab },
    { to: '/offer', label: 'Offer report', icon: 'offer' },
    { to: '/targets', label: 'Scrape targets', icon: 'target' },
    { to: '/aps?tab=fees', label: 'Settings', icon: 'settings', match: (p: string) => p === '/aps' && !!route.query.tab },
  ] : []),
])
const isOn = (i: Item) => { const p = route.path.replace(/\/$/, '') || '/'; return i.match ? i.match(p) : p === i.to || p.startsWith(i.to + '/') }
</script>

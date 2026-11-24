<template>
  <div v-if="!showShell" class="authwrap" :class="{ full: route.path === '/login' }"><slot /></div>
  <div v-else>
    <header class="topbar">
      <NuxtLink to="/" class="logo">Dealer <b>PublicGo</b></NuxtLink>
      <div class="mbtns">
        <button class="mbtn" :class="{ on: route.path.startsWith('/account') }" title="My account" aria-label="My account" @click="navigateTo('/account')"><RailIcon name="user" /></button>
        <button class="mbtn" title="Log out" aria-label="Log out" @click="logout"><RailIcon name="logout" /></button>
      </div>
    </header>
    <nav class="rail">
      <a v-for="i in items" :key="i.to" :href="i.to" :class="{ on: isOn(i), 'm-hide': hasMore && !i.primary }" :title="i.label" @click.prevent="navigateTo(i.to)">
        <RailIcon :name="i.icon" />{{ i.label }}<span v-if="i.badge" class="badge">{{ i.badge }}</span>
      </a>
      <button v-if="hasMore" class="morebtn" :class="{ on: moreOpen || hiddenActive }" @click="moreOpen = true"><RailIcon name="more" />More<span v-if="hiddenBadge" class="badge">{{ hiddenBadge }}</span></button>
      <span class="spacer" />
      <a href="/account" class="acct" :class="{ on: route.path.startsWith('/account') }" title="My account" @click.prevent="navigateTo('/account')"><RailIcon name="user" />My account</a>
      <button class="logout" @click="logout"><RailIcon name="logout" />Log out</button>
    </nav>
    <main class="page"><slot /></main>

    <!-- phone: everything the bottom bar has no room for -->
    <Transition name="sheet">
      <div v-if="moreOpen" class="sheet-back" @click.self="moreOpen = false">
        <div class="sheet" role="dialog" aria-label="All options">
          <div class="grab" />
          <div class="sgrid">
            <a v-for="i in items" :key="i.to" :href="i.to" :class="{ on: isOn(i) }" @click.prevent="navigateTo(i.to)"><span class="sic"><RailIcon :name="i.icon" /></span>{{ i.label }}<span v-if="i.badge" class="badge">{{ i.badge }}</span></a>
            <a href="/account" :class="{ on: route.path.startsWith('/account') }" @click.prevent="navigateTo('/account')"><span class="sic"><RailIcon name="user" /></span>My account</a>
            <a href="#" class="out" @click.prevent="logout"><span class="sic"><RailIcon name="logout" /></span>Log out</a>
          </div>
        </div>
      </div>
    </Transition>
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

type Item = { to: string; label: string; icon: string; badge?: number | null; primary?: boolean; match?: (p: string) => boolean }
// A dealer buys cars: favourites and their own orders. Staff do not bid or keep favourites: they place the dealers' bids (Bid queue) and run the office.
// On a phone everyone gets 4 icons + More (a drawer with everything); on a computer the whole rail shows.
const items = computed<Item[]>(() => isStaff.value ? [
  { to: '/', label: 'Home', icon: 'home', primary: true, match: (p) => p === '/' },
  { to: '/calculator', label: 'Calculator', icon: 'calc', primary: true },
  { to: '/bids', label: 'Bid queue', icon: 'queue', primary: true, badge: toPlace.value || null },
  { to: '/aps', label: 'AP holders', icon: 'users', primary: true, match: (p: string) => p === '/aps' && !route.query.tab },
  { to: '/cars', label: 'Marketplace', icon: 'cars', match: (p) => p.startsWith('/cars') || p.startsWith('/car/') },
  { to: '/offer', label: 'Offer report', icon: 'offer' },
  { to: '/cif', label: 'CIF rates', icon: 'table' },
  { to: '/targets', label: 'Scrape targets', icon: 'target' },
  { to: '/aps?tab=fees', label: 'Settings', icon: 'settings', match: (p: string) => p === '/aps' && !!route.query.tab },
] : [
  { to: '/', label: 'Home', icon: 'home', primary: true, match: (p) => p === '/' },
  { to: '/cars', label: 'Marketplace', icon: 'cars', primary: true, match: (p) => p.startsWith('/cars') || p.startsWith('/car/') },
  { to: '/orders', label: 'My orders', icon: 'orders', primary: true },
  { to: '/calculator', label: 'Calculator', icon: 'calc', primary: true },
  { to: '/watchlist', label: 'Favourites', icon: 'heart' },
  { to: '/cif', label: 'CIF rates', icon: 'table' },
])
const hasMore = computed(() => items.value.some((i) => !i.primary))     // phone: 4 icons + More (staff and dealers alike); the rest sits in the drawer
const moreOpen = ref(false)
watch(() => route.fullPath, () => { moreOpen.value = false })
const hiddenActive = computed(() => items.value.some((i) => !i.primary && isOn(i)) || route.path.startsWith('/account'))
const hiddenBadge = computed(() => 0)
const isOn = (i: Item) => { const p = route.path.replace(/\/$/, '') || '/'; return i.match ? i.match(p) : p === i.to || p.startsWith(i.to + '/') }
</script>

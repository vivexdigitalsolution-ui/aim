<template>
  <div v-if="!showShell" class="authshell"><slot /></div>
  <div v-else class="shell">
    <aside class="side">
      <div class="brand"><div class="logo">AIM</div><div><b>Auction Import Margin</b><small>{{ isStaff ? 'Staff' : profile?.role === 'customer' ? 'Guest' : 'AP holder' }}</small></div></div>
      <NavPill :items="items" />
      <div class="sidefoot">
        <NuxtLink to="/account" class="acctlink"><b>{{ profile?.company_name || profile?.contact_name || profile?.email }}</b><small>My account</small></NuxtLink>
        {{ isStaff ? 'Staff access' : profile?.role === 'customer' ? 'Viewing access' : (profile?.tier || 'free') + ' tier' }}
        <NuxtLink v-if="isStaff && sysLabel" to="/status" class="sysline"><span class="sdot" :class="sysLevel" />{{ sysLabel }}</NuxtLink>
        <div style="margin-top: 8px"><button class="btn ghost sm" @click="logout">Sign out</button></div>
      </div>
    </aside>
    <main class="main"><slot /></main>
    <nav class="tabbar">
      <NavPill :items="barItems" mobile />
      <button v-if="moreItems.length" type="button" class="morebtn" :class="{ on: moreOpen }" @click="moreOpen = !moreOpen">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg><span>More</span>
      </button>
    </nav>
    <div v-if="moreOpen" class="moreback" @click="moreOpen = false">
      <div class="moresheet" @click.stop>
        <NuxtLink v-for="it in moreItems" :key="it.to" :to="it.to" class="moreitem" @click="moreOpen = false"><span class="mi" v-html="NAV_ICONS[it.icon]" /><span class="ml">{{ it.short || it.label }}</span><span v-if="it.badge" class="n">{{ it.badge }}</span></NuxtLink>
        <NuxtLink to="/account" class="moreitem" @click="moreOpen = false"><span class="mi" v-html="NAV_ICONS.account" /><span class="ml">Account</span></NuxtLink>
        <button type="button" class="moreitem out" @click="moreOpen = false; logout()"><span class="mi" v-html="NAV_ICONS.signout" /><span class="ml">Sign out</span></button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NavItem } from '~/components/NavPill.vue'
const { user, profile, isStaff, hasTier, signOut } = useAuth()
const route = useRoute()
const showShell = computed(() => !!user.value && profile.value?.status === 'active' && route.path !== '/login' && route.path !== '/pending')
const reviewCount = useState<number | null>('review-count', () => null)
const bidCount = useState<number | null>('bid-count', () => null)
const alertCount = useState<number | null>('alert-count', () => null)
const pendingAps = useState<number | null>('pending-aps', () => null)
const openRequests = useState<number | null>('open-requests', () => null)
const db = useDb()
const { level: sysLevel, label: sysLabel, load: loadStatus } = useSystemStatus()
const items = computed<NavItem[]>(() => profile.value?.role === 'customer' ? [{ to: '/', label: 'Home', short: 'Home', icon: 'home' }, { to: '/for-you', label: 'Cars for you', short: 'Cars', icon: 'cars' }] : [
  { to: '/', label: 'Dashboard', short: 'Home', icon: 'home' },
  { to: '/cars', label: 'Cars', short: 'Cars', icon: 'cars' },
  ...(hasTier('member') ? [{ to: '/today', label: 'Today for you', short: 'Today', icon: 'today' }, { to: '/margin', label: 'Margin analysis', short: 'Margin', icon: 'margin' }, { to: '/explorer', label: 'Market explorer', short: 'Explorer', icon: 'explorer' }, { to: '/history', label: 'History price', short: 'History', icon: 'history' }, ...(isStaff.value ? [{ to: '/market', label: 'Market prices', short: 'Prices', icon: 'prices' }] : [])] : [{ to: '/upgrade', label: 'Upgrade', short: 'Upgrade', icon: 'upgrade' }]),
  ...(isStaff.value ? [{ to: '/bids', label: 'Bid pipeline', short: 'Bids', icon: 'bids', badge: bidCount.value || null }, { to: '/lists', label: 'Dealer lists', short: 'Lists', icon: 'lists' }, { to: '/kpi', label: 'KPIs', short: 'KPIs', icon: 'chart' }, { to: '/segments', label: 'Segments', short: 'Segments', icon: 'segments' }, { to: '/customers', label: 'Walk-in customers', short: 'Customers', icon: 'customers' }, { to: '/costing', label: 'Order costing', short: 'Costing', icon: 'costing' }, { to: '/offer', label: 'Offer report', short: 'Offer', icon: 'offer' }, { to: '/targets', label: 'Scrape targets', short: 'Targets', icon: 'targets' }] : []),
  { to: '/calculator', label: 'Import calculator', short: 'Calc', icon: 'calc' },
  ...(!isStaff.value && hasTier('member') ? [{ to: '/buylist', label: 'My buy list', short: 'Buy list', icon: 'buylist' }] : []),
  ...(isStaff.value ? [{ to: '/review', label: 'Docket review', short: 'Review', icon: 'review', badge: reviewCount.value || null }] : []),
  { to: '/search', label: 'Find by feature', short: 'Find', icon: 'search' },
  { to: '/watchlist', label: 'Watchlist', short: 'Watch', icon: 'star' },
  { to: '/preferences', label: 'My preferences', short: 'Prefs', icon: 'prefs' },
  { to: '/requests', label: isStaff.value ? 'Sourcing requests' : 'Find me a car', short: isStaff.value ? 'Requests' : 'Request', icon: 'request', badge: isStaff.value ? openRequests.value || null : null },
  ...(!isStaff.value && hasTier('member') ? [{ to: '/orders', label: 'My bid orders', short: 'Orders', icon: 'orders' }] : []),
  { to: '/alerts', label: 'Alerts', short: 'Alerts', icon: 'bell', badge: alertCount.value || null },
  ...(isStaff.value ? [{ to: '/aps', label: 'AP holders', short: 'APs', icon: 'users', badge: pendingAps.value || null }] : []),
])
// phone bottom bar: 4 main pages + a More button that opens the rest
const moreOpen = ref(false)
watch(() => route.path, () => { moreOpen.value = false })
const mainTo = computed(() => profile.value?.role === 'customer' ? ['/', '/for-you'] : isStaff.value ? ['/', '/cars', '/bids', '/review'] : ['/', '/cars', '/watchlist', hasTier('member') ? '/orders' : '/calculator'])
const barItems = computed(() => mainTo.value.map((t) => items.value.find((i) => i.to === t)).filter(Boolean) as NavItem[])
const moreItems = computed(() => (profile.value?.role === 'customer' ? [] : items.value.filter((i) => !mainTo.value.includes(i.to))))
// badge counts for staff: bid orders waiting to be placed, dockets waiting for a decision (refreshed every minute)
async function loadCounts() {
  if (profile.value?.role === 'customer') return
  const a = await db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  if (a.count != null) alertCount.value = a.count
  if (!isStaff.value) return
  const [b, r, p, q] = await Promise.all([
    db.from('bids').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('lot_docket_decisions').select('lot_id', { count: 'exact', head: true }).eq('status', 'review'),
    db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'ap_holder').eq('status', 'pending'),
    db.from('sourcing_requests').select('id', { count: 'exact', head: true }).eq('status', 'open'),
  ])
  if (q.count != null) openRequests.value = q.count
  if (b.count != null) bidCount.value = b.count
  if (r.count != null) reviewCount.value = r.count
  if (p.count != null) pendingAps.value = p.count
}
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => { loadCounts(); loadStatus().catch(() => {}); timer = setInterval(() => { loadCounts(); loadStatus().catch(() => {}) }, 60_000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
async function logout() { await signOut(); await navigateTo('/login') }
</script>

<style scoped>
.morebtn { display: none; }
.moreback { display: none; }
@media (max-width: 760px) {
  .tabbar :deep(.navwrap) { flex: 4 1 0; min-width: 0; width: auto; }
  .morebtn { display: flex; flex: 1 1 0; flex-direction: column; align-items: center; justify-content: center; gap: 2px; height: 48px; border: 0; background: none; color: var(--mu); font-size: 10px; border-radius: 10px; cursor: pointer; min-width: 0; }
  .morebtn svg { width: 18px; height: 18px; } .morebtn.on { color: var(--ac); }
  .moreback { display: block; position: fixed; inset: 0; background: rgba(0, 0, 0, .55); z-index: 20; }
  .moresheet { position: absolute; left: 10px; right: 10px; bottom: calc(76px + env(safe-area-inset-bottom)); max-height: 70vh; overflow-y: auto; background: var(--s2); border: 1px solid var(--line); border-radius: 16px; padding: 6px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; }
  .moreitem { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 84px; padding: 8px 4px; border: 0; background: none; color: inherit; text-decoration: none; text-align: center; border-radius: 12px; cursor: pointer; }
  .moreitem:active { background: var(--s3); } .moreitem.out { color: var(--bad); }
  .moreitem .mi { width: 44px; height: 44px; border-radius: 14px; background: var(--s3); display: grid; place-items: center; color: var(--ac); } .moreitem.out .mi { color: var(--bad); }
  .moreitem .mi :deep(svg) { width: 22px; height: 22px; }
  .moreitem .ml { font-size: 11.5px; line-height: 1.2; color: var(--tx); overflow-wrap: anywhere; }
  .moreitem .n { position: absolute; top: 4px; right: 14px; font-size: 10px; background: var(--ac); color: #1a0b05; border-radius: 20px; padding: 1px 6px; font-weight: 700; }
}
.acctlink { display: block; text-decoration: none; color: inherit; }
.acctlink small { display: block; color: var(--mu); font-size: 11px; }
.sysline { display: flex; align-items: center; gap: 7px; margin-top: 8px; color: var(--mu); font-size: 12px; text-decoration: none; }
.sdot { width: 8px; height: 8px; border-radius: 50%; background: var(--mu2); flex: none; }
.sdot.ok { background: var(--ok); } .sdot.warn { background: var(--warn); } .sdot.bad { background: var(--bad); }
</style>

<template>
  <div v-if="!showShell" class="authshell"><slot /></div>
  <div v-else class="shell">
    <aside class="side">
      <div class="brand"><div class="logo">AIM</div><div><b>Auction Import Margin</b><small>{{ isStaff ? 'Staff' : 'AP holder' }}</small></div></div>
      <NavPill :items="items" />
      <div class="sidefoot">
        <NuxtLink to="/account" class="acctlink"><b>{{ profile?.company_name || profile?.contact_name || profile?.email }}</b><small>My account</small></NuxtLink>
        {{ isStaff ? 'Staff access' : (profile?.tier || 'free') + ' tier' }}
        <NuxtLink v-if="isStaff && sysLabel" to="/status" class="sysline"><span class="sdot" :class="sysLevel" />{{ sysLabel }}</NuxtLink>
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
const bidCount = useState<number | null>('bid-count', () => null)
const alertCount = useState<number | null>('alert-count', () => null)
const pendingAps = useState<number | null>('pending-aps', () => null)
const db = useDb()
const { level: sysLevel, label: sysLabel, load: loadStatus } = useSystemStatus()
const items = computed<NavItem[]>(() => [
  { to: '/cars', label: 'Cars', short: 'Cars', icon: 'cars' },
  ...(hasTier('member') ? [{ to: '/today', label: 'Today for you', short: 'Today', icon: 'today' }, { to: '/margin', label: 'Margin analysis', short: 'Margin', icon: 'margin' }, { to: '/explorer', label: 'Market explorer', short: 'Explorer', icon: 'chart' }, ...(isStaff.value ? [{ to: '/market', label: 'Market prices', short: 'Prices', icon: 'tag' }] : [])] : [{ to: '/upgrade', label: 'Upgrade', short: 'Upgrade', icon: 'today' }]),
  ...(isStaff.value ? [{ to: '/bids', label: 'Bid pipeline', short: 'Bids', icon: 'bids', badge: bidCount.value || null }, { to: '/lists', label: 'Dealer lists', short: 'Lists', icon: 'lists' }] : []),
  ...(!isStaff.value && hasTier('member') ? [{ to: '/buylist', label: 'My buy list', short: 'Buy list', icon: 'lists' }] : []),
  ...(isStaff.value ? [{ to: '/review', label: 'Docket review', short: 'Review', icon: 'review', badge: reviewCount.value || null }] : []),
  { to: '/search', label: 'Find by feature', short: 'Find', icon: 'search' },
  ...(!isStaff.value && hasTier('member') ? [{ to: '/orders', label: 'My bid orders', short: 'Orders', icon: 'bids' }] : []),
  { to: '/alerts', label: 'Alerts', short: 'Alerts', icon: 'bell', badge: alertCount.value || null },
  ...(isStaff.value ? [{ to: '/aps', label: 'AP holders', short: 'APs', icon: 'users', badge: pendingAps.value || null }] : []),
])
// badge counts for staff: bid orders waiting to be placed, dockets waiting for a decision (refreshed every minute)
async function loadCounts() {
  const a = await db.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  if (a.count != null) alertCount.value = a.count
  if (!isStaff.value) return
  const [b, r, p] = await Promise.all([
    db.from('bids').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('lot_docket_decisions').select('lot_id', { count: 'exact', head: true }).eq('status', 'review'),
    db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'ap_holder').eq('status', 'pending'),
  ])
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
.acctlink { display: block; text-decoration: none; color: inherit; }
.acctlink small { display: block; color: var(--mu); font-size: 11px; }
.sysline { display: flex; align-items: center; gap: 7px; margin-top: 8px; color: var(--mu); font-size: 12px; text-decoration: none; }
.sdot { width: 8px; height: 8px; border-radius: 50%; background: var(--mu2); flex: none; }
.sdot.ok { background: var(--ok); } .sdot.warn { background: var(--warn); } .sdot.bad { background: var(--bad); }
</style>

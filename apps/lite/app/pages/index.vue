<template>
  <div>
    <!-- live strip -->
    <NuxtLink to="/cars?sort=closing" class="live card">
      <span class="dot" :class="{ off: !nextClose }" />
      <template v-if="nextClose"><b>Bidding is open</b><span>closes in</span><span class="clock">{{ countdown }}</span></template>
      <b v-else>No car is open for bidding right now</b>
      <span class="grow" /><span class="ac">Browse cars ›</span>
    </NuxtLink>

    <div class="home">
      <div class="main">
        <!-- banner -->
        <div class="banner" :style="{ background: slides[si]!.bg }">
          <div class="bt">
            <small>{{ slides[si]!.kicker }}</small>
            <h2>{{ slides[si]!.title }}</h2>
            <p>{{ slides[si]!.text }}</p>
            <NuxtLink :to="slides[si]!.to" class="btn yellow">{{ slides[si]!.cta }}</NuxtLink>
          </div>
          <div class="big">{{ slides[si]!.big }}</div>
          <button class="nav l" aria-label="Previous" @click="si = (si + slides.length - 1) % slides.length">‹</button>
          <button class="nav r" aria-label="Next" @click="si = (si + 1) % slides.length">›</button>
          <div class="dots"><i v-for="(s, i) in slides" :key="i" :class="{ on: i === si }" @click="si = i" /></div>
        </div>

        <div class="two">
          <!-- my tasks -->
          <div class="card">
            <div class="sect">{{ isStaff ? 'Bid orders' : 'My tasks' }}</div>
            <div class="tiles">
              <NuxtLink v-for="t in tasks" :key="t.key" :to="t.to" class="tile">
                <small>{{ t.label }}</small>
                <b>{{ t.n }}</b>
                <span class="hint"><span v-if="t.hint" class="chip" :class="t.warn ? 'warn' : ''">{{ t.hint }}</span></span>
                <span class="tic" :class="t.key"><RailIcon :name="t.icon" /></span>
              </NuxtLink>
            </div>
          </div>
          <!-- quick actions -->
          <div class="card">
            <div class="sect">Quick actions</div>
            <div class="quick">
              <NuxtLink v-for="a in quick" :key="a.to" :to="a.to" class="qa"><span class="ic"><RailIcon :name="a.icon" /></span>{{ a.label }}</NuxtLink>
            </div>
          </div>
        </div>

        <!-- closing soon -->
        <div class="card">
          <div class="row"><div class="sect">Closing soon</div><NuxtLink to="/cars?sort=closing" class="small">View all</NuxtLink></div>
          <div v-if="loading" class="muted">Loading ...</div>
          <div class="strip">
            <NuxtLink v-for="c in soon" :key="c.id" :to="`/car/${c.id}`" class="mini">
              <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /><span v-else>no photo</span>
                <button class="star" :class="{ on: watch.has(c.id) }" @click.prevent.stop="star(c.id)">{{ watch.has(c.id) ? '★' : '☆' }}</button></div>
              <div class="mb">
                <b>{{ c.brand }} {{ c.model }}</b>
                <div class="muted small">{{ [c.mfg_year, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null].filter(Boolean).join(' · ') }}</div>
                <div class="muted small">{{ c.venue }} · closes in {{ left(c.bid_deadline, now) }}</div>
                <div class="pr">{{ money(c.start_price_jpy) }}</div>
              </div>
            </NuxtLink>
          </div>
        </div>

        <!-- favourites -->
        <div class="card">
          <div class="row"><div class="sect">Recently favourited cars</div><NuxtLink to="/watchlist" class="small">View all</NuxtLink></div>
          <div v-if="!favs.length" class="empty">Your favourite cars will be added here. Go to the marketplace and press the star on a car.<br /><NuxtLink to="/cars" class="btn yellow" style="margin-top: 10px">Browse cars</NuxtLink></div>
          <div class="strip">
            <NuxtLink v-for="c in favs" :key="c.id" :to="`/car/${c.id}`" class="mini">
              <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /><span v-else>no photo</span></div>
              <div class="mb"><b>{{ c.brand }} {{ c.model }}</b><div class="muted small">closes in {{ left(c.bid_deadline, now) }}</div><div class="pr">{{ money(c.start_price_jpy) }}</div></div>
            </NuxtLink>
          </div>
        </div>
      </div>

      <aside class="side">
        <NuxtLink to="/account" class="member">
          <div class="av">{{ initial }}</div>
          <div><small>{{ isStaff ? (profile?.role === 'admin' ? 'Admin' : 'Staff') : 'Dealer' }}<template v-if="!isStaff"> · {{ planName }} plan</template></small><b>{{ profile?.company_name || profile?.contact_name || profile?.email }}</b></div>
          <span class="chev">›</span>
        </NuxtLink>
        <div v-if="!isStaff" class="card limits">
          <div class="row"><span class="muted small">Bid limit per car</span><b>{{ profile?.bid_limit_jpy ? yen(profile.bid_limit_jpy) + ' · ' + rm(profile.bid_limit_jpy) : 'Not set yet' }}</b></div>
          <div class="row"><span class="muted small">Open orders</span><b>{{ yen(openJpy) }}<template v-if="profile?.open_limit_jpy"> / {{ yen(profile.open_limit_jpy) }}</template></b></div>
          <p v-if="!profile?.bid_limit_jpy" class="small muted" style="margin: 6px 0 0">Our team sets your bid limit. Contact us to start bidding.</p>
        </div>

        <div class="card notes">
          <div class="row"><div class="sect" style="margin: 0">Recent notifications</div><a v-if="unread" href="#" class="small" @click.prevent="readAll">Mark all as read</a></div>
          <div class="tabs2"><button :class="{ on: tab === 'all' }" @click="tab = 'all'">All</button><button :class="{ on: tab === 'unread' }" @click="tab = 'unread'">Unread ({{ unread }})</button></div>
          <div v-if="!shownNotes.length" class="muted small" style="padding: 14px 2px">Nothing here yet.</div>
          <a v-for="n in shownNotes" :key="n.id" href="#" class="note" @click.prevent="openNote(n)">
            <i v-if="!n.read_at" class="dotr" />
            <div class="muted small">{{ when(n.created_at) }}</div>
            <b>{{ n.title }}</b>
            <div v-if="n.body" class="small body">{{ n.body }}</div>
          </a>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const now = useNow()
const { user, profile, isStaff } = useAuth()
const { loadRate, loadCur, left, money, yen, rm } = useLite()
const watch = useWatch()

// banner
const slides = [
  { kicker: 'JAPAN AUCTION', title: 'Cars priced in RM, with the import cost shown', text: 'Every car shows its customs docket, duty and import price, so you know what it lands at.', cta: 'Browse cars', to: '/cars', big: 'RM', bg: 'linear-gradient(120deg, #1a56a0, #2a7bd6)' },
  { kicker: 'NOT SURE WHAT TO BID?', title: 'A suggested bid on every car', text: 'Worked out from what the same model and grade sold for recently.', cta: 'Open the calculator', to: '/calculator', big: '¥', bg: 'linear-gradient(120deg, #17406f, #2268b8)' },
  { kicker: 'NEVER MISS A CLOSING', title: 'Star the cars you like', text: 'Your favourites are kept for you, and we alert you before they close.', cta: 'My favourites', to: '/watchlist', big: '★', bg: 'linear-gradient(120deg, #2a5ea8, #3d8fe6)' },
]
const si = ref(0)
let timer: any, clock: any
const sec = ref(Date.now())      // this page's own clock: the countdown moves every second (the shared clock only moves every 30 seconds)
onMounted(() => { timer = setInterval(() => { si.value = (si.value + 1) % slides.length }, 6000); clock = setInterval(() => { sec.value = Date.now() }, 1000) })
onBeforeUnmount(() => { clearInterval(timer); clearInterval(clock) })

// live strip
const nextClose = ref<string | null>(null)
const countdown = computed(() => {
  if (!nextClose.value) return ''
  const s = Math.max(0, Math.floor((new Date(nextClose.value).getTime() - sec.value) / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return (d ? d + 'd ' : '') + `${p(h)}:${p(m)}:${p(x)}`
})

// tasks
const counts = reactive<Record<string, number>>({ pending: 0, placed: 0, won: 0, lost: 0 })
const openJpy = ref(0)
const tasks = computed(() => isStaff.value
  ? [
      { key: 'pending', label: 'To place', n: counts.pending, to: '/bids', hint: counts.pending ? 'Waiting' : '', warn: true, icon: 'clock' },
      { key: 'placed', label: 'Placed', n: counts.placed, to: '/bids', icon: 'gavel' },
      { key: 'won', label: 'Won', n: counts.won, to: '/bids', icon: 'trophy' },
      { key: 'lost', label: 'Not won', n: counts.lost, to: '/bids', icon: 'cross' },
    ]
  : [
      { key: 'pending', label: 'Waiting for our team', n: counts.pending, to: '/orders', hint: counts.pending ? 'Can still change' : '', icon: 'clock' },
      { key: 'placed', label: 'Placed at auction', n: counts.placed, to: '/orders', icon: 'gavel' },
      { key: 'won', label: 'Won', n: counts.won, to: '/orders', icon: 'trophy' },
      { key: 'lost', label: 'Not won', n: counts.lost, to: '/orders', icon: 'cross' },
    ])
const quick = computed(() => [
  { to: '/cars', label: 'Marketplace', icon: 'cars' }, { to: '/watchlist', label: 'Favourites', icon: 'heart' }, { to: '/orders', label: 'My orders', icon: 'orders' }, { to: '/calculator', label: 'Calculator', icon: 'calc' },
  ...(isStaff.value ? [{ to: '/bids', label: 'Bid queue', icon: 'queue' }, { to: '/aps', label: 'AP holders', icon: 'users' }, { to: '/offer', label: 'Offer report', icon: 'offer' }, { to: '/targets', label: 'Scrape targets', icon: 'target' }] : []),
])

// cars
const soon = ref<any[]>([]), favs = ref<any[]>([]), loading = ref(true)
const COLS = 'id,brand,model,mfg_year,mileage_km,venue,start_price_jpy,photos,bid_deadline'
async function star(id: string) { try { await watch.toggle(id); await loadFavs() } catch { /* shown by the star state */ } }
async function loadFavs() {
  const ids = watch.ids.value.slice(-6).reverse()
  if (!ids.length) { favs.value = []; return }
  const { data } = await db.from('lots').select(COLS).in('id', ids).gt('bid_deadline', new Date().toISOString())
  favs.value = data || []
}

// notifications
const notes = ref<any[]>([]), tab = ref<'all' | 'unread'>('all')
const unread = computed(() => notes.value.filter((n) => !n.read_at).length)
const shownNotes = computed(() => (tab.value === 'unread' ? notes.value.filter((n) => !n.read_at) : notes.value).slice(0, 8))
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
async function readAll() { const ids = notes.value.filter((n) => !n.read_at).map((n) => n.id); if (!ids.length) return; await db.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids); notes.value.forEach((n) => { n.read_at ||= new Date().toISOString() }) }
async function openNote(n: any) {
  if (!n.read_at) { await db.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); n.read_at = new Date().toISOString() }
  if (n.link) await navigateTo(n.link)
}

const initial = computed(() => String(profile.value?.company_name || profile.value?.contact_name || profile.value?.email || '?').charAt(0).toUpperCase())
const planName = computed(() => ({ free: 'Free', member: 'Member', partner: 'Partner' } as Record<string, string>)[profile.value?.tier || 'free'])

onMounted(async () => {
  loadCur()
  try {
    await Promise.all([loadRate().catch(() => {}), watch.load().catch(() => {})])
    const nowIso = new Date().toISOString()
    const [next, closing, bids, nt] = await Promise.all([
      db.from('lots').select('bid_deadline').gt('bid_deadline', nowIso).eq('my_eligible', true).order('bid_deadline').limit(1),
      db.from('lots').select(COLS).gt('bid_deadline', nowIso).eq('my_eligible', true).order('bid_deadline').limit(12),
      db.from('bids').select('status,max_bid_jpy').limit(5000),
      db.from('notifications').select('id,title,body,link,created_at,read_at').eq('user_id', user.value.id).order('created_at', { ascending: false }).limit(30),
    ])
    nextClose.value = next.data?.[0]?.bid_deadline || null
    soon.value = closing.data || []
    for (const b of bids.data || []) { if (b.status in counts) counts[b.status]!++; if (!isStaff.value && (b.status === 'pending' || b.status === 'placed')) openJpy.value += Number(b.max_bid_jpy) }
    notes.value = nt.data || []
    await loadFavs()
  } finally { loading.value = false }
})
</script>

<style scoped>
.live { display: flex; white-space: nowrap; width: 100%; align-items: center; gap: 10px; padding: 11px 16px; margin-bottom: 16px; color: var(--tx); font-size: 14px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #e0452b; box-shadow: 0 0 0 4px rgba(224, 69, 43, .18); } .dot.off { background: var(--mu2); box-shadow: none; }
.clock { background: #fdeceb; color: #c8372d; font-weight: 700; border-radius: 6px; padding: 2px 8px; font-variant-numeric: tabular-nums; }
.home { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
.main { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; min-width: 0; }
.main > *, .side > * { min-width: 0; }
.banner { position: relative; border-radius: var(--r); color: #fff; padding: 0 56px; height: 210px; display: flex; align-items: center; justify-content: space-between; overflow: hidden; transition: background .4s; }
.bt { max-width: 440px; position: relative; z-index: 1; } .bt small { color: var(--yl); font-weight: 800; letter-spacing: 1px; }
.bt h2 { font-size: 24px; line-height: 1.2; margin: 6px 0 8px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.bt p { margin: 0 0 14px; opacity: .92; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.big { font-size: 150px; font-weight: 900; color: var(--yl); opacity: .95; line-height: 1; margin-right: 30px; }
.nav { position: absolute; top: 50%; transform: translateY(-50%); width: 30px; height: 30px; border-radius: 50%; border: 0; background: #fff; color: var(--tx); cursor: pointer; font-size: 18px; line-height: 1; z-index: 2; } .nav.l { left: 8px; } .nav.r { right: 8px; }
.dots { position: absolute; bottom: 10px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; } .dots i { width: 7px; height: 7px; border-radius: 50%; background: rgba(255, 255, 255, .45); cursor: pointer; } .dots i.on { background: var(--yl); width: 18px; border-radius: 4px; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 1fr; gap: 10px; }
.tile { position: relative; background: var(--s2); border-radius: 10px; padding: 11px 12px; color: var(--tx); display: grid; grid-template-rows: auto auto 22px; gap: 2px; align-content: start; height: 104px; overflow: hidden; }
.hint { min-height: 22px; display: block; }
.tic { position: absolute; right: 8px; bottom: 8px; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: #fff; } .tic svg { width: 20px; height: 20px; }
.tic.pending { background: #f5a65b; } .tic.placed { background: #5aa9f0; } .tic.won { background: #4cc38f; } .tic.lost { background: #ef8a80; }
.tile small { color: var(--mu); font-size: 12.5px; padding-right: 40px; line-height: 1.25; } .tile b { font-size: 24px; } .tile .chip { justify-self: start; font-size: 11px; }
.quick { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 10px; }
.qa { display: grid; justify-items: center; gap: 6px; text-align: center; color: var(--tx); font-size: 12.5px; padding: 8px 2px; border-radius: 10px; } .qa:hover { background: var(--s2); }
.ic { width: 42px; height: 42px; border-radius: 50%; background: var(--acbg); color: var(--ac); display: grid; place-items: center; } .ic svg { width: 21px; height: 21px; }
.strip { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 6px; }
.mini { flex: 0 0 200px; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; color: var(--tx); background: #fff; }
.ph { position: relative; aspect-ratio: 4 / 3; background: #e9edf3; display: grid; place-items: center; color: var(--mu2); font-size: 12px; } .ph img { width: 100%; height: 100%; object-fit: cover; }
.star { position: absolute; top: 6px; right: 6px; width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(0, 0, 0, .5); color: #fff; font-size: 17px; cursor: pointer; } .star.on { color: #ffc83d; }
.mb { padding: 9px 11px 11px; } .mb b { font-size: 13.5px; display: block; line-height: 1.25; } .pr { font-weight: 800; font-size: 16px; margin-top: 4px; }
.empty { text-align: center; color: var(--mu); padding: 18px 8px; font-size: 13.5px; }
.side { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; min-width: 0; }
.member { display: flex; align-items: center; gap: 12px; background: linear-gradient(120deg, #2268b8, #2f7fd3); color: #fff; border-radius: var(--r); padding: 16px; }
.av { width: 42px; height: 42px; border-radius: 50%; background: rgba(255, 255, 255, .22); display: grid; place-items: center; font-weight: 800; font-size: 18px; flex: none; }
.member small { display: block; opacity: .85; font-size: 12px; } .member b { font-size: 15px; word-break: break-word; } .chev { margin-left: auto; font-size: 22px; }
.limits { display: grid; gap: 8px; } .limits b { font-size: 14px; }
.notes { padding: 14px 14px 6px; }
.tabs2 { display: flex; border-bottom: 1px solid var(--line); margin: 10px 0 4px; } .tabs2 button { flex: 1; background: none; border: 0; border-bottom: 2px solid transparent; padding: 8px 0; cursor: pointer; color: var(--mu); font: inherit; font-weight: 600; } .tabs2 button.on { color: var(--ac); border-color: var(--ac); }
.note { display: block; position: relative; color: var(--tx); padding: 11px 14px 11px 2px; border-bottom: 1px solid var(--line); } .note:last-child { border-bottom: 0; }
.dotr { position: absolute; right: 2px; top: 14px; width: 8px; height: 8px; border-radius: 50%; background: #e0452b; }
.note .body { color: var(--mu); margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
@media (max-width: 1100px) { .home { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .two { grid-template-columns: 1fr; } .big, .banner .nav { display: none; } .banner { padding: 0 20px; height: 200px; } .live .ac { display: none; } .bt h2 { font-size: 21px; } }
</style>

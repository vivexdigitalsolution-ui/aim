<template>
  <div class="dash">
    <header class="top">
      <div><h1>{{ greeting }}, {{ name }}</h1><div class="muted">{{ todayLabel }} · ¥1 = RM {{ board.rate.value || '—' }}</div></div>
      <span class="chip ac">{{ tierLabel }} plan</span>
    </header>
    <div v-if="err" class="err">{{ err }}</div>

    <section class="kpis">
      <div v-for="k in kpis" :key="k.label" class="card kpi"><small>{{ k.label }}</small><b>{{ k.value }}</b><span class="muted small">{{ k.sub }}</span></div>
    </section>

    <section class="two">
      <div class="card big">
        <div class="row wrap between">
          <div>
            <div class="muted small">{{ bd.day.mode === 'closed' ? 'Bidding today' : "Today's bidding ends in" }}</div>
            <div class="clock">{{ bd.day.mode === 'today' && bd.day.at ? bd.countdown(bd.tick.value) : bd.day.mode === 'closed' ? 'Closed' : '—' }}</div>
            <div class="muted small"><template v-if="bd.day.mode === 'today'">{{ bd.dateLabel.value }} · {{ bd.day.cars }} open cars · last venue closes {{ bd.myt(bd.day.at) }} MYT</template><template v-else-if="bd.day.mode === 'closed'">All venues are closed.<template v-if="bd.day.next"> Next bidding day: {{ bd.nextLabel.value }}. The countdown starts after 12:00 am Japan time (11:00 pm Malaysia time).</template></template><template v-else>No open car right now.</template></div>
          </div>
          <NuxtLink to="/cars" class="btn" style="display: inline-flex; align-items: center">Browse the cars</NuxtLink>
        </div>
        <div class="line">You have <b>{{ o.open }} open order{{ o.open === 1 ? '' : 's' }}</b><template v-if="o.open">: {{ o.pending }} waiting for our team to place, {{ o.placed }} placed at the auction</template>.</div>
      </div>

      <div class="card">
        <div class="row between"><h2>My import costs</h2><NuxtLink to="/account" class="small">Change</NuxtLink></div>
        <div v-for="f in feeRows" :key="f.label" class="kv"><span class="muted">{{ f.label }}</span><b>RM {{ f.value.toLocaleString('en-US') }}</b></div>
        <div class="muted small" style="margin-top: 8px">Added to every import price. You can also change them straight on a car. {{ fees.custom ? 'These are your own figures.' : 'These are the team defaults.' }}</div>
      </div>
    </section>

    <section class="two">
      <div class="card big">
        <div class="row between"><h2>Closing soon from your watchlist</h2><NuxtLink to="/watchlist" class="small">Watchlist</NuxtLink></div>
        <div v-if="!watchCars.length" class="muted small" style="margin-top: 8px">{{ watch.ids.value.length ? 'None of your watched cars is still open.' : 'Star a car on the Cars page to follow it here.' }}</div>
        <div v-else class="cards">
          <NuxtLink v-for="c in watchCars" :key="c.id" :to="`/cars/${c.id}`" class="mini">
            <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /><span v-else>no photo</span></div>
            <div class="mb"><b>{{ c.brand }} {{ c.model }}</b><small class="muted">{{ [c.mfg_year, c.grade, c.venue].filter(Boolean).join(' · ') }}</small>
              <div class="row small"><span class="warnc">{{ closesInfo(c.bid_deadline, now).text }}</span><b>{{ c.start_price_jpy > 0 ? yen(c.start_price_jpy) : '' }}</b></div></div>
          </NuxtLink>
        </div>
      </div>

      <div class="card">
        <div class="row between"><h2>My bid orders</h2><NuxtLink to="/orders" class="small">All orders</NuxtLink></div>
        <div v-if="!o.recent.length" class="muted small" style="margin-top: 8px">No order yet. Open a car and send your highest bid.</div>
        <div v-for="b in o.recent" :key="b.id" class="ord">
          <span class="grow"><b>{{ b.lots?.brand }} {{ b.lots?.model }}</b><small class="muted">Up to {{ yen(b.max_bid_jpy) }} · {{ ago(b.created_at) }}</small></span>
          <span class="chip" :class="STATUS[b.status]?.cls">{{ STATUS[b.status]?.label || b.status }}</span>
        </div>
      </div>
    </section>

    <section class="two">
      <div class="card big">
        <div class="row between"><h2>Best room to bid today</h2><span class="chip">Member plan</span></div>
        <template v-if="hasTier('member')">
          <div v-if="marginLoading" class="muted small" style="margin-top: 8px">Working out the margins ...</div>
          <div v-else-if="!best.length" class="muted small" style="margin-top: 8px">No open car has both a market price and a docket yet.</div>
          <template v-else>
            <NuxtLink v-for="c in best" :key="c.id" :to="`/margin?lot=${c.id}`" class="rowc">
              <span class="grow"><b>{{ c.brand }} {{ c.model }}</b><small class="muted">{{ c.history ? 'Usually sells ' + yen(c.history.price) : 'no sale history' }} · {{ closesInfo(c.bid_deadline, now).text }}</small></span>
              <span class="ra"><b class="up">{{ c.headroom == null ? '—' : (c.headroom >= 0 ? '+' : '−') + yen(Math.abs(c.headroom)) }}</b><small class="muted">room to bid</small></span>
            </NuxtLink>
          </template>
        </template>
        <div v-else class="muted" style="margin-top: 8px">Margins, the Malaysian market price and bidding rooms are part of the Member plan. <NuxtLink to="/upgrade" class="ac">See the plans</NuxtLink></div>
      </div>

      <div class="stack">
        <div class="card">
          <h2>My bid limit</h2>
          <template v-if="limit">
            <div class="row small muted" style="margin-top: 8px"><span>Open orders {{ yen(o.openJpy) }}</span><span>of {{ yen(limit) }}</span></div>
            <div class="bar"><i :style="{ width: Math.min(100, Math.round((o.openJpy / limit) * 100)) + '%' }" /></div>
          </template>
          <div v-else class="muted small" style="margin-top: 8px">No limit is set yet. Open orders: {{ yen(o.openJpy) }}.</div>
        </div>
        <div class="card">
          <div class="row between"><h2>Alerts</h2><NuxtLink to="/alerts" class="small">All alerts</NuxtLink></div>
          <div v-if="!notes.length" class="muted small" style="margin-top: 8px">Nothing new.</div>
          <NuxtLink v-for="a in notes" :key="a.id" :to="a.link || '/alerts'" class="al"><b :class="{ dim: a.read_at }">{{ a.title }}</b><small class="muted">{{ ago(a.created_at) }}</small></NuxtLink>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { timeLeft, closesInfo, isPlaceholderDeadline } from '@aim/core'

const db = useDb()
const now = useNow()
const { user, profile, hasTier } = useAuth()
const bd = useBiddingDay()
const board = useMarginBoard()
const watch = useWatch()
const err = ref(''), marginLoading = ref(true)
const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
const hour = Number(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }).slice(0, 2))
const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
const name = computed(() => profile.value?.company_name || profile.value?.contact_name || 'there')
const tierLabel = computed(() => ({ free: 'Free', member: 'Member', partner: 'Partner' } as Record<string, string>)[profile.value?.tier || 'free'] || 'Free')
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('en-US')
const nf = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'))
const ago = (iso: string) => { const h = (Date.now() - new Date(iso).getTime()) / 3600_000; return h < 1 ? 'just now' : h < 24 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' d ago' }
const STATUS: Record<string, { label: string; cls: string }> = { pending: { label: 'Waiting', cls: 'warn' }, placed: { label: 'Placed', cls: '' }, won: { label: 'Won', cls: 'ok' }, lost: { label: 'Lost', cls: 'bad' }, cancelled: { label: 'Cancelled', cls: '' }, rejected: { label: 'Rejected', cls: 'bad' } }

const limit = computed(() => Number((profile.value as any)?.bid_limit_jpy || 0))
const openCars = ref(0), unread = ref(0), notes = ref<any[]>([]), watchCars = ref<any[]>([]), best = ref<any[]>([])
const closingWatch = ref(0)
const fees = reactive({ port: 2500, inland: 250, ap: 10500, custom: false })
const feeRows = computed(() => [{ label: 'Port clearance', value: fees.port }, { label: 'Inland transfer', value: fees.inland }, { label: 'AP fee', value: fees.ap }])
const o = reactive({ open: 0, pending: 0, placed: 0, openJpy: 0, won30: 0, lost30: 0, recent: [] as any[] })
const kpis = computed(() => {
  const dec = o.won30 + o.lost30
  return [
    { label: 'Open cars', value: nf(openCars.value), sub: bd.day.cars ? `${bd.day.cars} on ${bd.dateLabel.value}` : 'for bidding' },
    { label: 'My open orders', value: nf(o.open), sub: o.open ? yen(o.openJpy) + ' in total' : 'none open' },
    { label: 'Cars won, last 30 days', value: nf(o.won30), sub: dec ? 'Win rate ' + Math.round((o.won30 / dec) * 100) + '%' : 'no result yet' },
    { label: 'My watchlist', value: nf(watch.ids.value.length), sub: closingWatch.value ? `${closingWatch.value} close within 24 hours` : 'none closing soon' },
    { label: 'Unread alerts', value: nf(unread.value), sub: unread.value ? 'see Alerts' : 'all read' },
  ]
})

async function loadOrders() {
  const since = Date.now() - 30 * 86400_000
  const { data, error } = await db.from('bids').select('id,status,max_bid_jpy,created_at,decided_at,lots(brand,model)').order('created_at', { ascending: false }).limit(300)
  if (error) throw error
  const rows = data || []
  const openRows = rows.filter((b: any) => b.status === 'pending' || b.status === 'placed')
  Object.assign(o, {
    open: openRows.length, pending: openRows.filter((b: any) => b.status === 'pending').length, placed: openRows.filter((b: any) => b.status === 'placed').length,
    openJpy: openRows.reduce((s: number, b: any) => s + Number(b.max_bid_jpy || 0), 0),
    won30: rows.filter((b: any) => b.status === 'won' && new Date(b.decided_at || b.created_at).getTime() >= since).length,
    lost30: rows.filter((b: any) => b.status === 'lost' && new Date(b.decided_at || b.created_at).getTime() >= since).length,
    recent: rows.slice(0, 4),
  })
}
async function loadCars() {
  const nowIso = new Date().toISOString()
  const r = await db.from('lots').select('id', { count: 'exact', head: true }).gt('bid_deadline', nowIso).eq('my_eligible', true)
  openCars.value = r.count || 0
  await watch.load().catch(() => {})
  if (watch.ids.value.length) {
    const { data } = await db.from('lots').select('id,brand,model,grade,mfg_year,venue,photos,start_price_jpy,bid_deadline').in('id', watch.ids.value.slice(0, 200)).gt('bid_deadline', nowIso).order('bid_deadline').limit(200)
    const list = data || []
    watchCars.value = list.slice(0, 3)
    closingWatch.value = list.filter((l: any) => !isPlaceholderDeadline(l.bid_deadline) && new Date(l.bid_deadline).getTime() - Date.now() < 24 * 3600_000).length
  }
}
async function loadNotes() {
  if (!user.value) return
  const [u, n] = await Promise.all([
    db.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.value.id).is('read_at', null),
    db.from('notifications').select('id,title,link,created_at,read_at').eq('user_id', user.value.id).order('created_at', { ascending: false }).limit(3),
  ])
  unread.value = u.count || 0; notes.value = n.data || []
}
async function loadFees() {
  const { data } = await db.rpc('import_fees')
  if (!data) return
  Object.assign(fees, { port: Number(data.effective.port_myr), inland: Number(data.effective.inland_myr), ap: Number(data.effective.ap_fee_myr), custom: Object.values(data.mine || {}).some((v) => v != null) })
}
async function loadMargins() {
  if (!hasTier('member')) { marginLoading.value = false; return }
  try {
    await board.load()
    best.value = board.lots.value.map((l) => board.evaluate(l, { targetPct: 12, reconMyr: 3000, apFeeMyr: fees.ap })).filter((x) => x.market && x.sellMyr && x.dutyMyr != null && x.headroom != null)
      .sort((a, b) => (b.headroom ?? -Infinity) - (a.headroom ?? -Infinity)).slice(0, 3)
  } catch (e: any) { err.value = e.message } finally { marginLoading.value = false }
}

onMounted(async () => {
  const jobs = await Promise.allSettled([bd.load(), loadOrders(), loadCars(), loadNotes(), loadFees()])
  const bad = jobs.find((j) => j.status === 'rejected') as PromiseRejectedResult | undefined
  if (bad) err.value = String(bad.reason?.message || bad.reason)
  loadMargins()
})
</script>

<style scoped>
.dash { display: grid; gap: 16px; }
.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; }
.kpi { display: grid; gap: 2px; min-width: 0; } .kpi small { color: var(--mu); } .kpi b { font-size: 26px; letter-spacing: -.5px; line-height: 1.15; }
.two { display: flex; flex-wrap: wrap; gap: 14px; align-items: stretch; }
.two > .card, .two > .stack { min-width: 0; flex: 2 1 340px; } .two > .big { flex: 3 1 480px; }
.stack { display: grid; gap: 14px; align-content: start; }
.between { justify-content: space-between; } .grow { flex: 1; min-width: 0; }
.clock { font-size: 38px; font-weight: 700; letter-spacing: -1px; font-variant-numeric: tabular-nums; line-height: 1.15; }
.line { border-top: 1px solid var(--line); margin-top: 14px; padding-top: 12px; color: var(--mu); }
.kv { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line); }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-top: 10px; }
.mini { background: var(--s2); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; color: inherit; text-decoration: none; display: block; } .mini:hover { border-color: var(--ac); }
.ph { height: 110px; background: var(--s3); display: grid; place-items: center; color: var(--mu2); font-size: 12px; overflow: hidden; } .ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mb { padding: 10px 12px; display: grid; gap: 2px; } .mb small { display: block; } .warnc { color: var(--warn); }
.ord { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); margin-top: 6px; } .ord small { display: block; }
.rowc { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-top: 1px solid var(--line); margin-top: 6px; color: inherit; text-decoration: none; } .rowc small { display: block; } .ra { text-align: right; white-space: nowrap; } .ra small { display: block; }
.bar { height: 9px; border-radius: 5px; background: var(--s3); overflow: hidden; margin-top: 6px; } .bar i { display: block; height: 100%; background: var(--ac); border-radius: 5px; }
.al { display: block; padding: 9px 0; border-top: 1px solid var(--line); margin-top: 6px; color: inherit; text-decoration: none; } .al b { font-weight: 500; } .al .dim { color: var(--mu); } .al small { display: block; }
@media (max-width: 1100px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .clock { font-size: 32px; } }
</style>

<template>
  <div class="dash">
    <header class="top">
      <div><h1>Dashboard</h1><div class="muted">{{ todayLabel }} · ¥1 = RM {{ board.rate.value || '—' }}</div></div>
      <NuxtLink to="/status" class="syschip"><span class="sdot" :class="sysLevel" />{{ sysLabel || 'System status' }}</NuxtLink>
    </header>
    <div v-if="err" class="err">{{ err }}</div>

    <section class="kpis">
      <div v-for="k in kpis" :key="k.label" class="card kpi"><small>{{ k.label }}</small><b>{{ k.value }}</b><span class="muted small">{{ k.sub }}</span></div>
    </section>

    <section class="two">
      <div class="card big">
        <div class="row wrap between">
          <div>
            <div class="muted small">{{ bd.day.mode === 'later' ? 'Next bidding day ends in' : "Today's bidding ends in" }}</div>
            <div class="clock">{{ bd.day.at ? bd.countdown(now) : '—' }}</div>
            <div class="muted small">{{ bd.day.mode === 'none' ? 'No open car.' : bd.day.mode === 'later' ? 'All of today is closed. ' : '' }}{{ bd.dateLabel.value }}<template v-if="bd.day.mode !== 'none'"> · {{ bd.day.cars }} open cars · {{ bd.day.venues.length }} venue{{ bd.day.venues.length === 1 ? '' : 's' }}</template></div>
          </div>
        </div>
        <div v-if="bd.day.venues.length" class="venues">
          <div v-for="v in bd.day.venues" :key="v.name" class="vrow">
            <span class="vn">{{ v.name }}</span>
            <span class="bar"><i :style="{ width: Math.round((v.cars / bd.day.venues[0]!.cars) * 100) + '%' }" /></span>
            <span class="muted small vc">{{ v.cars }} cars · {{ bd.myt(v.closesAt) }}</span>
          </div>
        </div>
        <div class="row wrap" style="gap: 10px; justify-content: flex-start"><NuxtLink to="/bids" class="btn" style="display: inline-flex; align-items: center">Open the bid pipeline</NuxtLink><NuxtLink to="/cars" class="btn ghost" style="display: inline-flex; align-items: center">See the cars</NuxtLink></div>
      </div>

      <div class="card">
        <div class="row between"><h2>Needs your attention</h2><span class="muted small">{{ attention.filter((a) => a.n).length }} things</span></div>
        <NuxtLink v-for="a in attention" :key="a.title" :to="a.to" class="att">
          <span class="num" :class="{ zero: !a.n }">{{ a.n }}</span>
          <span class="grow"><b>{{ a.title }}</b><small class="muted">{{ a.sub }}</small></span>
          <span class="muted">›</span>
        </NuxtLink>
      </div>
    </section>

    <section class="two">
      <div class="card big">
        <div class="row wrap between"><div><h2>Performance, last 14 days</h2><div class="muted small">Bid orders sent by AP holders and cars won, per day (Malaysia time)</div></div>
          <div class="legend"><span><i class="lp" />Orders</span><span><i class="lw" />Won</span></div></div>
        <div class="chart">
          <div v-for="d in days" :key="d.key" class="col" :title="d.key + ': ' + d.placed + ' orders, ' + d.won + ' won'">
            <i class="bp" :style="{ height: h(d.placed) }" /><i class="bw" :style="{ height: h(d.won) }" />
          </div>
        </div>
        <div class="axis"><span v-for="d in days" :key="d.key">{{ d.label }}</span></div>
        <div class="perf">
          <div v-for="p in perf" :key="p.label"><small class="muted">{{ p.label }}</small><b>{{ p.value }}</b><span class="small" :class="p.up == null ? 'muted' : p.up ? 'up' : 'down'">{{ p.delta }}</span></div>
        </div>
      </div>

      <div class="card">
        <div class="row between"><h2>Scraper and data</h2><span class="chip" :class="enrichLeft ? 'warn' : 'ok'">{{ enrichLeft ? 'Sheets still to read' : 'All sheets read' }}</span></div>
        <div v-if="!steps.length" class="muted small" style="margin-top: 8px">No daily run logged yet.</div>
        <div v-for="s in steps" :key="s.name" class="step"><span class="dot" :class="s.cls" /><span class="grow">{{ s.name }}</span><span class="muted small">{{ s.note }}</span></div>
        <div class="enrich">
          <div class="row small muted"><span>Sheets read by Claude (open cars)</span><span>{{ enrichDone }} of {{ openCars }}</span></div>
          <div class="bar big2"><i :style="{ width: openCars ? Math.round((enrichDone / openCars) * 100) + '%' : '0%' }" /></div>
          <div class="muted small">{{ enrichNote }}</div>
        </div>
      </div>
    </section>

    <section class="two">
      <div class="card big">
        <div class="row between"><h2>Best room to bid, closing soon</h2><NuxtLink to="/today" class="small">See all</NuxtLink></div>
        <div v-if="marginLoading" class="muted small" style="margin-top: 8px">Working out the margins ...</div>
        <div v-else-if="!bestCars.length" class="muted small" style="margin-top: 8px">No open car has both a market price and a docket yet.</div>
        <div v-else class="scroll">
          <table class="t">
            <thead><tr><th>Car</th><th class="r">Closes in</th><th class="r">Max bid</th><th class="r">Usually sells</th><th class="r">Room to bid</th></tr></thead>
            <tbody>
              <tr v-for="c in bestCars" :key="c.id">
                <td><NuxtLink :to="`/margin?lot=${c.id}`"><b>{{ c.brand }} {{ c.model }}</b></NuxtLink><small class="muted">{{ [c.mfg_year, c.grade, c.venue].filter(Boolean).join(' · ') }}</small></td>
                <td class="r nw">{{ timeLeft(c.bid_deadline, now).label }}</td>
                <td class="r nw">{{ c.maxBid ? yen(c.maxBid) : '—' }}</td>
                <td class="r nw">{{ c.history ? yen(c.history.price) : '—' }}</td>
                <td class="r nw up"><b>{{ c.headroom == null ? '—' : (c.headroom >= 0 ? '+' : '−') + yen(Math.abs(c.headroom)) }}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="row between"><h2>AP holders</h2><NuxtLink to="/aps" class="small">Manage</NuxtLink></div>
          <div v-if="!aps.length" class="muted small" style="margin-top: 8px">No active AP holder yet.</div>
          <div v-for="a in aps" :key="a.id" class="ap">
            <span class="av">{{ (a.company_name || a.contact_name || a.email || '?').slice(0, 1).toUpperCase() }}</span>
            <span class="grow"><b>{{ a.company_name || a.contact_name || a.email }}</b><small class="muted">{{ a.last_order_at ? 'Last order ' + ago(a.last_order_at) : 'No order yet' }}</small></span>
            <span class="chip">{{ a.tier }}</span>
          </div>
        </div>
        <div class="card">
          <div class="row between"><h2>What we scrape</h2><NuxtLink to="/targets" class="small">Scrape targets</NuxtLink></div>
          <div class="tg"><div v-for="t in targets" :key="t.label" class="tile"><b>{{ t.n }}</b><small class="muted">{{ t.label }}</small></div></div>
          <div class="muted small" style="margin-top: 8px">Targets switched on. {{ oneOpen }} One price cars open.</div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { timeLeft } from '@aim/core'

const db = useDb()
const now = useNow()
const bd = useBiddingDay()
const board = useMarginBoard()
const { level: sysLevel, label: sysLabel, load: loadStatus, runs } = useSystemStatus()
const err = ref(''), marginLoading = ref(true)
const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('en-US')
const nf = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'))
const ago = (iso: string) => { const h = (Date.now() - new Date(iso).getTime()) / 3600_000; return h < 1 ? 'just now' : h < 24 ? Math.round(h) + ' h ago' : Math.round(h / 24) + ' d ago' }
const myt = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10)

const c = reactive({ open: 0, closing24: 0, pendingBids: 0, review: 0, flagged: null as number | null, oneUnread: null as number | null, pendingAps: 0, requests: 0, enrichErr: 0, activeAps: 0, enrichDone: 0, oneOpen: 0 })
const openCars = computed(() => c.open)
const enrichDone = computed(() => c.enrichDone)
const enrichLeft = computed(() => Math.max(0, c.open - c.enrichDone) + (c.oneUnread || 0))
const enrichNote = computed(() => (c.open - c.enrichDone > 0 ? `${c.open - c.enrichDone} bidding cars` : 'All bidding cars read') + (c.oneUnread != null ? ` · ${c.oneUnread} One price cars not read yet` : ''))
const targets = ref<{ n: number; label: string }[]>([])
const aps = ref<any[]>([])
const days = ref<{ key: string; label: string; placed: number; won: number }[]>([])
const perf = ref<{ label: string; value: string; delta: string; up: boolean | null }[]>([])
const bestCars = ref<any[]>([])

const kpis = computed(() => [
  { label: 'Open cars', value: nf(c.open), sub: bd.day.cars ? `${bd.day.cars} on ${bd.dateLabel.value}` : 'for bidding' },
  { label: 'Bids waiting to place', value: nf(c.pendingBids), sub: c.pendingBids ? 'AP holders are waiting' : 'Nothing waiting' },
  { label: 'Closing in 24 hours', value: nf(c.closing24), sub: 'open cars' },
  { label: 'Active AP holders', value: nf(c.activeAps), sub: c.pendingAps ? `${c.pendingAps} waiting for approval` : 'None waiting' },
  { label: 'Bidding cars read', value: c.open ? Math.round((c.enrichDone / c.open) * 100) + '%' : '—', sub: `${c.enrichDone} of ${c.open}` },
])
const attention = computed(() => [
  { n: c.pendingBids, title: 'Bids waiting to be placed', sub: 'AP holders are waiting for these', to: '/bids' },
  { n: c.review, title: 'Dockets to review', sub: 'The rule and Claude picked differently', to: '/review' },
  ...(c.flagged != null ? [{ n: c.flagged, title: 'Cars marked "check the sheet"', sub: 'Handwritten or unclear sheet values', to: '/cars' }] : []),
  ...(c.oneUnread != null ? [{ n: c.oneUnread, title: 'One price cars not read yet', sub: 'The next enrich run reads them', to: '/status' }] : []),
  { n: c.pendingAps, title: 'AP holders waiting for approval', sub: 'New sign-ups', to: '/aps' },
  { n: c.requests, title: 'Open sourcing requests', sub: 'Dealers asked us to find a car', to: '/requests' },
  { n: c.enrichErr, title: 'Cars that failed to be read', sub: 'Retried on the next enrich run', to: '/status' },
].sort((a, b) => (b.n ? 1 : 0) - (a.n ? 1 : 0)))

const STEP_CLS: Record<string, string> = { ok: 'ok', failed: 'bad', skipped: 'off', running: 'warn' }
const steps = computed(() => {
  const r: any = runs.value[0]
  if (!r) return []
  const list = (r.steps || []).map((s: any) => ({ name: s.name, cls: STEP_CLS[s.status] || 'off', note: s.status === 'ok' ? 'Done' + (s.seconds ? ' · ' + (s.seconds >= 60 ? Math.round(s.seconds / 60) + ' min' : s.seconds + ' s') : '') : s.status === 'failed' ? 'Failed' : s.status === 'skipped' ? 'Skipped' : s.status }))
  if (r.status === 'running') list.push({ name: 'Run in progress', cls: 'warn', note: 'started ' + ago(r.started_at) })
  return list.slice(-8)
})
const maxDay = computed(() => Math.max(1, ...days.value.map((d) => d.placed), ...days.value.map((d) => d.won)))
const h = (n: number) => (n ? Math.max(4, Math.round((n / maxDay.value) * 100)) + '%' : '0%')

const head = async (q: any) => { const r = await q; return r.error ? null : (r.count as number | null) }

async function loadCounts() {
  const nowIso = new Date().toISOString(), in24 = new Date(Date.now() + 24 * 3600_000).toISOString()
  const open = () => db.from('lots').select('id', { count: 'exact', head: true }).gt('bid_deadline', nowIso).eq('my_eligible', true)
  const [o, c24, pb, rv, fl, ou, pa, rq, ee, aa, ed, oo, t1, t2, t3] = await Promise.all([
    head(open()), head(open().lt('bid_deadline', in24)),
    head(db.from('bids').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
    head(db.from('lot_docket_decisions').select('lot_id', { count: 'exact', head: true }).eq('status', 'review')),
    head(open().eq('needs_review', true)),                                                  // null until migration 44 is run
    head(db.from('one_price_lots').select('id', { count: 'exact', head: true }).gt('deadline', nowIso).is('enriched_at', null)),
    head(db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'ap_holder').eq('status', 'pending')),
    head(db.from('sourcing_requests').select('id', { count: 'exact', head: true }).eq('status', 'open')),
    head(open().is('enriched_at', null).like('enrich_note', 'AI:%')),
    head(db.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'ap_holder').eq('status', 'active')),
    head(open().not('enriched_at', 'is', null)),
    head(db.from('one_price_lots').select('id', { count: 'exact', head: true }).gt('deadline', nowIso)),
    ...['bid', 'one_price', 'history'].map((t) => head(db.from('scrape_targets').select('id', { count: 'exact', head: true }).eq('lot_type', t).eq('enabled', true))),
  ])
  Object.assign(c, { open: o || 0, closing24: c24 || 0, pendingBids: pb || 0, review: rv || 0, flagged: fl, oneUnread: ou, pendingAps: pa || 0, requests: rq || 0, enrichErr: ee || 0, activeAps: aa || 0, enrichDone: ed || 0, oneOpen: oo || 0 })
  targets.value = [{ n: t1 || 0, label: 'Bidding' }, { n: t2 || 0, label: 'One price' }, { n: t3 || 0, label: 'History' }]
}
const oneOpen = computed(() => c.oneOpen)

async function loadPerformance() {
  const since = new Date(Date.now() - 28 * 86400_000).toISOString()
  const { data, error } = await db.from('bids').select('status,created_at,decided_at,agent_fee_jpy').gte('created_at', since).limit(20000)
  if (error) throw error
  const rows = data || []
  const keys: { key: string; label: string }[] = []
  for (let i = 13; i >= 0; i--) { const k = new Date(Date.now() + 8 * 3600_000 - i * 86400_000).toISOString().slice(0, 10); keys.push({ key: k, label: String(Number(k.slice(8))) }) }
  const m = new Map(keys.map((k) => [k.key, { ...k, placed: 0, won: 0 }]))
  const cut = Date.now() - 14 * 86400_000
  const cur = { orders: 0, won: 0, lost: 0, fees: 0 }, prev = { orders: 0, won: 0, lost: 0, fees: 0 }
  for (const b of rows) {
    const t = new Date(b.created_at).getTime(), s = t >= cut ? cur : prev
    s.orders++
    if (b.status === 'won') { s.won++; s.fees += Number(b.agent_fee_jpy || 0) } else if (b.status === 'lost') s.lost++
    const dk = myt(b.created_at); if (m.has(dk)) m.get(dk)!.placed++
    if (b.status === 'won') { const wk = myt(b.decided_at || b.created_at); if (m.has(wk)) m.get(wk)!.won++ }
  }
  days.value = [...m.values()]
  const rate = (s: typeof cur) => (s.won + s.lost ? Math.round((s.won / (s.won + s.lost)) * 100) : null)
  const diff = (a: number, b: number, unit = '') => (a === b ? 'same as before' : (a > b ? '+' : '−') + Math.abs(a - b).toLocaleString('en-US') + unit + ' vs the 14 days before')
  const rc = rate(cur), rp = rate(prev)
  perf.value = [
    { label: 'Bid orders', value: nf(cur.orders), delta: diff(cur.orders, prev.orders), up: cur.orders === prev.orders ? null : cur.orders > prev.orders },
    { label: 'Win rate', value: rc == null ? '—' : rc + '%', delta: rc != null && rp != null ? (rc === rp ? 'same as before' : (rc > rp ? '+' : '−') + Math.abs(rc - rp) + ' points') : 'no earlier result', up: rc != null && rp != null && rc !== rp ? rc > rp : null },
    { label: 'Cars won', value: nf(cur.won), delta: diff(cur.won, prev.won), up: cur.won === prev.won ? null : cur.won > prev.won },
    { label: 'Agent fees earned', value: '¥' + nf(cur.fees), delta: diff(cur.fees, prev.fees, ''), up: cur.fees === prev.fees ? null : cur.fees > prev.fees },
  ]
}

async function loadAps() {
  const { data } = await db.from('profiles').select('id,company_name,contact_name,email,tier,last_order_at').eq('role', 'ap_holder').eq('status', 'active').order('last_order_at', { ascending: false, nullsFirst: false }).limit(5)
  aps.value = data || []
}

async function loadMargins() {
  try {
    await board.load()
    bestCars.value = board.lots.value.map((l) => board.evaluate(l, { targetPct: 12, reconMyr: 3000, apFeeMyr: board.fees.value.apFeeMyr })).filter((x) => x.market && x.sellMyr && x.dutyMyr != null && x.headroom != null)
      .sort((a, b) => (b.headroom ?? -Infinity) - (a.headroom ?? -Infinity)).slice(0, 5)
  } catch (e: any) { err.value = e.message } finally { marginLoading.value = false }
}

onMounted(async () => {
  const jobs = await Promise.allSettled([loadCounts(), bd.load(), loadPerformance(), loadAps(), loadStatus()])
  const bad = jobs.find((j) => j.status === 'rejected') as PromiseRejectedResult | undefined
  if (bad) err.value = String(bad.reason?.message || bad.reason)
  loadMargins()
})
</script>

<style scoped>
.dash { display: grid; gap: 16px; }
.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.syschip { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line); background: var(--s2); border-radius: 20px; padding: 5px 12px; font-size: 12.5px; color: var(--mu); }
.sdot { width: 8px; height: 8px; border-radius: 50%; background: var(--mu2); } .sdot.ok { background: var(--ok); } .sdot.warn { background: var(--warn); } .sdot.bad { background: var(--bad); }
.kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; }
.kpi { display: grid; gap: 2px; min-width: 0; } .kpi small { color: var(--mu); } .kpi b { font-size: 26px; letter-spacing: -.5px; line-height: 1.15; }
.two { display: flex; flex-wrap: wrap; gap: 14px; align-items: stretch; }
.two > .card, .two > .stack { min-width: 0; flex: 2 1 340px; } .two > .big { flex: 3 1 520px; }
.stack { display: grid; gap: 14px; align-content: start; }
.between { justify-content: space-between; }
.grow { flex: 1; min-width: 0; }
.clock { font-size: 38px; font-weight: 700; letter-spacing: -1px; font-variant-numeric: tabular-nums; line-height: 1.15; }
.venues { display: grid; gap: 9px; margin: 14px 0; }
.vrow { display: grid; grid-template-columns: 110px minmax(0, 1fr) 150px; gap: 12px; align-items: center; } .vn { font-weight: 500; } .vc { text-align: right; font-variant-numeric: tabular-nums; }
.bar { height: 9px; border-radius: 5px; background: var(--s3); overflow: hidden; } .bar i { display: block; height: 100%; background: var(--ac); border-radius: 5px; }
.att { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
.att small { display: block; } .att b { font-weight: 500; }
.num { min-width: 44px; height: 28px; padding: 0 8px; border-radius: 8px; background: var(--acbg); color: var(--ac2); font-weight: 700; display: grid; place-items: center; font-variant-numeric: tabular-nums; } .num.zero { background: var(--s2); color: var(--mu2); }
.legend { display: flex; gap: 14px; font-size: 12.5px; color: var(--mu); align-items: center; } .legend span { display: inline-flex; align-items: center; gap: 6px; } .legend i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; } .lp { background: var(--mu2); } .lw { background: var(--ac); }
.chart { display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); gap: 8px; align-items: end; height: 150px; margin-top: 14px; border-bottom: 1px solid var(--line); }
.col { display: flex; align-items: flex-end; justify-content: center; gap: 3px; height: 100%; } .col i { width: 38%; border-radius: 4px 4px 0 0; display: block; } .bp { background: var(--mu2); } .bw { background: var(--ac); }
.axis { display: grid; grid-template-columns: repeat(14, minmax(0, 1fr)); gap: 8px; color: var(--mu); font-size: 11px; text-align: center; margin-top: 4px; }
.perf { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; border-top: 1px solid var(--line); margin-top: 14px; padding-top: 14px; } .perf b { display: block; font-size: 20px; } .perf small { display: block; }
.step { display: flex; align-items: center; gap: 10px; padding: 7px 0; } .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mu2); flex: none; } .dot.ok { background: var(--ok); } .dot.bad { background: var(--bad); } .dot.warn { background: var(--warn); }
.enrich { border-top: 1px solid var(--line); margin-top: 8px; padding-top: 12px; display: grid; gap: 6px; } .big2 { height: 9px; } .enrich .bar i { background: var(--warn); }
.scroll { overflow-x: auto; margin-top: 8px; }
.t { width: 100%; border-collapse: collapse; min-width: 520px; } .t th { text-align: left; color: var(--mu); font-weight: 500; font-size: 12.5px; padding: 8px 6px; } .t td { padding: 10px 6px; border-top: 1px solid var(--line); } .t td small { display: block; } .r { text-align: right; } .t th.r { text-align: right; } .nw { white-space: nowrap; }
.ap { display: flex; align-items: center; gap: 12px; padding: 9px 0; border-top: 1px solid var(--line); margin-top: 6px; } .ap small { display: block; }
.av { width: 34px; height: 34px; border-radius: 50%; background: var(--s3); display: grid; place-items: center; font-weight: 600; color: var(--ac2); flex: none; }
.tg { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 8px; } .tile { background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; } .tile b { display: block; font-size: 20px; }
@media (max-width: 1100px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 760px) {
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .clock { font-size: 32px; }
  .vrow { grid-template-columns: 86px minmax(0, 1fr); } .vc { grid-column: 1 / -1; text-align: left; margin-top: -6px; }
  .perf { grid-template-columns: repeat(2, minmax(0, 1fr)); } .chart, .axis { gap: 4px; }
}
</style>

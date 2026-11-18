
<template>
  <div>
    <h1>KPIs</h1>
    <p class="sub">What the business is doing: dealers who order, cars won, fees earned, and how well the personal lists work. Malaysia time.</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>
    <div class="row wrap" style="gap: 8px; margin-bottom: 14px; justify-content: flex-start">
      <span v-for="p in periods" :key="p.key" class="chip tag" :class="{ on: period === p.key }" @click="period = p.key">{{ p.label }}</span>
    </div>
    <div v-if="loading" class="muted">Loading ...</div>

    <template v-else>
      <div class="grid kpis">
        <div class="card kpi"><small>Dealers who ordered</small><b>{{ k.activeDealers }}</b><span class="muted small">of {{ k.totalDealers }} active dealers</span></div>
        <div class="card kpi"><small>Bid orders</small><b>{{ k.orders }}</b><span class="muted small">{{ k.placed }} placed at the auction</span></div>
        <div class="card kpi"><small>Cars won</small><b>{{ k.won }}</b><span class="muted small">win rate {{ k.winRate }}</span></div>
        <div class="card kpi"><small>Repeat dealers</small><b>{{ k.repeat }}</b><span class="muted small">won 2 or more cars</span></div>
        <div class="card kpi"><small>Agent fees earned</small><b>¥{{ n(k.fees) }}</b><span class="muted small">average ¥{{ n(k.avgFee) }} a car</span></div>
        <div class="card kpi"><small>Value of cars won</small><b>¥{{ n(k.wonValue) }}</b></div>
        <div class="card kpi"><small>Personal lists sent</small><b>{{ k.lists }}</b><span class="muted small">{{ k.listsOpened }} opened</span></div>
        <div class="card kpi"><small>Bid clicks from lists</small><b>{{ k.bidClicks }}</b><span class="muted small">{{ k.sheetReq }} sheet requests</span></div>
      </div>

      <h2 style="margin: 22px 0 10px">By month</h2>
      <div class="card" style="overflow-x: auto; padding: 4px 14px">
        <table class="t">
          <thead><tr><th>Month</th><th class="r">Bid orders</th><th class="r">Won</th><th class="r">Fees (¥)</th><th class="r">Dealers who ordered</th></tr></thead>
          <tr v-for="m in months" :key="m.key"><td>{{ m.key }}</td><td class="r">{{ m.orders }}</td><td class="r">{{ m.won }}</td><td class="r">{{ n(m.fees) }}</td><td class="r">{{ m.dealers }}</td></tr>
          <tr v-if="!months.length"><td colspan="5" class="muted" style="padding: 16px 4px">No orders yet.</td></tr>
        </table>
      </div>

      <h2 style="margin: 22px 0 10px">By dealer</h2>
      <div class="card" style="overflow-x: auto; padding: 4px 14px">
        <table class="t">
          <thead><tr><th>Dealer</th><th>Plan</th><th class="r">Orders</th><th class="r">Won</th><th class="r">Fees (¥)</th><th>Last order</th></tr></thead>
          <tr v-for="d in dealers" :key="d.id"><td><b>{{ d.name }}</b></td><td><span class="chip">{{ d.tier }}</span></td><td class="r">{{ d.orders }}</td><td class="r">{{ d.won }}</td><td class="r">{{ n(d.fees) }}</td><td class="small">{{ d.last ? fmtMytDateTime(d.last).slice(0, 10) : 'never' }}</td></tr>
          <tr v-if="!dealers.length"><td colspan="6" class="muted" style="padding: 16px 4px">No dealers yet.</td></tr>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime } from '@aim/core'

const db = useDb()
const periods = [{ key: '30', label: 'Last 30 days' }, { key: '90', label: 'Last 90 days' }, { key: 'all', label: 'All time' }]
const period = ref('30'), loading = ref(true), err = ref('')
const bids = ref<any[]>([]), aps = ref<any[]>([]), lists = ref<any[]>([]), events = ref<any[]>([])
const n = (v: number) => Math.round(v || 0).toLocaleString('en-US')
const myt = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' })

const since = computed(() => (period.value === 'all' ? 0 : Date.now() - Number(period.value) * 86400_000))
const inPeriod = (iso: string | null) => !!iso && new Date(iso).getTime() >= since.value
const pb = computed(() => bids.value.filter((b) => inPeriod(b.created_at)))
const wonBids = computed(() => pb.value.filter((b) => b.status === 'won'))
const k = computed(() => {
  const won = wonBids.value, lost = pb.value.filter((b) => b.status === 'lost').length
  const perDealer = new Map<string, number>()
  for (const b of won) perDealer.set(b.ap_id, (perDealer.get(b.ap_id) || 0) + 1)
  const fees = won.reduce((s, b) => s + Number(b.agent_fee_jpy || 0), 0)
  const pl = lists.value.filter((l) => inPeriod(l.created_at)), plIds = new Set(pl.map((l) => l.id))
  const ev = events.value.filter((e) => plIds.has(e.list_id))
  return {
    totalDealers: aps.value.length, activeDealers: new Set(pb.value.map((b) => b.ap_id)).size,
    orders: pb.value.length, placed: pb.value.filter((b) => ['placed', 'won', 'lost'].includes(b.status)).length,
    won: won.length, winRate: won.length + lost ? Math.round((won.length / (won.length + lost)) * 100) + '%' : '—',
    repeat: [...perDealer.values()].filter((c) => c >= 2).length, fees, avgFee: won.length ? fees / won.length : 0,
    wonValue: won.reduce((s, b) => s + Number(b.final_price_jpy || 0), 0),
    lists: pl.length, listsOpened: new Set(ev.filter((e) => e.event === 'open').map((e) => e.list_id)).size,
    bidClicks: ev.filter((e) => e.event === 'bid_click').length, sheetReq: ev.filter((e) => e.event === 'request_sheet').length,
  }
})
const months = computed(() => {
  const m = new Map<string, { key: string; orders: number; won: number; fees: number; ds: Set<string> }>()
  for (const b of bids.value) {
    const key = myt(b.created_at).slice(0, 7)
    const x = m.get(key) || m.set(key, { key, orders: 0, won: 0, fees: 0, ds: new Set() }).get(key)!
    x.orders++; x.ds.add(b.ap_id)
    if (b.status === 'won') { x.won++; x.fees += Number(b.agent_fee_jpy || 0) }
  }
  return [...m.values()].sort((a, b) => b.key.localeCompare(a.key)).slice(0, 12).map((x) => ({ ...x, dealers: x.ds.size }))
})
const dealers = computed(() => aps.value.map((a) => {
  const mine = pb.value.filter((b) => b.ap_id === a.id), won = mine.filter((b) => b.status === 'won')
  const last = bids.value.filter((b) => b.ap_id === a.id).map((b) => b.created_at).sort().pop() || null
  return { id: a.id, name: a.company_name || a.contact_name || a.email, tier: a.tier, orders: mine.length, won: won.length, fees: won.reduce((s, b) => s + Number(b.agent_fee_jpy || 0), 0), last }
}).sort((a, b) => b.fees - a.fees || b.orders - a.orders))

onMounted(async () => {
  try {
    const [b, a, l, e] = await Promise.all([
      db.from('bids').select('ap_id,status,max_bid_jpy,final_price_jpy,agent_fee_jpy,created_at').order('created_at', { ascending: false }).limit(20000),
      db.from('profiles').select('id,company_name,contact_name,email,tier').eq('role', 'ap_holder').eq('status', 'active'),
      db.from('dealer_lists').select('id,created_at').eq('draft', false).limit(5000),
      db.from('dealer_list_events').select('list_id,event').limit(50000),
    ])
    const bad = [b, a, l, e].find((x) => x.error)
    if (bad) throw bad.error
    bids.value = b.data || []; aps.value = a.data || []; lists.value = l.data || []; events.value = e.data || []
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.kpis { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.kpi { display: grid; gap: 2px; } .kpi small { color: var(--mu); } .kpi b { font-size: 22px; }
.t { width: 100%; border-collapse: collapse; } .t th { text-align: left; color: var(--mu); font-weight: 500; font-size: 12px; padding: 10px 6px; }
.t td { padding: 9px 6px; border-top: 1px solid var(--line); } .r { text-align: right; } .t th.r { text-align: right; }
</style>

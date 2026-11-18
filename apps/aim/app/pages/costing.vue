
<template>
  <div>
    <h1>Order costing</h1>
    <p class="sub">Internal only: dealers never see anything on this page. Each car: the deal agreed with the dealer, every cost line, and the real profit. Estimates come from the rate card; replace them with the confirmed amount when the invoice arrives.</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>
    <div class="row wrap" style="gap: 8px; margin-bottom: 14px; justify-content: flex-start">
      <span v-for="t in tabs" :key="t.key" class="chip tag" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }}</span>
    </div>
    <div v-if="loading" class="muted">Loading ...</div>

    <!-- ORDERS -->
    <template v-else-if="tab !== 'rates'">
      <div v-if="!shownBids.length" class="card muted">No cars here.</div>
      <div class="grid">
        <div v-for="b in shownBids" :key="b.id" class="card">
          <div class="row" style="align-items: flex-start; cursor: pointer" @click="open(b)">
            <div style="min-width: 0">
              <b>{{ b.lots?.brand }} {{ b.lots?.model }}</b> <span class="muted small">{{ [b.lots?.mfg_year, b.lots?.venue, 'lot ' + b.lots?.lot_no].filter(Boolean).join(' · ') }}</span>
              <div class="muted small">{{ b.ap?.company_name || b.ap?.contact_name || b.ap?.email }} · {{ b.status }}{{ b.final_price_jpy ? ' · won ' + yen(b.final_price_jpy) : ' · dealer max ' + yen(b.max_bid_jpy) }}</div>
            </div>
            <span class="chip" :class="sel?.id === b.id ? 'ac' : ''">{{ sel?.id === b.id ? 'close' : 'open' }}</span>
          </div>

          <div v-if="sel?.id === b.id" class="editor">
            <h2 style="margin-top: 14px">Deal agreed with the dealer</h2>
            <div class="grid2">
              <label class="f">Type
                <select v-model="deal.basis"><option value="bid_plus_fixed">Bid amount + fixed freight and insurance</option><option value="cif">All in (CIF): freight and insurance included</option></select>
              </label>
              <label class="f">{{ deal.basis === 'cif' ? 'Dealer all-in amount (¥)' : 'Dealer bid amount (¥)' }}<input v-model.number="deal.offer" type="number" step="5000" /></label>
              <label v-if="deal.basis === 'bid_plus_fixed'" class="f">Fixed freight + insurance (¥)<input v-model.number="deal.fixed" type="number" step="1000" :placeholder="b.agent_fee_jpy ? 'agent fee on file: ' + b.agent_fee_jpy : ''" /></label>
              <label class="f">Give back to the dealer (¥)<input v-model.number="deal.giveback" type="number" step="1000" /></label>
              <label class="f" style="grid-column: 1 / -1"><span class="row" style="justify-content: flex-start; gap: 8px; color: var(--tx)"><input v-model="deal.show" type="checkbox" style="width: auto; height: auto" /> The dealer asked to see the winning price (unticked: we invoice their amount, even if we won lower)</span></label>
            </div>

            <h2 style="margin-top: 16px">Cost lines</h2>
            <table class="t">
              <thead><tr><th>Line</th><th class="r">Amount ¥</th><th class="r">Comes back ¥</th><th>Status</th><th>Party</th><th></th></tr></thead>
              <tr v-for="(l, i) in lines" :key="l.uid">
                <td><input v-model="l.label" /></td>
                <td class="r"><input v-model.number="l.amount" type="number" class="num" /></td>
                <td class="r"><input v-model.number="l.refundable" type="number" class="num" /></td>
                <td><select v-model="l.status"><option value="estimate">estimate</option><option value="confirmed">confirmed</option></select></td>
                <td><input v-model="l.party" placeholder="who" /></td>
                <td><a class="x" title="Remove" @click="lines.splice(i, 1)">×</a></td>
              </tr>
            </table>
            <div class="row wrap" style="gap: 8px; margin: 10px 0; justify-content: flex-start">
              <button class="btn ghost sm" @click="fillFromRates(b)">Fill missing lines from the rate card</button>
              <button class="btn ghost sm" @click="addLine()">Add a line</button>
            </div>

            <div class="grid kpis">
              <div class="card kpi"><small>Invoice to the dealer</small><b>{{ yen(money.invoice) }}</b><span class="muted small">{{ rmOf(money.invoice) }}</span></div>
              <div class="card kpi"><small>Net actual cost</small><b>{{ yen(money.cost) }}</b><span class="muted small">cash out {{ yen(money.cash) }}</span></div>
              <div class="card kpi"><small>Profit</small><b :class="money.profit == null ? '' : money.profit >= 0 ? 'up' : 'down'">{{ yen(money.profit) }}</b><span class="muted small">{{ rmOf(money.profit) }}{{ money.margin != null ? ' · ' + money.margin + '% of the invoice' : '' }}</span></div>
              <div class="card kpi"><small>Most to bid</small><b>{{ yen(ceiling) }}</b>
                <span class="muted small">profit wanted ¥ <input v-model.number="target" type="number" step="10000" style="width: 90px" /></span></div>
            </div>
            <div class="row wrap" style="gap: 8px; margin-top: 12px; justify-content: flex-start">
              <button class="btn" :disabled="busy" @click="save(b)">Save</button>
              <span v-if="msg" class="okmsg" style="padding: 6px 10px">{{ msg }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- RATE CARD -->
    <template v-else>
      <div class="card" style="margin-bottom: 14px">
        <h2>Add a rate</h2>
        <p class="muted small" style="margin: 4px 0 10px">A new rate is a new line: the newest line that has started is used for estimates, and old lines stay as history. A line with a venue beats a line for every venue.</p>
        <div class="grid2">
          <label class="f">Cost line<select v-model="nr.item_key"><option v-for="i in items" :key="i.key" :value="i.key">{{ i.label }}</option></select></label>
          <label class="f">Amount (¥)<input v-model.number="nr.amount_jpy" type="number" step="100" /></label>
          <label class="f">Party (forwarder, transport company ...)<input v-model="nr.party" /></label>
          <label class="f">Venue (empty = every venue)<input v-model="nr.venue" placeholder="Yokohama" /></label>
          <label class="f">Valid from<input v-model="nr.valid_from" type="date" /></label>
          <label class="f">Note<input v-model="nr.note" /></label>
        </div>
        <div style="margin-top: 12px"><button class="btn" :disabled="busy || nr.amount_jpy == null" @click="addRate">Add the rate</button></div>
      </div>
      <div class="card" style="overflow-x: auto; padding: 4px 14px">
        <table class="t">
          <thead><tr><th>Cost line</th><th>Party</th><th>Venue</th><th class="r">Amount ¥</th><th>Valid from</th><th>Note</th><th></th></tr></thead>
          <tr v-for="r in rates" :key="r.id" :class="{ old: r.valid_from > today }">
            <td>{{ labelOf(r.item_key) }}</td><td>{{ r.party || '—' }}</td><td>{{ r.venue || 'every venue' }}</td><td class="r">{{ n(r.amount_jpy) }}</td><td>{{ r.valid_from }}{{ r.valid_from > today ? ' (future)' : '' }}</td><td class="small muted">{{ r.note || '' }}</td>
            <td><a class="x" title="Delete" @click="delRate(r)">×</a></td>
          </tr>
          <tr v-if="!rates.length"><td colspan="7" class="muted" style="padding: 16px 4px">The rate card is empty. Add the freight, inland transport and other rates you pay; cost lines are then pre-filled with them.</td></tr>
        </table>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { invoiceJpy, netCostJpy, cashOutlayJpy, profitOf, bidCeilingJpy, pickRate, type Deal } from '@aim/core'

const db = useDb()
const { rate, loadRate } = useRate()
const tabs = [{ key: 'won', label: 'Won cars' }, { key: 'open', label: 'Bids not decided yet' }, { key: 'rates', label: 'Rate card' }]
const tab = ref('won'), loading = ref(true), busy = ref(false), err = ref(''), msg = ref('')
const bids = ref<any[]>([]), items = ref<any[]>([]), rates = ref<any[]>([]), sel = ref<any>(null)
const deal = reactive({ basis: 'bid_plus_fixed' as 'bid_plus_fixed' | 'cif', offer: null as number | null, fixed: null as number | null, giveback: 0, show: true })
const lines = ref<any[]>([]), target = ref(0)
const nr = reactive({ item_key: 'ocean_freight', amount_jpy: null as number | null, party: '', venue: '', valid_from: new Date().toISOString().slice(0, 10), note: '' })
const today = new Date().toISOString().slice(0, 10)
let uid = 0
const n = (v: number) => Math.round(Number(v) || 0).toLocaleString('en-US')
const yen = (v: number | null | undefined) => (v == null ? '—' : '¥' + n(v))
const rmOf = (v: number | null) => (v != null && rate.value > 0 ? 'RM ' + n(v * rate.value) : '')
const labelOf = (k: string) => items.value.find((i) => i.key === k)?.label || k
const shownBids = computed(() => bids.value.filter((b) => (tab.value === 'won' ? b.status === 'won' : ['pending', 'placed'].includes(b.status))))

const dealObj = (b: any): Deal => ({ basis: deal.basis, offerJpy: deal.offer, fixedChargeJpy: deal.fixed ?? (b?.agent_fee_jpy != null ? Number(b.agent_fee_jpy) : null), showWonPrice: deal.show, givebackJpy: Number(deal.giveback) || 0, wonJpy: b?.final_price_jpy != null ? Number(b.final_price_jpy) : null })
const costs = computed(() => lines.value.map((l) => ({ amountJpy: Number(l.amount) || 0, refundableJpy: Number(l.refundable) || 0 })))
const money = computed(() => {
  const b = sel.value, d = dealObj(b), p = b ? profitOf(d, costs.value) : null
  return { invoice: b ? invoiceJpy(d) : null, cost: b?.final_price_jpy != null ? netCostJpy(d.wonJpy, costs.value) : null, cash: b?.final_price_jpy != null ? cashOutlayJpy(d.wonJpy, costs.value) : null, profit: p?.profitJpy ?? null, margin: p?.marginPct ?? null }
})
const ceiling = computed(() => (sel.value ? bidCeilingJpy({ basis: deal.basis, offerJpy: deal.offer, givebackJpy: Number(deal.giveback) || 0 }, costs.value, Number(target.value) || 0) : null))

const newLine = (o: any = {}) => ({ uid: ++uid, id: null, item_key: null, label: '', amount: 0, refundable: 0, status: 'estimate', party: '', ...o })
const addLine = () => lines.value.push(newLine())
async function open(b: any) {
  if (sel.value?.id === b.id) { sel.value = null; return }
  msg.value = ''; err.value = ''
  const { data, error } = await db.from('order_costs').select('*').eq('bid_id', b.id).order('updated_at')
  if (error) { err.value = error.message; return }
  sel.value = b
  Object.assign(deal, { basis: b.deal_basis || 'bid_plus_fixed', offer: b.offer_jpy != null ? Number(b.offer_jpy) : (b.deal_basis === 'cif' ? null : Number(b.max_bid_jpy) || null), fixed: b.fixed_charge_jpy != null ? Number(b.fixed_charge_jpy) : null, giveback: Number(b.giveback_jpy) || 0, show: b.show_won_price !== false })
  lines.value = (data || []).map((r: any) => newLine({ id: r.id, item_key: r.item_key, label: r.label, amount: Number(r.amount_jpy), refundable: Number(r.refundable_jpy), status: r.status, party: r.party || '' }))
}
function fillFromRates(b: any) {
  const have = new Set(lines.value.map((l) => l.item_key).filter(Boolean))
  let added = 0
  for (const it of items.value) {
    if (have.has(it.key) || it.kind === 'refundable') continue
    const r = pickRate(rates.value, it.key, b.lots?.venue || null, today)
    if (!r) continue
    lines.value.push(newLine({ item_key: it.key, label: it.label, amount: Number(r.amount_jpy), status: 'estimate', party: r.party || '' })); added++
  }
  msg.value = added ? `${added} line${added === 1 ? '' : 's'} added from the rate card` : 'The rate card has nothing new for this car'
}
async function save(b: any) {
  busy.value = true; err.value = ''; msg.value = ''
  try {
    const up = await db.from('bids').update({ deal_basis: deal.basis, offer_jpy: deal.offer, fixed_charge_jpy: deal.basis === 'bid_plus_fixed' ? deal.fixed : null, show_won_price: deal.show, giveback_jpy: Number(deal.giveback) || 0 }).eq('id', b.id)
    if (up.error) throw up.error
    const keep = lines.value.filter((l) => l.id).map((l) => l.id)
    const old = await db.from('order_costs').select('id').eq('bid_id', b.id)
    const gone = (old.data || []).map((r: any) => r.id).filter((id: string) => !keep.includes(id))
    if (gone.length) { const d = await db.from('order_costs').delete().in('id', gone); if (d.error) throw d.error }
    for (const l of lines.value) {
      const row = { bid_id: b.id, item_key: l.item_key, label: l.label || 'Other', amount_jpy: Number(l.amount) || 0, refundable_jpy: Number(l.refundable) || 0, status: l.status, party: l.party || null, updated_at: new Date().toISOString() }
      const r = l.id ? await db.from('order_costs').update(row).eq('id', l.id) : await db.from('order_costs').insert(row).select('id').single()
      if (r.error) throw r.error
      if (!l.id && (r as any).data) l.id = (r as any).data.id
    }
    Object.assign(b, { deal_basis: deal.basis, offer_jpy: deal.offer, fixed_charge_jpy: deal.fixed, show_won_price: deal.show, giveback_jpy: deal.giveback })
    msg.value = 'Saved'
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}

async function addRate() {
  busy.value = true; err.value = ''
  const { error } = await db.from('rate_card').insert({ item_key: nr.item_key, amount_jpy: nr.amount_jpy, party: nr.party.trim() || null, venue: nr.venue.trim() || null, valid_from: nr.valid_from || today, note: nr.note.trim() || null })
  busy.value = false
  if (error) { err.value = error.message; return }
  Object.assign(nr, { amount_jpy: null, note: '' }); await loadRates()
}
async function delRate(r: any) { if (!confirm('Delete this rate line? (To change a rate, add a new line instead: the old one stays as history.)')) return; const { error } = await db.from('rate_card').delete().eq('id', r.id); if (error) err.value = error.message; else await loadRates() }
async function loadRates() {
  const { data, error } = await db.from('rate_card').select('*').order('item_key').order('valid_from', { ascending: false }).limit(2000)
  if (error) throw error
  rates.value = (data || []).map((r: any) => ({ ...r, amount_jpy: Number(r.amount_jpy) }))
}

onMounted(async () => {
  try {
    await loadRate().catch(() => {})
    const [b, i] = await Promise.all([
      db.from('bids').select('id,status,max_bid_jpy,final_price_jpy,agent_fee_jpy,deal_basis,offer_jpy,fixed_charge_jpy,show_won_price,giveback_jpy,created_at,ap:profiles!ap_id(company_name,contact_name,email),lots(brand,model,venue,lot_no,mfg_year)').in('status', ['pending', 'placed', 'won']).order('created_at', { ascending: false }).limit(500),
      db.from('cost_items').select('*').order('sort'),
    ])
    if (b.error) throw b.error
    if (i.error) throw i.error
    bids.value = b.data || []; items.value = i.data || []
    await loadRates()
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.f { display: grid; gap: 5px; color: var(--mu); font-size: 12px; } .f input, .f select { width: 100%; }
.editor { border-top: 1px solid var(--line); margin-top: 12px; }
.t { width: 100%; border-collapse: collapse; } .t th { text-align: left; color: var(--mu); font-weight: 500; font-size: 12px; padding: 8px 6px; }
.t td { padding: 5px 6px; border-top: 1px solid var(--line); } .t td input, .t td select { width: 100%; } .num { text-align: right; max-width: 130px; }
.r { text-align: right; } .t th.r { text-align: right; }
.kpis { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); margin-top: 6px; }
.kpi { display: grid; gap: 2px; } .kpi small { color: var(--mu); } .kpi b { font-size: 19px; }
.up { color: var(--ok); } .down { color: var(--bad); }
.x { cursor: pointer; color: var(--mu); } .x:hover { color: var(--bad); }
tr.old td { opacity: .6; }
@media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
</style>

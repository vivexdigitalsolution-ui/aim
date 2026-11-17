<template>
  <div>
    <h1>Bid pipeline</h1>
    <p class="sub">Orders from dealers, car by car, soonest deadline first. Place them at the auction, then record the result. The dealer sees the status and your note.</p>

    <div class="row wrap" style="gap: 8px; margin-bottom: 14px">
      <span v-for="t in tabs" :key="t.key" class="chip tag" :class="{ on: tab === t.key }" @click="tab = t.key">{{ t.label }} <small>{{ counts[t.key] || 0 }}</small></span>
      <span class="grow" />
      <button v-if="tab === 'todo' && copyable.length" class="btn ghost sm" @click="copySheet">{{ copied ? 'Copied' : 'Copy bid sheet' }}</button>
      <button class="btn ghost sm" @click="load">Refresh</button>
    </div>

    <div v-if="err" class="err" style="margin-bottom: 10px">{{ err }}</div>
    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!groups.length" class="card muted">Nothing here.</div>

    <div class="grid">
      <div v-for="g in groups" :key="g.lot.id" class="card">
        <div class="row">
          <div style="min-width: 0">
            <b>{{ g.lot.brand }} {{ g.lot.model }}</b>
            <div class="muted small">{{ g.lot.venue }} · lot <b>{{ g.lot.lot_no }}</b> · {{ g.lot.auction_date }} · {{ [g.lot.mfg_year, g.lot.grade ? 'grade ' + g.lot.grade : null, g.lot.mileage_km != null ? g.lot.mileage_km.toLocaleString('en-US') + ' km' : null].filter(Boolean).join(' · ') }} · start ¥{{ (g.lot.start_price_jpy || 0).toLocaleString('en-US') }}</div>
          </div>
          <span class="chip" :class="closed(g.lot) ? 'bad' : soon(g.lot) ? 'warn' : 'ac'">{{ closed(g.lot) ? 'deadline passed' : fmtMytDateTime(g.lot.bid_deadline) + ' · ' + left(g.lot.bid_deadline) }}</span>
        </div>

        <div v-for="b in g.bids" :key="b.id" class="bid">
          <div class="who">
            <b>{{ b.ap?.company_name || b.ap?.contact_name || 'AP holder' }}</b>
            <div class="muted small">{{ [b.ap?.contact_name !== b.ap?.company_name ? b.ap?.contact_name : null, b.ap?.phone || b.ap?.whatsapp].filter(Boolean).join(' · ') }}</div>
            <div v-if="b.ap_note" class="small" style="margin-top: 3px">“{{ b.ap_note }}”</div>
            <div v-if="exposure(b.ap)" class="small muted" style="margin-top: 3px" :class="{ down: exposure(b.ap)!.over }">Open orders ¥{{ exposure(b.ap)!.open.toLocaleString('en-US') }} of ¥{{ b.ap.open_limit_jpy.toLocaleString('en-US') }}</div>
          </div>
          <div class="amt">
            <b>¥{{ Number(b.max_bid_jpy).toLocaleString('en-US') }}</b>
            <div class="muted small">{{ rm(b.max_bid_jpy) }}</div>
          </div>
          <div class="st">
            <span class="chip" :class="STATUS[b.status]?.cls">{{ STATUS[b.status]?.label }}</span>
            <div v-if="b.status === 'won'" class="small" style="margin-top: 3px">¥{{ Number(b.final_price_jpy).toLocaleString('en-US') }} <span class="muted">({{ rm(b.final_price_jpy) }})</span><br /><span class="muted">agent fee ¥{{ Number(b.agent_fee_jpy || 0).toLocaleString('en-US') }}</span></div>
            <div v-if="b.team_note" class="small muted" style="margin-top: 3px">Note: {{ b.team_note }}</div>
          </div>
          <div class="act">
            <template v-if="wonFor === b.id">
              <input v-model.number="wonPrice" type="number" inputmode="numeric" placeholder="Winning price ¥" style="width: 150px" />
              <span class="muted small">{{ wonPrice ? rm(wonPrice) : '' }}</span>
              <button class="btn sm" :disabled="!wonPrice || busy === b.id" @click="set(b, 'won', wonPrice)">Save win</button>
              <button class="btn ghost sm" @click="wonFor = null">Cancel</button>
            </template>
            <template v-else>
              <input v-model="notes[b.id]" class="note" placeholder="Note to the dealer (optional)" />
              <div class="row wrap" style="gap: 6px">
                <button v-if="b.status === 'pending'" class="btn sm" :disabled="busy === b.id" @click="set(b, 'placed')">Mark placed</button>
                <button v-if="['pending', 'placed', 'lost', 'won'].includes(b.status)" class="btn ghost sm" @click="wonFor = b.id; wonPrice = b.final_price_jpy ? Number(b.final_price_jpy) : null">Won ...</button>
                <button v-if="['pending', 'placed'].includes(b.status)" class="btn ghost sm" :disabled="busy === b.id" @click="set(b, 'lost')">Not won</button>
                <button v-if="b.status === 'pending'" class="btn ghost sm down" :disabled="busy === b.id" @click="set(b, 'rejected')">Reject</button>
                <button v-if="['placed', 'lost', 'won', 'rejected'].includes(b.status)" class="btn ghost sm" :disabled="busy === b.id" @click="set(b, 'pending')">Back to waiting</button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime, timeLeft } from '@aim/core'

const db = useDb()
const now = useNow()
const { loadRate, rm } = useRate()
const bidCount = useState<number | null>('bid-count', () => null)
const bids = ref<any[]>([]), loading = ref(true), err = ref(''), busy = ref(''), tab = ref('todo')
const wonFor = ref(''), wonPrice = ref<number | null>(null), notes = reactive<Record<string, string>>({}), copied = ref(false)

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'To place', cls: 'warn' }, placed: { label: 'Placed', cls: 'ac' }, won: { label: 'Won', cls: 'ok' },
  lost: { label: 'Not won', cls: '' }, cancelled: { label: 'Cancelled by dealer', cls: '' }, rejected: { label: 'Rejected', cls: 'bad' },
}
const TABS: Record<string, string[]> = { todo: ['pending'], placed: ['placed'], won: ['won'], lost: ['lost'], other: ['cancelled', 'rejected'] }
const tabs = [{ key: 'todo', label: 'To place' }, { key: 'placed', label: 'Placed' }, { key: 'won', label: 'Won' }, { key: 'lost', label: 'Not won' }, { key: 'other', label: 'Cancelled / rejected' }]
const counts = computed(() => Object.fromEntries(Object.entries(TABS).map(([k, st]) => [k, bids.value.filter((b) => st.includes(b.status)).length])))

const closed = (l: any) => new Date(l.bid_deadline).getTime() <= now.value
const soon = (l: any) => new Date(l.bid_deadline).getTime() - now.value < 3 * 3600_000
const left = (iso: string) => timeLeft(iso, now.value).label

const groups = computed(() => {
  const m = new Map<string, { lot: any; bids: any[] }>()
  for (const b of bids.value.filter((x) => TABS[tab.value]!.includes(x.status))) {
    if (!b.lots) continue
    ;(m.get(b.lot_id) || m.set(b.lot_id, { lot: b.lots, bids: [] }).get(b.lot_id)!).bids.push(b)
  }
  const out = [...m.values()]
  for (const g of out) g.bids.sort((a, b) => Number(b.max_bid_jpy) - Number(a.max_bid_jpy))
  // to place / placed: soonest deadline first; results: newest first
  const asc = tab.value === 'todo' || tab.value === 'placed'
  return out.sort((a, b) => (asc ? 1 : -1) * String(a.lot.bid_deadline).localeCompare(String(b.lot.bid_deadline)))
})

// what each dealer has open in total, against their own limit
function exposure(ap: any) {
  if (!ap || ap.open_limit_jpy == null) return null
  const open = bids.value.filter((b) => b.ap_id === ap.id && ['pending', 'placed'].includes(b.status)).reduce((s, b) => s + Number(b.max_bid_jpy), 0)
  return { open, over: open > Number(ap.open_limit_jpy) }
}

const copyable = computed(() => groups.value.filter((g) => !closed(g.lot)))
async function copySheet() {
  const lines = copyable.value.flatMap((g) => g.bids.map((b) => `${g.lot.venue} | lot ${g.lot.lot_no} | ${g.lot.brand} ${g.lot.model} | grade ${g.lot.grade || '-'} | max ¥${Number(b.max_bid_jpy).toLocaleString('en-US')} | ${b.ap?.company_name || b.ap?.contact_name || ''} | closes ${fmtMytDateTime(g.lot.bid_deadline)}`))
  try { await navigator.clipboard.writeText(lines.join('\n')); copied.value = true; setTimeout(() => (copied.value = false), 2000) } catch { err.value = 'Could not copy: your browser blocked the clipboard' }
}

async function load() {
  loading.value = true; err.value = ''
  try {
    await loadRate()
    const { data, error } = await db.from('bids')
      .select('id,ap_id,lot_id,max_bid_jpy,status,ap_note,team_note,final_price_jpy,agent_fee_jpy,created_at,decided_at,ap:profiles!ap_id(id,company_name,contact_name,phone,whatsapp,open_limit_jpy),lots(id,brand,model,grade,mfg_year,mileage_km,venue,auction_date,lot_no,start_price_jpy,bid_deadline)')
      .order('created_at', { ascending: false }).limit(1000)
    if (error) throw error
    bids.value = data || []
    bidCount.value = bids.value.filter((b) => b.status === 'pending').length
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
}

async function set(b: any, status: string, final?: number | null) {
  if (status === 'rejected' && !confirm('Reject this order? The dealer will see it as rejected.')) return
  busy.value = b.id; err.value = ''
  try {
    const { error } = await db.rpc('staff_set_bid', { p_bid: b.id, p_status: status, p_final: final ?? null, p_note: (notes[b.id] || '').trim() || null })
    if (error) throw error
    wonFor.value = ''; notes[b.id] = ''
    await load()
  } catch (e: any) { err.value = e.message } finally { busy.value = '' }
}

onMounted(load)
</script>

<style scoped>
.bid { display: grid; grid-template-columns: minmax(0, 1.3fr) 110px minmax(0, 1fr) minmax(0, 1.5fr); gap: 14px; align-items: start; padding: 12px 0 2px; margin-top: 12px; border-top: 1px solid var(--line); }
.amt { text-align: right; } .amt b { font-size: 16px; }
.act { display: grid; gap: 8px; justify-items: start; }
.note { width: 100%; height: 34px; font-size: 13px; }
.btn.sm { height: 32px; padding: 0 12px; font-size: 13px; }
.down { color: var(--bad); }
@media (max-width: 900px) { .bid { grid-template-columns: 1fr 1fr; } .amt { text-align: left; } .act { grid-column: 1 / -1; } }
</style>

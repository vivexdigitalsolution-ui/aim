<template>
  <div>
    <h1>Dealer lists</h1>
    <p class="sub">Pick 3–5 cars that fit a dealer's buy list, send them a personal link, and see what they open. The figures in a list are fixed when you create it.</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>

    <div v-if="drafts.length" class="card" style="margin-bottom: 16px; border-color: var(--ac)">
      <h2>{{ drafts.length }} draft{{ drafts.length === 1 ? '' : 's' }} waiting for you</h2>
      <p class="muted small" style="margin: 4px 0 10px">Made automatically from each dealer's buy list. Nothing is sent and the dealer sees nothing until you press Send.</p>
      <div v-for="d in drafts" :key="d.id" class="draft">
        <div style="min-width: 0">
          <b>{{ d.who }}</b> <span class="muted small">· {{ d.items.length }} car{{ d.items.length === 1 ? '' : 's' }} · made {{ fmtMytDateTime(d.created_at) }}</span>
          <div class="small muted">{{ d.items.map((i: any) => i.title + ' (' + i.margin_pct + '%)').join(' · ') }}</div>
          <div v-if="sentLink[d.id]" class="okmsg" style="margin-top: 8px">
            <div class="small" style="word-break: break-all">{{ sentLink[d.id].url }}</div>
            <button class="btn ghost sm" style="margin-top: 6px" @click="copy(sentLink[d.id].text, d.id)">{{ copied === d.id ? 'Copied' : 'Copy message with link' }}</button>
          </div>
        </div>
        <div class="row" style="gap: 6px; flex: none">
          <button v-if="!sentLink[d.id]" class="btn sm" :disabled="busy" @click="sendDraft(d)">Send</button>
          <button v-if="!sentLink[d.id]" class="btn ghost sm down" :disabled="busy" @click="discardDraft(d)">Discard</button>
          <button v-if="!sentLink[d.id]" class="btn ghost sm" @click="apId = d.ap_id">Open dealer</button>
        </div>
      </div>
    </div>

    <div class="row wrap" style="gap: 10px; margin-bottom: 14px; justify-content: flex-start">
      <select v-model="apId" style="min-width: 280px">
        <option value="">Choose a dealer ...</option>
        <option v-for="a in aps" :key="a.id" :value="a.id">{{ a.company_name || a.contact_name || a.email }} · {{ a.tier }}</option>
      </select>
      <button v-if="apId" class="btn ghost sm" @click="showBl = !showBl">{{ showBl ? 'Hide buy list' : 'Edit buy list' }}</button>
    </div>
    <div v-if="apId && showBl" class="card" style="margin-bottom: 14px"><BuyListForm :ap-id="apId" @saved="bl = $event" /></div>
    <div v-else-if="apId" style="display: none"><BuyListForm :ap-id="apId" @saved="bl = $event" /></div>

    <template v-if="apId && bl">
      <div class="card" style="margin-bottom: 14px">
        <div class="row wrap" style="gap: 8px; justify-content: flex-start">
          <b>Buy list:</b>
          <span class="chip">{{ bl.brands.length ? bl.brands.join(', ') : 'any make' }}</span>
          <span class="chip">{{ bl.models.length ? bl.models.join(', ') : 'any model' }}</span>
          <span v-if="bl.segments?.length" class="chip ac">{{ bl.segments.map((k) => segLabel(k)).join(', ') }}</span>
          <span v-if="bl.year_from" class="chip">{{ bl.year_from }}+</span>
          <span class="chip">{{ bl.budget_myr ? 'up to RM ' + bl.budget_myr.toLocaleString('en-US') : 'no budget limit' }}</span>
          <span class="chip ac">margin ≥ {{ bl.min_margin_pct }}%</span>
          <span v-if="bl.aps_left != null" class="chip">{{ bl.aps_left }} AP{{ bl.aps_left === 1 ? '' : 's' }} left</span>
          <span v-if="bl.notes" class="muted small">“{{ bl.notes }}”</span>
        </div>
      </div>

      <div v-if="loading" class="muted">Loading cars ...</div>
      <template v-else>
        <div class="row" style="margin-bottom: 8px"><h2>{{ fit.length }} car{{ fit.length === 1 ? '' : 's' }} fit</h2>
          <label class="small muted"><input v-model="showAll" type="checkbox" style="width: auto; height: auto" /> also show cars that do not fit</label></div>
        <div v-if="!shown.length" class="card muted">Nothing fits yet. Lower the minimum margin or widen the models. Cars need a market price, a docket and a usual auction price to get a margin.</div>
        <div class="grid">
          <label v-for="c in shown" :key="c.id" class="card cand" :class="{ off: !c.fits }">
            <input v-model="picked" type="checkbox" :value="c.id" :disabled="!picked.includes(c.id) && picked.length >= 8" style="width: auto; height: auto" />
            <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /></div>
            <div style="min-width: 0">
              <b>{{ c.brand }} {{ c.model }}</b>
              <div class="muted small">{{ [c.mfg_year, c.grade, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null, c.venue].filter(Boolean).join(' · ') }}</div>
              <div class="small">margin <b :class="c.fits ? 'up' : ''">{{ c.atHistory!.marginPct }}%</b> · profit RM {{ c.atHistory!.profitMyr.toLocaleString('en-US') }} · cost RM {{ (c.atHistory!.landedMyr + RECON).toLocaleString('en-US') }} · closes {{ left(c.bid_deadline) }}</div>
              <div v-if="!c.fits" class="small down">not shown to the dealer by default: {{ c.why.join(', ') }}</div>
            </div>
          </label>
        </div>

        <div class="card" style="margin-top: 16px">
          <h2>Create the link</h2>
          <div class="row wrap" style="gap: 10px; margin: 10px 0; justify-content: flex-start">
            <span class="chip ac">{{ picked.length }} car{{ picked.length === 1 ? '' : 's' }} selected</span>
            <label class="small muted">Valid for <select v-model.number="days"><option :value="3">3 days</option><option :value="7">7 days</option><option :value="14">14 days</option></select></label>
          </div>
          <textarea v-model="message" rows="3" style="width: 100%" />
          <div class="row wrap" style="gap: 8px; margin-top: 10px; justify-content: flex-start">
            <button class="btn" :disabled="busy || !picked.length" @click="create">Create link</button>
          </div>
          <div v-if="made" class="okmsg" style="margin-top: 12px">
            <div><b>Link ready.</b> Copy the message and send it to the dealer.</div>
            <div class="small" style="word-break: break-all; margin: 6px 0">{{ made.url }}</div>
            <div class="row wrap" style="gap: 8px; justify-content: flex-start">
              <button class="btn ghost sm" @click="copy(made.text)">{{ copied === 'text' ? 'Copied' : 'Copy message with link' }}</button>
              <button class="btn ghost sm" @click="copy(made.url, 'url')">{{ copied === 'url' ? 'Copied' : 'Copy link only' }}</button>
            </div>
          </div>
        </div>
      </template>

      <h2 style="margin: 22px 0 10px">Lists sent to this dealer</h2>
      <div v-if="!past.length" class="card muted">None yet.</div>
      <div class="grid">
        <div v-for="p in past" :key="p.id" class="card">
          <div class="row">
            <div><b>{{ fmtMytDateTime(p.created_at) }}</b> <span class="muted small">· {{ p.items.length }} car{{ p.items.length === 1 ? '' : 's' }} · {{ p.draft ? 'draft, not sent' : p.revoked ? 'revoked' : new Date(p.expires_at) < new Date() ? 'expired' : 'valid until ' + fmtMytDateTime(p.expires_at) }}</span></div>
            <button v-if="!p.draft && !p.revoked && new Date(p.expires_at) > new Date()" class="btn ghost sm down" @click="revoke(p)">Revoke</button>
          </div>
          <div class="row wrap" style="gap: 6px; margin-top: 8px; justify-content: flex-start">
            <span class="chip" :class="p.stats.open ? 'ok' : 'warn'">{{ p.stats.open ? 'opened ' + p.stats.open + 'x, last ' + fmtMytDateTime(p.stats.lastOpen) : 'not opened yet' }}</span>
            <span v-if="p.stats.view_car" class="chip">{{ p.stats.view_car }} car view{{ p.stats.view_car === 1 ? '' : 's' }}</span>
            <span v-if="p.stats.open_calc" class="chip ac">{{ p.stats.open_calc }} calculator</span>
            <span v-if="p.stats.bid_click" class="chip ok">{{ p.stats.bid_click }} bid click{{ p.stats.bid_click === 1 ? '' : 's' }}</span>
            <span v-if="p.stats.request_sheet" class="chip warn">{{ p.stats.request_sheet }} sheet request{{ p.stats.request_sheet === 1 ? '' : 's' }}</span>
          </div>
          <div class="small muted" style="margin-top: 8px">{{ p.items.map((i: any) => i.title + ' (' + i.margin_pct + '%)').join(' · ') }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { matchesBuyList, rankForDealer, listMessage, fmtMytDateTime, timeLeft, type BuyList, type ListItem } from '@aim/core'

const db = useDb()
const now = useNow()
const { load, lots, evaluate, fees, rate } = useMarginBoard()
const RECON = 3000
const aps = ref<any[]>([]), apId = ref(''), bl = ref<BuyList | null>(null), showBl = ref(false)
const loading = ref(true), err = ref(''), busy = ref(false), showAll = ref(false)
const picked = ref<string[]>([]), days = ref(7), message = ref(''), made = ref<{ url: string; text: string } | null>(null), copied = ref('')
const past = ref<any[]>([])
const { segments, map: segMap, load: loadSegments } = useSegments()
const segLabel = (k: string) => segments.value.find((s) => s.key === k)?.label || k
const drafts = ref<any[]>([]), sentLink = ref<Record<string, { url: string; text: string }>>({})
const left = (iso: string) => timeLeft(iso, now.value).label

const dealer = computed(() => aps.value.find((a) => a.id === apId.value))
const candidates = computed(() => {
  if (!bl.value) return []
  const s = { targetPct: bl.value.min_margin_pct, reconMyr: RECON, apFeeMyr: fees.value.apFeeMyr }
  return lots.value.map((l) => evaluate(l, s)).filter((c) => c.market && c.sellMyr && c.dutyMyr != null && c.atHistory).map((c) => {
    const m = matchesBuyList(bl.value!, { brand: c.brand, model: c.model, year: c.mfg_year, landedMyr: c.atHistory!.landedMyr + RECON, marginPct: c.atHistory!.marginPct }, segMap.value)
    return { ...c, fits: m.ok, why: m.why, marginPct: c.atHistory!.marginPct, closesAt: c.bid_deadline }
  })
})
const fit = computed(() => rankForDealer(candidates.value.filter((c) => c.fits)))
const shown = computed(() => (showAll.value ? [...fit.value, ...rankForDealer(candidates.value.filter((c) => !c.fits))] : fit.value).slice(0, 40))

// a new dealer or a new buy list: preselect the best 5 and write the message
watch([fit, apId], () => { if (!made.value) picked.value = fit.value.slice(0, Math.min(5, bl.value?.aps_left ?? 5) || 5).map((c) => c.id) })
watch([apId, days], () => { message.value = listMessage({ dealer: dealer.value?.company_name || dealer.value?.contact_name || '', count: picked.value.length || 5, url: '[link]', expiresDays: days.value }); made.value = null; loadPast() })

function toItem(c: any): ListItem {
  const r = c.market.row
  return {
    lot_id: c.id, title: `${c.brand} ${c.model}`, year: c.mfg_year, km: c.mileage_km, grade: c.grade, photo: c.photos?.[0] || null, venue: c.venue, auction_date: c.auction_date, closes_at: c.bid_deadline,
    market_low: r.p25_myr, market_typical: r.median_myr, market_high: r.p75_myr, market_n: r.n, market_source: r.source || 'carznexus', confidence: c.confidence, wider: c.market.wider,
    usual_jpy: c.history?.price ?? null, max_bid_jpy: c.maxBid, landed_myr: c.atHistory.landedMyr, sell_myr: c.sellMyr, profit_myr: c.atHistory.profitMyr, margin_pct: c.atHistory.marginPct, target_pct: bl.value!.min_margin_pct, jpy_rate: rate.value,
  }
}
async function create() {
  busy.value = true; err.value = ''; made.value = null
  try {
    const items = candidates.value.filter((c) => picked.value.includes(c.id)).map(toItem)
    const { data, error } = await db.from('dealer_lists').insert({ ap_id: apId.value, message: message.value.replace('[link]', '').trim(), items, expires_at: new Date(Date.now() + days.value * 86400_000).toISOString() }).select('token').single()
    if (error) throw error
    const url = `${location.origin}/t/${data.token}`
    made.value = { url, text: message.value.includes('[link]') ? message.value.replace('[link]', url) : message.value + '\n' + url }
    await loadPast()
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
async function copy(text: string, which = 'text') { try { await navigator.clipboard.writeText(text); copied.value = which; setTimeout(() => (copied.value = ''), 2000) } catch { err.value = 'Could not copy: select the text and copy it by hand' } }
async function revoke(p: any) { if (!confirm('Revoke this link? The dealer will no longer be able to open it.')) return; await db.from('dealer_lists').update({ revoked: true }).eq('id', p.id); await loadPast() }

async function loadDrafts() {
  const { data, error } = await db.from('dealer_lists').select('id,ap_id,items,message,created_at,token').eq('draft', true).order('created_at', { ascending: false }).limit(100)
  if (error) { err.value = error.message; return }
  drafts.value = (data || []).map((d: any) => { const a = aps.value.find((x) => x.id === d.ap_id); return { ...d, who: a ? a.company_name || a.contact_name || a.email : 'Dealer' } })
}
async function sendDraft(d: any) {
  busy.value = true; err.value = ''
  try {
    const days = 7
    const { error } = await db.from('dealer_lists').update({ draft: false, expires_at: new Date(Date.now() + days * 86400_000).toISOString(), created_at: new Date().toISOString() }).eq('id', d.id)
    if (error) throw error
    const url = `${location.origin}/t/${d.token}`
    const text = listMessage({ dealer: d.who === 'Dealer' ? '' : d.who, count: d.items.length, url, expiresDays: days })
    sentLink.value = { ...sentLink.value, [d.id]: { url, text } }
    if (apId.value === d.ap_id) await loadPast()
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
async function discardDraft(d: any) {
  if (!confirm('Discard this draft? The dealer never saw it.')) return
  busy.value = true
  const { error } = await db.from('dealer_lists').delete().eq('id', d.id).eq('draft', true)
  busy.value = false
  if (error) { err.value = error.message; return }
  drafts.value = drafts.value.filter((x) => x.id !== d.id)
}

async function loadPast() {
  if (!apId.value) { past.value = []; return }
  const { data, error } = await db.from('dealer_lists').select('*').eq('ap_id', apId.value).order('created_at', { ascending: false }).limit(20)
  if (error) { err.value = error.message; return }
  const ids = (data || []).map((l: any) => l.id)
  const ev = ids.length ? await db.from('dealer_list_events').select('list_id,event,created_at').in('list_id', ids).limit(5000) : { data: [] as any[] }
  past.value = (data || []).map((l: any) => {
    const mine = (ev.data || []).filter((e: any) => e.list_id === l.id)
    const count = (k: string) => mine.filter((e: any) => e.event === k).length
    const opens = mine.filter((e: any) => e.event === 'open').map((e: any) => e.created_at).sort()
    return { ...l, stats: { open: count('open'), lastOpen: opens[opens.length - 1], view_car: count('view_car'), open_calc: count('open_calc'), bid_click: count('bid_click'), request_sheet: count('request_sheet') } }
  })
}

onMounted(async () => {
  try {
    const { data, error } = await db.from('profiles').select('id,company_name,contact_name,email,tier,status').eq('role', 'ap_holder').eq('status', 'active').order('company_name')
    if (error) throw error
    aps.value = data || []
    await Promise.all([load(), loadSegments().catch(() => {}), loadDrafts()])
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.cand { display: grid; grid-template-columns: 22px 92px 1fr; gap: 12px; align-items: start; cursor: pointer; }
.cand.off { opacity: .55; }
.ph { border-radius: 8px; background: var(--s2); aspect-ratio: 4 / 3; overflow: hidden; } .ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
textarea { background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; color: var(--tx); font: inherit; outline: none; resize: vertical; }
.down { color: var(--bad); }
.draft { display: flex; gap: 12px; justify-content: space-between; align-items: flex-start; padding: 10px 0; border-top: 1px solid var(--line); }
@media (max-width: 640px) { .draft { flex-direction: column; } }
</style>

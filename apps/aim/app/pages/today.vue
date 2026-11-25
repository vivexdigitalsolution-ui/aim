<template>
  <div>
    <h1>Today for you</h1>
    <p class="sub">Open auction cars ranked by how much room there is to bid and still make your margin. Market prices are asking prices from CarzNexus dealers, matched by catalog variant.</p>

    <div v-if="err" class="err">{{ err }}</div>

    <div class="card setcard">
      <div class="row wrap" style="gap: 18px; justify-content: flex-start; align-items: flex-end">
        <label class="fld">Target margin<span class="inp"><NumInput v-model="targetPct" decimal class="r" /><i class="suf">%</i></span></label>
        <label class="fld">Japan inland transfer<span class="inp"><i class="pre">¥</i><NumInput v-model="japanInlandJpy" placeholder="0" /></span></label>
        <label class="fld">Port clearance<span class="inp"><i class="pre">RM</i><NumInput v-model="portMyr" /></span></label>
        <label class="fld">Malaysia inland transfer<span class="inp"><i class="pre">RM</i><NumInput v-model="inlandMyr" /></span></label>
        <label class="fld">Your AP fee<span class="inp"><i class="pre">RM</i><NumInput v-model="apFeeMyr" /></span></label>
      </div>
      <div class="muted small note">Margin is on cost: RM 12 back for every RM 100 put in. Price source: CarzNexus asking prices{{ marketAsOf ? ', ' + marketAsOf : '' }}. These are estimates, not sold prices. Repairs are not included.</div>
      <div v-if="!marketAsOf" class="muted small note">No CarzNexus market prices yet. They appear once CarzNexus has linked its listings to the catalog and the market snapshot has been run (<code>node market-snapshot.js --write</code>). Cars with a hand-checked price are listed meanwhile; the others stay in Find by feature.</div>
    </div>

    <div v-if="loading" class="muted">Loading cars ...</div>
    <template v-else>
      <div class="row wrap" style="gap: 8px; margin-bottom: 12px">
        <span class="chip ok">{{ ranked.length }} with a market price</span>
        <span class="chip">{{ stats.noMarket }} no market price yet</span>
        <span class="chip">{{ stats.noDuty }} no docket (duty unknown)</span>
        <span class="chip">{{ stats.open }} open cars</span>
      </div>

      <div v-if="!ranked.length" class="card muted">None of the open cars has both a market price and a docket yet.</div>

      <div class="grid cars">
        <NuxtLink v-for="c in shown" :key="c.id" :to="`/margin?lot=${c.id}`" class="card car">
          <div class="pcol">
            <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /><span v-else>no photo</span></div>
            <div class="mg" :class="mgClass(c)">
              <small>Margin at the usual price</small>
              <b>{{ c.atHistory ? (c.atHistory.profitMyr < 0 ? '−RM ' : '+RM ') + myr(Math.abs(c.atHistory.profitMyr)) : '—' }}</b>
              <span class="pc">{{ c.atHistory ? c.atHistory.marginPct + '%' : 'no sold history' }}</span>
            </div>
          </div>
          <div style="min-width: 0">
            <h2 class="ttl">{{ c.brand }} {{ c.model }}</h2>
            <div class="muted small">{{ [c.grade, c.mfg_year, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null].filter(Boolean).join(' · ') }}</div>
            <div class="muted small">{{ c.venue }} · {{ c.auction_date }} · lot {{ c.lot_no }} · closes {{ left(c.bid_deadline) }}</div>

            <div class="kv">
              <div><small>Start bid</small><b>{{ c.start_price_jpy ? yen(c.start_price_jpy) : '—' }}</b><small>{{ c.start_price_jpy && rate > 0 ? 'RM ' + myr(c.start_price_jpy * rate) : 'not given' }}</small></div>
              <div><small>Market (RM)</small><b>{{ myr(c.market!.row.p25_myr) }} – {{ myr(c.market!.row.p75_myr) }}</b>
                <small v-if="c.market!.row.source === 'manual'">hand-checked {{ c.market!.row.as_of }} · {{ c.market!.row.n }} car{{ c.market!.row.n === 1 ? '' : 's' }}</small>
                <small v-else>{{ c.market!.row.n }} listing{{ c.market!.row.n === 1 ? '' : 's' }} · {{ c.market!.row.sellers }} dealer{{ c.market!.row.sellers === 1 ? '' : 's' }}</small></div>
              <div><small>Usually sells</small><b>{{ c.history ? yen(c.history.price) : '—' }}</b><small>{{ c.history ? c.history.n + ' sale' + (c.history.n === 1 ? '' : 's') + ' · ' + c.history.basis : 'no history' }}</small></div>
              <div><small>Room to bid</small><b :class="c.headroom == null ? '' : c.headroom >= 0 ? 'up' : 'down'">{{ c.headroom == null ? '—' : (c.headroom >= 0 ? '+' : '−') + yen(Math.abs(c.headroom)) }}</b>
                <small>{{ c.atHistory ? 'margin ' + c.atHistory.marginPct + '% at the usual price' : '' }}</small></div>
            </div>
            <div class="row wrap" style="gap: 6px; margin-top: 8px; justify-content: flex-start">
              <span class="chip" :class="c.maxBid ? 'ac' : ''">max bid {{ c.maxBid ? yen(c.maxBid) : '—' }}</span>
              <span class="chip" :class="c.confidence === 'high' ? 'ok' : c.confidence === 'medium' ? 'warn' : ''">confidence {{ c.confidence }}</span>
              <span v-if="c.market!.wider" class="chip warn" title="CarzNexus has no listing linked to this exact variant yet: the whole model is used">model price · wider range</span>
            </div>
          </div>
        </NuxtLink>
      </div>
      <button v-if="ranked.length > limit" class="btn ghost" style="margin-top: 14px" @click="limit += 30">Show more ({{ ranked.length - limit }} left)</button>
    </template>
  </div>
</template>

<script setup lang="ts">
const { load, lots, evaluate, stats, marketAsOf, fees, rate } = useMarginBoard()
// no repair / prep cost: repairs are unknown until the car is seen. The only extra Japan cost is the inland transfer when the car is far from the port (yen).
const targetPct = ref(12), japanInlandJpy = ref<number | null>(0), portMyr = ref<number | null>(2500), inlandMyr = ref<number | null>(250), apFeeMyr = ref(10500), loading = ref(true), err = ref(''), limit = ref(30)
const now = useNow()
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('en-US')
const myr = (n: number) => Math.round(n).toLocaleString('en-US')
const left = (iso: string) => { const m = Math.max(0, Math.round((new Date(iso).getTime() - now.value) / 60000)); return m >= 1440 ? Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm' }

const ranked = computed(() => lots.value.map((l) => evaluate(l, { targetPct: targetPct.value || 0, japanInlandJpy: japanInlandJpy.value || 0, portMyr: portMyr.value || 0, inlandMyr: inlandMyr.value || 0, apFeeMyr: apFeeMyr.value || 0 })).filter((c) => c.market && c.sellMyr && c.dutyMyr != null)
  .sort((a, b) => (b.headroom ?? -Infinity) - (a.headroom ?? -Infinity) || (b.maxBid ?? 0) - (a.maxBid ?? 0)))
const shown = computed(() => ranked.value.slice(0, limit.value))

const mgClass = (c: any) => (!c.atHistory ? '' : c.atHistory.profitMyr <= 0 ? 'bad' : c.atHistory.marginPct >= (targetPct.value || 0) ? 'ok' : 'warn')
onMounted(async () => { try { await load(); apFeeMyr.value = fees.value.apFeeMyr; portMyr.value = fees.value.portMyr; inlandMyr.value = fees.value.inlandMyr } catch (e: any) { err.value = e.message } finally { loading.value = false } })
</script>

<style scoped>
.fld { display: flex; flex-direction: column; gap: 4px; color: var(--mu); font-size: 12px; }
.inp { position: relative; display: block; }
.inp input { width: 150px; }
.inp .pre { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-style: normal; color: var(--mu); font-size: 13px; pointer-events: none; }
.inp .pre ~ input { padding-left: 40px; }
.inp .suf { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-style: normal; color: var(--mu); font-size: 13px; pointer-events: none; }
.inp .r { text-align: right; padding-right: 30px; }
.setcard { margin-bottom: 14px; display: grid; gap: 10px; } .setcard .note { margin: 0; }
.ttl { margin: 0 0 2px; font-size: 17px; line-height: 1.25; }
.cars { grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); }
.car { display: grid; grid-template-columns: 150px 1fr; gap: 12px; color: inherit; text-decoration: none; transition: border-color .2s; }
.car:hover { border-color: var(--ac); }
.ph { border-radius: 10px; background: var(--s2); display: grid; place-items: center; color: var(--mu2); font-size: 11px; min-height: 90px; overflow: hidden; align-self: start; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pcol { display: grid; gap: 8px; align-content: start; min-width: 0; }
.mg { border-radius: 12px; padding: 10px 8px; text-align: center; background: var(--s2); border: 2px solid var(--line); display: grid; gap: 2px; }
.mg small { color: var(--mu); font-size: 10.5px; line-height: 1.2; } .mg b { font-size: 19px; line-height: 1.15; letter-spacing: -.3px; font-variant-numeric: tabular-nums; white-space: nowrap; } .mg .pc { font-size: 22px; font-weight: 800; line-height: 1.1; }
.mg.ok { border-color: var(--ok); } .mg.ok b, .mg.ok .pc { color: var(--ok); }
.mg.warn { border-color: var(--warn); } .mg.warn b, .mg.warn .pc { color: var(--warn); }
.mg.bad { border-color: var(--bad); } .mg.bad b, .mg.bad .pc { color: var(--bad); }
.kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px; }
.kv div { background: var(--s2); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; min-width: 0; }
.kv small { color: var(--mu); font-size: 11px; } .kv b { font-size: 14px; }
@media (max-width: 760px) { .cars { grid-template-columns: 1fr; } .car { grid-template-columns: 120px 1fr; } }
</style>

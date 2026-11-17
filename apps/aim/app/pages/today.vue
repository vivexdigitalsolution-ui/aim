<template>
  <div>
    <h1>Today for you</h1>
    <p class="sub">Open auction cars ranked by how much room there is to bid and still make your margin. Market prices are asking prices from CarzNexus dealers, matched by catalog variant.</p>

    <div v-if="err" class="err">{{ err }}</div>

    <div class="card row wrap" style="gap: 18px; margin-bottom: 14px">
      <label class="fld">Target margin %<input v-model.number="targetPct" type="number" min="0" max="60" step="1" /></label>
      <label class="fld">Recon / prep (RM)<input v-model.number="reconMyr" type="number" min="0" step="500" /></label>
      <div class="muted small">Margin is on cost: RM 12 back for every RM 100 put in. Price source: CarzNexus asking prices{{ marketAsOf ? ', ' + marketAsOf : '' }}. These are estimates, not sold prices.</div>
    </div>

    <div v-if="loading" class="muted">Loading cars ...</div>
    <template v-else>
      <div class="row wrap" style="gap: 8px; margin-bottom: 12px">
        <span class="chip ok">{{ ranked.length }} with a market price</span>
        <span class="chip">{{ stats.noMarket }} no market price yet</span>
        <span class="chip">{{ stats.noDuty }} no docket (duty unknown)</span>
        <span class="chip">{{ stats.open }} open cars</span>
      </div>

      <div v-if="!marketAsOf" class="card muted">
        No market prices yet. They appear once CarzNexus has linked its listings to the catalog and the market snapshot has been run
        (<code>node market-snapshot.js --write</code>). Cars stay listed in Find by feature meanwhile.
      </div>
      <div v-else-if="!ranked.length" class="card muted">None of the open cars has both a market price and a docket yet.</div>

      <div class="grid cars">
        <NuxtLink v-for="c in shown" :key="c.id" :to="`/margin?lot=${c.id}`" class="card car">
          <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /><span v-else>no photo</span></div>
          <div style="min-width: 0">
            <div class="row"><h2>{{ c.brand }} {{ c.model }}</h2>
              <span class="chip" :class="c.maxBid ? 'ac' : ''">max bid {{ c.maxBid ? yen(c.maxBid) : '—' }}</span></div>
            <div class="muted small">{{ [c.grade, c.mfg_year, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null].filter(Boolean).join(' · ') }}</div>
            <div class="muted small">{{ c.venue }} · {{ c.auction_date }} · lot {{ c.lot_no }} · closes {{ left(c.bid_deadline) }}</div>

            <div class="kv">
              <div><small>Market (RM)</small><b>{{ myr(c.market!.row.p25_myr) }} – {{ myr(c.market!.row.p75_myr) }}</b>
                <small>{{ c.market!.row.n }} listing{{ c.market!.row.n === 1 ? '' : 's' }} · {{ c.market!.row.sellers }} dealer{{ c.market!.row.sellers === 1 ? '' : 's' }}</small></div>
              <div><small>Usually sells</small><b>{{ c.history ? yen(c.history.price) : '—' }}</b><small>{{ c.history ? c.history.n + ' sale' + (c.history.n === 1 ? '' : 's') + ' · ' + c.history.basis : 'no history' }}</small></div>
              <div><small>Room to bid</small><b :class="c.headroom == null ? '' : c.headroom >= 0 ? 'up' : 'down'">{{ c.headroom == null ? '—' : (c.headroom >= 0 ? '+' : '−') + yen(Math.abs(c.headroom)) }}</b>
                <small>{{ c.atHistory ? 'margin ' + c.atHistory.marginPct + '% at the usual price' : '' }}</small></div>
            </div>
            <div class="row wrap" style="gap: 6px; margin-top: 8px">
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
const { load, lots, evaluate, stats, marketAsOf } = useMarginBoard()
const targetPct = ref(12), reconMyr = ref(3000), loading = ref(true), err = ref(''), limit = ref(30)
const now = useNow()
const yen = (n: number) => '¥' + Math.round(n).toLocaleString('en-US')
const myr = (n: number) => Math.round(n).toLocaleString('en-US')
const left = (iso: string) => { const m = Math.max(0, Math.round((new Date(iso).getTime() - now.value) / 60000)); return m >= 1440 ? Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm' }

const ranked = computed(() => lots.value.map((l) => evaluate(l, { targetPct: targetPct.value || 0, reconMyr: reconMyr.value || 0 })).filter((c) => c.market && c.sellMyr && c.dutyMyr != null)
  .sort((a, b) => (b.headroom ?? -Infinity) - (a.headroom ?? -Infinity) || (b.maxBid ?? 0) - (a.maxBid ?? 0)))
const shown = computed(() => ranked.value.slice(0, limit.value))

onMounted(async () => { try { await load() } catch (e: any) { err.value = e.message } finally { loading.value = false } })
</script>

<style scoped>
.fld { display: flex; flex-direction: column; gap: 4px; color: var(--mu); font-size: 12px; }
.fld input { width: 130px; }
.cars { grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); }
.car { display: grid; grid-template-columns: 120px 1fr; gap: 12px; color: inherit; text-decoration: none; transition: border-color .2s; }
.car:hover { border-color: var(--ac); }
.ph { border-radius: 10px; background: var(--s2); display: grid; place-items: center; color: var(--mu2); font-size: 11px; min-height: 90px; overflow: hidden; align-self: start; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; }
.kv div { background: var(--s2); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; min-width: 0; }
.kv small { color: var(--mu); font-size: 11px; } .kv b { font-size: 14px; }
@media (max-width: 760px) { .cars { grid-template-columns: 1fr; } .car { grid-template-columns: 96px 1fr; } .kv { grid-template-columns: 1fr 1fr; } }
</style>

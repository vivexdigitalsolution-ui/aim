<template>
  <div>
    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!list" class="card">
      <h2>This link is not valid any more</h2>
      <p class="muted" style="margin: 6px 0 0">It may have expired or been replaced. Ask us for a new one.</p>
    </div>

    <template v-else>
      <h1>{{ list.dealer ? 'For ' + list.dealer : 'Cars picked for you' }}</h1>
      <p v-if="list.message" class="sub" style="white-space: pre-line">{{ list.message }}</p>
      <div v-if="!list.items.length" class="card muted">All the cars in this list have closed. Ask us for today's list.</div>

      <div class="grid">
        <div v-for="c in list.items" :key="c.lot_id" class="card car" @click.once="track('view_car', c.lot_id)">
          <div class="ph"><img v-if="c.photo" :src="c.photo" loading="lazy" alt="" /><span v-else>no photo</span></div>
          <div style="min-width: 0">
            <div class="row"><h2>{{ c.title }}</h2><span class="chip" :class="c.margin_pct >= c.target_pct ? 'ok' : ''">{{ c.margin_pct }}% margin</span></div>
            <div class="muted small">{{ [c.year, c.grade ? 'grade ' + c.grade : null, c.km != null ? c.km.toLocaleString('en-US') + ' km' : null].filter(Boolean).join(' · ') }}</div>
            <div class="muted small">{{ c.venue }} · closes in {{ left(c.closes_at) }}</div>

            <div class="kv">
              <div><small>Sells in Malaysia</small><b>RM {{ n(c.market_low) }} – {{ n(c.market_high) }}</b><small>typical RM {{ n(c.market_typical) }}</small></div>
              <div><small>Usual auction price</small><b>{{ c.usual_jpy ? '¥' + n(c.usual_jpy) : '—' }}</b><small>{{ rm(c.usual_jpy, c.jpy_rate) }}</small></div>
              <div><small>Landed cost</small><b>RM {{ n(c.landed_myr) }}</b><small>at the usual price</small></div>
              <div><small>Estimated profit</small><b class="up">RM {{ n(c.profit_myr) }}</b><small>after prep</small></div>
            </div>
            <div class="muted small" style="margin-top: 8px">You can bid up to <b>¥{{ n(c.max_bid_jpy) }}</b> and still make {{ c.target_pct }}%.
              <span v-if="c.wider" class="chip warn" style="margin-left: 4px">model price, wider range</span></div>

            <div class="row wrap" style="gap: 8px; margin-top: 10px; justify-content: flex-start">
              <button class="btn sm" @click.stop="go('bid_click', c.lot_id)">Bid on this car</button>
              <button class="btn ghost sm" @click.stop="go('open_calc', c.lot_id)">Open the calculator</button>
              <button class="btn ghost sm" :disabled="asked.has(c.lot_id)" @click.stop="sheet(c.lot_id)">{{ asked.has(c.lot_id) ? 'We will send the sheet' : 'Ask for the sheet' }}</button>
            </div>
          </div>
        </div>
      </div>
      <p class="muted small" style="margin-top: 16px">Margins are estimates from Malaysian asking prices and recent auction results, measured on cost. They are not promises. Valid until {{ fmtMytDateTime(list.expires_at) }}.</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime, timeLeft } from '@aim/core'

definePageMeta({ layout: 'public' })
const db = useDb()
const route = useRoute()
const now = useNow()
const token = route.params.token as string
const list = ref<any>(null), loading = ref(true), asked = ref(new Set<string>())
const n = (v: number | null | undefined) => (v == null ? '—' : Math.round(Number(v)).toLocaleString('en-US'))
const left = (iso: string) => timeLeft(iso, now.value).label
// RM at the yen rate that made the figures (stored in each item when the list was made)
const rm = (jpy: number | null, rate: number | null) => (jpy && rate ? 'RM ' + n(jpy * rate) : '')

async function track(event: string, lot: string | null) { try { await db.rpc('dealer_list_event', { p_token: token, p_event: event, p_lot: lot }) } catch { /* tracking never blocks the dealer */ } }
async function go(event: string, lot: string) { await track(event, lot); await navigateTo(`/margin?lot=${lot}`) }
async function sheet(lot: string) { asked.value = new Set([...asked.value, lot]); await track('request_sheet', lot) }

onMounted(async () => {
  try { const { data } = await db.rpc('dealer_list_get', { p_token: token }); list.value = data } catch { list.value = null } finally { loading.value = false }
})
</script>

<style scoped>
.car { display: grid; grid-template-columns: 130px 1fr; gap: 14px; }
.ph { border-radius: 10px; background: var(--s2); display: grid; place-items: center; color: var(--mu2); font-size: 11px; min-height: 100px; overflow: hidden; align-self: start; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px; }
.kv div { background: var(--s2); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; min-width: 0; }
.kv small { color: var(--mu); font-size: 11px; } .kv b { font-size: 14px; }
.btn.sm { height: 34px; padding: 0 12px; font-size: 13px; }
@media (max-width: 600px) { .car { grid-template-columns: 1fr; } .ph { max-height: 190px; } }
</style>

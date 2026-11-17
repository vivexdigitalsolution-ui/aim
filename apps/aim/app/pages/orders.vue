
<template>
  <div>
    <h1>My bid orders</h1>
    <p class="sub">Your orders and what happened to them. Won cars show the price paid at the auction.</p>
    <div v-if="err" class="err">{{ err }}</div>
    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!orders.length" class="card muted">No bid orders yet. Open a car in <NuxtLink to="/today" class="ac">Today for you</NuxtLink> and place one.</div>

    <div class="grid">
      <div v-for="o in orders" :key="o.id" class="card order">
        <NuxtLink :to="`/margin?lot=${o.lot_id}`" class="ph"><img v-if="o.lots?.photos?.[0]" :src="o.lots.photos[0]" loading="lazy" alt="" /></NuxtLink>
        <div style="min-width: 0">
          <div class="row"><b>{{ o.lots?.brand }} {{ o.lots?.model }}</b><span class="chip" :class="STATUS[o.status]?.cls">{{ STATUS[o.status]?.label || o.status }}</span></div>
          <div class="muted small">{{ [o.lots?.mfg_year, o.lots?.venue, 'lot ' + o.lots?.lot_no].filter(Boolean).join(' · ') }}</div>
          <div style="margin-top: 8px">Your highest bid <b>¥{{ Number(o.max_bid_jpy).toLocaleString('en-US') }}</b></div>
          <div v-if="o.status === 'won' && o.final_price_jpy" class="up">Won at ¥{{ Number(o.final_price_jpy).toLocaleString('en-US') }}</div>
          <div v-if="o.team_note" class="small" style="margin-top: 6px"><span class="muted">Our team:</span> {{ o.team_note }}</div>
          <div v-if="o.status === 'pending' && isOpen(o)" class="row wrap" style="gap: 8px; margin-top: 10px; justify-content: flex-start">
            <NuxtLink :to="`/margin?lot=${o.lot_id}`" class="btn ghost sm" style="display: inline-flex; align-items: center">Change</NuxtLink>
            <button class="btn ghost sm down" :disabled="busy === o.id" @click="cancel(o)">Cancel</button>
          </div>
          <div v-if="o.status === 'pending' || o.status === 'placed'" class="muted small" style="margin-top: 6px">{{ isOpen(o) ? 'closes in ' + left(o.lots.bid_deadline) : 'auction closed' }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { timeLeft } from '@aim/core'

const db = useDb()
const now = useNow()
const orders = ref<any[]>([]), loading = ref(true), err = ref(''), busy = ref('')
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Waiting for our team', cls: 'warn' }, placed: { label: 'Placed at the auction', cls: 'ac' }, won: { label: 'Won', cls: 'ok' },
  lost: { label: 'Not won', cls: '' }, cancelled: { label: 'Cancelled', cls: '' }, rejected: { label: 'Rejected', cls: 'bad' },
}
const isOpen = (o: any) => new Date(o.lots.bid_deadline).getTime() > now.value
const left = (iso: string) => timeLeft(iso, now.value).label

async function load() {
  const { data, error } = await db.from('bids').select('id,lot_id,max_bid_jpy,status,team_note,final_price_jpy,created_at,lots(brand,model,mfg_year,venue,lot_no,photos,bid_deadline)').order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  orders.value = data || []
}
async function cancel(o: any) {
  if (!confirm('Cancel this bid order?')) return
  busy.value = o.id
  try { const { error } = await db.rpc('cancel_bid', { p_bid: o.id }); if (error) throw error; await load() } catch (e: any) { err.value = e.message } finally { busy.value = '' }
}
onMounted(async () => { try { await load() } catch (e: any) { err.value = e.message } finally { loading.value = false } })
</script>

<style scoped>
.order { display: grid; grid-template-columns: 120px 1fr; gap: 14px; }
.ph { border-radius: 10px; background: var(--s2); overflow: hidden; aspect-ratio: 4 / 3; align-self: start; display: block; }
.ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.down { color: var(--bad); }
@media (max-width: 560px) { .order { grid-template-columns: 90px 1fr; } }
</style>

<template>
  <div>
    <NuxtLink to="/" class="small">← All cars</NuxtLink>
    <div v-if="err" class="err" style="margin-top: 10px">{{ err }}</div>
    <div v-if="loading" class="muted" style="margin-top: 14px">Loading ...</div>
    <div v-else-if="!car" class="card muted" style="margin-top: 14px">This car is no longer available.</div>

    <div v-else class="grid two" style="margin-top: 10px">
      <div>
        <div class="card" style="padding: 10px">
          <div class="hero"><img v-if="photos[pi]" :src="photos[pi]" alt="" /><span v-else class="muted">no photo</span></div>
          <div v-if="photos.length > 1" class="thumbs"><img v-for="(p, i) in photos" :key="p" :src="p" :class="{ on: i === pi }" loading="lazy" alt="" @click="pi = i" /></div>
        </div>
        <div v-if="car.sheet_url" class="card" style="margin-top: 14px">
          <h2>Auction sheet</h2>
          <a :href="car.sheet_url" target="_blank" rel="noopener"><img :src="car.sheet_url" class="sheet" loading="lazy" alt="Auction sheet" /></a>
        </div>
      </div>

      <div class="grid" style="align-content: start">
        <div class="card">
          <div class="muted small">{{ car.venue }} · lot {{ car.lot_no }} · {{ car.auction_date }}</div>
          <h1 style="margin-top: 4px">{{ car.brand }} {{ car.model }}</h1>
          <div class="price">{{ rm(car.start_price_jpy) }}</div>
          <div class="muted small">Starting price {{ yen(car.start_price_jpy) }} at ¥1 = RM {{ rate }}</div>
          <div class="row wrap" style="gap: 6px; margin-top: 10px"><span class="chip" :class="soon ? 'warn' : 'ac'">closes in {{ left(car.bid_deadline, now) }}</span><span class="chip">{{ fmtMyt(car.bid_deadline) }} MYT</span></div>
        </div>

        <div class="card">
          <h2>Your bid order</h2>
          <div v-if="open" class="okmsg" style="margin: 10px 0">
            You have an order of <b>{{ rm(open.max_bid_jpy) }}</b> ({{ yen(open.max_bid_jpy) }}) —
            {{ open.status === 'placed' ? 'placed by our team, it can no longer be changed.' : 'waiting for our team. You can change or cancel it until it is placed.' }}
          </div>
          <template v-if="!open || open.status === 'pending'">
            <label class="fld">Your highest bid (RM)
              <input v-model.number="bidRm" type="number" min="0" step="1000" :placeholder="'e.g. ' + Math.round((car.start_price_jpy || 0) * rate / 1000) * 1000" />
            </label>
            <div class="muted small" style="margin: 6px 0 10px">
              <template v-if="bidJpy > 0">We bid in yen steps of ¥5,000: your order will be <b>{{ yen(bidJpy) }}</b> (about {{ rm(bidJpy) }}). It is the most we will bid; the car is bought for the lowest price that wins.</template>
              <template v-else>Type the most you want to pay, in RM.</template>
            </div>
            <textarea v-model="note" rows="2" placeholder="Note for our team (optional)" style="width: 100%"></textarea>
            <div v-if="msg" :class="msgOk ? 'okmsg' : 'err'" style="margin-top: 10px">{{ msg }}</div>
            <div class="row wrap" style="gap: 8px; margin-top: 12px">
              <button class="btn" :disabled="busy || bidJpy <= 0 || closed" @click="submit">{{ open ? 'Update order' : 'Place bid order' }}</button>
              <button v-if="open" class="btn danger" :disabled="busy" @click="cancel">Cancel order</button>
            </div>
          </template>
          <div v-if="closed" class="err" style="margin-top: 10px">The bid deadline for this car has passed.</div>
        </div>

        <div class="card">
          <h2>Details</h2>
          <table class="spec">
            <tr v-for="r in specs" :key="r[0]"><td>{{ r[0] }}</td><td>{{ r[1] }}</td></tr>
          </table>
          <div v-if="car.equipment" style="margin-top: 12px"><div class="muted small">Equipment</div><div>{{ car.equipment }}</div></div>
          <div v-if="car.notes" style="margin-top: 12px"><div class="muted small">Seller notes</div><div>{{ car.notes }}</div></div>
          <div v-if="car.inspector_report" style="margin-top: 12px"><div class="muted small">Inspector report</div><div>{{ car.inspector_report }}</div></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmtMyt } from '@aim/core'

const db = useDb()
const route = useRoute()
const now = useNow()
const { rate, loadRate, rm, yen, rmToBidJpy, left } = useLite()
const car = ref<any>(null), open = ref<any>(null), loading = ref(true), err = ref(''), pi = ref(0)
const bidRm = ref<number | null>(null), note = ref(''), busy = ref(false), msg = ref(''), msgOk = ref(false)

const photos = computed<string[]>(() => (Array.isArray(car.value?.photos) ? car.value.photos : []))
const closed = computed(() => !car.value || new Date(car.value.bid_deadline).getTime() <= now.value)
const soon = computed(() => !!car.value && new Date(car.value.bid_deadline).getTime() - now.value < 6 * 3600_000)
const bidJpy = computed(() => rmToBidJpy(Number(bidRm.value) || 0))
const specs = computed(() => {
  const c = car.value
  if (!c) return []
  const cc = c.engine_cc ? c.engine_cc.toLocaleString('en-US') + ' cc' : null
  return ([
    ['Year', c.mfg_year ? c.mfg_year + (c.mfg_month ? '/' + String(c.mfg_month).padStart(2, '0') : '') : null], ['Mileage', c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null],
    ['Auction grade', c.grade], ['Interior grade', c.interior_grade], ['Engine', cc], ['Transmission', c.transmission], ['Fuel', c.fuel], ['Drive', c.drive], ['Colour', c.color], ['Chassis code', c.model_code],
  ] as [string, string | null][]).filter((r) => r[1])
})

async function loadOpen() {
  const { data } = await db.from('bids').select('id,max_bid_jpy,status').eq('lot_id', route.params.id as string).in('status', ['pending', 'placed']).maybeSingle()
  open.value = data || null
}
async function submit() {
  msg.value = ''; busy.value = true
  try {
    const { error } = await db.rpc('place_bid', { p_lot: car.value.id, p_max: bidJpy.value, p_note: note.value.trim() || null })
    if (error) throw error
    await loadOpen(); msgOk.value = true; msg.value = 'Your bid order is saved. Our team will place it at the auction.'
  } catch (e: any) { msgOk.value = false; msg.value = e.message } finally { busy.value = false }
}
async function cancel() {
  if (!open.value || !confirm('Cancel this bid order?')) return
  busy.value = true; msg.value = ''
  try { const { error } = await db.rpc('cancel_bid', { p_bid: open.value.id }); if (error) throw error; open.value = null; bidRm.value = null; msgOk.value = true; msg.value = 'Order cancelled.' }
  catch (e: any) { msgOk.value = false; msg.value = e.message } finally { busy.value = false }
}

onMounted(async () => {
  try {
    await loadRate()
    const { data, error } = await db.from('lots').select('*').eq('id', route.params.id as string).eq('my_eligible', true).maybeSingle()
    if (error) throw error
    car.value = data
    if (data) { await loadOpen(); if (open.value) bidRm.value = Math.round(open.value.max_bid_jpy * rate.value) }
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.two { grid-template-columns: 1.15fr 1fr; align-items: start; }
.hero { aspect-ratio: 4 / 3; background: #e9edf3; border-radius: 10px; overflow: hidden; display: grid; place-items: center; }
.hero img { width: 100%; height: 100%; object-fit: contain; background: #0f1115; }
.thumbs { display: flex; gap: 6px; overflow-x: auto; margin-top: 8px; padding-bottom: 2px; }
.thumbs img { width: 72px; height: 54px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; flex: none; }
.thumbs img.on { border-color: var(--ac); }
.sheet { width: 100%; border-radius: 8px; margin-top: 10px; }
.price { font-size: 28px; font-weight: 800; margin-top: 4px; }
.fld { display: grid; gap: 5px; color: var(--mu); font-size: 13px; margin-top: 10px; } .fld input { width: 100%; }
.spec { width: 100%; border-collapse: collapse; margin-top: 8px; } .spec td { padding: 6px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); width: 42%; }
@media (max-width: 860px) { .two { grid-template-columns: 1fr; } }
</style>

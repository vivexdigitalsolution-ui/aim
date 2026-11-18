
<template>
  <div>
    <NuxtLink to="/cars" class="small ac">← All cars</NuxtLink>
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
          <div class="price">{{ rm(car.start_price_jpy) || '—' }}</div>
          <div class="muted small">Starting price ¥{{ (car.start_price_jpy || 0).toLocaleString('en-US') }}<template v-if="rate"> at ¥1 = RM {{ rate }}</template></div>
          <div class="row wrap" style="gap: 6px; margin-top: 10px; justify-content: flex-start"><span class="chip ac">closes in {{ left(car.bid_deadline) }}</span><span class="chip">{{ fmtMytDateTime(car.bid_deadline) }} MYT</span></div>
          <div class="row wrap" style="gap: 8px; margin-top: 12px; justify-content: flex-start">
            <button class="btn ghost sm" :class="{ starred: watching }" @click="star">{{ watching ? '★ On your watchlist' : '☆ Watch this car' }}</button>
            <NuxtLink v-if="hasTier('member')" :to="`/history?brand=${encodeURIComponent(car.brand)}&model=${encodeURIComponent(String(car.model).split(' ')[0])}`" class="btn ghost sm" style="display: inline-flex; align-items: center; text-decoration: none">What it sold for</NuxtLink>
          </div>
          <div style="margin-top: 14px">
            <NuxtLink v-if="hasTier('member')" :to="`/margin?lot=${car.id}`" class="btn" style="display: inline-flex; align-items: center; text-decoration: none">See the margin and bid</NuxtLink>
            <div v-else class="muted small">Margin, the Malaysian market price and bidding are part of the Member plan. <NuxtLink to="/upgrade" class="ac">See the plans</NuxtLink></div>
          </div>
        </div>

        <div v-if="features.length" class="card">
          <h2>On this car</h2>
          <div class="row wrap" style="gap: 6px; margin-top: 8px; justify-content: flex-start">
            <span v-for="f in features" :key="f.key" class="chip" :class="f.source === 'aftermarket' ? 'warn' : f.source === 'factory' ? 'ok' : ''" :title="f.evidence || ''">{{ f.label }}<small v-if="f.source === 'aftermarket'"> · aftermarket</small></span>
          </div>
        </div>

        <div class="card">
          <h2>Details</h2>
          <table class="spec"><tr v-for="r in specs" :key="r[0]"><td>{{ r[0] }}</td><td>{{ r[1] }}</td></tr></table>
          <div v-if="car.equipment" style="margin-top: 12px"><div class="muted small">Equipment</div><div>{{ car.equipment }}</div></div>
          <div v-if="car.notes_en || car.notes" style="margin-top: 12px"><div class="muted small">Seller notes</div><div>{{ car.notes_en || car.notes }}</div></div>
          <div v-if="car.inspector_report_en || car.inspector_report" style="margin-top: 12px"><div class="muted small">Inspector report</div><div>{{ car.inspector_report_en || car.inspector_report }}</div></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime, timeLeft } from '@aim/core'

const db = useDb()
const route = useRoute()
const now = useNow()
const { hasTier } = useAuth()
const { rate, loadRate, rm } = useRate()
const watch = useWatch()
const watching = computed(() => !!car.value && watch.has(car.value.id))
async function star() { try { await watch.toggle(car.value.id) } catch (e: any) { err.value = e.message } }
const car = ref<any>(null), features = ref<any[]>([]), loading = ref(true), err = ref(''), pi = ref(0)
const left = (iso: string) => timeLeft(iso, now.value).label
const photos = computed<string[]>(() => (Array.isArray(car.value?.photos) ? car.value.photos : []))
const specs = computed(() => {
  const c = car.value
  if (!c) return []
  return ([
    ['Year', c.mfg_year ? c.mfg_year + (c.mfg_month ? '/' + String(c.mfg_month).padStart(2, '0') : '') : null], ['Mileage', c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null],
    ['Auction grade', c.grade], ['Interior grade', c.interior_grade], ['Engine', c.engine_cc ? c.engine_cc.toLocaleString('en-US') + ' cc' : null], ['Transmission', c.transmission],
    ['Fuel', c.fuel], ['Drive', c.drive], ['Colour', c.color], ['Chassis code', c.model_code],
  ] as [string, string | null][]).filter((r) => r[1])
})
onMounted(async () => {
  try {
    await Promise.all([loadRate().catch(() => {}), watch.load().catch(() => {})])
    const { data, error } = await db.from('lots').select('*').eq('id', route.params.id as string).eq('my_eligible', true).maybeSingle()
    if (error) throw error
    car.value = data
    if (data) { const f = await db.from('lot_features').select('key,label,source,evidence').eq('lot_id', data.id); features.value = f.data || [] }
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.two { grid-template-columns: 1.15fr 1fr; align-items: start; }
.hero { aspect-ratio: 4 / 3; background: var(--s2); border-radius: 10px; overflow: hidden; display: grid; place-items: center; }
.hero img { width: 100%; height: 100%; object-fit: contain; background: #0b0b0d; }
.thumbs { display: flex; gap: 6px; overflow-x: auto; margin-top: 8px; padding-bottom: 2px; }
.thumbs img { width: 72px; height: 54px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; flex: none; }
.thumbs img.on { border-color: var(--ac); }
.starred { color: var(--ac); border-color: var(--ac); }
.sheet { width: 100%; border-radius: 8px; margin-top: 10px; }
.price { font-size: 28px; font-weight: 800; margin-top: 4px; }
.spec { width: 100%; border-collapse: collapse; margin-top: 8px; } .spec td { padding: 6px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); width: 42%; }
@media (max-width: 860px) { .two { grid-template-columns: 1fr; } }
</style>

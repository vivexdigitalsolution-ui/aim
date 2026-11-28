<template>
  <div>
    <BackLink to="/cars">All cars</BackLink>
    <div v-if="err" class="err" style="margin-top: 10px">{{ err }}</div>
    <div v-if="loading" class="muted" style="margin-top: 14px">Loading ...</div>
    <div v-else-if="!car" class="card muted" style="margin-top: 14px">This car is no longer available.</div>

    <div v-else class="op">
      <div>
        <div class="card" style="padding: 10px">
          <div class="hero"><img v-if="photos[pi]" :src="photos[pi]" alt="" /><span v-else class="muted">no photo</span></div>
          <div v-if="photos.length > 1" class="thumbs"><img v-for="(p, i) in photos" :key="p" :src="p" :class="{ on: i === pi }" loading="lazy" alt="" @click="pi = i" /></div>
        </div>
        <div v-if="car.sheet_url" class="card" style="margin-top: 14px">
          <h2>Auction sheet</h2>
          <a :href="car.sheet_url" target="_blank" rel="noopener"><img :src="car.sheet_url" class="sheet" loading="lazy" alt="Auction sheet" /></a>
        </div>
        <PosterCard v-if="isLite && isStaff" :car="{ ...car, model: fullName, grade: car.auction_grade }" one-price :est="calc?.importMyr ?? null" style="margin-top: 14px; display: block" />
      </div>

      <div class="grid" style="align-content: start">
        <div v-if="car.needs_review" class="card review">
          <b>Check the auction sheet</b>
          <div class="small">Some details of this car could not be read clearly from the sheet and may be wrong<template v-if="car.review_note"> ({{ car.review_note }})</template>. Please check the sheet before you decide.</div>
        </div>
        <div class="card">
          <div class="muted small">{{ car.venue }} · One price</div>
          <h1 style="margin-top: 4px">{{ car.brand }} {{ fullName }}</h1>
          <template v-if="isLite">
          <div class="toprow">
            <div v-if="car.price_jpy > 0 && calc?.importMyr != null">
              <div class="muted small" title="Estimated import price at the One price">Est. import price</div>
              <div class="price" style="margin-top: 0">RM {{ Math.round(calc.importMyr).toLocaleString('en-US') }}</div>
              <div class="sp2">One price <span>{{ shown(car.price_jpy) }}</span></div>
            </div>
            <div v-else><div class="muted small">One price (fixed, no bidding)</div><div class="price" style="margin-top: 0">{{ car.price_jpy > 0 ? shown(car.price_jpy) : 'Price not open yet' }}</div></div>
            <div class="cur" role="group" aria-label="Currency"><button :class="{ on: cur === 'RM' }" @click="setCur('RM')">RM</button><button :class="{ on: cur === 'JPY' }" @click="setCur('JPY')">¥</button></div>
          </div>
          <div v-if="car.price_jpy > 0" class="muted small">{{ cur === 'JPY' ? rm(car.price_jpy) : '¥' + car.price_jpy.toLocaleString('en-US') }}<template v-if="rate"> at ¥1 = RM {{ rate }}</template></div>
          <div v-else-if="car.price_reveal" class="muted small">The price opens {{ fmtMytDateTime(car.price_reveal) }} MYT.</div>
          <div class="row wrap" style="gap: 6px; margin-top: 10px; justify-content: flex-start"><span v-if="car.deadline" class="chip ac">offer ends {{ fmtMytDateTime(car.deadline) }} MYT</span></div>
          </template>
          <template v-else>
          <div class="toprow">
            <div>
              <div class="muted small">One price (fixed, no bidding)</div>
              <div class="price" style="margin-top: 0">{{ car.price_jpy > 0 ? yenf(car.price_jpy) : 'Price not open yet' }}<small v-if="car.price_jpy > 0 && rateNow > 0" class="muted rmsmall"> · RM {{ Math.round(car.price_jpy * rateNow).toLocaleString('en-US') }}</small></div>
            </div>
            <div v-if="car.price_jpy > 0 && calc?.importMyr != null" class="estb" title="Estimated import price at the One price: the car, agent fee and shipping, duty, port, inland and AP fee"><span>Est. import price</span><b>RM {{ Math.round(calc.importMyr).toLocaleString('en-US') }}</b></div>
          </div>
          <div v-if="!(car.price_jpy > 0) && car.price_reveal" class="muted small" style="margin-top: 4px">The price opens {{ fmtMytDateTime(car.price_reveal) }} MYT.</div>
          <div class="row wrap" style="gap: 6px; margin-top: 10px; justify-content: flex-start"><span v-if="car.deadline" class="chip ac">offer ends {{ fmtMytDateTime(car.deadline) }} MYT</span><span v-if="rateNow > 0" class="chip ac" title="Exchange rate used on this page (change it in the breakdown)">¥1 = RM {{ rateNow }}</span></div>
          </template>
          <div v-if="!(isLite && isStaff)" :class="isLite ? 'row wrap' : 'actrow'" :style="isLite ? 'gap: 8px; margin-top: 10px; justify-content: flex-start' : ''"><button class="btn ghost sm" :class="{ starred: watching, wstar: !isLite, fav: isLite }" @click="star"><StarIcon v-if="!isLite" :filled="watching" /><svg v-else viewBox="0 0 24 24" :fill="watching ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5S4.5 16 3 11a4.7 4.7 0 0 1 9-2.3A4.7 4.7 0 0 1 21 11c-1.5 5-9 9.5-9 9.5z" /></svg>{{ watching ? (isLite ? 'In your favourites' : 'On your watchlist') : (isLite ? 'Add to favourites' : 'Watch this car') }}</button><button v-if="isStaff && !isLite" class="btn ghost sm" :class="{ starred: recs?.has(car.id) }" @click="recommend">{{ recs?.has(car.id) ? '✔ Recommended' : '＋ Recommend this car' }}</button></div>
          <p class="muted small" style="margin-top: 10px">One price cars are sold at the listed price to the first buyer. Ask our team to buy one for you.</p>
        </div>

        <div class="card">
          <h2>Import price breakdown</h2>
          <ImportCalc :car="car" @result="calc = $event" :price-jpy="car.price_jpy || 0" :docket-id="car.docket_id" :lock-price="car.price_jpy > 0" :price-note="car.price_jpy > 0 ? '(the One price; it is fixed)' : '(the price is not open yet: type the price you expect)'" />
        </div>

        <div class="card">
          <h2>Details</h2>
          <table class="spec">
            <tr v-for="r in specs" :key="r[0]"><td>{{ r[0] }}</td><td class="r">{{ r[1] }}</td></tr>
          </table>
          <div v-if="car.equipment" class="small" style="margin-top: 10px"><span class="muted">Equipment</span><br />{{ car.equipment }}</div>
        </div>

        <div v-if="feats.length && hasTier('member')" class="card">
          <h2>On this car</h2>
          <div class="row wrap" style="gap: 6px; margin-top: 8px; justify-content: flex-start">
            <span v-for="f in feats" :key="f.key" class="chip" :title="f.evidence || ''">{{ f.label }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime, trimmedName } from '@aim/core'

const db = useDb()
const route = useRoute()
const { rate, loadRate, rm } = useRate()
const { hasTier, isStaff } = useAuth()
const isLite = useRuntimeConfig().public.appKind === 'lite'
const watch = useWatch()
const calc = ref<{ importMyr: number | null; rate: number } | null>(null)      // from the breakdown: the estimate and the rate in use (a typed rate moves every RM figure)
const rateNow = computed(() => calc.value?.rate || rate.value || 0)
const yenf = (jpy: number) => '¥' + Math.round(jpy).toLocaleString('en-US')
const watching = computed(() => !!car.value && watch.has(car.value.id))
const recs = isStaff.value && !isLite ? useRecommend() : null      // staff, aim only
async function recommend() { try { await recs?.toggle(car.value.id, true) } catch (e: any) { err.value = e.message } }
async function star() { try { await watch.toggle(car.value.id, true) } catch (e: any) { err.value = e.message } }
const car = ref<any>(null), loading = ref(true), err = ref(''), pi = ref(0)
const cur = ref<'RM' | 'JPY'>('RM')
function setCur(c: 'RM' | 'JPY') { cur.value = c; try { localStorage.setItem('cars-currency', c) } catch { /* private mode */ } }
const shown = (jpy: number) => (cur.value === 'JPY' ? '¥' + Math.round(jpy).toLocaleString('en-US') : rm(jpy))
const fullName = computed(() => trimmedName(car.value?.model, car.value?.grade))      // "ALPHARD" + the trim "Z"
const photos = computed<string[]>(() => (Array.isArray(car.value?.photos) ? car.value.photos : []))
const feats = computed<any[]>(() => (Array.isArray(car.value?.features) ? car.value.features.filter((f: any) => f && f.label) : []))
const specs = computed(() => {
  const c = car.value
  if (!c) return []
  return ([
    ['Year', c.mfg_year ? c.mfg_year + (c.mfg_month ? '/' + String(c.mfg_month).padStart(2, '0') : '') : null], ['Mileage', c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null],
    ['Auction grade', c.auction_grade], ['Engine', c.engine_cc ? c.engine_cc.toLocaleString('en-US') + ' cc' : null], ['Transmission', c.transmission],
    ['Fuel', c.fuel], ['Drive', c.drive], ['Colour', c.color], ['Chassis code', c.model_code],
  ] as [string, string | null][]).filter((r) => r[1])
})
onMounted(async () => {
  useViewed().mark(route.params.id as string)      // lite cars page: "Viewed" badge
  try { const c = localStorage.getItem('cars-currency'); if (c === 'RM' || c === 'JPY') cur.value = c } catch { /* private mode */ }
  try {
    await loadRate().catch(() => {})
    watch.load().catch(() => {}); recs?.load().catch(() => {})
    const { data, error } = await db.from('one_price_lots').select('*').eq('id', route.params.id as string).maybeSingle()
    if (error) throw error
    car.value = data
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.op { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 14px; margin-top: 10px; align-items: start; }
.hero { aspect-ratio: 4 / 3; background: var(--s2); border-radius: 12px; overflow: hidden; display: grid; place-items: center; } .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumbs { display: flex; gap: 6px; margin-top: 8px; overflow-x: auto; } .thumbs img { width: 76px; height: 56px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; flex: none; } .thumbs img.on { border-color: var(--ac); }
.sheet { width: 100%; border-radius: 8px; display: block; margin-top: 8px; }
.price { font-size: 26px; font-weight: 800; }
.spec { width: 100%; border-collapse: collapse; margin-top: 8px; } .spec td { padding: 7px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); } .r { text-align: right; }
.toprow { display: flex; justify-content: space-between; align-items: stretch; gap: 12px; } .toprow > div:first-child { min-width: 0; } .rmsmall { font-size: 14px; font-weight: 500; }
.estb { flex: none; display: flex; flex-direction: column; justify-content: center; align-items: flex-end; gap: 1px; background: var(--acbg); color: var(--ac2); border-radius: 12px; padding: 6px 12px; line-height: 1.25; } .estb span { font-size: 11.5px; font-weight: 600; } .estb b { font-size: 17px; }
.actrow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; } .actrow .btn { padding-left: 10px; padding-right: 10px; white-space: nowrap; } .wstar { display: inline-flex; align-items: center; gap: 6px; }
@media (min-width: 520px) { .actrow { flex-wrap: nowrap; } }
@media (max-width: 560px) { .toprow { flex-wrap: wrap; } .price { font-size: 24px; } .estb { width: 100%; flex-direction: row; justify-content: space-between; align-items: center; } }
.op > div { min-width: 0; } .wstar.fav { display: inline-flex; align-items: center; gap: 6px; } .fav svg { width: 16px; height: 16px; }
.sp2 { font-size: 13px; color: var(--mu); margin-top: 2px; } .sp2 span { color: var(--tx); font-weight: 500; }
.cur { display: inline-flex; align-self: flex-start; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.cur button { background: transparent; border: 0; color: inherit; padding: 6px 14px; cursor: pointer; font-weight: 600; } .cur button.on { background: var(--ac); color: #fff; }
.starred { color: var(--ac); border-color: var(--ac); }
.starred { color: #e0452b; border-color: #e0452b; }
.review { border-color: var(--warn); background: var(--warnbg); color: var(--warn); } .review .small { margin-top: 4px; }
@media (max-width: 860px) { .op { grid-template-columns: 1fr; } }
</style>

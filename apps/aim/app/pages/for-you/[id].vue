
<template>
  <div>
    <BackLink to="/for-you">All cars for you</BackLink>
    <div v-if="err" class="err" style="margin-top: 10px">{{ err }}</div>
    <div v-if="loading" class="muted" style="margin-top: 14px">Loading ...</div>
    <div v-else-if="!car" class="card muted" style="margin-top: 14px">This car is no longer available.</div>
    <div v-else class="grid two" style="margin-top: 10px">
      <div>
        <div class="card" style="padding: 10px">
          <div class="hero"><img v-if="photos[pi]" :src="photos[pi]" alt="" /><span v-else class="muted">no photo</span></div>
          <div v-if="photos.length > 1" class="thumbs"><img v-for="(p, i) in photos" :key="p" :src="p" :class="{ on: i === pi }" loading="lazy" alt="" @click="pi = i" /></div>
        </div>
      </div>
      <div class="grid" style="align-content: start">
        <div class="card">
          <h1>{{ car.brand }} {{ car.model }}</h1>
          <div class="row wrap" style="gap: 8px; margin-top: 12px; justify-content: flex-start">
            <button class="btn" :class="{ ghost: !liked }" @click="like">{{ liked ? '♥ You like this car' : '♡ I like this car' }}</button>
          </div>
          <p class="muted small" style="margin-top: 10px">Like it and our team will talk to you about the price and the next step.</p>
        </div>
        <div v-if="car.features?.length" class="card">
          <h2>On this car</h2>
          <div class="row wrap" style="gap: 6px; margin-top: 8px; justify-content: flex-start"><span v-for="f in car.features" :key="f.key" class="chip" :class="f.source === 'aftermarket' ? 'warn' : f.source === 'factory' ? 'ok' : ''">{{ f.label }}<small v-if="f.source === 'aftermarket'"> · aftermarket</small></span></div>
        </div>
        <div class="card">
          <h2>Details</h2>
          <table class="spec"><tr v-for="r in specs" :key="r[0]"><td>{{ r[0] }}</td><td>{{ r[1] }}</td></tr></table>
          <div v-if="car.equipment" style="margin-top: 12px"><div class="muted small">Equipment</div><div>{{ car.equipment }}</div></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const route = useRoute()
const { user } = useAuth()
const car = ref<any>(null), loading = ref(true), err = ref(''), pi = ref(0), liked = ref(false)
const photos = computed<string[]>(() => (Array.isArray(car.value?.photos) ? car.value.photos : []))
const specs = computed(() => {
  const c = car.value
  if (!c) return []
  return ([['Year', c.mfg_year], ['Mileage', c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null], ['Grade', c.grade], ['Interior grade', c.interior_grade], ['Engine', c.engine_cc ? c.engine_cc.toLocaleString('en-US') + ' cc' : null], ['Transmission', c.transmission], ['Colour', c.color]] as [string, any][]).filter((r) => r[1])
})
async function like() {
  try {
    if (liked.value) { const { error } = await db.from('customer_picks').delete().eq('customer_id', user.value.id).eq('lot_id', car.value.id); if (error) throw error }
    else { const { error } = await db.from('customer_picks').insert({ customer_id: user.value.id, lot_id: car.value.id }); if (error) throw error }
    liked.value = !liked.value
  } catch (e: any) { err.value = e.message }
}
onMounted(async () => {
  try {
    const id = route.params.id as string
    const [c, p] = await Promise.all([db.rpc('customer_car', { p_id: id }), db.from('customer_picks').select('lot_id').eq('lot_id', id)])
    if (c.error) throw c.error
    car.value = c.data
    liked.value = (p.data || []).length > 0
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.two { grid-template-columns: 1.15fr 1fr; align-items: start; }
.hero { aspect-ratio: 4 / 3; background: var(--s2); border-radius: 10px; overflow: hidden; display: grid; place-items: center; }
.hero img { width: 100%; height: 100%; object-fit: contain; background: #0b0b0d; }
.thumbs { display: flex; gap: 6px; overflow-x: auto; margin-top: 8px; padding-bottom: 2px; }
.thumbs img { width: 72px; height: 54px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; flex: none; } .thumbs img.on { border-color: var(--ac); }
.sheet { width: 100%; border-radius: 8px; margin-top: 10px; }
.spec { width: 100%; border-collapse: collapse; margin-top: 8px; } .spec td { padding: 6px 0; border-bottom: 1px solid var(--line); } .spec td:first-child { color: var(--mu); width: 42%; }
@media (max-width: 860px) { .two { grid-template-columns: 1fr; } }
</style>

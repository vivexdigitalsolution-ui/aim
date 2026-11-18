
<template>
  <div>
    <h1>Cars for you</h1>
    <p class="sub">{{ intro }}</p>
    <div class="chip ac" style="margin-bottom: 14px">Your viewing time ends in {{ left }}</div>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>

    <div class="row wrap" style="gap: 10px; margin-bottom: 14px; justify-content: flex-start">
      <select v-model="year"><option value="">Any year</option><option v-for="y in years" :key="y" :value="y">{{ y }}</option></select>
      <select v-model="sort"><option value="year">Newest first</option><option value="km">Lowest mileage first</option></select>
      <label class="small muted"><input v-model="likedOnly" type="checkbox" style="width: auto; height: auto" /> Only cars I like ({{ liked.size }})</label>
    </div>

    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!shown.length" class="card muted">{{ cars.length ? 'No car fits that choice.' : 'We have no matching car open right now. Please ask our team: we can look for more.' }}</div>
    <div class="grid cars">
      <NuxtLink v-for="c in shown" :key="c.id" :to="`/for-you/${c.id}`" class="card car">
        <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /><span v-else class="muted">no photo</span></div>
        <div style="min-width: 0">
          <div class="row"><b>{{ c.brand }} {{ c.model }}</b><button class="heart" :class="{ on: liked.has(c.id) }" :title="liked.has(c.id) ? 'Remove' : 'I like this car'" @click.prevent="like(c.id)">{{ liked.has(c.id) ? '♥' : '♡' }}</button></div>
          <div class="muted small">{{ [c.mfg_year, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null, c.grade ? 'Grade ' + c.grade : null, c.transmission, c.color].filter(Boolean).join(' · ') }}</div>
          <div class="row wrap" style="gap: 4px; margin-top: 6px; justify-content: flex-start"><span v-for="f in c.features.slice(0, 4)" :key="f.key" class="chip">{{ f.label }}</span></div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { timeLeft } from '@aim/core'

const db = useDb()
const now = useNow()
const { user, profile } = useAuth()
const cars = ref<any[]>([]), liked = ref(new Set<string>()), loading = ref(true), err = ref('')
const year = ref(''), sort = ref('year'), likedOnly = ref(false)
const left = computed(() => (profile.value?.expires_at ? timeLeft(profile.value.expires_at, now.value).label : ''))
const intro = computed(() => {
  const f: any = (profile.value as any)?.customer_filters || {}
  const what = [...(f.brands || []), ...(f.models || [])].join(' ').trim()
  return what ? `Cars that match what you are looking for: ${what}.` : 'Cars our team picked for you.'
})
const years = computed(() => [...new Set(cars.value.map((c) => c.mfg_year).filter(Boolean))].sort((a, b) => b - a))
const shown = computed(() => cars.value
  .filter((c) => (!year.value || c.mfg_year === Number(year.value)) && (!likedOnly.value || liked.value.has(c.id)))
  .sort((a, b) => sort.value === 'km' ? (a.mileage_km ?? 1e9) - (b.mileage_km ?? 1e9) : (b.mfg_year ?? 0) - (a.mfg_year ?? 0)))

async function like(id: string) {
  try {
    if (liked.value.has(id)) { const { error } = await db.from('customer_picks').delete().eq('customer_id', user.value.id).eq('lot_id', id); if (error) throw error; liked.value.delete(id) }
    else { const { error } = await db.from('customer_picks').insert({ customer_id: user.value.id, lot_id: id }); if (error) throw error; liked.value.add(id) }
    liked.value = new Set(liked.value)
  } catch (e: any) { err.value = e.message }
}
onMounted(async () => {
  try {
    const [c, p] = await Promise.all([db.rpc('customer_cars'), db.from('customer_picks').select('lot_id')])
    if (c.error) throw c.error
    cars.value = c.data || []
    liked.value = new Set((p.data || []).map((r: any) => r.lot_id))
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.cars { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
.car { display: grid; gap: 10px; text-decoration: none; color: inherit; }
.ph { border-radius: 10px; background: var(--s2); aspect-ratio: 4 / 3; overflow: hidden; display: grid; place-items: center; } .ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.heart { background: none; border: 0; font-size: 22px; cursor: pointer; color: var(--mu); line-height: 1; } .heart.on { color: var(--bad); }
</style>

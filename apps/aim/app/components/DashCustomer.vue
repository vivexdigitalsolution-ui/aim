<template>
  <div class="dash">
    <div v-if="err" class="err">{{ err }}</div>

    <section class="two">
      <div class="card big">
        <h1>Welcome{{ name ? ', ' + name : '' }}</h1>
        <div class="muted" style="margin-top: 4px">{{ intro }}</div>
        <div class="row wrap" style="gap: 10px; justify-content: flex-start; margin-top: 14px">
          <NuxtLink to="/for-you" class="btn" style="display: inline-flex; align-items: center">See the cars for you</NuxtLink>
          <NuxtLink v-if="liked.size" to="/for-you" class="btn ghost" style="display: inline-flex; align-items: center">Cars I like ({{ liked.size }})</NuxtLink>
        </div>
        <div class="muted small" style="margin-top: 10px">Want us to look for something else? Ask our team.</div>
      </div>
      <div class="card">
        <div class="muted small">Your viewing time ends in</div>
        <div class="clock">{{ left }}</div>
        <div class="muted small">Ask our team if you need more time.</div>
      </div>
    </section>

    <section class="kpis">
      <div class="card kpi"><small>Cars for you</small><b>{{ cars.length }}</b><span class="muted small">{{ cars.length ? 'open for bidding now' : 'none open right now' }}</span></div>
      <div class="card kpi"><small>Cars you like</small><b>{{ liked.size }}</b><span class="muted small">{{ liked.size ? 'our team can see them' : 'tap the heart on a car' }}</span></div>
      <div class="card kpi"><small>Newest model year</small><b>{{ newest || '—' }}</b><span class="muted small">in your list</span></div>
    </section>

    <section class="card">
      <div class="row between"><h2>Cars for you</h2><NuxtLink v-if="cars.length > 6" to="/for-you" class="small">See all {{ cars.length }}</NuxtLink></div>
      <div v-if="loading" class="muted small" style="margin-top: 8px">Loading ...</div>
      <div v-else-if="!cars.length" class="muted" style="margin-top: 8px">We have no matching car open right now. Please ask our team: we can look for more.</div>
      <div v-else class="cars">
        <NuxtLink v-for="c in cars.slice(0, 6)" :key="c.id" :to="`/for-you/${c.id}`" class="mini">
          <div class="ph"><img v-if="c.photos?.[0]" :src="c.photos[0]" loading="lazy" alt="" /><span v-else>no photo</span></div>
          <div class="mb">
            <div class="row"><b>{{ c.brand }} {{ c.model }}</b><span class="heart" :class="{ on: liked.has(c.id) }">{{ liked.has(c.id) ? '♥' : '♡' }}</span></div>
            <small class="muted">{{ [c.mfg_year, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null, c.grade ? 'Grade ' + c.grade : null].filter(Boolean).join(' · ') }}</small>
            <div class="chips"><span v-for="f in (c.features || []).slice(0, 3)" :key="f.key" class="chip">{{ f.label }}</span></div>
          </div>
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { timeLeft } from '@aim/core'

const db = useDb()
const now = useNow()
const { profile } = useAuth()
const cars = ref<any[]>([]), liked = ref(new Set<string>()), loading = ref(true), err = ref('')
const name = computed(() => profile.value?.contact_name || profile.value?.company_name || '')
const left = computed(() => (profile.value?.expires_at ? timeLeft(profile.value.expires_at, now.value).label : '—'))
const newest = computed(() => Math.max(0, ...cars.value.map((c) => c.mfg_year || 0)) || null)
const intro = computed(() => {
  const f: any = (profile.value as any)?.customer_filters || {}
  const what = [...(f.brands || []), ...(f.models || [])].join(', ').trim()
  return what ? `Our team picked these cars for what you are looking for: ${what}.` : 'Cars our team picked for you.'
})
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
.dash { display: grid; gap: 16px; max-width: 1100px; }
.two { display: flex; flex-wrap: wrap; gap: 14px; align-items: stretch; }
.two > .card { min-width: 0; flex: 2 1 280px; display: grid; align-content: center; } .two > .big { flex: 3 1 460px; }
.clock { font-size: 36px; font-weight: 700; letter-spacing: -1px; font-variant-numeric: tabular-nums; line-height: 1.15; }
.kpis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.kpi { display: grid; gap: 2px; } .kpi small { color: var(--mu); } .kpi b { font-size: 26px; letter-spacing: -.5px; line-height: 1.15; }
.between { justify-content: space-between; }
.cars { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin-top: 12px; }
.mini { background: var(--s2); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; color: inherit; text-decoration: none; display: block; } .mini:hover { border-color: var(--ac); }
.ph { height: 130px; background: var(--s3); display: grid; place-items: center; color: var(--mu2); font-size: 12px; overflow: hidden; } .ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mb { padding: 10px 12px; display: grid; gap: 4px; } .chips { display: flex; flex-wrap: wrap; gap: 4px; }
.heart { color: var(--mu); font-size: 18px; line-height: 1; } .heart.on { color: var(--bad); }
@media (max-width: 760px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } .kpi b { font-size: 22px; } .clock { font-size: 30px; } }
</style>

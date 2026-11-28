<template>
  <div>
    <h1>Favourites</h1>
    <p class="muted" style="margin: 0 0 16px">Cars you saved. We send you an alert when one of them is about to close. Press the heart on a car to add or remove it.</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>
    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!cars.length" class="card muted">No favourite yet. <NuxtLink to="/cars">Browse the cars</NuxtLink> and press the heart on the ones you like.</div>
    <div v-else class="grid cars">
      <NuxtLink v-for="c in cars" :key="c.id" :to="c.op ? `/one-price/${c.id}` : `/car/${c.id}`" class="card car">
        <div class="ph"><img v-if="c.photos?.[0] && !broken.has(c.id)" :src="c.photos[0]" loading="lazy" alt="" @error="broken.add(c.id)" /></div>
        <div style="min-width: 0">
          <b>{{ c.brand }} {{ c.model }}</b>
          <div class="muted small">{{ [c.mfg_year, c.grade, c.mileage_km != null ? c.mileage_km.toLocaleString('en-US') + ' km' : null, c.venue].filter(Boolean).join(' · ') }}</div>
          <div class="small" style="margin-top: 4px"><span v-if="c.bid_deadline" class="chip" :class="chipCls(c.bid_deadline)">{{ closes(c.bid_deadline) }}</span> <span class="muted">Start price</span> <b>{{ money(c.start_price_jpy) }}</b></div>
        </div>
        <button class="btn ghost sm" title="Remove from favourites" @click.prevent="remove(c.id, !!c.op)"><RailIcon name="heart" filled class="hi" /> Remove</button>
      </NuxtLink>
    </div>
    <p v-if="gone" class="muted small" style="margin-top: 12px">{{ gone }} favourite car{{ gone === 1 ? ' has' : 's have' }} already closed and left the list.</p>
  </div>
</template>

<script setup lang="ts">
import { closesInfo } from '@aim/core'
const db = useDb()
const now = useNow()
const { ids, opIds, load, toggle } = useWatch()
const { loadRate, loadCur, money, left } = useLite()
const closes = (iso: string) => closesInfo(iso, now.value).text
const chipCls = (iso: string) => { const c = closesInfo(iso, now.value).cls; return c === 'late' || c === 'soon' ? 'warn' : c === 'unknown' || c === 'closed' ? '' : 'ac' }
const broken = reactive(new Set<string>())
const cars = ref<any[]>([]), loading = ref(true), err = ref(''), gone = ref(0)

async function show() {
  await load(true)
  const out: any[] = []
  for (let i = 0; i < ids.value.length; i += 100) {
    const { data, error } = await db.from('lots').select('id,brand,model,grade,mfg_year,mileage_km,venue,photos,start_price_jpy,bid_deadline').in('id', ids.value.slice(i, i + 100)).gt('bid_deadline', new Date().toISOString())
    if (error) throw error
    out.push(...(data || []))
  }
  // One price cars the dealer starred (their own table, migration 58)
  const ops: any[] = []
  for (let i = 0; i < opIds.value.length; i += 100) {
    const { data } = await openOffers(db.from('one_price_lots').select('id,brand,model,auction_grade,mfg_year,mileage_km,venue,photos,price_jpy,deadline').in('id', opIds.value.slice(i, i + 100)))
    ops.push(...(data || []).map((r: any) => ({ ...r, op: true, grade: r.auction_grade, start_price_jpy: r.price_jpy, bid_deadline: r.deadline })))
  }
  cars.value = [...out, ...ops].sort((a, b) => (a.bid_deadline || '9').localeCompare(b.bid_deadline || '9'))
  gone.value = ids.value.length + opIds.value.length - cars.value.length
}
async function remove(id: string, op = false) { try { await toggle(id, op); cars.value = cars.value.filter((c) => c.id !== id) } catch (e: any) { err.value = e.message } }
onMounted(async () => { loadCur(); try { await loadRate().catch(() => {}); await show() } catch (e: any) { err.value = e.message } finally { loading.value = false } })
</script>

<style scoped>
.hi { width: 15px; height: 15px; color: #ff5a6e; margin-right: 4px; }
.cars { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
.car { display: grid; grid-template-columns: 92px 1fr auto; gap: 12px; align-items: center; text-decoration: none; color: inherit; }
.ph { border-radius: 8px; background: #e9edf3; aspect-ratio: 4 / 3; overflow: hidden; } .ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>

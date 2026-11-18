<template>
  <div>
    <h1>My preferences</h1>
    <p class="sub">Save the kind of cars you look for, as many sets as you like. On the Cars page one tap applies a set, and we tell you when a new car fits one.</p>

    <div v-if="err" class="err" style="margin-bottom: 10px">{{ err }}</div>
    <div v-if="msg" class="okmsg" style="margin-bottom: 10px">{{ msg }}</div>

    <div class="card" style="margin-bottom: 16px">
      <h2>{{ f.id ? 'Edit preference' : 'New preference' }}</h2>
      <div class="grid form">
        <label class="f">Name<input v-model="f.name" placeholder="e.g. Alphard / Vellfire 2021+" /></label>
        <label class="f">Makes (comma separated, empty = any)<input v-model="f.brands" placeholder="Toyota, Lexus" list="brandlist" /></label>
        <label class="f">Models (comma separated, empty = any)<input v-model="f.models" placeholder="Alphard, Vellfire" /></label>
        <label class="f">Year from<input v-model.number="f.year_from" type="number" min="2000" :max="thisYear + 1" placeholder="2021" /></label>
        <label class="f">Year to<input v-model.number="f.year_to" type="number" min="2000" :max="thisYear + 1" placeholder="optional" /></label>
        <label class="f">Highest start price (RM)<input v-model.number="f.max_price_myr" type="number" step="10000" placeholder="empty = no limit" /></label>
        <label class="f">Lowest auction score
          <select v-model="f.min_score"><option :value="null">Any</option><option v-for="s in SCORES" :key="s" :value="s">{{ s }} and better</option></select>
        </label>
      </div>
      <datalist id="brandlist"><option v-for="b in brandList" :key="b" :value="b" /></datalist>
      <div class="row wrap" style="gap: 16px; margin-top: 12px; justify-content: flex-start">
        <label class="chk"><input v-model="f.notify_app" type="checkbox" /> Tell me in the app</label>
        <label class="chk"><input v-model="f.notify_email" type="checkbox" /> Email me</label>
        <label class="chk"><input v-model="f.notify_push" type="checkbox" /> Phone / browser notification</label>
      </div>
      <p v-if="f.notify_push && pushState !== 'on'" class="muted small" style="margin-top: 6px">Phone notifications are not switched on for this device yet. Switch them on in <NuxtLink to="/account" class="ac">My account</NuxtLink>.</p>
      <div class="row" style="gap: 8px; margin-top: 14px; justify-content: flex-start">
        <button class="btn" :disabled="busy || !f.name.trim()" @click="save">{{ f.id ? 'Save changes' : 'Save preference' }}</button>
        <button v-if="f.id" class="btn ghost" @click="reset">Cancel</button>
      </div>
    </div>

    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!list.length" class="card muted">No saved preference yet.</div>
    <div class="grid">
      <div v-for="p in list" :key="p.id" class="card">
        <div class="row"><h2>{{ p.name }}</h2>
          <div class="row" style="gap: 6px"><NuxtLink :to="`/cars?pref=${p.id}`" class="btn sm" style="text-decoration: none">Show cars</NuxtLink><button class="btn ghost sm" @click="edit(p)">Edit</button><button class="btn ghost sm" :disabled="busy" @click="remove(p)">Delete</button></div>
        </div>
        <div class="muted small">{{ describe(p) }}</div>
        <div class="row wrap" style="gap: 6px; margin-top: 8px; justify-content: flex-start">
          <span v-if="p.notify_app" class="chip ac">app</span><span v-if="p.notify_email" class="chip ac">email</span><span v-if="p.notify_push" class="chip ac">phone</span>
          <span v-if="!p.notify_app && !p.notify_email && !p.notify_push" class="chip">no alerts</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const { user } = useAuth()
const push = useFcm()
const pushState = push.state
const thisYear = new Date().getFullYear()
const SCORES = ['S', '6', '5', '4.5', '4', '3.5', '3']
const list = ref<any[]>([]), loading = ref(true), busy = ref(false), err = ref(''), msg = ref(''), brandList = ref<string[]>([])
const blank = () => ({ id: '', name: '', brands: '', models: '', year_from: null as number | null, year_to: null as number | null, max_price_myr: null as number | null, min_score: null as string | null, notify_app: true, notify_email: false, notify_push: false })
const f = reactive(blank())
const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const describe = (p: any) => [p.brands?.length ? p.brands.join(', ') : 'Any make', p.models?.length ? p.models.join(', ') : null, p.year_from || p.year_to ? `${p.year_from || ''}–${p.year_to || ''}` : null, p.max_price_myr ? 'up to RM ' + Number(p.max_price_myr).toLocaleString('en-US') : null, p.min_score ? 'score ' + (Number(p.min_score) >= 7 ? 'S' : Number(p.min_score)) + '+' : null].filter(Boolean).join(' · ')
function reset() { Object.assign(f, blank()) }
function edit(p: any) { Object.assign(f, { id: p.id, name: p.name, brands: (p.brands || []).join(', '), models: (p.models || []).join(', '), year_from: p.year_from, year_to: p.year_to, max_price_myr: p.max_price_myr ? Number(p.max_price_myr) : null, min_score: p.min_score != null ? (Number(p.min_score) >= 7 ? 'S' : String(Number(p.min_score))) : null, notify_app: p.notify_app, notify_email: p.notify_email, notify_push: p.notify_push }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
async function load() { const { data, error } = await db.from('saved_preferences').select('*').order('created_at'); if (error) throw error; list.value = data || [] }
async function save() {
  busy.value = true; err.value = ''; msg.value = ''
  try {
    const row = { name: f.name.trim(), brands: split(f.brands), models: split(f.models), year_from: f.year_from || null, year_to: f.year_to || null, max_price_myr: f.max_price_myr || null, min_score: f.min_score ? Number(f.min_score === 'S' ? 7 : f.min_score) : null, notify_app: f.notify_app, notify_email: f.notify_email, notify_push: f.notify_push }
    const q = f.id ? db.from('saved_preferences').update(row).eq('id', f.id) : db.from('saved_preferences').insert({ ...row, user_id: user.value.id })
    const { error } = await q
    if (error) throw error
    msg.value = 'Saved.'; reset(); await load()
  } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
async function remove(p: any) {
  if (!confirm(`Delete "${p.name}"?`)) return
  busy.value = true
  try { const { error } = await db.from('saved_preferences').delete().eq('id', p.id); if (error) throw error; await load() } catch (e: any) { err.value = e.message } finally { busy.value = false }
}
onMounted(async () => {
  push.refresh()
  try {
    await load()
    const { data } = await db.from('lots').select('brand').gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true).limit(3000)
    brandList.value = [...new Set((data || []).map((r: any) => r.brand))].sort() as string[]
  } catch (e: any) { err.value = e.message } finally { loading.value = false }
})
</script>

<style scoped>
.form { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
.chk { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
</style>

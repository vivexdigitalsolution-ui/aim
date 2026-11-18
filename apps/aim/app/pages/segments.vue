
<template>
  <div>
    <h1>Segments</h1>
    <p class="sub">The kinds of car a dealer can pick on their buy list (SUV, MPV ...). You decide which cars belong to each. A car belongs to a segment when its make matches and its model name contains the model you list. Leave the model empty to include every model of that make. The starter list is a first guess: please check it.</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>
    <div v-if="loading" class="muted">Loading ...</div>
    <template v-else>
      <div class="grid">
        <div v-for="s in segments" :key="s.key" class="card">
          <div class="row"><h2>{{ s.label }}</h2><button class="btn ghost sm down" @click="removeSegment(s)">Delete segment</button></div>
          <div class="row wrap" style="gap: 6px; margin: 10px 0; justify-content: flex-start">
            <span v-for="e in entries(s.key)" :key="e.id" class="chip">{{ e.brand }}{{ e.model ? ' ' + e.model : ' (all models)' }} <a class="x" title="Remove" @click="removeEntry(e)">×</a></span>
            <span v-if="!entries(s.key).length" class="muted small">No cars yet: dealers who pick this segment get nothing.</span>
          </div>
          <div class="row wrap" style="gap: 8px; justify-content: flex-start">
            <input v-model="draft[s.key].brand" placeholder="Make, e.g. TOYOTA" style="width: 170px" />
            <input v-model="draft[s.key].model" placeholder="Model (empty = all)" style="width: 190px" />
            <button class="btn sm" :disabled="!draft[s.key].brand.trim()" @click="addEntry(s.key)">Add</button>
          </div>
        </div>
      </div>
      <div class="card" style="margin-top: 14px">
        <h2>New segment</h2>
        <div class="row wrap" style="gap: 8px; margin-top: 8px; justify-content: flex-start">
          <input v-model="newLabel" placeholder="Name, e.g. Hybrid" style="width: 220px" />
          <button class="btn sm" :disabled="!newLabel.trim()" @click="addSegment">Add segment</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const db = useDb()
const segments = ref<any[]>([]), all = ref<any[]>([]), loading = ref(true), err = ref(''), newLabel = ref('')
const draft = reactive<Record<string, { brand: string; model: string }>>({})
const entries = (k: string) => all.value.filter((e) => e.segment_key === k)

async function load() {
  const [s, m] = await Promise.all([db.from('segments').select('*').order('sort'), db.from('segment_models').select('*').order('brand').order('model')])
  if (s.error) throw s.error
  if (m.error) throw m.error
  segments.value = s.data || []; all.value = m.data || []
  for (const x of segments.value) draft[x.key] ||= { brand: '', model: '' }
}
const guard = async (f: () => PromiseLike<{ error: any }>) => { err.value = ''; const { error } = await f(); if (error) { err.value = error.message; return false } await load(); return true }
async function addEntry(k: string) {
  const d = draft[k]
  if (await guard(() => db.from('segment_models').insert({ segment_key: k, brand: d.brand.trim().toUpperCase(), model: d.model.trim().toUpperCase() }))) { d.brand = ''; d.model = '' }
}
const removeEntry = (e: any) => guard(() => db.from('segment_models').delete().eq('id', e.id))
async function addSegment() {
  const label = newLabel.value.trim(), key = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!key) return
  if (await guard(() => db.from('segments').insert({ key, label, sort: segments.value.length + 1 }))) newLabel.value = ''
}
async function removeSegment(s: any) {
  if (!confirm(`Delete the segment "${s.label}"? Dealers who picked it keep a pick that no longer matches anything.`)) return
  await guard(() => db.from('segments').delete().eq('key', s.key))
}
onMounted(async () => { try { await load() } catch (e: any) { err.value = e.message } finally { loading.value = false } })
</script>

<style scoped>
.x { cursor: pointer; margin-left: 4px; color: var(--mu); } .x:hover { color: var(--bad); }
.down { color: var(--bad); }
</style>

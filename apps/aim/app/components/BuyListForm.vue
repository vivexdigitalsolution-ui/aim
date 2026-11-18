<template>
  <div class="bl">
    <div v-if="segments.length" class="f" style="margin-bottom: 12px">
      Kinds of car you buy (pick any; empty = no preference)
      <div class="row wrap" style="gap: 6px; justify-content: flex-start">
        <span v-for="s in segments" :key="s.key" class="chip tag" :class="{ on: chosen.includes(s.key) }" @click="toggle(s.key)">{{ s.label }}</span>
      </div>
      <span class="small muted">A car fits if it is one of these kinds, or if it matches the makes and models you type below.</span>
    </div>
    <div class="grid2">
      <label class="f">Makes you buy (comma separated, empty = any)<input v-model="brands" placeholder="Toyota, Lexus" /></label>
      <label class="f">Models (comma separated, empty = any)<input v-model="models" placeholder="Alphard, Vellfire, Harrier" /></label>
      <label class="f">Not older than (build year)<input v-model.number="f.year_from" type="number" min="2000" :max="new Date().getFullYear() + 1" placeholder="e.g. 2021" /></label>
      <label class="f">Budget per car (RM, all in: landed cost + prep + AP fee)<input v-model.number="f.budget_myr" type="number" step="10000" placeholder="empty = no limit" /></label>
      <label class="f">Minimum margin (% on cost)<input v-model.number="f.min_margin_pct" type="number" min="0" max="60" step="1" /></label>
      <label class="f">APs you still have this year<input v-model.number="f.aps_left" type="number" min="0" /></label>
      <label class="f">How fast you sell on
        <select v-model="f.speed"><option value="any">No preference</option><option value="fast">Fast: quick turnover models</option><option value="normal">Normal</option></select>
      </label>
      <label class="f" style="grid-column: 1 / -1">Anything else we should know<textarea v-model="f.notes" rows="2" placeholder="Colours, mileage, customers waiting ..." /></label>
    </div>
    <div v-if="msg" class="okmsg" style="margin-top: 10px">{{ msg }}</div>
    <div v-if="err" class="err" style="margin-top: 10px">{{ err }}</div>
    <div style="margin-top: 12px"><button class="btn" :disabled="busy" @click="save">Save buy list</button></div>
  </div>
</template>

<script setup lang="ts">
import type { BuyList } from '@aim/core'

const props = defineProps<{ apId: string }>()
const emit = defineEmits<{ (e: 'saved', bl: BuyList): void }>()
const db = useDb()
const f = reactive<any>({ year_from: null, budget_myr: null, min_margin_pct: 10, aps_left: null, speed: 'any', notes: '' })
const brands = ref(''), models = ref(''), busy = ref(false), msg = ref(''), err = ref('')
const { segments, load: loadSegments } = useSegments()
const chosen = ref<string[]>([])
const toggle = (k: string) => { chosen.value = chosen.value.includes(k) ? chosen.value.filter((x) => x !== k) : [...chosen.value, k] }
const split = (s: string) => s.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean)

async function load() {
  msg.value = ''; err.value = ''
  const { data } = await db.from('buy_lists').select('*').eq('ap_id', props.apId).maybeSingle()
  Object.assign(f, { year_from: data?.year_from ?? null, budget_myr: data?.budget_myr != null ? Number(data.budget_myr) : null, min_margin_pct: data ? Number(data.min_margin_pct) : 10, aps_left: data?.aps_left ?? null, speed: data?.speed || 'any', notes: data?.notes || '' })
  brands.value = (data?.brands || []).join(', '); models.value = (data?.models || []).join(', ')
  chosen.value = data?.segments || []
  await loadSegments().catch(() => {})
  emit('saved', current())
}
const current = (): BuyList => ({ brands: split(brands.value), models: split(models.value), segments: chosen.value, year_from: f.year_from || null, budget_myr: f.budget_myr || null, min_margin_pct: Number(f.min_margin_pct) || 0, aps_left: f.aps_left ?? null, speed: f.speed, notes: f.notes || null })
async function save() {
  busy.value = true; msg.value = ''; err.value = ''
  const c = current()
  const { error } = await db.from('buy_lists').upsert({ ap_id: props.apId, ...c, notes: c.notes, updated_at: new Date().toISOString() }, { onConflict: 'ap_id' })
  busy.value = false
  if (error) { err.value = error.message; return }
  msg.value = 'Saved'; emit('saved', c)
}
watch(() => props.apId, load)
onMounted(load)
</script>

<style scoped>
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.f { display: grid; gap: 5px; color: var(--mu); font-size: 12px; } .f input, .f select, .f textarea { width: 100%; }
textarea { background: var(--s2); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; color: var(--tx); font: inherit; outline: none; resize: vertical; }
@media (max-width: 640px) { .grid2 { grid-template-columns: 1fr; } }
</style>

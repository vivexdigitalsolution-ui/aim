<!--
  MultiPick — a dropdown with a search box (with a clear button) where several items can be ticked.
  Items can sit in groups (make > model): each group has a title bar with its own "all / none", and the items inside are ticked in columns that scroll.
  On a phone the list opens as a bottom sheet. Used by the Scrape targets page.
-->
<template>
  <div ref="root" class="mp">
    <button type="button" class="mp-btn" :class="{ open, filled: modelValue.length }" :disabled="disabled" @click="toggle">
      <span class="mp-txt">
        <template v-if="!modelValue.length"><span class="mp-ph">{{ placeholder }}</span></template>
        <template v-else><b>{{ modelValue.length }}</b> {{ noun }} <span class="mp-names">{{ summary }}</span></template>
      </span>
      <span v-if="loading" class="mp-spin" />
      <svg v-else class="mp-car" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
    </button>

    <Teleport to="body" :disabled="!sheet">
      <div v-if="open" class="mp-back" :class="{ 'mp-sheet': sheet }" @click.self="close">
        <div class="mp-panel" :class="{ 'mp-sheet': sheet }" :style="sheet ? {} : panelStyle" role="listbox" aria-multiselectable="true">
          <div class="mp-head">
            <div class="mp-search">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.500-3.500" /></svg>
              <input ref="searchEl" v-model="q" :placeholder="searchPlaceholder" autocomplete="off" @keydown.esc="close" />
              <button v-if="q" type="button" class="mp-x" aria-label="Clear the search" @click="q = ''; searchEl?.focus()">×</button>
            </div>
            <div class="mp-tools">
              <span class="mp-count">{{ modelValue.length }} selected<template v-if="q"> · {{ shownCount }} shown</template></span>
              <span class="mp-acts">
                <button type="button" class="mp-link" @click="tickShown">{{ q ? 'Tick shown' : 'Tick all' }}</button>
                <button type="button" class="mp-link" :disabled="!modelValue.length" @click="clearAll">Clear</button>
                <button type="button" class="mp-done" @click="close">Done</button>
              </span>
            </div>
          </div>

          <div class="mp-body">
            <div v-if="loading" class="mp-empty">Loading ...</div>
            <div v-else-if="!shown.length" class="mp-empty">{{ q ? 'Nothing matches “' + q + '”.' : emptyText }}</div>
            <section v-for="g in shown" :key="g.key" class="mp-group">
              <header v-if="g.label" class="mp-gh">
                <span class="mp-gt">{{ g.label }}<small v-if="g.sub"> {{ g.sub }}</small></span>
                <span class="mp-gn">{{ pickedIn(g) }}/{{ g.items.length }}</span>
                <button type="button" class="mp-link" @click="tickGroup(g)">{{ allIn(g) ? 'none' : 'all' }}</button>
              </header>
              <div class="mp-grid">
                <label v-for="it in g.items" :key="it.value" class="mp-it" :class="{ on: sel.has(it.value), off: it.disabled }" :title="it.disabled ? (it.why || 'Not available') : undefined">
                  <input type="checkbox" :checked="sel.has(it.value)" :disabled="it.disabled" @change="flip(it.value)" />
                  <span class="mp-lab">{{ it.label }}<small v-if="it.hint"> {{ it.hint }}</small></span>
                </label>
              </div>
            </section>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
type Item = { value: string; label: string; hint?: string; disabled?: boolean; why?: string }
type Group = { key: string; label?: string; sub?: string; items: Item[] }

const props = withDefaults(defineProps<{
  modelValue: string[]
  groups: Group[]
  placeholder?: string
  noun?: string
  searchPlaceholder?: string
  emptyText?: string
  loading?: boolean
  disabled?: boolean
  asSheet?: boolean      // always open as a sheet (inside a scrolling box that would cut a dropdown)
}>(), { asSheet: false, placeholder: 'Choose', noun: 'selected', searchPlaceholder: 'Search', emptyText: 'Nothing to choose from.', loading: false, disabled: false })
const emit = defineEmits<{ (e: 'update:modelValue', v: string[]): void }>()

const open = ref(false), q = ref(''), root = ref<HTMLElement | null>(null), searchEl = ref<HTMLInputElement | null>(null)
const sheet = ref(false), panelStyle = ref<Record<string, string>>({})
const sel = computed(() => new Set(props.modelValue))

const label = new Map<string, string>()
watchEffect(() => { for (const g of props.groups) for (const i of g.items) label.set(i.value, i.label) })
const summary = computed(() => { const n = props.modelValue.map((v) => label.get(v) || v); return n.slice(0, 3).join(', ') + (n.length > 3 ? ` +${n.length - 3}` : '') })

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const shown = computed(() => {
  const s = norm(q.value)
  if (!s) return props.groups.filter((g) => g.items.length)
  return props.groups.map((g) => {
    const whole = !!g.label && norm(g.label).includes(s)       // the search matches the group name: show the whole group
    return { ...g, items: whole ? g.items : g.items.filter((i) => norm(i.label).includes(s)) }
  }).filter((g) => g.items.length)
})
const shownCount = computed(() => shown.value.reduce((n, g) => n + g.items.length, 0))
const pickedIn = (g: Group) => g.items.filter((i) => sel.value.has(i.value)).length
const free = (g: Group) => g.items.filter((i) => !i.disabled)
const allIn = (g: Group) => free(g).length > 0 && free(g).every((i) => sel.value.has(i.value))

function set(v: string[]) { emit('update:modelValue', v) }
function flip(v: string) { set(sel.value.has(v) ? props.modelValue.filter((x) => x !== v) : [...props.modelValue, v]) }
function tickGroup(g: Group) {
  const ids = free(g).map((i) => i.value)
  set(allIn(g) ? props.modelValue.filter((v) => !ids.includes(v)) : [...new Set([...props.modelValue, ...ids])])
}
function tickShown() { set([...new Set([...props.modelValue, ...shown.value.flatMap((g) => free(g).map((i) => i.value))])]) }
function clearAll() { set([]) }

function place() {
  sheet.value = props.asSheet || window.innerWidth <= 760
  if (sheet.value || !root.value) return
  const r = root.value.getBoundingClientRect()
  panelStyle.value = { top: r.height + 6 + 'px', left: '0', width: Math.max(r.width, 420) + 'px', maxWidth: 'min(94vw, 720px)' }
}
async function toggle() { if (open.value) close(); else { place(); open.value = true; q.value = ''; await nextTick(); if (!sheet.value) searchEl.value?.focus() } }
function close() { open.value = false }

function outside(e: MouseEvent) { if (open.value && !sheet.value && root.value && !root.value.contains(e.target as Node)) close() }
onMounted(() => document.addEventListener('mousedown', outside))
onBeforeUnmount(() => document.removeEventListener('mousedown', outside))
watch(open, (o) => { if (sheet.value) document.documentElement.style.overflow = o ? 'hidden' : '' })
onBeforeUnmount(() => { document.documentElement.style.overflow = '' })
</script>

<style scoped>
.mp { position: relative; min-width: 0; }
.mp-btn { width: 100%; min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 8px; text-align: left; padding: 6px 12px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; color: var(--tx); cursor: pointer; }
.mp-btn:disabled { opacity: .5; cursor: default; }
.mp-btn.open, .mp-btn:focus-visible { border-color: var(--ac); outline: none; }
.mp-txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-ph { color: var(--mu); }
.mp-names { color: var(--mu); margin-left: 4px; }
.mp-car { flex: none; color: var(--mu); transition: transform .15s; } .mp-btn.open .mp-car { transform: rotate(180deg); }
.mp-spin { flex: none; width: 15px; height: 15px; border: 2px solid var(--line); border-top-color: var(--ac); border-radius: 50%; animation: mpspin .7s linear infinite; }
@keyframes mpspin { to { transform: rotate(360deg); } }

.mp-panel { position: absolute; z-index: 60; background: var(--s1); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 14px 40px rgba(0, 0, 0, .28); display: flex; flex-direction: column; max-height: min(480px, 70vh); overflow: hidden; }
.mp-back.mp-sheet { position: fixed; inset: 0; z-index: 90; background: rgba(0, 0, 0, .5); display: flex; align-items: flex-end; }
.mp-panel.mp-sheet { position: static; width: 100%; max-height: 86vh; border-radius: 18px 18px 0 0; border: 0; padding-bottom: env(safe-area-inset-bottom, 0px); }

.mp-head { padding: 10px 12px 8px; border-bottom: 1px solid var(--line); display: grid; gap: 8px; flex: none; }
.mp-search { position: relative; display: flex; align-items: center; }
.mp-search svg { position: absolute; left: 11px; color: var(--mu); pointer-events: none; }
.mp-search input { width: 100%; height: 38px; padding: 0 36px 0 34px; background: var(--s2); border: 1px solid var(--line); border-radius: 10px; font-size: 16px; }
.mp-search input:focus { border-color: var(--ac); outline: none; }
.mp-x { position: absolute; right: 6px; width: 26px; height: 26px; border: 0; border-radius: 50%; background: var(--s3, var(--line)); color: var(--tx); font-size: 18px; line-height: 1; cursor: pointer; display: grid; place-items: center; padding: 0; }
.mp-tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.mp-count { color: var(--mu); font-size: 12.5px; }
.mp-acts { display: inline-flex; align-items: center; gap: 12px; }
.mp-link { background: none; border: 0; color: var(--ac); font-size: 13px; font-weight: 600; cursor: pointer; padding: 4px 0; } .mp-link:disabled { opacity: .4; cursor: default; }
.mp-done { background: var(--ac); color: #fff; border: 0; border-radius: 8px; height: 30px; padding: 0 14px; font-weight: 600; cursor: pointer; }

.mp-body { overflow-y: auto; overscroll-behavior: contain; flex: 1; min-height: 0; }
.mp-empty { padding: 22px 14px; text-align: center; color: var(--mu); }
.mp-group + .mp-group { border-top: 1px solid var(--line); }
.mp-gh { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 10px; padding: 7px 12px; background: var(--s2); border-bottom: 1px solid var(--line); }
.mp-gt { font-weight: 700; font-size: 13px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .mp-gt small { color: var(--mu); font-weight: 500; }
.mp-gn { color: var(--mu); font-size: 12px; font-variant-numeric: tabular-nums; }
.mp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); padding: 4px 6px; }
.mp-it { display: flex; align-items: flex-start; gap: 9px; padding: 7px 8px; border-radius: 8px; cursor: pointer; line-height: 1.25; font-size: 14px; min-width: 0; }
.mp-it:hover { background: var(--s2); } .mp-it.on { background: var(--acbg); }
.mp-it.off { opacity: .4; cursor: not-allowed; }
.mp-it input { flex: none; width: 17px; height: 17px; margin: 1px 0 0; padding: 0; accent-color: var(--ac); }
.mp-lab { min-width: 0; overflow-wrap: anywhere; } .mp-lab small { color: var(--mu); }
@media (min-width: 761px) { .mp-back.mp-sheet { align-items: center; justify-content: center; } .mp-panel.mp-sheet { width: min(680px, 94vw); border-radius: 14px; max-height: 80vh; } }
@media (max-width: 760px) { .mp-grid { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); } .mp-it { padding: 10px 8px; } }
</style>

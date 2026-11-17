<template>
  <div ref="host" class="navwrap">
    <div ref="pill" class="pill" />
    <NuxtLink v-for="it in items" :key="it.to" :to="it.to" class="nav" :class="{ on: isOn(it.to) }" :data-to="it.to">
      <span class="ico" v-html="ICON[it.icon]" />
      <span>{{ mobile ? it.short || it.label : it.label }}</span>
      <span v-if="it.badge" class="n">{{ it.badge }}</span>
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
import { gsap } from 'gsap'

export interface NavItem { to: string; label: string; short?: string; icon: string; badge?: number | string | null }
const props = defineProps<{ items: NavItem[]; mobile?: boolean }>()
const route = useRoute()
const host = ref<HTMLElement>(), pill = ref<HTMLElement>()
const st = { a: 0, b: 0, ready: false }

const ICON: Record<string, string> = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.8c2 .7 3.2 2.3 3.5 5.2"/></svg>',
  bids: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3l7 7-3 3-7-7z"/><path d="M11 6L4 13l5 5 7-7"/><path d="M3 21h9"/></svg>',
  margin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15l4-4 3 3 5-6"/></svg>',
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
}
const isOn = (to: string) => route.path === to || route.path.startsWith(to + '/')

function target() {
  const el = host.value?.querySelector('.nav.on') as HTMLElement | null
  if (!el) return null
  return props.mobile ? { a: el.offsetLeft, b: el.offsetLeft + el.offsetWidth } : { a: el.offsetTop, b: el.offsetTop + el.offsetHeight }
}
function paint() {
  const p = pill.value; if (!p) return
  if (props.mobile) { p.style.left = st.a + 'px'; p.style.width = st.b - st.a + 'px' } else { p.style.top = st.a + 'px'; p.style.height = st.b - st.a + 'px' }
}
// the pill: the leading edge moves first, the trailing edge catches up
function move(animate: boolean) {
  const t = target(); const p = pill.value
  if (!t || !p) { if (p) p.style.opacity = '0'; return }
  p.style.opacity = '1'
  if (!animate || !st.ready) { st.a = t.a; st.b = t.b; st.ready = true; paint(); return }
  const fwd = t.a > st.a, lead = fwd ? 'b' : 'a', trail = fwd ? 'a' : 'b'
  gsap.killTweensOf(st)
  gsap.to(st, { [lead]: t[lead], duration: 0.36, ease: 'power3.out', onUpdate: paint })
  gsap.to(st, { [trail]: t[trail], duration: 0.55, ease: 'power3.inOut', onUpdate: paint })
}
const onResize = () => move(false)
onMounted(() => { nextTick(() => move(false)); window.addEventListener('resize', onResize) })
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
watch(() => route.path, () => nextTick(() => move(true)))
watch(() => props.items.length, () => nextTick(() => move(false)))
</script>

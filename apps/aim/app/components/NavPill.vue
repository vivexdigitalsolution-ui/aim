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

const ICON: Record<string, string> = NAV_ICONS
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


<template>
  <figure class="ch" :aria-label="`Asking price against mileage for ${points.length} listings`">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" preserveAspectRatio="xMidYMid meet">
      <g v-for="t in yTicks" :key="'y' + t">
        <line :x1="PL" :x2="W - PR" :y1="y(t)" :y2="y(t)" class="grid" />
        <text :x="PL - 6" :y="y(t) + 4" class="ytick">{{ Math.round(t / 1000) }}k</text>
      </g>
      <line :x1="PL" :x2="W - PR" :y1="H - PB" :y2="H - PB" class="axis" />
      <text v-for="t in xTicks" :key="'x' + t" :x="x(t)" :y="H - 8" class="tick">{{ Math.round(t / 1000) }}k km</text>
      <circle v-for="(p, i) in plotted" :key="i" :cx="x(p.km)" :cy="y(p.price)" r="5" class="dot"><title>{{ p.year }} · {{ p.km.toLocaleString('en-US') }} km · RM {{ p.price.toLocaleString('en-US') }}</title></circle>
      <g v-if="sell"><line :x1="PL" :x2="W - PR" :y1="y(sell)" :y2="y(sell)" class="sell" /><text :x="W - PR" :y="y(sell) - 5" class="selll">sell price</text></g>
    </svg>
    <figcaption v-if="skipped" class="muted small">{{ skipped }} listing{{ skipped === 1 ? ' has' : 's have' }} no mileage and {{ skipped === 1 ? 'is' : 'are' }} not drawn.</figcaption>
  </figure>
</template>

<script setup lang="ts">
const props = defineProps<{ points: { km: number | null; price: number; year: number }[]; sell?: number | null }>()
const W = 600, H = 260, PL = 44, PR = 14, PT = 14, PB = 28
const plotted = computed(() => props.points.filter((p) => p.km != null) as { km: number; price: number; year: number }[])
const skipped = computed(() => props.points.length - plotted.value.length)
const pr = computed(() => { const v = props.points.map((p) => p.price).concat(props.sell ? [props.sell] : []); const lo = Math.min(...v), hi = Math.max(...v), pad = (hi - lo) * 0.08 || hi * 0.05; return { lo: Math.max(0, lo - pad), hi: hi + pad } })
const kr = computed(() => { const v = plotted.value.map((p) => p.km); const hi = Math.max(10000, ...v); return { lo: 0, hi: hi * 1.05 } })
const x = (v: number) => PL + ((v - kr.value.lo) / (kr.value.hi - kr.value.lo)) * (W - PL - PR)
const y = (v: number) => PT + (1 - (v - pr.value.lo) / Math.max(1, pr.value.hi - pr.value.lo)) * (H - PT - PB)
const ticks = (lo: number, hi: number, n: number) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n)
const yTicks = computed(() => ticks(pr.value.lo, pr.value.hi, 4).map((t) => Math.round(t / 1000) * 1000))
const xTicks = computed(() => ticks(0, kr.value.hi, 4).map((t) => Math.round(t / 5000) * 5000))
</script>

<style scoped>
.ch { margin: 0; } svg { width: 100%; height: auto; display: block; }
.grid { stroke: var(--line); stroke-dasharray: 2 4; } .axis { stroke: var(--line); }
.ytick { fill: var(--mu); font-size: 11px; text-anchor: end; } .tick { fill: var(--mu); font-size: 11px; text-anchor: middle; }
.dot { fill: var(--ac); opacity: .75; stroke: var(--s1); stroke-width: 1.5; } .dot:hover { opacity: 1; }
.sell { stroke: var(--ok); stroke-width: 2; stroke-dasharray: 5 4; } .selll { fill: var(--ok); font-size: 11px; font-weight: 600; text-anchor: end; }
</style>

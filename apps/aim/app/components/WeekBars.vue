
<template>
  <figure class="ch" :aria-label="`Average sold price for each of ${weeks.length} auction weeks`">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" preserveAspectRatio="xMidYMid meet">
      <g v-for="(w, i) in weeks" :key="w.week">
        <rect :x="x(i)" :y="y(w.avg)" :width="bw" :height="H - PB - y(w.avg)" rx="3" class="bar"><title>Week of {{ w.week }}: average ¥{{ Math.round(w.avg).toLocaleString('en-US') }} from {{ w.n }} sale{{ w.n === 1 ? '' : 's' }}</title></rect>
        <text :x="x(i) + bw / 2" :y="y(w.avg) - 4" class="cnt">{{ k(w.avg) }}k</text>
        <text :x="x(i) + bw / 2" :y="H - 12" class="tick">{{ w.week.slice(5) }}</text>
        <text :x="x(i) + bw / 2" :y="H - 1" class="sub">{{ w.n }} sold</text>
      </g>
      <line :x1="PL" :x2="W - PR" :y1="H - PB" :y2="H - PB" class="axis" />
    </svg>
    <figcaption class="small muted">Average sold price in yen for each auction week (week starting date). The number under it is how many cars it is based on.</figcaption>
  </figure>
</template>

<script setup lang="ts">
const props = defineProps<{ weeks: { week: string; n: number; avg: number }[] }>()
const W = 600, H = 230, PL = 14, PR = 14, PT = 24, PB = 40
const n = computed(() => Math.max(1, props.weeks.length))
const slot = computed(() => (W - PL - PR) / n.value)
const bw = computed(() => Math.min(64, slot.value * 0.7))
const x = (i: number) => PL + slot.value * i + (slot.value - bw.value) / 2
const max = computed(() => Math.max(1, ...props.weeks.map((w) => w.avg)))
const y = (v: number) => PT + (1 - v / max.value) * (H - PT - PB)
const k = (v: number) => Math.round(v / 1000).toLocaleString('en-US')
</script>

<style scoped>
.ch { margin: 0; } svg { width: 100%; height: auto; display: block; }
.bar { fill: var(--ac); opacity: .85; } .bar:hover { opacity: 1; }
.cnt { fill: var(--mu); font-size: 11px; text-anchor: middle; }
.axis { stroke: var(--line); } .tick { fill: var(--mu); font-size: 11px; text-anchor: middle; } .sub { fill: var(--mu); font-size: 9px; text-anchor: middle; }
figcaption { margin-top: 6px; }
</style>

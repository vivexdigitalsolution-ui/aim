
<template>
  <figure class="ch" :aria-label="`Histogram of ${total} asking prices from RM ${k(lo)} to RM ${k(hi)}`">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" preserveAspectRatio="xMidYMid meet">
      <g v-for="(b, i) in bins" :key="i">
        <rect :x="x(b.from) + 1" :y="y(b.count)" :width="Math.max(1, x(b.to) - x(b.from) - 2)" :height="H - PB - y(b.count)" rx="3" class="bar"><title>RM {{ k(b.from) }}k to RM {{ k(b.to) }}k: {{ b.count }} listing{{ b.count === 1 ? '' : 's' }}</title></rect>
        <text v-if="b.count" :x="(x(b.from) + x(b.to)) / 2" :y="y(b.count) - 4" class="cnt">{{ b.count }}</text>
      </g>
      <line :x1="PL" :x2="W - PR" :y1="H - PB" :y2="H - PB" class="axis" />
      <text v-for="t in ticks" :key="t" :x="x(t)" :y="H - 8" class="tick">{{ k(t) }}k</text>
      <g v-for="m in marks" :key="m.label">
        <line :x1="x(m.value)" :x2="x(m.value)" :y1="PT" :y2="H - PB" :class="'mk ' + m.cls" />
        <text :x="x(m.value)" :y="PT - 4" :class="'mkl ' + m.cls">{{ m.label }}</text>
      </g>
    </svg>
  </figure>
</template>

<script setup lang="ts">
import { histogram } from '@aim/core'

const props = defineProps<{ prices: number[]; median?: number | null; sell?: number | null }>()
const W = 600, H = 220, PL = 14, PR = 14, PT = 22, PB = 26
const bins = computed(() => histogram(props.prices))
const total = computed(() => props.prices.length)
const lo = computed(() => Math.min(bins.value[0]?.from ?? 0, props.sell ?? Infinity))
const hi = computed(() => Math.max(bins.value[bins.value.length - 1]?.to ?? 1, props.sell ?? 0, props.median ?? 0))
const x = (v: number) => PL + ((v - lo.value) / Math.max(1, hi.value - lo.value)) * (W - PL - PR)
const maxC = computed(() => Math.max(1, ...bins.value.map((b) => b.count)))
const y = (c: number) => PT + (1 - c / maxC.value) * (H - PT - PB)
const k = (v: number) => Math.round(v / 1000).toLocaleString('en-US')
const ticks = computed(() => { const n = 5, out: number[] = []; for (let i = 0; i <= n; i++) out.push(lo.value + ((hi.value - lo.value) * i) / n); return out.map((t) => Math.round(t / 1000) * 1000) })
const marks = computed(() => [
  ...(props.median ? [{ value: props.median, label: 'median', cls: 'med' }] : []),
  ...(props.sell ? [{ value: props.sell, label: 'sell price', cls: 'sell' }] : []),
])
</script>

<style scoped>
.ch { margin: 0; } svg { width: 100%; height: auto; display: block; }
.bar { fill: var(--ac); opacity: .85; } .bar:hover { opacity: 1; }
.cnt { fill: var(--mu); font-size: 11px; text-anchor: middle; }
.axis { stroke: var(--line); } .tick { fill: var(--mu); font-size: 11px; text-anchor: middle; }
.mk { stroke-width: 2; stroke-dasharray: 5 4; } .mk.med { stroke: var(--tx); } .mk.sell { stroke: var(--ok); }
.mkl { font-size: 11px; text-anchor: middle; font-weight: 600; } .mkl.med { fill: var(--tx); } .mkl.sell { fill: var(--ok); }
</style>

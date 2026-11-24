<template>
  <svg v-if="pts.length > 1" class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
    <polyline :points="line" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
  </svg>
  <svg v-else-if="pts.length === 1" class="spark" viewBox="0 0 100 32" aria-hidden="true"><line x1="0" y1="16" x2="92" y2="16" stroke="currentColor" stroke-opacity=".3" stroke-width="1" stroke-dasharray="3 3" /><circle cx="94" cy="16" r="3.5" fill="currentColor" /></svg>
</template>
<script setup lang="ts">
// the small line graph of a dashboard card: the last days of one number (nulls are skipped; fewer than 2 points draws nothing)
const props = defineProps<{ values: (number | null | undefined)[] }>()
const pts = computed(() => props.values.map((v, i) => ({ v, i })).filter((p) => p.v != null) as { v: number; i: number }[])
const line = computed(() => {
  const p = pts.value, lo = Math.min(...p.map((x) => x.v)), hi = Math.max(...p.map((x) => x.v)), n = Math.max(1, props.values.length - 1)
  return p.map((x) => `${((x.i / n) * 100).toFixed(1)},${(hi === lo ? 16 : 29 - ((x.v - lo) / (hi - lo)) * 26).toFixed(1)}`).join(' ')
})
</script>
<style scoped>.spark { width: 100%; height: 28px; color: var(--ac); display: block; }</style>

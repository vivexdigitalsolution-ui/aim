<template>
  <span class="flags">
    <span class="fl" :class="{ on: docket }" :title="docket ? 'Customs docket found: the import cost is worked out' : 'No customs docket yet'" :aria-label="docket ? 'Docket found' : 'No docket yet'">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h4"/></svg>
    </span>
    <span class="fl warn" :class="{ on: review }" :title="review ? 'Handwriting or unclear on the auction sheet: check the sheet yourself' : 'The auction sheet read clearly'" :aria-label="review ? 'Check the auction sheet' : 'Sheet read clearly'">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/></svg>
    </span>
  </span>
</template>

<script setup lang="ts">
defineProps<{ docket?: boolean; review?: boolean }>()
</script>

<style scoped>
.flags { display: inline-flex; align-items: center; gap: 6px; }
.fl { width: 26px; height: 26px; border-radius: 8px; display: inline-grid; place-items: center; color: var(--mu2, #8a93a3); opacity: .45; border: 1px solid transparent; }
.fl svg { width: 16px; height: 16px; display: block; }
.fl.on { opacity: 1; color: var(--ok, #1f9d55); background: color-mix(in srgb, var(--ok, #1f9d55) 14%, transparent); border-color: color-mix(in srgb, var(--ok, #1f9d55) 40%, transparent); }
.fl.warn.on { color: var(--warn, #d98a00); background: color-mix(in srgb, var(--warn, #d98a00) 16%, transparent); border-color: color-mix(in srgb, var(--warn, #d98a00) 45%, transparent); }
</style>

<template>
  <svg viewBox="0 0 24 24" :fill="filled ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="staricon" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>
</template>

<script setup lang="ts">
defineProps<{ filled?: boolean }>()
</script>

<style scoped>
.staricon { width: 1.1em; height: 1.1em; display: block; flex: none; }
</style>

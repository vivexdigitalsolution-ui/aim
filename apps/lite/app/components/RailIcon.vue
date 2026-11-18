<template>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <template v-if="name === 'home'"><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v10h5v-6h4v6h5V10" /></template>
    <template v-else-if="name === 'cars'"><path d="M5 16v-5l1.7-4.2A2 2 0 0 1 8.6 5.5h6.8a2 2 0 0 1 1.9 1.3L19 11v5" /><path d="M3 11h18" /><path d="M7 19v-3M17 19v-3" /><circle cx="8" cy="13.5" r=".6" /><circle cx="16" cy="13.5" r=".6" /></template>
    <template v-else-if="name === 'heart'"><path d="M12 20.5S4.5 16 3 11a4.7 4.7 0 0 1 9-2.3A4.7 4.7 0 0 1 21 11c-1.5 5-9 9.500-9 9.500z" /></template>
    <template v-else-if="name === 'orders'"><path d="M9 4h6v3H9z" /><path d="M7 6H5.500A1.500 1.500 0 0 0 4 7.500v12A1.500 1.500 0 0 0 5.500 21h13a1.500 1.500 0 0 0 1.500-1.500v-12A1.500 1.500 0 0 0 18.500 6H17" /><path d="M8 12h8M8 16h5" /></template>
    <template v-else-if="name === 'calc'"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 7h8" /><path d="M8.500 11h.01M12 11h.01M15.500 11h.01M8.500 14.500h.01M12 14.500h.01M15.500 14.500h.01M8.500 18h.01M12 18h.01M15.500 18h.01" /></template>
    <template v-else-if="name === 'queue'"><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.500 6 1 1 2-2M3.500 12l1 1 2-2M3.500 18l1 1 2-2" /></template>
    <template v-else-if="name === 'users'"><circle cx="9.500" cy="8" r="3.500" /><path d="M3 20v-1a4.500 4.500 0 0 1 4.500-4.500h4A4.500 4.500 0 0 1 16 19v1" /><path d="M17 4.300a3.500 3.500 0 0 1 0 6.400M21 20v-1a3.500 3.500 0 0 0-2.500-3.300" /></template>
    <template v-else-if="name === 'offer'"><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h7M9 17h7" /></template>
    <template v-else-if="name === 'target'"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></template>
    <template v-else-if="name === 'clock'"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></template>
    <template v-else-if="name === 'gavel'"><path d="m14 4 6 6-3 3-6-6zM11 7 4 14l3 3 7-7M3 21h9" /></template>
    <template v-else-if="name === 'trophy'"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.500 20h7M10 17h4" /></template>
    <template v-else-if="name === 'cross'"><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></template>
    <template v-else-if="name === 'settings'"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></template>
  </svg>
</template>

<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template><div class="muted">Opening the cars ...</div></template>

<script setup lang="ts">
// Find by feature now lives on the Cars page (Features button). An old link goes there with the same options chosen.
const route = useRoute()
const f = String(route.query.f || ''), q = String(route.query.q || '')
await navigateTo({ path: '/cars', query: { ...(f ? { feat: f } : {}), ...(q ? { ftext: q } : {}) } }, { replace: true })
</script>

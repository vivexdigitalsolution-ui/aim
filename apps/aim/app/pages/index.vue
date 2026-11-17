<template><div /></template>

<script setup lang="ts">
const { hasTier } = useAuth()
await navigateTo(hasTier('member') ? '/today' : '/search', { replace: true })
</script>

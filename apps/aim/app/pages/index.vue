<template><div /></template>

<script setup lang="ts">
const { isStaff } = useAuth()
await navigateTo(isStaff.value ? '/today' : '/search', { replace: true })
</script>

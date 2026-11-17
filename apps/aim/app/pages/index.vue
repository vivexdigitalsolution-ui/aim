<template><div /></template>

<script setup lang="ts">
const { isStaff } = useAuth()
await navigateTo(isStaff.value ? '/review' : '/search', { replace: true })
</script>

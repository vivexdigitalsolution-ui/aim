<template>
  <DashStaff v-if="isStaff" />
  <DashCustomer v-else-if="profile?.role === 'customer'" />
  <DashAp v-else />
</template>

<script setup lang="ts">
// The home page: one dashboard per kind of user (staff, AP holder, walk-in customer).
const { isStaff, profile } = useAuth()
</script>

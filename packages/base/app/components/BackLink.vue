<template>
  <a :href="to" class="backlink" @click.prevent="go"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.500 5-7 7 7 7" /></svg><slot /></a>
</template>

<script setup lang="ts">
// "‹ All cars": goes back to the list as it was (filters and all); a page opened from a link goes to `to`.
const props = defineProps<{ to: string }>()
const router = useRouter()
function go() { if (import.meta.client && (window.history.state as any)?.back) router.back(); else navigateTo(props.to) }
</script>

<style scoped>
.backlink { display: inline-flex; align-items: center; gap: 2px; font-size: 14px; font-weight: 600; padding: 4px 10px 4px 2px; border-radius: 8px; color: var(--ac); text-decoration: none; margin-bottom: 6px; }
.backlink:hover { background: var(--acbg, rgba(255, 255, 255, .06)); }
.backlink svg { width: 22px; height: 22px; }
</style>

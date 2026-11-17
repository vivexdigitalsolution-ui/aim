
<template>
  <div>
    <h1>Alerts</h1>
    <p class="sub">{{ isStaff ? 'New bid orders, orders still waiting to be placed before their deadline, and changes by dealers.' : 'What happened to your bid orders, and new cars that fit your buy list.' }}</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>

    <div class="card row wrap" style="gap: 18px; margin-bottom: 14px; justify-content: flex-start">
      <label class="small"><input v-model="prefs.notify_email" type="checkbox" style="width: auto; height: auto" @change="savePrefs" /> Also email me <span class="muted">({{ profile?.email }})</span></label>
      <label class="small"><input v-model="prefs.notify_whatsapp" type="checkbox" style="width: auto; height: auto" :disabled="!profile?.whatsapp && !profile?.phone" @change="savePrefs" /> Also WhatsApp me <span class="muted">({{ profile?.whatsapp || profile?.phone || 'add a number in your profile' }})</span></label>
      <span class="grow" />
      <button class="btn ghost sm" :disabled="!unread" @click="markAll">Mark all read</button>
    </div>

    <div v-if="loading" class="muted">Loading ...</div>
    <div v-else-if="!rows.length" class="card muted">No alerts yet.</div>
    <div class="grid">
      <NuxtLink v-for="r in rows" :key="r.id" :to="r.link || '/'" class="card al" :class="{ unread: !r.read_at }" @click="markRead(r)">
        <span class="dot" :class="kindClass(r.kind)" />
        <div style="min-width: 0">
          <div class="row"><b>{{ r.title }}</b><span class="muted small nowrap">{{ fmtMytDateTime(r.created_at) }}</span></div>
          <div v-if="r.body" class="muted small" style="white-space: pre-line">{{ r.body }}</div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime } from '@aim/core'

const db = useDb()
const { profile, isStaff, loadProfile } = useAuth()
const unread = useState<number | null>('alert-count', () => null)
const rows = ref<any[]>([]), loading = ref(true), err = ref('')
const prefs = reactive({ notify_email: true, notify_whatsapp: false })
const kindClass = (k: string) => (['bid_won'].includes(k) ? 'ok' : ['bid_rejected', 'closing_soon', 'bid_cancelled'].includes(k) ? 'bad' : ['new_bid', 'bid_changed', 'buy_list', 'bid_placed'].includes(k) ? 'ac' : '')

async function load() {
  const { data, error } = await db.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)
  if (error) { err.value = error.message; return }
  rows.value = data || []; unread.value = rows.value.filter((r) => !r.read_at).length
}
async function markRead(r: any) { if (r.read_at) return; r.read_at = new Date().toISOString(); await db.from('notifications').update({ read_at: r.read_at }).eq('id', r.id); unread.value = Math.max(0, (unread.value || 0) - 1) }
async function markAll() { const at = new Date().toISOString(); await db.from('notifications').update({ read_at: at }).is('read_at', null); rows.value.forEach((r) => (r.read_at ||= at)); unread.value = 0 }
async function savePrefs() {
  const { error } = await db.from('profiles').update({ notify_email: prefs.notify_email, notify_whatsapp: prefs.notify_whatsapp }).eq('id', profile.value!.id)
  if (error) err.value = error.message; else await loadProfile()
}
onMounted(async () => {
  Object.assign(prefs, { notify_email: (profile.value as any)?.notify_email ?? true, notify_whatsapp: (profile.value as any)?.notify_whatsapp ?? false })
  try { await load() } finally { loading.value = false }
})
</script>

<style scoped>
.al { display: grid; grid-template-columns: 12px 1fr; gap: 12px; color: inherit; text-decoration: none; padding: 12px 16px; }
.al.unread { border-color: var(--ac); background: var(--acbg); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--mu2); margin-top: 5px; }
.dot.ok { background: var(--ok); } .dot.bad { background: var(--bad); } .dot.ac { background: var(--ac); }
.nowrap { white-space: nowrap; }
</style>

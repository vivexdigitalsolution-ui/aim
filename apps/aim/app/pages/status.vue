<template>
  <div>
    <h1>System status</h1>
    <p class="sub">The daily refresh: open cars, sold prices, sheet reading, features, catalog links and Malaysian market prices. Set up once on the scraper PC (docs/automation-setup.md).</p>
    <div v-if="err" class="err" style="margin-bottom: 12px">{{ err }}</div>

    <div class="grid kpis">
      <div class="card kpi"><small>Data</small><b :class="level === 'ok' ? 'up' : level === 'bad' ? 'down' : ''">{{ label || '—' }}</b></div>
      <div class="card kpi"><small>Open cars</small><b>{{ info.open.toLocaleString('en-US') }}</b></div>
      <div class="card kpi"><small>Linked to the catalog</small><b>{{ info.open ? Math.round((info.linked / info.open) * 100) : 0 }}%</b><span class="muted small">{{ info.linked }} of {{ info.open }}</span></div>
      <div class="card kpi"><small>Market prices</small><b>{{ info.marketRows ? info.marketAsOf : 'none yet' }}</b><span class="muted small">{{ info.marketRows ? info.marketRows + ' rows' : 'waiting for CarzNexus links' }}</span></div>
    </div>

    <h2 style="margin: 22px 0 10px">Recent runs</h2>
    <div v-if="!runs.length" class="card muted">No run yet. Run <code>node daily.js</code> or <code>run-daily.bat</code> on the scraper PC (migration 24 must be applied).</div>
    <div class="grid">
      <div v-for="r in runs" :key="r.id" class="card">
        <div class="row">
          <div><b>{{ fmtMytDateTime(r.started_at) }}</b> <span class="muted small">· {{ r.trigger }} · {{ r.host }}<template v-if="r.finished_at"> · {{ mins(r) }}</template></span></div>
          <span class="chip" :class="r.status === 'ok' ? 'ok' : r.status === 'running' ? 'ac' : r.status === 'partial' ? 'warn' : 'bad'">{{ r.status }}</span>
        </div>
        <div class="steps">
          <div v-for="s in r.steps" :key="s.name" class="step" :class="s.status" @click="open = open === r.id + s.name ? '' : r.id + s.name">
            <span class="dot" /><b>{{ s.name }}</b><span class="muted small">{{ s.status === 'skipped' ? 'skipped' : s.seconds + 's' }}</span>
            <pre v-if="open === r.id + s.name" class="note">{{ s.note || '(no output)' }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { fmtMytDateTime } from '@aim/core'
import type { JobRun } from '~/composables/useSystemStatus'

const { runs, info, level, label, load } = useSystemStatus()
const err = ref(''), open = ref('')
const mins = (r: JobRun) => { const m = Math.round((new Date(r.finished_at!).getTime() - new Date(r.started_at).getTime()) / 60000); return m < 60 ? m + ' min' : (m / 60).toFixed(1) + ' h' }
onMounted(async () => { try { await load() } catch (e: any) { err.value = e.message } })
</script>

<style scoped>
.kpis { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.kpi { display: grid; gap: 2px; } .kpi small { color: var(--mu); } .kpi b { font-size: 20px; }
.steps { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.step { background: var(--s2); border-radius: 10px; padding: 6px 10px; display: flex; gap: 8px; align-items: center; cursor: pointer; flex-wrap: wrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mu2); } .step.ok .dot { background: var(--ok); } .step.failed .dot { background: var(--bad); }
.note { flex-basis: 100%; margin: 6px 0 2px; white-space: pre-wrap; font-size: 12px; color: var(--mu); background: var(--bg); border-radius: 8px; padding: 8px; max-height: 200px; overflow: auto; }
</style>

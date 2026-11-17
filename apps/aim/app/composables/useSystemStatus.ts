export interface JobRun { id: string; started_at: string; finished_at: string | null; status: 'running' | 'ok' | 'partial' | 'failed'; trigger: string; host: string | null; steps: { name: string; status: string; seconds: number; note: string }[] }

/** How fresh the data is, for staff: the daily job's runs, the newest market snapshot, and how many open cars are linked. */
export function useSystemStatus() {
  const db = useDb()
  const runs = useState<JobRun[]>('job-runs', () => [])
  const info = useState('sys-info', () => ({ open: 0, linked: 0, marketAsOf: null as string | null, marketRows: 0 }))
  const level = useState<'ok' | 'warn' | 'bad' | 'unknown'>('sys-level', () => 'unknown')
  const label = useState('sys-label', () => '')

  async function load() {
    const r = await db.from('job_runs').select('*').order('started_at', { ascending: false }).limit(20)
    runs.value = (r.data || []) as JobRun[]
    const [open, linked, mk] = await Promise.all([
      db.from('lots').select('id', { count: 'exact', head: true }).gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true),
      db.from('lot_catalog').select('lot_id,lots!inner(bid_deadline)', { count: 'exact', head: true }).gt('lots.bid_deadline', new Date().toISOString()).in('level', ['variant', 'model']),
      db.from('market_stats').select('as_of', { count: 'exact' }).order('as_of', { ascending: false }).limit(1),
    ])
    info.value = { open: open.count || 0, linked: linked.count || 0, marketAsOf: mk.data?.[0]?.as_of || null, marketRows: mk.count || 0 }
    const last = runs.value.find((x) => x.status !== 'running') || null
    const lastOk = runs.value.find((x) => x.status === 'ok')
    if (r.error) { level.value = 'unknown'; label.value = 'No run log yet'; return }
    if (!last) { level.value = 'unknown'; label.value = 'Never run'; return }
    const hours = (Date.now() - new Date(last.finished_at || last.started_at).getTime()) / 3600_000
    const age = hours < 1 ? 'just now' : hours < 24 ? Math.round(hours) + 'h ago' : Math.round(hours / 24) + 'd ago'
    if (last.status === 'failed' || hours > 36) { level.value = 'bad'; label.value = (last.status === 'failed' ? 'Last run failed ' : 'No run since ') + age }
    else if (last.status === 'partial' || hours > 26) { level.value = 'warn'; label.value = (last.status === 'partial' ? 'Some steps failed ' : 'Last run ') + age }
    else { level.value = 'ok'; label.value = 'Data updated ' + age }
    void lastOk
  }
  return { runs, info, level, label, load }
}

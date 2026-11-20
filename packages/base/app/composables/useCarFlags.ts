/** Two yes/no flags per car for the cars page: docket found, sheet needs a look. Loaded in one call per page of cars. */
export function useCarFlags() {
  const db = useDb()
  const map = useState<Record<string, { docket: boolean; review: boolean }>>('car-flags', () => ({}))
  async function load(lotIds: string[]) {
    const want = lotIds.filter((id) => !(id in map.value))
    if (!want.length) return
    const { data, error } = await db.rpc('car_flags', { p_lot_ids: want })
    if (error || !Array.isArray(data)) return          // migration 45 not run yet: flags stay grey
    const next = { ...map.value }
    for (const r of data as any[]) next[r.lot_id] = { docket: !!r.has_docket, review: !!r.needs_review }
    map.value = next
  }
  const docket = (id: string) => !!map.value[id]?.docket
  const review = (id: string) => !!map.value[id]?.review
  return { load, docket, review }
}

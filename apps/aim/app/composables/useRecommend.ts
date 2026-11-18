/** The cars staff picked to recommend (the Offer report is built from them). Staff only; shared state so the icon on a card, the car page and the report agree. */
export function useRecommend() {
  const db = useDb()
  const { user, isStaff } = useAuth()
  const ids = useState<string[]>('recommend-ids', () => [])
  const loaded = useState('recommend-loaded', () => false)
  async function load(force = false) {
    if (!isStaff.value || (loaded.value && !force)) return
    const { data, error } = await db.from('recommend_picks').select('lot_id').limit(2000)
    if (error) throw error
    ids.value = (data || []).map((r: any) => r.lot_id)
    loaded.value = true
  }
  const has = (lotId: string) => ids.value.includes(lotId)
  async function toggle(lotId: string) {
    if (!isStaff.value) return
    if (has(lotId)) {
      const { error } = await db.from('recommend_picks').delete().eq('lot_id', lotId)
      if (error) throw error
      ids.value = ids.value.filter((x) => x !== lotId)
    } else {
      const { error } = await db.from('recommend_picks').insert({ lot_id: lotId, added_by: user.value?.id })
      if (error) throw error
      ids.value = [...ids.value, lotId]
    }
  }
  return { ids, load, has, toggle }
}

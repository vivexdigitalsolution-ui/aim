/** The cars a dealer has starred. Shared state: the star on a car and the Watchlist page agree. */
export function useWatch() {
  const db = useDb()
  const { user } = useAuth()
  const ids = useState<string[]>('watch-ids', () => [])
  const loaded = useState('watch-loaded', () => false)
  async function load(force = false) {
    if (!user.value || (loaded.value && !force)) return
    const { data, error } = await db.from('watchlist').select('lot_id').eq('ap_id', user.value.id).limit(1000)
    if (error) throw error
    ids.value = (data || []).map((r: any) => r.lot_id)
    loaded.value = true
  }
  const has = (lotId: string) => ids.value.includes(lotId)
  async function toggle(lotId: string) {
    if (!user.value) return
    if (has(lotId)) {
      const { error } = await db.from('watchlist').delete().eq('ap_id', user.value.id).eq('lot_id', lotId)
      if (error) throw error
      ids.value = ids.value.filter((x) => x !== lotId)
    } else {
      const { error } = await db.from('watchlist').insert({ ap_id: user.value.id, lot_id: lotId })
      if (error) throw error
      ids.value = [...ids.value, lotId]
    }
  }
  return { ids, load, has, toggle }
}

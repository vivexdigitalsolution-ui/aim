/** The cars a dealer has starred (bidding cars and One price cars). Shared state: the star on a car and the Watchlist / Favourites page agree.
 *  Ids are unique across both kinds, so has(id) answers for either; toggle(id, true) is for a One price car (its own table, migration 58). */
export function useWatch() {
  const db = useDb()
  const { user } = useAuth()
  const ids = useState<string[]>('watch-ids', () => [])
  const opIds = useState<string[]>('watch-op-ids', () => [])
  const loaded = useState('watch-loaded', () => false)
  async function load(force = false) {
    if (!user.value || (loaded.value && !force)) return
    const { data, error } = await db.from('watchlist').select('lot_id').eq('ap_id', user.value.id).limit(1000)
    if (error) throw error
    ids.value = (data || []).map((r: any) => r.lot_id)
    const op = await db.from('watchlist_one_price').select('one_price_id').eq('ap_id', user.value.id).limit(1000)
    opIds.value = op.error ? [] : (op.data || []).map((r: any) => r.one_price_id)      // before migration 58 there is no such table: One price stars just do not load
    loaded.value = true
  }
  const has = (id: string) => ids.value.includes(id) || opIds.value.includes(id)
  async function toggle(id: string, onePrice = false) {
    if (!user.value) return
    const [table, col, list] = onePrice ? (['watchlist_one_price', 'one_price_id', opIds] as const) : (['watchlist', 'lot_id', ids] as const)
    if (list.value.includes(id)) {
      const { error } = await db.from(table).delete().eq('ap_id', user.value.id).eq(col, id)
      if (error) throw error
      list.value = list.value.filter((x) => x !== id)
    } else {
      const { error } = await db.from(table).insert({ ap_id: user.value.id, [col]: id })
      if (error) throw new Error(onePrice && /watchlist_one_price|schema cache|relation/.test(error.message) ? 'One price favourites are not set up yet (database update 58 is missing).' : error.message)
      list.value = [...list.value, id]
    }
  }
  return { ids, opIds, load, has, toggle }
}

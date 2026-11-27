/**
 * The cars staff picked to recommend (the Offer report is built from the bidding ones). Staff only; shared state so the badge on a card, the car page and the report agree.
 * A One price car is kept in its own table (recommend_picks_one_price, migration 60): `ids` = bidding cars, `opIds` = One price cars.
 */
export function useRecommend() {
  const db = useDb()
  const { user, isStaff } = useAuth()
  const ids = useState<string[]>('recommend-ids', () => [])
  const opIds = useState<string[]>('recommend-op-ids', () => [])
  const loaded = useState('recommend-loaded', () => false)
  async function load(force = false) {
    if (!isStaff.value || (loaded.value && !force)) return
    const { data, error } = await db.from('recommend_picks').select('lot_id').limit(2000)
    if (error) throw error
    ids.value = (data || []).map((r: any) => r.lot_id)
    const op = await db.from('recommend_picks_one_price').select('one_price_id').limit(2000)      // before migration 60 is run this fails: One price cars then simply show as not recommended
    opIds.value = op.error ? [] : (op.data || []).map((r: any) => r.one_price_id)
    loaded.value = true
  }
  const has = (lotId: string) => ids.value.includes(lotId) || opIds.value.includes(lotId)
  async function toggle(lotId: string, onePrice = false) {
    if (!isStaff.value) return
    const table = onePrice ? 'recommend_picks_one_price' : 'recommend_picks', col = onePrice ? 'one_price_id' : 'lot_id'
    const list = onePrice ? opIds : ids
    if (list.value.includes(lotId)) {
      const { error } = await db.from(table).delete().eq(col, lotId)
      if (error) throw error
      list.value = list.value.filter((x) => x !== lotId)
    } else {
      const { error } = await db.from(table).insert({ [col]: lotId, added_by: user.value?.id })
      if (error) throw new Error(onePrice && /does not exist|schema cache/i.test(error.message) ? 'Run migration 60 in the Supabase SQL editor first (supabase/migrations/60_recommend_picks_one_price.sql).' : error.message)
      list.value = [...list.value, lotId]
    }
  }
  return { ids, opIds, load, has, toggle }
}

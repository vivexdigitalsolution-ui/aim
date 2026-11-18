/**
 * Keeps a page's filters in the address (so the address can be shared, and Back from a car returns to the same list)
 * and in this browser (so the filters are still there next time). Pages keep their own refs; this only connects them.
 *   const url = useUrlFilters('cars', { q, brand, yearFrom, maxRm, sort, pref }, { sort: 'closing' })
 *   url.restore()    once, before the first load: the address wins, then what was saved
 *   url.save()       after every change of a filter
 */
type Ref = { value: any }

export function useUrlFilters(storeKey: string, refs: Record<string, Ref>, defaults: Record<string, string | number> = {}) {
  const route = useRoute()
  const router = useRouter()
  const key = 'filters-' + storeKey
  const initial = Object.fromEntries(Object.keys(refs).map((k) => [k, refs[k]!.value]))
  const isDefault = (k: string, v: any) => v === null || v === undefined || v === '' || v === 0 || v === (defaults[k] ?? initial[k])
  const apply = (o: Record<string, any>) => {
    for (const k of Object.keys(refs)) {
      if (!(k in o)) continue
      const cur = initial[k]
      refs[k]!.value = typeof cur === 'number' ? Number(o[k]) || 0 : cur === null ? (o[k] === '' || o[k] == null ? null : Number(o[k]) || null) : String(o[k])
    }
  }
  function restore() {
    const q = route.query as Record<string, any>
    if (Object.keys(refs).some((k) => k in q)) { apply(q); return }       // an address with filters wins
    try { const s = localStorage.getItem(key); if (s) { apply(JSON.parse(s)); save() } } catch { /* private mode: no memory */ }
  }
  function save() {
    const out: Record<string, any> = {}
    for (const k of Object.keys(refs)) if (!isDefault(k, refs[k]!.value)) out[k] = refs[k]!.value
    try { localStorage.setItem(key, JSON.stringify(out)) } catch { /* private mode */ }
    router.replace({ query: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, String(v)])) })
  }
  return { restore, save }
}

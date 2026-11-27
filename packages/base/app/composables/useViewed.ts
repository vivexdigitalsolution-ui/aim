/**
 * The cars this user has opened (lite cars page: a "Viewed" badge, and the "Hide viewed" tick box). Kept in this browser, per signed-in user, no database.
 * An entry is forgotten after 14 days (the car has closed long before), and at most 1,500 are kept (the newest).
 */
export function useViewed() {
  const { user } = useAuth()
  const ids = useState<Record<string, number>>('viewed-ids', () => ({}))
  const loadedFor = useState<string>('viewed-for', () => '')
  const key = () => 'viewed-cars-' + (user.value?.id || 'none')
  function load() {
    if (!import.meta.client) return
    const k = key()
    if (loadedFor.value === k) return
    loadedFor.value = k
    try {
      const cutoff = Date.now() - 14 * 86400_000
      const raw = JSON.parse(localStorage.getItem(k) || '{}') as Record<string, number>
      ids.value = Object.fromEntries(Object.entries(raw).filter(([, t]) => Number(t) > cutoff))
    } catch { ids.value = {} }
  }
  function mark(id: string) {
    load()
    if (!id) return
    let next = { ...ids.value, [id]: Date.now() }
    const keys = Object.keys(next)
    if (keys.length > 1500) next = Object.fromEntries(Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, 1500))
    ids.value = next
    try { localStorage.setItem(key(), JSON.stringify(next)) } catch { /* private mode: only this visit remembers */ }
  }
  const has = (id: string) => !!ids.value[id]
  return { load, mark, has, ids }
}

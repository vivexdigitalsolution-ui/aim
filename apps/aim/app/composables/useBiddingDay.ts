/**
 * Today's bidding for the dashboards: the auction day is the Japan date, because the auctions run on Japan time.
 * - mode "today":  cars with a REAL closing time are still open: counts down (every second) to the last closing time of the day.
 * - mode "closed": every real closing time of today has passed (or the site gave none): it says Closed. The next day's countdown starts after 12:00 am Japan time
 *                  (11:00 pm Malaysia time), when it becomes "today"; `next` tells which day and how many cars.
 * A closing time of exactly 23:59 Japan time is a placeholder (the site had no time yet): it is ignored completely (no countdown, no car count, no venue row).
 * The page refreshes by itself: the clock ticks every second, the data reloads every minute and at once when the countdown ends or the Japan date changes.
 */
export interface DayVenue { name: string; cars: number; closesAt: string | null }
export interface UpcomingDay { date: string; cars: number; venues: { name: string; cars: number }[] }

export function useBiddingDay() {
  const db = useDb()
  const day = reactive({ mode: 'none' as 'today' | 'closed' | 'none', date: '', at: null as string | null, cars: 0, venues: [] as DayVenue[], next: null as { date: string; cars: number } | null })
  const upcoming = ref<UpcomingDay[]>([])      // the auction days after today: cars per venue (every open car, also those whose closing time is not known yet)
  const tick = ref(Date.now())
  const placeholder = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) === '23:59'
  const jstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  let loadedFor = ''

  async function loadUpcoming(todayJst: string) {
    const { data } = await db.from('lots').select('venue,auction_date').gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true).gt('auction_date', todayJst).order('auction_date').limit(5000)
    const days = new Map<string, Map<string, number>>()
    for (const r of (data || []) as any[]) { const d = days.get(r.auction_date) || days.set(r.auction_date, new Map()).get(r.auction_date)!; d.set(r.venue, (d.get(r.venue) || 0) + 1) }
    upcoming.value = [...days.entries()].slice(0, 5).map(([date, v]) => ({ date, cars: [...v.values()].reduce((a, b) => a + b, 0), venues: [...v.entries()].map(([name, cars]) => ({ name, cars })).sort((a, b) => b.cars - a.cars) }))
  }

  async function load() {
    const nowIso = new Date().toISOString(), todayJst = jstDate()
    loadedFor = todayJst
    loadUpcoming(todayJst).catch(() => {})
    // only cars with a REAL closing time count
    const realOn = async (date: string) => (((await db.from('lots').select('venue,bid_deadline').gt('bid_deadline', nowIso).eq('my_eligible', true).eq('auction_date', date).limit(3000)).data || []) as any[]).filter((r) => !placeholder(r.bid_deadline))
    const rows = await realOn(todayJst)
    if (rows.length) {
      const by = new Map<string, { cars: number; at: string | null }>()
      for (const r of rows) {
        const v = by.get(r.venue) || by.set(r.venue, { cars: 0, at: null }).get(r.venue)!
        v.cars++
        if (!v.at || r.bid_deadline > v.at) v.at = r.bid_deadline
      }
      const at = rows.map((r) => r.bid_deadline).sort().pop() || null
      Object.assign(day, { mode: 'today', date: todayJst, at, cars: rows.length, next: null, venues: [...by.entries()].map(([name, v]) => ({ name, cars: v.cars, closesAt: v.at })).sort((a, b) => b.cars - a.cars) })
      return
    }
    // nothing open today: Closed. Look up the next auction day only to tell which one comes.
    let next: { date: string; cars: number } | null = null
    const nxt = await db.from('lots').select('auction_date').gt('bid_deadline', nowIso).eq('my_eligible', true).gt('auction_date', todayJst).order('auction_date').limit(3000)
    const dates = [...new Set(((nxt.data || []) as any[]).map((r) => r.auction_date as string))].slice(0, 5)
    for (const d of dates) { const r = await realOn(d); if (r.length) { next = { date: d, cars: r.length }; break } }
    Object.assign(day, { mode: 'closed', date: todayJst, at: null, cars: 0, venues: [], next })
  }

  /** "03:12:44" (with days when more than a day) */
  const countdown = (nowMs: number) => {
    if (!day.at) return ''
    const s = Math.max(0, Math.floor((new Date(day.at).getTime() - nowMs) / 1000))
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
    const p = (n: number) => String(n).padStart(2, '0')
    return (d ? d + 'd ' : '') + `${p(h)}:${p(m)}:${p(x)}`
  }
  const myt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }) : '—')
  const label = (d: string) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }) : '')
  const dateLabel = computed(() => label(day.date))
  const nextLabel = computed(() => (day.next ? label(day.next.date) : ''))

  // the clock ticks every second; the data reloads every minute, when the countdown reaches zero, and when the Japan date changes (12:00 am Japan time)
  let timer: ReturnType<typeof setInterval> | null = null
  let n = 0
  onMounted(() => {
    timer = setInterval(() => {
      tick.value = Date.now()
      n++
      const ended = day.mode === 'today' && day.at && Date.now() >= new Date(day.at).getTime()
      if (ended || jstDate() !== loadedFor || n % 60 === 0) load().catch(() => {})
    }, 1000)
  })
  onBeforeUnmount(() => { if (timer) clearInterval(timer) })
  return { day, load, countdown, myt, dateLabel, nextLabel, tick, upcoming, label }
}

/**
 * Today's bidding for the dashboards: the auction day is the Japan date, because the auctions run on Japan time.
 * It counts down to the END of today's bidding (the last closing time of any car, over all venues) and lists the venues of that day.
 * When every car of today has closed it shows the next auction day instead.
 * A closing time of exactly 23:59 Japan time is a placeholder (the site had no time yet), so it never decides the countdown while a real time exists.
 */
export interface DayVenue { name: string; cars: number; closesAt: string | null }

export function useBiddingDay() {
  const db = useDb()
  const day = reactive({ mode: 'none' as 'today' | 'later' | 'none', date: '', at: null as string | null, cars: 0, venues: [] as DayVenue[] })
  const placeholder = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) === '23:59'

  async function load() {
    const nowIso = new Date().toISOString()
    const todayJst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const open = () => db.from('lots').select('venue,bid_deadline').gt('bid_deadline', nowIso).eq('my_eligible', true)
    let mode: 'today' | 'later' = 'today', date = todayJst
    let rows: any[] = (await open().eq('auction_date', todayJst).limit(3000)).data || []
    if (!rows.length) {
      const next = await db.from('lots').select('auction_date').gt('bid_deadline', nowIso).eq('my_eligible', true).gt('auction_date', todayJst).order('auction_date').limit(1)
      if (next.data?.length) { mode = 'later'; date = next.data[0]!.auction_date; rows = (await open().eq('auction_date', date).limit(3000)).data || [] }
    }
    if (!rows.length) { Object.assign(day, { mode: 'none', date: '', at: null, cars: 0, venues: [] }); return }
    const real = rows.filter((r) => !placeholder(r.bid_deadline))
    const by = new Map<string, { cars: number; at: string | null }>()
    for (const r of rows) {
      const v = by.get(r.venue) || by.set(r.venue, { cars: 0, at: null }).get(r.venue)!
      v.cars++
      if (!placeholder(r.bid_deadline) && (!v.at || r.bid_deadline > v.at)) v.at = r.bid_deadline
    }
    const at = (real.length ? real : rows).map((r) => r.bid_deadline).sort().pop() || null
    Object.assign(day, { mode, date, at, cars: rows.length, venues: [...by.entries()].map(([name, v]) => ({ name, cars: v.cars, closesAt: v.at })).sort((a, b) => b.cars - a.cars) })
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
  const dateLabel = computed(() => (day.date ? new Date(day.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''))
  return { day, load, countdown, myt, dateLabel }
}

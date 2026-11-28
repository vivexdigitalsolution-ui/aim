/**
 * Today's bidding for the dashboards: the auction day is the Japan date, because the auctions run on Japan time.
 * - mode "today":  cars with a REAL closing time are still open: counts down (every second) to the last closing time of the day.
 * - mode "closed": every real closing time of today has passed (or the site gave none): it says Closed. The next day's countdown starts after 12:00 am Japan time
 *                  (11:00 pm Malaysia time), when it becomes "today"; `next` tells which day and how many cars.
 * A closing time of exactly 23:59 Japan time is a placeholder (the site had no time yet): it is ignored completely (no countdown, no car count, no venue row).
 * The page refreshes by itself: the clock ticks every second, the data reloads every minute and at once when the countdown ends or the Japan date changes.
 */
// One price rows name their venue in Japanese, bidding rows in English
const VENUE_EN: Record<string, string> = {
  東京: 'Tokyo', 横浜: 'Yokohama', 名古屋: 'Nagoya', '名古屋＆北陸': 'Nagoya＆Hokuriku', 北陸: 'Hokuriku', 大阪: 'Osaka', 札幌: 'Sapporo', 新潟: 'Niigata', 東北: 'Tohoku', 神戸: 'Kobe', 福岡: 'Fukuoka',
  九州: 'Kyushu', 静岡: 'Shizuoka', 岡山: 'Okayama', 群馬: 'Gunma', 四国: 'Shikoku', 埼玉: 'Saitama', 'R-名古屋': 'R-Nagoya', 'HAA神戸': 'HAA Kobe',
}

/**
 * The coming auction days, each venue with its bidding cars and its open One price cars. A One price offer has no auction day of its own:
 * it ends before the venue's auction, so it goes to that venue's first auction day on or after the day it ends (Japan date).
 * A venue with no bidding car listed goes to the day after its offers end.
 */
export function comingDays(bids: { venue: string; auction_date: string }[], offers: { venue: string; deadline: string }[]): UpcomingDay[] {
  const days = new Map<string, Map<string, { cars: number; one: number }>>()
  const at = (date: string, venue: string) => {
    const d = days.get(date) || days.set(date, new Map()).get(date)!
    return d.get(venue) || d.set(venue, { cars: 0, one: 0 }).get(venue)!
  }
  const auctions = new Map<string, Set<string>>()
  for (const r of bids) { at(r.auction_date, r.venue).cars++; (auctions.get(r.venue) || auctions.set(r.venue, new Set()).get(r.venue)!).add(r.auction_date) }
  for (const o of offers) {
    const venue = VENUE_EN[o.venue] || o.venue
    const ends = new Date(new Date(o.deadline).getTime() + 9 * 3600_000).toISOString().slice(0, 10)
    const next = [...(auctions.get(venue) || [])].sort().find((d) => d >= ends)
    at(next || new Date(new Date(ends + 'T00:00:00Z').getTime() + 86400_000).toISOString().slice(0, 10), venue).one++
  }
  return [...days.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => {
    const venues = [...v.entries()].map(([name, n]) => ({ name, ...n })).sort((a, b) => b.cars + b.one - (a.cars + a.one))
    return { date, cars: venues.reduce((a, x) => a + x.cars, 0), one: venues.reduce((a, x) => a + x.one, 0), venues }
  })
}

export interface DayVenue { name: string; cars: number; closesAt: string | null }
export interface UpcomingDay { date: string; cars: number; one: number; venues: { name: string; cars: number; one: number }[] }

/** opts.onePrice: the coming days also carry each venue's open USS One price cars (the staff dashboard). */
export function useBiddingDay(opts: { onePrice?: boolean } = {}) {
  const db = useDb()
  const day = reactive({ mode: 'none' as 'today' | 'closed' | 'none', date: '', at: null as string | null, cars: 0, venues: [] as DayVenue[], next: null as { date: string; cars: number } | null })
  const upcoming = ref<UpcomingDay[]>([])      // the auction days after today: cars per venue (every open car, also those whose closing time is not known yet)
  const tick = ref(Date.now())
  const placeholder = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) === '23:59'
  const jstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
  let loadedFor = ''

  // the database answers 1,000 rows at most, however many are asked for: read on until a short answer
  async function every(query: () => any): Promise<any[]> {
    const out: any[] = []
    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await query().order('id').range(from, from + 999)
      if (error) throw error
      out.push(...(data || []))
      if ((data || []).length < 1000) break
    }
    return out
  }

  async function loadUpcoming(todayJst: string) {
    const nowIso = new Date().toISOString()
    const [bids, offers] = await Promise.all([
      every(() => db.from('lots').select('venue,auction_date').gt('bid_deadline', nowIso).eq('my_eligible', true).gt('auction_date', todayJst)),
      opts.onePrice ? every(() => db.from('one_price_lots').select('venue,deadline').eq('source', 'uss').gt('deadline', nowIso)) : Promise.resolve([] as any[]),
    ])
    upcoming.value = comingDays(bids, offers).slice(0, 5)
  }

  async function load() {
    const nowIso = new Date().toISOString(), todayJst = jstDate()
    loadedFor = todayJst
    loadUpcoming(todayJst).catch(() => {})
    // only cars with a REAL closing time count
    const realOn = async (date: string) => (await every(() => db.from('lots').select('venue,bid_deadline').gt('bid_deadline', nowIso).eq('my_eligible', true).eq('auction_date', date))).filter((r) => !placeholder(r.bid_deadline))
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
    const nxt = await every(() => db.from('lots').select('auction_date').gt('bid_deadline', nowIso).eq('my_eligible', true).gt('auction_date', todayJst))
    const dates = [...new Set(nxt.map((r) => r.auction_date as string))].sort().slice(0, 5)
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

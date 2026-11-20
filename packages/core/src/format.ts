// All times the AP holders see are Malaysia time, whatever the phone's own time zone is.
export const MYT = 'Asia/Kuala_Lumpur'

export const fmtJpy = (n: unknown) => (n === null || n === undefined || n === '' ? '—' : '¥' + Math.round(Number(n)).toLocaleString('en-US'))
export const fmtNum = (n: unknown, unit = '') => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US') + unit)

const mytFull = new Intl.DateTimeFormat('en-GB', { timeZone: MYT, weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const mytDateTime = new Intl.DateTimeFormat('en-GB', { timeZone: MYT, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })

/** "Tue 05 Nov, 13:34" in Malaysia time */
export const fmtMyt = (iso?: string | null) => (iso ? mytFull.format(new Date(iso)).replace(',', '') : '—')
/** "05 Nov 2026, 13:34" in Malaysia time */
export const fmtMytDateTime = (iso?: string | null) => (iso ? mytDateTime.format(new Date(iso)) : '—')
/** An auction date such as "2026-11-05" -> "Thu 05 Nov 2026" (a plain calendar date, no time zone shift) */
export const fmtDay = (d?: string | null) => (d ? dayFmt.format(new Date(d + 'T00:00:00Z')) : '—')

export function timeLeft(iso: string | null | undefined, nowMs: number): { label: string; cls: 'ok' | 'soon' | 'late' | 'closed' } {
  if (!iso) return { label: '—', cls: 'ok' }
  const diff = new Date(iso).getTime() - nowMs
  if (diff <= 0) return { label: 'Closed', cls: 'closed' }
  const mins = Math.floor(diff / 60000)
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60
  const label = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  return { label, cls: mins < 60 ? 'late' : mins < 360 ? 'soon' : 'ok' }
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for us', placed: 'Bid placed', won: 'Won', lost: 'Lost', cancelled: 'Cancelled', rejected: 'Not accepted',
}

// ── closing times ──
// The auction site gives no closing time for some cars yet (it shows it the day before or on the day). The scraper then stores 23:59 Japan time as a
// PLACEHOLDER. A placeholder is not a real deadline: it must never be shown as a countdown.
const jstClock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false })
const mytClock = new Intl.DateTimeFormat('en-GB', { timeZone: MYT, hour: '2-digit', minute: '2-digit', hour12: false })
const jstDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', day: 'numeric', month: 'short' })
export const isPlaceholderDeadline = (iso?: string | null) => !!iso && jstClock.format(new Date(iso)) === '23:59'

/** What a card says about the closing time: its OWN countdown, or "time TBA" while the site has not published the time. */
export function closesInfo(iso: string | null | undefined, nowMs: number): { text: string; cls: 'ok' | 'soon' | 'late' | 'closed' | 'unknown'; exact: boolean } {
  if (!iso) return { text: '—', cls: 'unknown', exact: false }
  if (isPlaceholderDeadline(iso)) {
    if (new Date(iso).getTime() <= nowMs) return { text: 'Closed', cls: 'closed', exact: false }
    return { text: `closes ${jstDay.format(new Date(iso))} · time TBA`, cls: 'unknown', exact: false }
  }
  const t = timeLeft(iso, nowMs)
  return { text: t.cls === 'closed' ? 'Closed' : `closes in ${t.label}`, cls: t.cls, exact: true }
}
/** The closing time of a car for its page: "14:25 JST · 13:25 MYT", or a plain "not announced yet". */
export const closingTimeText = (iso?: string | null) => (!iso ? '' : isPlaceholderDeadline(iso) ? 'closing time not announced yet' : `${jstClock.format(new Date(iso))} JST · ${mytClock.format(new Date(iso))} MYT`)

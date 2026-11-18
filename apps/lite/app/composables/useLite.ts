import { BID_STEP } from '@aim/core'

/** Prices in RM: the yen rate comes from the server (one number), everything else is maths in the browser. */
export function useLite() {
  const db = useDb()
  const rate = useState<number>('lite-rate', () => 0)
  async function loadRate() {
    if (rate.value > 0) return
    const { data, error } = await db.rpc('lite_jpy_rate')
    if (error) throw error
    rate.value = Number(data) || 0
  }
  const rm = (jpy: number | null | undefined) => (jpy && rate.value > 0 ? 'RM ' + Math.round(jpy * rate.value).toLocaleString('en-US') : '—')
  const yen = (n: number | null | undefined) => (n == null ? '—' : '¥' + Math.round(n).toLocaleString('en-US'))
  /** A bid typed in RM, as yen in the auction's ¥5,000 steps (rounded DOWN: never more than the dealer typed). */
  const rmToBidJpy = (myr: number) => (rate.value > 0 && myr > 0 ? Math.floor(myr / rate.value / BID_STEP) * BID_STEP : 0)
  const left = (iso: string, nowMs: number) => {
    const m = Math.round((new Date(iso).getTime() - nowMs) / 60000)
    if (m <= 0) return 'closed'
    return m >= 1440 ? Math.floor(m / 1440) + 'd ' + Math.floor((m % 1440) / 60) + 'h' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'
  }
  /** The currency the cars are shown in (RM or yen), remembered in this browser. */
  const cur = useState<'RM' | 'JPY'>('lite-cur', () => 'RM')
  function loadCur() { try { const c = localStorage.getItem('cars-currency'); if (c === 'RM' || c === 'JPY') cur.value = c } catch { /* private mode */ } }
  function setCur(c: 'RM' | 'JPY') { cur.value = c; try { localStorage.setItem('cars-currency', c) } catch { /* private mode */ } }
  /** A car's starting price in the chosen currency; a car with no starting price says so. */
  const money = (jpy: number | null | undefined) => (!(jpy && jpy > 0) ? 'Price at auction' : cur.value === 'JPY' ? yen(jpy) : rm(jpy))
  return { rate, loadRate, rm, yen, rmToBidJpy, left, cur, loadCur, setCur, money }
}

/** The yen rate (RM per ¥1) for staff screens: the Offer report's manual rate if set, else the latest stored rate. Loaded once. */
export function useRate() {
  const db = useDb()
  const rate = useState<number>('staff-rate', () => 0)
  async function loadRate() {
    if (rate.value > 0) return
    const p = await db.from('calc_presets').select('amount').eq('preset_key', 'fx_jpy_myr').maybeSingle()
    let v = Number(p.data?.amount)
    if (!(v > 0)) {
      const r = await db.from('currency_rates').select('rate').eq('from_currency', 'JPY').eq('to_currency', 'MYR').order('rate_date', { ascending: false }).limit(1).maybeSingle()
      v = Number(r.data?.rate)
    }
    rate.value = v > 0 ? v : 0
  }
  const rm = (jpy: number | null | undefined) => (jpy && rate.value > 0 ? 'RM ' + Math.round(Number(jpy) * rate.value).toLocaleString('en-US') : '')
  return { rate, loadRate, rm }
}

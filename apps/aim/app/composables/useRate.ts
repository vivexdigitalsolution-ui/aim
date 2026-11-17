/** The yen rate (RM per ¥1) for every signed-in user: the Offer report's manual rate if staff set one, else the latest stored rate. One number from the server; loaded once. */
export function useRate() {
  const db = useDb()
  const rate = useState<number>('staff-rate', () => 0)
  async function loadRate() {
    if (rate.value > 0) return
    const { data, error } = await db.rpc('lite_jpy_rate')
    if (error) throw error
    rate.value = Number(data) > 0 ? Number(data) : 0
  }
  const rm = (jpy: number | null | undefined) => (jpy && rate.value > 0 ? 'RM ' + Math.round(Number(jpy) * rate.value).toLocaleString('en-US') : '')
  return { rate, loadRate, rm }
}

import type { Docket, DutyRate } from '@aim/core'

export interface Reference {
  dockets: Docket[]; rates: DutyRate[]
  currencies: { code: string; standard_fare_myr: number | null }[]
  fx: Record<string, { rate: number } | undefined>   // docket currency -> MYR per single unit, latest
}
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** Reference data for the duty maths (staff only): ~2,500 dockets, loaded once per visit; everything else is calculated in the browser. */
export function useReference() {
  const db = useDb()
  const data = useState<Reference | null>('reference', () => null)

  async function all(table: string, cols: string, order: string) {
    const out: any[] = []
    for (let from = 0; ; from += 1000) {
      const { data: rows, error } = await db.from(table).select(cols).order(order).range(from, from + 999)
      if (error) throw error
      out.push(...(rows || []))
      if ((rows || []).length < 1000) break
    }
    return out
  }

  async function load(force = false): Promise<Reference> {
    if (data.value && !force) return data.value
    const [dockets, rates, currencies, fxRows] = await Promise.all([
      all('custom_dockets', 'id,brand,model,cc,currency_code,bil,year,amt_12m_24m,amt_24m_36m,amt_36m_48m,amt_48m_60m,amt_60m_plus', 'id'),
      all('duty_rates', 'vehicle_type,cc_min,cc_max,multiplier,is_active', 'id'),
      all('currencies', 'code,standard_fare_myr', 'code'),
      db.from('currency_rates').select('from_currency,rate,rate_date').eq('to_currency', 'MYR').order('rate_date', { ascending: false }).limit(200).then((r) => r.data || []),
    ])
    const fx: Reference['fx'] = {}
    for (const r of fxRows as any[]) if (!fx[r.from_currency]) fx[r.from_currency] = { rate: Number(r.rate) }
    data.value = {
      dockets: dockets.map((d) => ({ ...d, amt_12m_24m: n(d.amt_12m_24m), amt_24m_36m: n(d.amt_24m_36m), amt_36m_48m: n(d.amt_36m_48m), amt_48m_60m: n(d.amt_48m_60m), amt_60m_plus: n(d.amt_60m_plus) })),
      rates: rates.map((r) => ({ ...r, multiplier: Number(r.multiplier) })), currencies, fx,
    }
    return data.value
  }
  return { data, load }
}

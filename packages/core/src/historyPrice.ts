// The history price on the offer report: the average of the sold prices of the SAME grade in the history window.
//   target 4.5A  -> every 4.5A sale; if there is none -> the sales of 4.5B, 5A and 5B together (same grade other interior, and one grade up)
//   no sale at all -> null (the report shows "–")
// Only sales of the same model code count when both sides have one.

export interface HistorySale { grade: string | null; price: number; model_code?: string | null }
export interface HistoryResult { price: number; n: number; basis: string }

const LADDER = ['3', '3.5', '4', '4.5', '5', '6', 'S']

export function gradeParts(g: string | null | undefined): { main: string; letter: string } | null {
  const m = String(g || '').trim().toUpperCase().match(/^(\d+(?:\.\d+)?|[A-Z]{1,2}?)\s*([A-D])?$/)
  return m ? { main: m[1], letter: m[2] || '' } : null
}

const core = (c: string | null | undefined) => String(c || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')
// the average is rounded UP to the next ¥5,000: a bid in the auction moves in ¥5,000 steps
export const BID_STEP = 5000
const avg = (v: number[]) => Math.ceil(v.reduce((a, b) => a + b, 0) / v.length / BID_STEP) * BID_STEP

export function historyPrice(sales: HistorySale[], grade: string | null, modelCode?: string | null): HistoryResult | null {
  const t = gradeParts(grade)
  if (!t) return null
  const code = core(modelCode)
  const rows = sales.filter((s) => s.price > 0 && !(code && s.model_code && core(s.model_code) !== code))
  const parts = rows.map((s) => ({ s, g: gradeParts(s.grade) })).filter((x) => x.g) as { s: HistorySale; g: { main: string; letter: string } }[]

  const exact = parts.filter((x) => x.g.main === t.main && x.g.letter === t.letter)
  if (exact.length) return { price: avg(exact.map((x) => x.s.price)), n: exact.length, basis: t.main + t.letter }

  const up = LADDER[LADDER.indexOf(t.main) + 1]
  const near = parts.filter((x) => (x.g.main === t.main || x.g.main === up) && ['A', 'B'].includes(x.g.letter) && !(x.g.main === t.main && x.g.letter === t.letter))
  if (!near.length) return null
  const basis = [...new Set(near.map((x) => x.g.main + x.g.letter))].sort().join(' / ')
  return { price: avg(near.map((x) => x.s.price)), n: near.length, basis }
}

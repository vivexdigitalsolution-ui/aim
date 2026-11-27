/** Engine size in litres, one decimal: 3456 -> "3.5", 1998 -> "2.0", 660 -> "0.7". null when the size is not known. */
export function ccLitres(cc: number | null | undefined): string | null {
  return cc && cc > 0 ? (Math.round(cc / 100) / 10).toFixed(1) : null
}
/** Gearbox in brackets: AT -> "(AT)", MT -> "(MT)". null when unknown. */
export function transShort(t: string | null | undefined): string | null {
  const s = String(t || '').trim().toUpperCase()
  return s ? '(' + s + ')' : null
}
/** Card title (aim and lite): "LEXUS RX F SPORT 2.5 (AT)" */
export function carTitle(c: { brand?: string | null; model?: string | null; engine_cc?: number | null; transmission?: string | null }): string {
  return [c.brand, c.model, ccLitres(c.engine_cc), transShort(c.transmission)].filter(Boolean).join(' ')
}

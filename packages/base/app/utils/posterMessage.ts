// The WhatsApp message that goes with the poster (ported from CarzNexus). It is written from an editable TEMPLATE: words in {{double braces}} are replaced with the
// car's data, everything else is plain text. A line whose {{...}} values are all empty is left out; on a line of parts joined by " · " the empty parts are dropped.
// {{spec}} becomes the selling points as a list of "✅ ..." lines. The template is remembered in this browser; "Reset" brings the default back.
import type { PosterCar } from './lotPoster'

export const DEFAULT_TEMPLATE = `*🔥 {{title}}*
*Grade: {{grade}} · Mileage: {{mileage}}*
*Colour: {{colour}}*

*Car spec:*
{{spec}}

*🔥 Price: {{price}}*
*Contact: {{phone}}*`

export const PLACEHOLDERS = ['title', 'year', 'grade', 'mileage', 'colour', 'transmission', 'model_code', 'engine', 'lot', 'spec', 'price', 'market_price', 'save', 'phone']

const STORE_KEY = 'lite.poster.whatsappTemplate'
export function loadTemplate(): string { try { return localStorage.getItem(STORE_KEY) || DEFAULT_TEMPLATE } catch { return DEFAULT_TEMPLATE } }
export function saveTemplate(t: string) { try { if (t.trim() && t !== DEFAULT_TEMPLATE) localStorage.setItem(STORE_KEY, t); else localStorage.removeItem(STORE_KEY) } catch { /* storage blocked */ } }

const up = (s: unknown) => String(s ?? '').trim().toUpperCase()
const rm = (n: number) => `RM ${Math.round(n).toLocaleString('en-MY')}`
const bold = (s: string) => `*${s}*`

// "A, B, C and D." -> ['A', 'B', 'C', 'D']
function splitPoints(text: string | null | undefined, max = 12): string[] {
  if (!text) return []
  const parts = text.replace(/\s*\n+\s*/g, ', ').replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '').split(/\s*,\s*/).map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return []
  const last = parts.pop() as string
  const items = [...parts, ...last.replace(/^and\s+/i, '').split(/\s+and\s+/i)].map((p) => p.replace(/^(featuring|with)\s+/i, '').trim()).filter(Boolean)
  return items.slice(0, max).map((p) => p.charAt(0).toUpperCase() + p.slice(1))
}

export function messageVars(d: PosterCar, o: { note?: string; marketPrice?: number | null; postingPrice?: number | null; phone?: string; kind: 'b2c' | 'b2b' }): Record<string, string> {
  const our = o.postingPrice && o.postingPrice > 0 ? o.postingPrice : null
  const market = o.kind === 'b2b' ? null : o.marketPrice && our && o.marketPrice > our ? o.marketPrice : null
  const spec = splitPoints(o.note).map((p) => bold(`✅ ${p}`)).join('\n')
  return {
    title: up(d.title),
    year: d.mfgYear ? String(d.mfgYear) : '',
    grade: up(d.grade),
    mileage: d.mileageKm != null ? `${Number(d.mileageKm).toLocaleString('en-MY')} KM` : '',
    colour: up(d.color),
    transmission: [up(d.transmission), up(d.drive)].filter(Boolean).join(' / '),
    model_code: up(d.modelCode),
    engine: [d.engineCc ? `${Number((d.engineCc / 1000).toFixed(2))}L` : '', up(d.fuel)].filter(Boolean).join(' / '),
    lot: d.lotRef ? up(d.lotRef) : '',
    spec,
    price: our ? rm(our) : '',
    market_price: market ? rm(market) : '',
    save: market && our ? rm(market - our) : '',
    phone: (o.phone ?? '').trim(),
  }
}

export function buildMessage(template: string, vars: Record<string, string>): string {
  const re = /\{\{\s*([a-z_]+)\s*\}\}/gi
  const out: string[] = []
  for (const line of template.replace(/\r\n/g, '\n').split('\n')) {
    const names = [...line.matchAll(re)].map((m) => m[1]!.toLowerCase())
    if (!names.length) { out.push(line); continue }
    const fill = (seg: string) => seg.replace(re, (_m, n: string) => vars[n.toLowerCase()] ?? '')
    const hasBold = line.trim().startsWith('*') && line.trim().endsWith('*') && line.trim().length > 2
    const inner = hasBold ? line.trim().slice(1, -1) : line
    const segs = inner.split(' · ').filter((seg) => {
      const n = [...seg.matchAll(re)].map((m) => m[1]!.toLowerCase())
      return !n.length || n.some((x) => (vars[x] ?? '') !== '')
    }).map(fill)
    if (!segs.length || segs.every((x) => !x.trim())) continue
    if (names.includes('spec')) { out.push(...fill(inner).split('\n')); continue }
    const text = segs.join(' · ')
    out.push(hasBold ? bold(text) : text)
  }
  const lines = vars.spec ? out : out.filter((l) => !/^\*?\s*car spec\s*:?\s*\*?$/i.test(l.trim()))
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

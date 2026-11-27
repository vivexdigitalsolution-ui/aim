// The car "poster" (a promo slide for WhatsApp / social media) of one auction car, drawn on a canvas so the same picture can be saved as a JPG, copied or printed to PDF.
// Ported from CarzNexus (Nexus > Sourcing > Recon > Poster); the colours are PAW-J blue here (the ACCENT constants below).
//
//   title    year brand model (the page's own title)          photos   3 x 3 grid: the cover takes columns 1-2 / rows 1-2, five more fill the rest
//   specs    year, mileage, engine / fuel, transmission / drive, colour, lot
//   note     selling points (typed)                              price    A Slide: MARKET PRICE struck through, then OUR PRICE with the saving; B Slide: one SELLING PRICE
//   footer   one option: show the PAW-J footer with the phone / WhatsApp number

export interface PosterCar {
  title: string                 // e.g. LEXUS NX350H F SPORT 2.5 (A) 2025
  photos: string[]              // up to 6 (the first is the big cover)
  grade?: string | null
  modelCode?: string | null
  mfgYear?: number | null
  mileageKm?: number | null
  engineCc?: number | null
  fuel?: string | null
  transmission?: string | null
  drive?: string | null
  color?: string | null
  lotRef?: string | null        // shown as LOT in the spec grid
}

export interface PosterOptions {
  kind: 'b2c' | 'b2b'           // 'b2c' = A Slide (customer: market price, our price, saving, footer); 'b2b' = B Slide (broker: one selling price, no footer)
  footer: boolean               // the PAW-J footer with the phone number
  note?: string                 // selling points, shown above the price
  marketPrice?: number | null   // RM, struck through on the A Slide when it is higher than the posting price
  postingPrice?: number | null  // RM, the price on the poster
  phone?: string                // WhatsApp / phone number shown in the footer
}

const SITE = 'www.paw-j.com', COMPANY = 'PAW-J'
const W = 1080, PAD = 40, GAP = 10
const CELL_W = (W - 2 * PAD - 2 * GAP) / 3
const CELL_H = 245
const GRID_H = 3 * CELL_H + 2 * GAP
const ACCENT = '#3b8cf5', ACCENT_DARK = '#1f4f9a', INK = '#0a111a', PANEL = '#101b27', MUTED = '#9aa7b4'
const BOX_1 = '#4c97f7', BOX_2 = '#2268b8', BOX_3 = '#164a8a'
const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif'

const rm = (n: number) => `RM ${Math.round(n).toLocaleString('en-MY')}`
const up = (s: unknown) => String(s ?? '').trim().toUpperCase()

// the photos live on another address that allows reading them (CORS): fetched as a blob, so the canvas stays clean and can be saved
async function loadImage(src: string | null): Promise<HTMLImageElement | null> {
  if (!src) return null
  try {
    const res = await fetch(src, { mode: 'cors' })
    if (!res.ok) return null
    const url = URL.createObjectURL(await res.blob())
    return await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = url
    })
  } catch { return null }
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: string, max: number, min: number, width: number): number {
  let size = max
  for (; size > min; size -= 2) { ctx.font = `${weight} ${size}px ${FONT}`; if (ctx.measureText(text).width <= width) break }
  ctx.font = `${weight} ${size}px ${FONT}`
  return size
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w
    if (ctx.measureText(t).width <= width || !cur) cur = t
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  if (lines.length > maxLines) { const keep = lines.slice(0, maxLines); keep[maxLines - 1] += '…'; return keep }
  return lines
}

function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height)
  const dw = img.width * s, dh = img.height * s
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

// cells in drawing order: cover, c3r1, c3r2, c1r3, c2r3, c3r3  ->  photo numbers 1, 2, 4, 3, 6, 5
const CELL_PHOTO = [0, 1, 3, 2, 5, 4]

export async function renderPoster(d: PosterCar, opts: PosterOptions): Promise<HTMLCanvasElement> {
  const b2b = opts.kind === 'b2b'
  const footer = !b2b && opts.footer
  const pics = await Promise.all(CELL_PHOTO.map((i) => loadImage(d.photos[i] || null)))

  // ── text ──
  const title = up(d.title) || 'CAR FOR SALE'
  const subtitle = up([d.drive, d.transmission].filter(Boolean).join(' / '))
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `800 56px ${FONT}`
  let titleLines = wrapLines(measure, title, W - 2 * PAD, 2)
  let titleSize = 0                                         // 0 = one line, fitted below
  if (measure.measureText(title).width > W - 2 * PAD) {
    for (titleSize = 52; titleSize >= 34; titleSize -= 2) {
      measure.font = `800 ${titleSize}px ${FONT}`
      const l = wrapLines(measure, title, W - 2 * PAD, 3)
      if (l.length <= 2 || titleSize === 34) { titleLines = wrapLines(measure, title, W - 2 * PAD, 2); break }
    }
  } else titleLines = [title]
  measure.font = `500 24px ${FONT}`
  const noteLines = opts.note?.trim() ? wrapLines(measure, opts.note.trim().replace(/\s*\n+\s*/g, '  •  '), W - 2 * PAD - 52, 3) : []
  const NOTE_H = noteLines.length ? 64 + noteLines.length * 32 : 0

  // ── layout (top to bottom) ──
  const FOOTER_H = footer ? 150 : 0
  const TITLE_H = 90 + (titleLines.length > 1 ? titleSize + 14 : 0) + 96
  const topPad = 30
  const gridTop = topPad + TITLE_H
  const infoTop = gridTop + GRID_H + 14
  const specTop = infoTop + 50
  const specH = 2 * 74
  const noteTop = specTop + specH + 22
  const priceTop = noteTop + (NOTE_H ? NOTE_H + 16 : 0)
  const PRICE_H = 190
  const footTop = priceTop + PRICE_H + 22
  const H = footTop + FOOTER_H + (footer ? 0 : 8)

  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.textBaseline = 'alphabetic'

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0a121b'); bg.addColorStop(1, '#0e1a27')
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

  // ── title block ──
  let y = topPad
  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED; ctx.font = `600 20px ${FONT}`
  ctx.letterSpacing = '5px'
  ctx.fillText('PREMIUM IMPORTED VEHICLES', PAD, y + 48)
  ctx.letterSpacing = '0px'
  y += 56
  const tg = ctx.createLinearGradient(0, y, 0, y + 70)
  tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#b9c2cc')
  ctx.fillStyle = tg
  if (titleLines.length === 1) {
    fitFont(ctx, titleLines[0]!, '800', 72, 40, W - 2 * PAD)
    ctx.fillText(titleLines[0]!, PAD, y + 62); y += 78
  } else {
    ctx.font = `800 ${titleSize}px ${FONT}`
    titleLines.forEach((l, i) => ctx.fillText(l, PAD, y + 54 + i * (titleSize + 10))); y += 54 + (titleSize + 10) * (titleLines.length - 1) + 16
  }
  ctx.fillStyle = '#d7dee6'; ctx.font = `500 30px ${FONT}`
  if (subtitle) ctx.fillText(subtitle, PAD, y + 28)
  ctx.fillStyle = ACCENT; ctx.fillRect(PAD, y + 48, W - 2 * PAD, 2)

  // ── photo grid ──
  const cell = (c: number, r: number, cs = 1, rs = 1) => ({
    x: PAD + c * (CELL_W + GAP), y: gridTop + r * (CELL_H + GAP),
    w: cs * CELL_W + (cs - 1) * GAP, h: rs * CELL_H + (rs - 1) * GAP,
  })
  const slots = [cell(0, 0, 2, 2), cell(2, 0), cell(2, 1), cell(0, 2), cell(1, 2), cell(2, 2)]
  slots.forEach((s, i) => {
    ctx.fillStyle = PANEL; ctx.fillRect(s.x, s.y, s.w, s.h)
    const img = pics[i]
    if (img) drawContain(ctx, img, s.x + 6, s.y + 6, s.w - 12, s.h - 12)
    ctx.strokeStyle = ACCENT_DARK; ctx.lineWidth = 2; ctx.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2)
  })

  // ── grade / model code | updated ──
  ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = `700 21px ${FONT}`
  const gradeLine = [d.grade ? `LISTED GRADE ${up(d.grade)}` : '', d.modelCode ? up(d.modelCode) : ''].filter(Boolean).join('   |   ')
  if (gradeLine) ctx.fillText(gradeLine, PAD, infoTop + 26)
  ctx.textAlign = 'right'; ctx.fillStyle = MUTED; ctx.font = `500 20px ${FONT}`
  ctx.fillText(`UPDATED: ${up(new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }))}`, W - PAD, infoTop + 26)

  // ── spec grid (3 x 2) ──
  const engine = d.engineCc ? `${Number((d.engineCc / 1000).toFixed(2))}L` : ''
  const specs: [string, string][] = [
    ['REGISTRATION YEAR', d.mfgYear ? String(d.mfgYear) : '—'],
    ['LISTED MILEAGE', d.mileageKm != null ? `~${Number(d.mileageKm).toLocaleString('en-MY')} km` : '—'],
    ['ENGINE / FUEL', [engine, up(d.fuel)].filter(Boolean).join(' / ') || '—'],
    ['TRANSMISSION / DRIVE', [up(d.transmission), up(d.drive)].filter(Boolean).join(' / ') || '—'],
    ['COLOUR', up(d.color) || '—'],
    ['LOT', d.lotRef ? up(d.lotRef) : '—'],
  ]
  const sw = (W - 2 * PAD) / 3
  ctx.strokeStyle = ACCENT_DARK; ctx.lineWidth = 2; ctx.strokeRect(PAD + 1, specTop + 1, W - 2 * PAD - 2, specH - 2)
  specs.forEach(([k, v], i) => {
    const cx = PAD + (i % 3) * sw, cy = specTop + Math.floor(i / 3) * 74
    if (i % 3) { ctx.fillStyle = ACCENT_DARK; ctx.fillRect(cx, specTop, 2, specH) }
    if (i >= 3) { ctx.fillStyle = ACCENT_DARK; ctx.fillRect(PAD, specTop + 74, W - 2 * PAD, 2) }
    ctx.textAlign = 'left'; ctx.fillStyle = MUTED; ctx.font = `600 15px ${FONT}`; ctx.letterSpacing = '1px'
    ctx.fillText(k, cx + 22, cy + 28); ctx.letterSpacing = '0px'
    ctx.fillStyle = '#fff'; fitFont(ctx, v, '700', 29, 18, sw - 40)
    ctx.fillText(v, cx + 22, cy + 58)
  })

  // ── selling point note ──
  if (noteLines.length) {
    ctx.fillStyle = PANEL; ctx.fillRect(PAD, noteTop, W - 2 * PAD, NOTE_H)
    ctx.fillStyle = ACCENT; ctx.fillRect(PAD, noteTop, 6, NOTE_H)
    ctx.textAlign = 'left'; ctx.fillStyle = ACCENT; ctx.font = `800 16px ${FONT}`; ctx.letterSpacing = '4px'
    ctx.fillText('SELLING POINTS', PAD + 28, noteTop + 30); ctx.letterSpacing = '0px'
    ctx.fillStyle = '#fff'; ctx.font = `500 24px ${FONT}`
    noteLines.forEach((l, i) => ctx.fillText(l, PAD + 28, noteTop + 66 + i * 32))
  }

  // ── price: A Slide = a dark MARKET PRICE pentagon whose point cuts into the big OUR PRICE box (the border forms the arrow); one box when there is no market price.
  //    The A Slide price always ends with "NEGO". B Slide = one SELLING PRICE box. ──
  const our = opts.postingPrice && opts.postingPrice > 0 ? opts.postingPrice : null
  const market = !b2b && opts.marketPrice && our && opts.marketPrice > our ? opts.marketPrice : null     // only when it really is higher
  const BW = W - 2 * PAD
  const priceBox = (x: number, w: number) => {
    const g = ctx.createLinearGradient(x, priceTop, x + w, priceTop + PRICE_H)
    g.addColorStop(0, BOX_1); g.addColorStop(0.55, BOX_2); g.addColorStop(1, BOX_3)
    ctx.fillStyle = g; ctx.fillRect(x, priceTop, w, PRICE_H)
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x, priceTop, w, 5)
  }
  const label = (text: string, cx: number, yy: number, color: string, size = 21) => {
    ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = `800 ${size}px ${FONT}`; ctx.letterSpacing = '5px'
    ctx.fillText(text, cx + 2, yy); ctx.letterSpacing = '0px'
  }
  const bigPrice = (text: string, cx: number, base: number, maxW: number, maxSize: number, minSize: number, nego: boolean) => {
    ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4
    const gap = nego ? 16 : 0
    const size = fitFont(ctx, text, '900', maxSize, minSize, nego ? maxW - (maxSize * 0.36 * 3.1 + gap) : maxW)
    const pw = ctx.measureText(text).width
    const nSize = Math.max(22, Math.round(size * 0.36))
    let nw = 0
    if (nego) { ctx.font = `800 ${nSize}px ${FONT}`; ctx.letterSpacing = '3px'; nw = ctx.measureText('NEGO').width; ctx.font = `900 ${size}px ${FONT}`; ctx.letterSpacing = '0px' }
    const x0 = cx - (pw + gap + nw) / 2
    ctx.textAlign = 'left'; ctx.fillText(text, x0, base)
    if (nego) {
      ctx.font = `800 ${nSize}px ${FONT}`; ctx.letterSpacing = '3px'; ctx.fillStyle = '#e8f1ff'
      ctx.fillText('NEGO', x0 + pw + gap, base); ctx.letterSpacing = '0px'
    }
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0
  }

  if (market) {
    const w1 = 330, PT = 54
    const x1 = PAD, x2 = x1 + w1, xr = PAD + BW
    priceBox(x1 + w1 - PT, BW - (w1 - PT))
    const my = priceTop + PRICE_H / 2
    ctx.beginPath()
    ctx.moveTo(x1, priceTop); ctx.lineTo(x2 - PT, priceTop); ctx.lineTo(x2, my); ctx.lineTo(x2 - PT, priceTop + PRICE_H); ctx.lineTo(x1, priceTop + PRICE_H); ctx.closePath()
    ctx.fillStyle = '#16212e'; ctx.fill()
    ctx.lineJoin = 'miter'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke()
    const mcx = x1 + (w1 - PT) / 2
    label('MARKET PRICE', mcx, priceTop + 56, '#9aa7b4', 19)
    ctx.textAlign = 'center'; ctx.fillStyle = '#c9d3dd'; fitFont(ctx, rm(market), '800', 58, 24, w1 - PT - 50)
    const mt = rm(market), mw = ctx.measureText(mt).width
    const mSize = parseInt(ctx.font.match(/(\d+)px/)?.[1] || '46', 10), mBase = priceTop + 128
    ctx.fillText(mt, mcx, mBase)
    const sy = mBase - mSize * 0.36
    ctx.strokeStyle = '#ff3b2f'; ctx.lineWidth = 3; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(mcx - mw / 2 - 8, sy); ctx.lineTo(mcx + mw / 2 + 8, sy); ctx.stroke(); ctx.lineCap = 'butt'
    const ox = x2 + (xr - x2) / 2
    label('OUR PRICE', ox, priceTop + 56, 'rgba(255,255,255,.95)', 22)
    bigPrice(rm(our as number), ox, priceTop + 138, xr - x2 - 60, 100, 36, true)
  } else {
    priceBox(PAD, BW)
    label(b2b ? 'SELLING PRICE' : 'OUR PRICE', W / 2, priceTop + 56, 'rgba(255,255,255,.95)', 24)
    if (our) bigPrice(rm(our), W / 2, priceTop + 140, 820, 104, 44, !b2b)
    else { ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; fitFont(ctx, 'ASK FOR PRICE', '900', 104, 44, 820); ctx.fillText('ASK FOR PRICE', W / 2, priceTop + 140) }
  }

  // ── footer: the company name on the left, then "message us for details", the phone / WhatsApp number and the website ──
  if (footer) {
    ctx.fillStyle = '#05080c'; ctx.fillRect(0, footTop, W, FOOTER_H)
    ctx.fillStyle = ACCENT; ctx.fillRect(0, footTop, W, 4)
    const LOGO_W = 300
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
    fitFont(ctx, COMPANY, '800', 54, 24, LOGO_W)
    ctx.fillText(COMPANY, PAD + LOGO_W / 2, footTop + FOOTER_H / 2 + 6)
    ctx.fillStyle = MUTED; ctx.font = `600 15px ${FONT}`; ctx.letterSpacing = '4px'
    ctx.fillText('PARTNER', PAD + LOGO_W / 2, footTop + FOOTER_H / 2 + 34); ctx.letterSpacing = '0px'
    ctx.fillStyle = ACCENT_DARK; ctx.fillRect(PAD + LOGO_W + 28, footTop + 26, 2, FOOTER_H - 52)
    const tx = PAD + LOGO_W + 58, tw = W - PAD - tx
    const phone = (opts.phone ?? '').trim()
    ctx.textAlign = 'left'
    ctx.fillStyle = '#fff'; ctx.font = `800 30px ${FONT}`; ctx.letterSpacing = '2px'
    ctx.fillText('MESSAGE US FOR DETAILS', tx, footTop + (phone ? 56 : 66)); ctx.letterSpacing = '0px'
    if (phone) { ctx.fillStyle = ACCENT; fitFont(ctx, phone, '800', 40, 22, tw); ctx.fillText(phone, tx, footTop + 102) }
    ctx.fillStyle = '#d7dee6'; fitFont(ctx, SITE, '600', 21, 13, tw)
    ctx.fillText(SITE, tx, footTop + (phone ? 134 : 108))
  }
  void INK
  return canvas
}

export function posterToJpgBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the picture'))), 'image/jpeg', 0.92))
}

/** HTML for the print window: the poster as one full page (page size = the poster's proportions). */
export function posterPrintHtml(canvas: HTMLCanvasElement, title: string): string {
  const pageW = 540, pageH = Math.round(pageW * canvas.height / canvas.width)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, '')}</title>
<style>@page { size: ${pageW}px ${pageH}px; margin: 0 } html, body { margin: 0; padding: 0; background: #fff } img { display: block; width: ${pageW}px; height: ${pageH}px }</style></head>
<body><img src="${canvas.toDataURL('image/jpeg', 0.92)}"></body></html>`
}

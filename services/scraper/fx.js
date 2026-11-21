'use strict'

/**
 * fx.js — the daily CIMB exchange rates: Australian dollar, British pound, Japanese yen (Selling TT/OD, in ringgit).
 *
 *   node fx.js            fetch, check the page date, save to currency_rates
 *   node fx.js --dry      show what it would save, write nothing
 *   node fx.js --force    save even if the rate moved more than 20% since the last one (a safety stop normally)
 *
 * How it reads the page: CIMB blocks a headless browser (that is why the old scraper stopped working) but serves the normal page to a plain
 * web request, with the rate tables in the HTML. So this is one HTTP request, no browser. If CIMB ever blocks that too, it falls back to the
 * installed Microsoft Edge (a real browser, not the headless Chromium CIMB blocks).
 *
 * The date check: the page says "Last Updated: 5:08 pm, 20 Nov 2026, Friday". The rate is saved under that date (Malaysia time), so a rate that
 * CIMB has not refreshed yet is never saved as today's. Exit code 0 = the page was updated today and the rates are saved; 2 = the page is still
 * showing an older day (CIMB has not updated yet, or it is a weekend / holiday): the newest rate it shows is kept, and Task Scheduler runs this
 * again 30 minutes later (see docs/automation-setup.md). Exit code 1 = failed.
 *
 * Per-unit table: AUD, GBP.  Per-100-units table: JPY (divided by 100, so the stored rate is always ringgit per ONE unit).
 */

require('dotenv').config()
const supabase = require('./lib/db')

const URL = 'https://www.cimb.com.my/en/business/help-and-support/rates-charges/forex-rates.html'
const WANT = ['AUD', 'GBP', 'JPY']
const MAX_MOVE = 0.2
const dry = process.argv.includes('--dry'), force = process.argv.includes('--force')
const log = (m) => console.log(`[${new Date().toISOString()}] [fx] ${m}`)
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

async function getHtml() {
  const bad = (h) => !h || !/Last Updated/i.test(h) || !/<table/i.test(h)
  let html = null, why = ''
  for (let i = 1; i <= 3 && bad(html); i++) {
    try {
      const r = await fetch(URL, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-MY,en;q=0.9' }, signal: AbortSignal.timeout(30000) })
      html = await r.text(); why = 'HTTP ' + r.status
    } catch (e) { why = e.message; html = null }
    if (bad(html) && i < 3) await new Promise((r) => setTimeout(r, 5000 * i))
  }
  if (!bad(html)) return html
  log(`plain request gave nothing usable (${why}); trying the installed Edge browser`)
  const { chromium } = require('playwright')
  const browser = await chromium.launch({ channel: 'msedge', headless: false })
  try {
    const page = await browser.newPage()
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('table', { timeout: 30000 })
    html = await page.content()
  } finally { await browser.close() }
  if (bad(html)) throw new Error('CIMB page has no rate tables (the page layout may have changed)')
  return html
}

/** "5:08 pm, 20 Nov 2026" -> { iso, date (Malaysia day) } */
function parseUpdated(text) {
  const m = /(\d{1,2}):(\d{2})\s*(am|pm)\s*,\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/i.exec(text || '')
  if (!m) return null
  let h = Number(m[1]) % 12; if (/pm/i.test(m[3])) h += 12
  const mon = MON[m[5].toLowerCase()]
  if (mon === undefined) return null
  const p = (n) => String(n).padStart(2, '0')
  const date = `${m[6]}-${p(mon + 1)}-${p(Number(m[4]))}`
  return { date, iso: new Date(`${date}T${p(h)}:${m[2]}:00+08:00`).toISOString(), text: text.trim() }
}

/** every table section: { title, per, updated, rows: { CODE: [sell, buyTT, buyOD] } } */
function parse(html) {
  const h = html.replace(/\s+/g, ' ')
  const out = []
  for (const part of h.split(/<h3[^>]*>/i).slice(1)) {
    const title = (part.split('</h3>')[0] || '').replace(/<[^>]+>/g, '').trim()
    if (!/Foreign Currency Table/i.test(title) || /Notes/i.test(title)) continue
    const upd = /Last Updated:?\s*([^<]*)</i.exec(part)
    const rows = {}
    for (const tr of part.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const c = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map((x) => x.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())
      if (c.length >= 3 && /^[A-Z]{3}$/.test(c[1])) rows[c[1]] = c.slice(2).map((v) => parseFloat(v.replace(/,/g, '')))
    }
    out.push({ title, per: /100/.test(title) ? 100 : 1, updatedText: upd ? upd[1].trim() : '', rows })
  }
  return out
}

async function main() {
  const todayMyt = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const sections = parse(await getHtml())
  if (!sections.length) throw new Error('no rate tables found on the CIMB page')

  const found = {}
  for (const code of WANT) {
    const s = sections.find((x) => x.rows[code] && Number.isFinite(x.rows[code][0]) && x.rows[code][0] > 0)
    if (!s) throw new Error(`${code} not found on the CIMB page (or it shows N/A)`)
    const upd = parseUpdated(s.updatedText)
    if (!upd) throw new Error(`cannot read the "Last Updated" line for ${code}: "${s.updatedText}"`)
    found[code] = { sell: s.rows[code][0], per: s.per, rate: Number((s.rows[code][0] / s.per).toFixed(8)), upd }
  }
  const pageDate = found.JPY.upd.date
  log(`page says: Last Updated: ${found.JPY.upd.text}`)
  for (const c of WANT) log(`${c}: Selling TT/OD ${found[c].sell} per ${found[c].per} = RM ${found[c].rate} per 1 ${c}`)

  const { data: prev } = await supabase.from('currency_rates').select('from_currency,rate,rate_date,source_updated_at').eq('to_currency', 'MYR').in('from_currency', WANT).order('rate_date', { ascending: false }).limit(60)
  const last = (c) => (prev || []).find((r) => r.from_currency === c)
  const rows = []
  for (const c of WANT) {
    const f = found[c], p = last(c), pr = p ? Number(p.rate) : 0
    if (pr && Math.abs(f.rate / pr - 1) > MAX_MOVE && !force) throw new Error(`${c} moved ${((f.rate / pr - 1) * 100).toFixed(1)}% since ${p.rate_date} (RM ${pr} -> ${f.rate}); not saved. Check the page, then run with --force if it is right.`)
    if (p && p.rate_date === f.upd.date && p.source_updated_at && new Date(p.source_updated_at) >= new Date(f.upd.iso) && Number(p.rate) === f.rate) { log(`${c}: already saved for ${f.upd.date}`); continue }
    rows.push({ from_currency: c, to_currency: 'MYR', rate: f.rate, rate_date: f.upd.date, source: 'cimb_selling_tt_od', source_updated_at: f.upd.iso, fetched_at: new Date().toISOString() })
  }
  if (rows.length) {
    if (dry) log(`dry run, would save: ${JSON.stringify(rows.map((r) => `${r.from_currency} ${r.rate} for ${r.rate_date}`))}`)
    else {
      const { error } = await supabase.from('currency_rates').upsert(rows, { onConflict: 'from_currency,to_currency,rate_date' })
      if (error) throw new Error('save failed: ' + error.message + (/constraint|conflict/i.test(error.message) ? '  (run migration 48 first)' : ''))
      log(`saved ${rows.length} rate(s) for ${pageDate}`)
    }
  }
  if (pageDate !== todayMyt) { log(`the page is still showing ${pageDate}, today is ${todayMyt} (Malaysia): CIMB has not updated yet, or it is a weekend / holiday. Will be checked again.`); process.exit(2) }
  log(`up to date: the page was updated today (${todayMyt})`)
}

main().catch((e) => { console.error(`[fx] FAILED: ${e.message}`); process.exit(1) })

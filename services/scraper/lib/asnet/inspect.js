'use strict'

/**
 * lib/asnet/inspect.js — "node asnet.js --inspect": records how the real result page behaves, so the reading rules are written from facts.
 * It only reads: one search, one press of Next, one car opened. Saved into out/asnet-inspect/ (not committed):
 *   report.json   how many rows there are second by second (waiting, then scrolling), the page buttons, and what Next set off
 *   detail.html   the opened car's window (its photo links are also listed in report.json under "detail")
 *   page.html     the result page, without the top bar (member name) and without form tokens or typed values
 *   scripts/      the site's own scripts, which say what the buttons do
 */

const fs = require('fs')
const path = require('path')

const sleep = (page, ms) => page.waitForTimeout(ms)

/** one look at the list */
const look = (page) => page.evaluate(() => {
  const rows = document.querySelectorAll('tr[data-key]')
  return { rows: rows.length, first: rows[0]?.getAttribute('data-key') || null, pageSize: document.querySelector('#pageSizeSelect')?.value || null, height: document.body.scrollHeight, ready: document.readyState }
})

/** looks every second and keeps only the moments something changed */
async function watch(page, seconds, what, each) {
  const seen = []
  let last = ''
  for (let s = 0; s <= seconds; s++) {
    if (each) await each(s)
    const now = await look(page).catch((e) => ({ error: e.message.split('\n')[0] }))
    const key = JSON.stringify(now)
    if (key !== last) { seen.push({ second: s, ...now }); console.log(`  ${what} ${s}s: ${now.error || now.rows + ' rows'}`); last = key }
    if (s < seconds) await sleep(page, 1000)
  }
  return seen
}

const buttons = (page) => page.evaluate(() => [...document.querySelectorAll('a[data-page]')].slice(0, 30).map((a) => {
  const box = a.getBoundingClientRect(), over = box.width ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null
  return {
    html: a.outerHTML.slice(0, 300), inside: [a.parentElement, a.closest('nav'), a.closest('ul')].map((e) => (e ? e.tagName.toLowerCase() + '.' + e.className : null)),
    visible: a.getClientRects().length > 0, onTop: over ? (over === a || a.contains(over) ? 'itself' : over.outerHTML.slice(0, 200)) : 'off screen',
  }
}))

async function inspect(page, outDir) {
  const dir = path.join(outDir, 'asnet-inspect')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  const asked = [], errors = []
  let stage = 'loading'
  const onRequest = (r) => { if (!['image', 'font', 'stylesheet'].includes(r.resourceType())) asked.push({ stage, type: r.resourceType(), method: r.method(), url: r.url().split('?')[0] }) }
  const onError = (e) => errors.push({ stage, error: String(e.message || e).slice(0, 400) })
  const onConsole = (m) => { if (m.type() === 'error') errors.push({ stage, console: m.text().slice(0, 400) }) }
  page.on('request', onRequest); page.on('pageerror', onError); page.on('console', onConsole)
  const report = { made_at: new Date().toISOString() }
  try {
    console.log('\nINSPECT: please do not touch the Chrome window (about 2 minutes)')
    report.waiting = await watch(page, 20, 'waiting')
    stage = 'scrolling'
    report.scrolling = await watch(page, 20, 'scrolling', () => page.evaluate(() => window.scrollBy(0, Math.max(500, window.innerHeight * 0.8))))
    report.buttons_before = await buttons(page)
    stage = 'next'
    report.next_clicked = await page.evaluate(() => {
      const links = [...document.querySelectorAll('li.next a[data-page], a[data-page]')]
      const link = links.find((a) => /next/i.test(a.textContent) && a.getClientRects().length > 0) || links.find((a) => a.closest('li.next')) || null
      if (!link) return null
      link.scrollIntoView({ block: 'center' }); link.click()
      return link.outerHTML.slice(0, 300)
    })
    console.log('  Next: ' + (report.next_clicked ? 'clicked' : 'no link found'))
    report.after_next = await watch(page, 30, 'after Next')
    report.buttons_after = await buttons(page)
    report.url = page.url()

    const html = await page.evaluate(() => {
      const copy = document.documentElement.cloneNode(true)
      copy.querySelectorAll('header, #header').forEach((e) => e.remove())
      copy.querySelectorAll('input[type=hidden], input[type=password], input[type=text], input[type=email]').forEach((e) => e.removeAttribute('value'))
      return copy.outerHTML
    })
    fs.writeFileSync(path.join(dir, 'page.html'), html)

    // one car's own window: the list only gives the first photo's link, the full gallery is here
    stage = 'detail'
    try {
      const opened = await page.evaluate(() => {
        const row = document.querySelector('tr[data-key]'), link = row?.querySelector('a.showDetail')
        if (!link) return null
        link.scrollIntoView({ block: 'center' }); link.click()
        return { thumbnail: row.querySelector('td.carPhoto img')?.getAttribute('src') || null }
      })
      if (!opened) throw new Error('no car link in the first row')
      await page.waitForFunction(() => /asnet2\.com/.test(document.querySelector('#detail_view')?.innerHTML || ''), null, { timeout: 90000, polling: 1000 })
      await sleep(page, 10000)      // the pictures arrive after the window
      const detail = await page.evaluate(() => {
        const copy = document.querySelector('#detail_view').cloneNode(true)
        copy.querySelectorAll('input[type=hidden], input[type=password], input[type=text], input[type=email], textarea').forEach((e) => { e.removeAttribute('value'); e.textContent = '' })
        return copy.outerHTML
      })
      fs.writeFileSync(path.join(dir, 'detail.html'), detail)
      report.detail = { thumbnail: opened.thumbnail, photo_links: [...new Set(detail.match(/https?:\/\/img\w*\.asnet2\.com\/[^"'()\s<>]+/g) || [])] }
      console.log(`  car opened: ${report.detail.photo_links.length} photo link(s)`)
    } catch (e) { report.detail = { error: e.message.split('\n')[0] }; console.log('  car not opened: ' + report.detail.error) }

    // the site's own script files, asked for by the page itself
    const sources = await page.evaluate(() => [...document.scripts].map((s) => s.src).filter((u) => u && new URL(u).hostname.endsWith('asnet.jp')))
    report.scripts = []
    for (let i = 0; i < sources.length; i++) {
      const text = await page.evaluate((u) => fetch(u).then((r) => (r.ok ? r.text() : null)).catch(() => null), sources[i])
      if (!text) continue
      const name = `${String(i).padStart(2, '0')}-${(sources[i].split('?')[0].split('/').pop() || 'script').replace(/[^\w.-]/g, '_')}`
      fs.writeFileSync(path.join(dir, 'scripts', name), text)
      report.scripts.push({ file: name, url: sources[i].split('?')[0] })
    }
  } finally {
    page.off('request', onRequest); page.off('pageerror', onError); page.off('console', onConsole)
    report.asked = asked; report.errors = errors
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2))
    console.log('\nINSPECT saved: ' + dir)
  }
}

module.exports = { inspect }

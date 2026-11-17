'use strict'

// Offline check of the day selection and score filter against a mock page shaped like the source site's search page.
//   node test-nav.js
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://x'
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'k'

const { chromium } = require('playwright')
const { selectWeekdayVenues, applyFilter } = require('./lib/nav')

const HTML = `<html><body>
<select id="UssWeekOption" name="UssWeekOption" onchange="setUssWeek()"><option value="">- a day -</option>
<option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option></select>
<label><input type="checkbox" name="UssOption" value="@U" checked>ALL USS</label>
<label><input type="checkbox" name="UssOption" value="TK" week="2" checked>Tokyo</label>
<label><input type="checkbox" name="UssOption" value="YK" week="2" checked>Yokohama</label>
<label><input type="checkbox" name="UssOption" value="NR" week="2" checked>R-Nagoya</label>
<label><input type="checkbox" name="UssOption" value="OS" week="3" checked>Osaka</label>
<a id="StepHeadKaijo" onclick="document.body.insertAdjacentHTML('beforeend','<input type=checkbox name=BrandCodeOption value=01>')">next</a>
<div id="scores">
<input type="checkbox" name="ScoreOption" value="1"><input type="checkbox" name="ScoreOption" value="10"><input type="checkbox" name="ScoreOption" value="4">
<input type="checkbox" name="ScoreOption" value="11"><input type="checkbox" name="ScoreOption" value="5"><input type="checkbox" name="ScoreOption" value="12" checked>
</div>
<select id="ModelYearFromOption"><option value="">-</option><option value="2021">2021</option><option value="2022">2022</option></select>
<select id="ModelYearToOption"><option value="">-</option><option value="2026">2026</option></select>
<a href="javascript:toMore();" onclick="return false">more</a>
<a id="StepHeadMore" onclick="document.body.insertAdjacentHTML('beforeend','<span id=ResultCount>12 hits</span>')">go</a>
<script>
function setUssWeek() {
  const w = document.getElementById('UssWeekOption').value
  document.querySelectorAll('input[name=UssOption]').forEach(c => {
    if (c.value === '@U') c.checked = false
    else c.checked = (c.getAttribute('week') === w)
  })
}
</script></body></html>`

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(HTML)

  const final = await selectWeekdayVenues(page, 2, ['YK', 'NR'])
  ok(final.length === 1 && final[0].code === 'TK', 'Tuesday keeps only Tokyo after skipping Yokohama and R-Nagoya')
  ok(!(await page.locator('input[value="YK"]').isChecked()) && !(await page.locator('input[value="NR"]').isChecked()), 'Yokohama and R-Nagoya are unticked')
  ok(!(await page.locator('input[value="OS"]').isChecked()), 'Wednesday-only venue is not ticked')
  ok((await page.locator('input[name="BrandCodeOption"]').count()) > 0, 'moved on to the brand step')

  let msg = ''
  await page.setContent(HTML)
  try { await selectWeekdayVenues(page, 3, ['OS']) } catch (e) { msg = e.message }
  ok(/No venue left/.test(msg), 'errors when the skip list would leave nothing to scrape')

  await page.setContent(HTML)
  const hits = await applyFilter(page, { year_from: 2022, year_to: 2026, score_min: 4 }, 'bid')
  const ticked = await page.evaluate(() => [...document.querySelectorAll('input[name=ScoreOption]')].filter((c) => c.checked).map((c) => c.value).sort())
  ok(JSON.stringify(ticked) === JSON.stringify(['1', '10', '11', '4', '5']), 'score 4+ ticks S,6,5,4.5,4 and clears 3.5 (' + ticked.join(',') + ')')
  ok((await page.inputValue('#ModelYearFromOption')) === '2022', 'year from 2022 selected')
  ok(hits === 12, 'hit count read')

  await browser.close()
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.log(e); process.exit(1) })

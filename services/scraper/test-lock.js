'use strict'

// Offline check of lib/lock.js with a fake database that, like Supabase, returns at most 1000 rows per query:   node test-lock.js
// Regression test: with 1262 targets the old single query never saw targets 1001-1262, so they were never scraped.
const path = require('path')

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

const rows = []
for (let i = 0; i < 1262; i++) {
  rows.push({ id: 'id' + String(i).padStart(5, '0'), lot_type: 'bid', enabled: true, priority: 100, maker_code: '01', car_code: String(i), locked_by: null, locked_at: null, completed_at: null, last_run_at: null, run_count: 0 })
}
// the first 1000 have already run once (yesterday), the last 262 never ran: they must be claimed first
for (let i = 0; i < 1000; i++) Object.assign(rows[i], { run_count: 1, last_run_at: '2020-01-01T00:00:00Z', completed_at: '2020-01-01T00:00:00Z' })

class Query {
  constructor(table) { this.filters = []; this.sorts = []; this.patch = null; this.rangeArgs = null }
  select() { return this }
  update(p) { this.patch = p; return this }
  eq(c, v) { this.filters.push((r) => r[c] === v); return this }
  is(c, v) { this.filters.push((r) => r[c] === v); return this }
  lt(c, v) { this.filters.push((r) => r[c] < v); return this }
  order(c, o) { this.sorts.push([c, o.ascending]); return this }
  range(a, b) { this.rangeArgs = [a, b]; return Promise.resolve(this.run()) }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej) }   // a query with no .range() is awaitable too (returns the first 1000 rows)
  single() { const d = this.run().data; return Promise.resolve({ data: d[0] || null, error: d.length ? null : { message: 'no row' } }) }
  run() {
    let out = rows.filter((r) => this.filters.every((f) => f(r)))
    if (this.patch) { out.forEach((r) => Object.assign(r, this.patch)); return { data: out.map((r) => ({ ...r })), error: null } }
    for (const [c, asc] of [...this.sorts].reverse()) out = [...out].sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1))
    const [a, b] = this.rangeArgs || [0, 999]
    out = out.slice(a, Math.min(b, a + 999) + 1)   // never more than 1000 rows, like Supabase
    return { data: out.map((r) => ({ ...r })), error: null }
  }
}
const fake = { from: () => new Query() }
const dbPath = require.resolve(path.join(__dirname, 'lib', 'db.js'))
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fake }

;(async () => {
  const { claimTarget } = require('./lib/lock')
  const first = await claimTarget('bid')
  ok(first && Number(first.car_code) >= 1000, 'a never-run target past row 1000 is claimed first (car_code ' + (first && first.car_code) + ')')

  const claimedNever = new Set([first.car_code])
  for (let i = 0; i < 261; i++) { const t = await claimTarget('bid'); if (t) claimedNever.add(t.car_code) }
  ok(claimedNever.size === 262 && [...claimedNever].every((c) => Number(c) >= 1000), 'all 262 targets past row 1000 can be claimed (' + claimedNever.size + ')')

  const next = await claimTarget('bid')
  ok(next && Number(next.car_code) < 1000, 'after them the earlier targets come up again (car_code ' + (next && next.car_code) + ')')

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
  process.exit(fails ? 1 : 0)
})().catch((e) => { console.log(e); process.exit(1) })

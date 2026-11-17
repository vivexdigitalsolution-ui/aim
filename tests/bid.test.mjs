// Reverse bid and margin at a bid.   node tests/bid.test.mjs
import { landedMyr, marginAtBid, maxBidJpy, sellFromRow, offerPricing } from '../packages/core/src/index.ts'

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

const c = { rate: 0.03, dutyMyr: 60000, reconMyr: 3000 }
const body = 5_000_000
const direct = offerPricing({ historyJpy: body, rate: c.rate, dutyMyr: c.dutyMyr, portMyr: 2500, inlandMyr: 250, apFeeMyr: 10500 }).importMyr
ok(landedMyr(body, c) === direct, 'landed cost = the offer report import price')
const m = marginAtBid({ bodyJpy: body, sellMyr: 250000, ...c })
ok(m.profitMyr === 250000 - direct - 3000 && Math.abs(m.marginPct - (m.profitMyr / (direct + 3000)) * 100) < 0.06, 'margin is profit over cost (landed + recon)')

const top = maxBidJpy({ sellMyr: 250000, targetPct: 12, ...c })
const at = marginAtBid({ bodyJpy: top, sellMyr: 250000, ...c }), over = marginAtBid({ bodyJpy: top + 5000, sellMyr: 250000, ...c })
const exact = (x) => x.profitMyr / x.costMyr * 100
ok(top % 5000 === 0 && exact(at) >= 12 && exact(over) < 12, 'max bid: the last yen-step that still gives the target margin; one step more falls short')
ok(maxBidJpy({ sellMyr: 250000, targetPct: 12, ...c }) > maxBidJpy({ sellMyr: 250000, targetPct: 20, ...c }), 'a higher target margin lowers the max bid')
ok(maxBidJpy({ sellMyr: 30000, targetPct: 12, ...c }) === 0, 'when duty and fees alone exceed the sell price: max bid 0')

const row = { n: 12, sellers: 3, min_myr: 190000, p25_myr: 200000, median_myr: 210000, p75_myr: 220000, max_myr: 235000 }
ok(sellFromRow(row, false).confidence === 'high' || sellFromRow(row, false).confidence === 'medium', 'a tight variant row with several dealers is trusted')
ok(sellFromRow(row, true).confidence === 'low', 'a wider (model-level) row is never above low')
ok(sellFromRow({ ...row, sellers: 1 }, false).confidence === 'low', 'one dealer is never above low')
ok(sellFromRow({ ...row, n: 2 }, false).sellMyr === null, 'fewer than 3 listings: no sell price')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

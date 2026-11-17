// Buy list matching and the personal list text.   node tests/buylist.test.mjs
import { matchesBuyList, rankForDealer, listMessage } from '../packages/core/src/index.ts'

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

const bl = { brands: ['Toyota'], models: ['alphard', 'vellfire'], year_from: 2021, budget_myr: 300000, min_margin_pct: 10 }
const car = (o) => ({ brand: 'TOYOTA', model: 'VELLFIRE 2.5 Z', year: 2022, landedMyr: 250000, marginPct: 14, ...o })
ok(matchesBuyList(bl, car({})).ok, 'a car that fits everything matches (make and model are case-insensitive)')
ok(matchesBuyList(bl, car({ brand: 'HONDA' })).why.includes('other make'), 'another make does not match')
ok(matchesBuyList(bl, car({ model: 'HARRIER Z' })).why.includes('other model'), 'another model does not match')
ok(matchesBuyList(bl, car({ year: 2019 })).why.includes('older than 2021'), 'too old does not match')
ok(matchesBuyList(bl, car({ landedMyr: 320000 })).why.includes('over budget'), 'over budget does not match')
ok(matchesBuyList(bl, car({ landedMyr: null })).why.includes('cost unknown'), 'unknown cost never matches a budget')
ok(matchesBuyList(bl, car({ marginPct: 8 })).why.includes('margin below 10%'), 'a margin under the dealer minimum does not match')
ok(matchesBuyList(bl, car({ marginPct: null })).why.includes('no margin figure'), 'no margin figure: nothing is promised')
ok(matchesBuyList({ brands: [], models: [], year_from: null, budget_myr: null, min_margin_pct: 0 }, car({ brand: 'X', model: 'Y', year: null })).ok, 'an empty buy list matches any car that has a margin')
const ranked = rankForDealer([{ marginPct: 10, closesAt: 'b' }, { marginPct: 18, closesAt: 'z' }, { marginPct: 10, closesAt: 'a' }, { marginPct: null, closesAt: 'a' }])
ok(ranked.map((r) => r.marginPct + r.closesAt).join() === '18z,10a,10b,nulla', 'ranking: best margin first, then the earlier deadline, no figure last')
const msg = listMessage({ dealer: 'Ali Motors', count: 4, url: 'https://x/t/abc', expiresDays: 7 })
ok(msg.includes('Hi Ali Motors,') && msg.includes('4 cars') && msg.includes('https://x/t/abc') && msg.includes('not promises'), 'the message names the dealer, the count, the link and says margins are estimates')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

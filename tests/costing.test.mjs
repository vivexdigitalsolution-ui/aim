// Order costing maths, checked against two real cases of the PAWJ VEHICLE COSTING sheet (JI AP 001 and JI AP 003).   node tests/costing.test.mjs
import { invoiceJpy, netCostJpy, cashOutlayJpy, profitOf, bidCeilingJpy, pickRate } from '../packages/core/src/index.ts'

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }
const L = (amountJpy, refundableJpy = 0) => ({ amountJpy, refundableJpy })

// JI AP 003 (GR Corolla): won 4,915,000, received from the AP holder 5,700,000
const ap3 = [L(491500, 491500), L(12000, 12000), L(29700), L(16500, 16500), L(16500), L(0), L(20000), L(15000), L(13131.5), L(3500), L(1000), L(1650), L(22000), L(76898), L(1455), L(1800)]
ok(netCostJpy(4915000, ap3) === 5117634.5, 'AP 003: net actual cost 5,117,634.5, as in the sheet')
ok(cashOutlayJpy(4915000, ap3) === 5637634.5, 'AP 003: total cash outlay 5,637,634.5, as in the sheet')
const d3 = { basis: 'cif', offerJpy: 5700000, fixedChargeJpy: null, showWonPrice: true, givebackJpy: 0, wonJpy: 4915000 }
const p3 = profitOf(d3, ap3)
ok(p3.invoiceJpy === 5700000 && p3.profitJpy === 582365.5, 'AP 003: profit 582,365.5 (the sheet: 582,365.5)')
ok(p3.marginPct === 10.2, 'AP 003: margin on the invoice is 10.2% (the sheet shows 0.04% because its formula divides the document cost)')

// JI AP 001 (Stepwgn): won 3,640,000, received 3,890,000
const ap1 = [L(364000, 364000), L(12310, 12310), L(33000), L(16720, 13970), L(9900), L(25500), L(20000), L(15000), L(25674), L(10000), L(95000), L(300)]
ok(netCostJpy(3640000, ap1) === 3877124, 'AP 001: net actual cost 3,877,124, as in the sheet')
ok(profitOf({ ...d3, offerJpy: 3890000, wonJpy: 3640000 }, ap1).profitJpy === 12876, 'AP 001: profit 12,876, as in the sheet')

// the deal types
const base = { basis: 'bid_plus_fixed', offerJpy: 6900000, fixedChargeJpy: 250000, showWonPrice: true, givebackJpy: 0, wonJpy: 6700000 }
ok(invoiceJpy(base) === 6950000, 'bid + fixed, the dealer sees the price: won price + the fixed charge (6.7M + 250k)')
ok(invoiceJpy({ ...base, showWonPrice: false }) === 7150000, 'bid + fixed, price not asked for: their 6.9M + the fixed 250k = 7.15M, the 200k difference is yours')
ok(invoiceJpy({ ...base, showWonPrice: false, givebackJpy: 50000 }) === 7100000, 'a 50k give-back lowers the invoice')
ok(invoiceJpy({ ...base, basis: 'cif', offerJpy: 7200000, fixedChargeJpy: null }) === 7200000, 'CIF 7.2M all in: the invoice is 7.2M whatever the car cost')
ok(invoiceJpy({ ...base, wonJpy: null }) === null, 'not won yet: no invoice figure (bid + fixed)')
ok(invoiceJpy({ ...base, basis: 'cif', wonJpy: null }) === 7200000 || invoiceJpy({ ...base, basis: 'cif', wonJpy: null }) === 6900000, 'CIF is known before the win')
ok(invoiceJpy({ ...base, basis: 'cif', offerJpy: null }) === null, 'CIF with no amount agreed: unknown')
ok(invoiceJpy({ ...base, givebackJpy: 99999999 }) === 0, 'a give-back can never make the invoice negative')
ok(profitOf({ ...base, wonJpy: null }, []) === null, 'no profit before the win')

// before bidding
ok(bidCeilingJpy({ basis: 'bid_plus_fixed', offerJpy: 6903000, givebackJpy: 0 }, []) === 6900000, 'bid + fixed: the ceiling is the dealer amount, rounded down to the 5,000 step')
ok(bidCeilingJpy({ basis: 'cif', offerJpy: 7200000, givebackJpy: 0 }, [L(300000), L(500000, 500000)], 200000) === 6700000, 'CIF: 7.2M - 300k costs (refunds net out) - 200k wanted profit = 6.7M ceiling')
ok(bidCeilingJpy({ basis: 'cif', offerJpy: 100000, givebackJpy: 0 }, [L(300000)], 0) === 0, 'costs above the offer: ceiling 0, never negative')
ok(bidCeilingJpy({ basis: 'cif', offerJpy: null, givebackJpy: 0 }, []) === null, 'no amount: no ceiling')

// the rate card
const rates = [
  { item_key: 'land_transport', venue: null, party: 'A', amount_jpy: 10000, valid_from: '2026-01-01' },
  { item_key: 'land_transport', venue: 'Yokohama', party: 'A', amount_jpy: 9900, valid_from: '2026-01-01' },
  { item_key: 'land_transport', venue: 'Yokohama', party: 'A', amount_jpy: 11000, valid_from: '2026-06-01' },
  { item_key: 'land_transport', venue: 'Yokohama', party: 'A', amount_jpy: 12000, valid_from: '2027-01-01' },
  { item_key: 'ocean_freight', venue: null, party: 'B', amount_jpy: 95000, valid_from: '2026-03-01' },
]
ok(pickRate(rates, 'land_transport', 'yokohama', '2026-11-18').amount_jpy === 11000, 'rate: the venue line beats the every-venue line, the newest start that has begun wins, a future rate is ignored')
ok(pickRate(rates, 'land_transport', 'Tokyo', '2026-11-18').amount_jpy === 10000, 'rate: another venue falls back to the every-venue line')
ok(pickRate(rates, 'ocean_freight', 'Kobe', '2026-11-18').amount_jpy === 95000, 'rate: a venue-less item applies everywhere')
ok(pickRate(rates, 'insurance', 'Tokyo', '2026-11-18') === null, 'rate: nothing on the card: null, staff type it')
ok(pickRate(rates, 'ocean_freight', 'Kobe', '2026-02-01') === null, 'rate: not started yet: null')
ok(pickRate(rates, 'ocean_freight', 'Kobe', '2026-11-18', 'a') === null && pickRate(rates, 'ocean_freight', 'Kobe', '2026-11-18', 'b').amount_jpy === 95000, 'rate: a party can be asked for')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

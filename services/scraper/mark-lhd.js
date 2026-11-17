'use strict'

/**
 * mark-lhd.js — mark cars as left-hand drive by hand (no AI, free). A marked car is never recommended; the offer report hides it
 * (also when it is already in a batch) and `node offer.js --refill` picks another car in its place.
 *
 *   node mark-lhd.js 6289 20138          mark these lot numbers (the cars still open for bidding) as left-hand drive
 *   node mark-lhd.js 6289 --undo         take the mark off again
 *
 * Needs supabase/migrations/17_lot_steering.sql (the lots.steering column).
 */

const supabase = require('./lib/db')
const { refreshBatchCopies } = require('./lib/batchcopy')

async function main() {
  const args = process.argv.slice(2)
  const undo = args.includes('--undo')
  const lotNos = args.filter((a) => !a.startsWith('--'))
  if (!lotNos.length) { console.log('Usage: node mark-lhd.js <lot no> [<lot no> ...] [--undo]'); return }
  const probe = await supabase.from('lots').select('steering').limit(1)
  if (probe.error) { console.log('The lots.steering column does not exist yet. Run supabase/migrations/17_lot_steering.sql in the Supabase SQL editor first.'); process.exit(1) }

  for (const no of lotNos) {
    const { data, error } = await supabase.from('lots').select('id,lot_no,brand,model,venue,auction_date').eq('lot_no', no).gt('bid_deadline', new Date().toISOString())
    if (error) throw new Error(error.message)
    if (!data.length) { console.log(`${no}: no open car with this lot number`); continue }
    for (const l of data) {
      const up = await supabase.from('lots').update({ steering: undo ? null : 'LHD' }).eq('id', l.id)
      if (up.error) throw new Error(up.error.message)
      await refreshBatchCopies(l.id)
      console.log(`${no}: ${l.brand} ${l.model} (${l.venue} ${l.auction_date}) ${undo ? 'mark removed' : 'marked left-hand drive: not recommended'}`)
    }
    if (data.length > 1) console.log(`  (${data.length} open cars share lot number ${no}: all were marked. Check the venues above.)`)
  }
  if (!undo) console.log('\nNow run: node offer.js --refill   (it picks other cars in their place)')
}
main().catch((e) => { console.error(e.message); process.exit(1) })

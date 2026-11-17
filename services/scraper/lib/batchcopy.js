'use strict'

const supabase = require('./db')

/**
 * An offer batch keeps its own copy of each car's lot and cost rows (so the report prints the same later). When a car is read or
 * priced again, bring the copies in the batches up to date, or the report would keep showing the old duty.
 */
async function refreshBatchCopies(lotId) {
  const { data: rows } = await supabase.from('offer_batch_cars').select('id').eq('lot_id', lotId)
  if (!rows || !rows.length) return
  const lot = (await supabase.from('lots').select('*').eq('id', lotId).single()).data
  const cost = (await supabase.from('lot_costs').select('*').eq('lot_id', lotId).maybeSingle()).data
  await supabase.from('offer_batch_cars').update({ lot, cost: cost || null }).eq('lot_id', lotId)
}

module.exports = { refreshBatchCopies }

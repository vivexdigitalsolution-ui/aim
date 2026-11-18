'use strict'

/**
 * refresh-photos.js — brings back the photos of the cars in today's offer batch when the photo host has deleted them
 * (the R2 lifecycle rule removes photos a few days after the scrape, but a car can wait longer for its auction day).
 *
 *   node refresh-photos.js          check today's batch; scrape again ONLY the models that have a car with missing photos
 *   node refresh-photos.js --dry    only say which cars have missing photos
 *   node refresh-photos.js --all    check every car of every batch of the last 10 days, not only today's
 *   node refresh-photos.js --open   check every OPEN car that closes within 3 days (--days N to change); what the daily job runs, so the Cars page never shows a car without photos
 *
 * How: the photo links of a car can only be rebuilt from the source site's listing, so the models of the cars with missing photos are
 * scraped again (bid cars only, every venue, no history). The normal scrape sees that the saved cover link answers 404 and downloads the
 * photos again to the SAME links, so the copies kept in the batches show them again at once. Nothing else is changed.
 * Needs the cars to be open for bidding on the source site: a car whose auction is over cannot be restored.
 */

const supabase = require('./lib/db')
const { todayStart } = require('./lib/cutoff')
const { ensureTargets, runScrape } = require('./lib/targets')

const has = (f) => process.argv.includes(f)
const DRY = has('--dry'), ALL = has('--all'), OPEN = has('--open')
const DAYS = Number(process.argv[process.argv.indexOf('--days') + 1]) || 3

/** true only when the photo host clearly says 404 (a network error is not "gone") */
async function gone(url) {
  if (!url) return true
  try { return (await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })).status === 404 } catch { return false }
}

async function missingOf(lotIds) {
  const out = []
  for (let i = 0; i < lotIds.length; i += 100) {
    const r = await supabase.from('lots').select('id,lot_no,auction_date,brand,model,maker_code,car_code,photos,sheet_url').in('id', lotIds.slice(i, i + 100))
    if (r.error) throw new Error('lots: ' + r.error.message)
    // the checks of one page of cars run side by side (a day has about 2,000 open cars)
    const flags = await Promise.all(r.data.map(async (l) => (await gone(l.photos?.[0])) || (await gone(l.sheet_url))))
    r.data.forEach((l, k) => { if (flags[k]) out.push(l) })
  }
  return out
}

async function main() {
  if (OPEN) return mainOpen()
  const since = ALL ? new Date(Date.now() - 10 * 86400000).toISOString() : todayStart()
  const nb = await supabase.from('offer_batches').select('id').gte('created_at', since)
  if (nb.error) throw new Error('offer_batches: ' + nb.error.message)
  if (!nb.data.length) { console.log(ALL ? 'No batch in the last 10 days.' : 'No batch was made today. Run node offer.js first.'); return }
  const ids = new Set()
  for (const b of nb.data) {
    const r = await supabase.from('offer_batch_cars').select('lot_id').eq('batch_id', b.id).eq('held_back', false)
    if (r.error) throw new Error('offer_batch_cars: ' + r.error.message)
    r.data.forEach((x) => ids.add(x.lot_id))
  }
  console.log(`Checking the photos of ${ids.size} recommended car(s) in ${nb.data.length} batch(es)...`)
  const bad = (await missingOf([...ids])).filter((l) => l.maker_code && l.car_code)
  if (!bad.length) { console.log('All photos are there. Nothing to do.'); return }
  const models = new Map()
  bad.forEach((l) => { const k = l.maker_code + '|' + l.car_code; if (!models.has(k)) models.set(k, { maker_code: l.maker_code, car_code: l.car_code, brand_name: l.brand, model_name: String(l.model).split(' ')[0], lots: [] }); models.get(k).lots.push(l) })
  console.log(`${bad.length} car(s) have missing photos, in ${models.size} model(s):`)
  models.forEach((m) => console.log(`  ${m.brand_name} (${m.lots.length}): lot ${m.lots.map((l) => l.lot_no + ' [' + l.auction_date + ']').join(', ')}`))
  if (DRY) { console.log('--dry: nothing scraped.'); return }

  await ensureTargets([...models.values()])
  runScrape('bid', [...models.values()], { hint: 'Run node refresh-photos.js again.' })

  const still = await missingOf(bad.map((l) => l.id))
  console.log(still.length
    ? `\n${bad.length - still.length} restored, ${still.length} still missing (lot ${still.map((l) => l.lot_no).join(', ')}): the car may be gone from the listing (auction over or withdrawn).`
    : `\nAll ${bad.length} restored.`)
}

/** every open car closing soon, whether or not it is in an offer batch */
async function mainOpen() {
  const now = new Date().toISOString(), until = new Date(Date.now() + DAYS * 86400000).toISOString()
  const ids = []
  for (let from = 0; ; from += 1000) {
    const r = await supabase.from('lots').select('id').gt('bid_deadline', now).lt('bid_deadline', until).range(from, from + 999)
    if (r.error) throw new Error('lots: ' + r.error.message)
    ids.push(...r.data.map((x) => x.id))
    if (r.data.length < 1000) break
  }
  console.log(`Checking the photos of ${ids.length} open car(s) closing within ${DAYS} day(s)...`)
  const bad = (await missingOf(ids)).filter((l) => l.maker_code && l.car_code)
  if (!bad.length) { console.log('All photos are there. Nothing to do.'); return }
  const models = new Map()
  bad.forEach((l) => { const k = l.maker_code + '|' + l.car_code; if (!models.has(k)) models.set(k, { maker_code: l.maker_code, car_code: l.car_code, brand_name: l.brand, model_name: String(l.model).split(' ')[0], lots: [] }); models.get(k).lots.push(l) })
  console.log(`${bad.length} car(s) have missing photos, in ${models.size} model(s)`)
  if (DRY) { console.log('--dry: nothing scraped.'); return }
  await ensureTargets([...models.values()])
  runScrape('bid', [...models.values()], { hint: 'Run node refresh-photos.js --open again.' })
  const still = await missingOf(bad.map((l) => l.id))
  console.log(`${bad.length - still.length} restored, ${still.length} still missing (cars of today's auction cannot be restored: the scrape skips the auction that is already running).`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })

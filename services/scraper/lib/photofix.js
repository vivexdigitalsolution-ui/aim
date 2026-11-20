'use strict'

/**
 * lib/photofix.js — finds the OPEN cars whose photos the photo host has deleted (the R2 lifecycle rule), so the scrape can fetch them again.
 * Only cars that can still be restored count: still open for bidding AND on an auction day the scrape still lists (a car of today's auction
 * cannot be restored, and a car that has closed is of no use). Used by scrape.js (the `photos` step of a combined run) and refresh-photos.js.
 */

const supabase = require('./db')
const { firstAuctionDate } = require('./cutoff')

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

/** ids of the open cars closing within `days` days that can still be restored */
async function openLotIds(days = 3) {
  const now = new Date().toISOString(), until = new Date(Date.now() + days * 86400000).toISOString()
  const ids = []
  for (let from = 0; ; from += 1000) {
    const r = await supabase.from('lots').select('id').gt('bid_deadline', now).lt('bid_deadline', until).gte('auction_date', firstAuctionDate()).range(from, from + 999)
    if (r.error) throw new Error('lots: ' + r.error.message)
    ids.push(...r.data.map((x) => x.id))
    if (r.data.length < 1000) break
  }
  return ids
}

/** @returns {Promise<{ bad: object[], models: Map<string, object> }>} the cars with missing photos and the models to scrape again */
async function openMissing(days = 3) {
  const ids = await openLotIds(days)
  console.log(`Checking the photos of ${ids.length} open car(s) closing within ${days} day(s)...`)
  const bad = (await missingOf(ids)).filter((l) => l.maker_code && l.car_code)
  const models = new Map()
  bad.forEach((l) => { const k = l.maker_code + '|' + l.car_code; if (!models.has(k)) models.set(k, { maker_code: l.maker_code, car_code: l.car_code, brand_name: l.brand, model_name: String(l.model).split(' ')[0], lots: [] }); models.get(k).lots.push(l) })
  return { bad, models }
}

module.exports = { gone, missingOf, openLotIds, openMissing }

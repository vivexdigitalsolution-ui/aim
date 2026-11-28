'use strict'

/**
 * lib/asnet/save.js — saves one ASNET car into `one_price_lots`, and removes the ones ASNET no longer lists.
 * The database, the photo download and the link check are handed in, so it can be tested offline.
 *
 * The rules:
 *   - only a row marked source = 'asnet' is ever changed or deleted. A new car is INSERTED (never upserted).
 *   - a saved car only gets its listing fields refreshed: what the sheet reading filled in (year, mileage, chassis ...) is left alone.
 *   - saved photos are fetched again when the photo host answers 404 for the cover or the auction sheet (old photos are removed from storage),
 *     or when the saved list holds one picture twice (saved by the earlier reading, which also missed pictures).
 *   - the same lot number showing a clearly different car is a new car: the old row goes (with its favourites and poster).
 */

const { slotOwner } = require('./map')

const UNIQUE_VIOLATION = '23505'
const core = (c) => String(c || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')

/** Clearly another car: another make, another chassis code, or years more than one apart. (A sheet reading may lengthen the code or correct the year by one.) */
function isOtherCar(old, car) {
  if (old.brand && old.brand !== car.brand) return true
  const a = core(old.model_code), b = core(car.model_code)
  if (a && b && !a.startsWith(b) && !b.startsWith(a)) return true
  return !!(old.mfg_year && car.mfg_year && Math.abs(old.mfg_year - car.mfg_year) > 1)
}

/**
 * @param {object} o
 * @param {object} o.db           Supabase client
 * @param {object} o.car          from rowToCar(), with maker_code / car_code of the target
 * @param {boolean} o.write       false = dry run: only says what would happen
 * @param {(keepOnError:boolean) => Promise<{photos:string[], sheet:string|null, keys:string[], error:string|null}>} o.fetchPhotos
 * @param {(url:string) => Promise<boolean>} o.isGone      true only when the link is clearly "not found"
 * @param {(keys:string[]) => Promise<void>} o.removePhotos
 * @returns {Promise<{status:'would'|'saved'|'updated'|'taken'|'failed', repaired?:boolean, message?:string}>}
 */
async function saveCar({ db, car, write, fetchPhotos, isGone, removePhotos }) {
  if (!write) return { status: 'would' }
  const found = await db.from('one_price_lots').select('id,ex_key,source,photos,sheet_url,brand,model_code,mfg_year').eq('ex_key', car.ex_key).maybeSingle()
  if (found.error) return { status: 'failed', message: 'database: ' + found.error.message }      // not knowing what is saved = do not write
  const owner = slotOwner(car, found.data)
  if (owner === 'taken') return { status: 'taken', message: 'a car of the other source has this key' }

  const old = owner === 'ours' ? found.data : null
  const replace = !!old && isOtherCar(old, car)
  const hasPhotos = !replace && Array.isArray(old?.photos) && old.photos.length > 0
  const doubled = hasPhotos && new Set(old.photos).size < old.photos.length
  const repair = hasPhotos && (doubled || await isGone(old.photos[0]) || (!!old.sheet_url && await isGone(old.sheet_url)))

  let fresh = null
  if (!hasPhotos || repair) {
    // a repair re-uploads to the same keys: after a failure they are kept, so photos that still work are not deleted
    fresh = await fetchPhotos(repair || !!old)
    if (fresh.error && !(old && !replace)) return { status: 'failed', message: 'photos: ' + fresh.error }
  }
  const now = new Date().toISOString()

  if (old && !replace) {
    const patch = {
      venue: car.venue, price_jpy: car.price_jpy, price_masked: false, maker_code: car.maker_code, car_code: car.car_code, last_seen_at: now,
      ...(fresh && !fresh.error ? { photos: fresh.photos, ...(fresh.sheet ? { sheet_url: fresh.sheet } : {}) } : {}),
    }
    const { data, error } = await db.from('one_price_lots').update(patch).eq('id', old.id).eq('source', 'asnet').eq('ex_key', car.ex_key).select('id')
    if (error) return { status: 'failed', message: 'database: ' + error.message }
    if (!data?.length) return { status: 'taken', message: 'the saved row changed while this car was being read' }
    if (fresh?.error) return { status: 'failed', message: 'photos could not be fetched again (price and place were updated): ' + fresh.error }
    return { status: 'updated', repaired: repair }
  }

  if (replace) {
    const del = await db.from('one_price_lots').delete().eq('id', old.id).eq('source', 'asnet')
    if (del.error) return { status: 'failed', message: 'database: ' + del.error.message }
  }
  const { error } = await db.from('one_price_lots').insert({ ...car, photos: fresh.photos, sheet_url: fresh.sheet, last_seen_at: now })
  if (!error) return { status: 'saved', repaired: false, ...(replace ? { message: 'this lot number now shows a different car: the old one was replaced' } : {}) }
  // the folder belongs to this car only, so removing what was just uploaded cannot touch another car
  if (error.code === UNIQUE_VIOLATION) return { status: 'taken', message: 'this car was saved by another run just now' }
  await removePhotos(fresh.keys || [])
  return { status: 'failed', message: 'database: ' + error.message }
}

/** More than this many AND more than half of a model's saved cars disappearing at once looks like a broken search, not sales. */
const MANY = 5

/**
 * Removes the saved cars of one ASNET model that a COMPLETE read of its search no longer found.
 * Call it only after every result page was read; `seen` holds the key of every car on those pages, saved or not.
 * @returns {Promise<{saved:number, gone:object[], removed:number, blocked:boolean, error?:string}>}
 */
async function removeGone({ db, target, seen, write, allowMany = false }) {
  const saved = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('one_price_lots').select('id,ex_key,brand,model').eq('source', 'asnet').eq('maker_code', target.maker_code).eq('car_code', target.car_code).order('id').range(from, from + 999)
    if (error) return { saved: 0, gone: [], removed: 0, blocked: false, error: error.message }
    saved.push(...data)
    if (data.length < 1000) break
  }
  const gone = saved.filter((c) => !seen.has(c.ex_key))
  const result = { saved: saved.length, gone, removed: 0, blocked: !allowMany && gone.length > MANY && gone.length * 2 > saved.length }
  if (!write || result.blocked) return result
  for (let i = 0; i < gone.length; i += 100) {
    const ids = gone.slice(i, i + 100).map((c) => c.id)
    const { error } = await db.from('one_price_lots').delete().eq('source', 'asnet').in('id', ids)
    if (error) return { ...result, error: error.message }
    result.removed += ids.length
  }
  return result
}

module.exports = { saveCar, removeGone, isOtherCar }

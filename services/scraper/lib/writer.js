'use strict'

/**
 * lib/writer.js — all database writes of the scraper, into the Auction project's own tables:
 *   lots          tomorrow's cars   (unique: venue + auction_date + lot_no)
 *   lot_history   sold prices       (unique: venue + auction_date + lot_no)
 * Nothing written here may name the source site or any company: the venue is stored as a plain name ("Yokohama").
 */

const supabase = require('./db')
const { isOthersGrade } = require('./rules')

const JST = '+09:00'

/** "USS Yokohama" / "Yokohama-Counter-1" / "  yokohama " -> "Yokohama" (no source prefix, no counter suffix). */
function cleanVenue(raw) {
  let v = String(raw || '').replace(/^\s*USS[\s-]*/i, '').replace(/[-\s]*Counter[-\s]*\d+\s*$/i, '').trim()
  if (!v) return 'Unknown'
  return v.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** USS shift codes: "FA"/"IA"/"CA" = automatic, "F5"/"F6"/"C5" = manual, anything with CVT = CVT. Unknown codes are kept as-is. */
function mapTransmission(raw) {
  const t = String(raw || '').trim().toUpperCase()
  if (!t) return null
  if (t.includes('CVT')) return 'CVT'
  if (/^[A-Z]?A$/.test(t) || t.includes('AT')) return 'AT'
  if (/^[A-Z]?[3-7]$/.test(t) || t.includes('MT')) return 'MT'
  return t
}

/** Japan auction date + time -> a timestamp with the Japan offset (the app shows it in Malaysia time). No time = end of that day. */
function toDeadline(date, time) {
  if (!date) return null
  const t = String(time || '').trim()
  const hhmmss = /^\d{1,2}:\d{2}$/.test(t) ? `${t.padStart(5, '0')}:00` : /^\d{1,2}:\d{2}:\d{2}$/.test(t) ? t.padStart(8, '0') : '23:59:00'
  return `${date}T${hhmmss}${JST}`
}

/** "M3" + "M3 SEDAN COMPETITION" -> "M3 SEDAN COMPETITION" (no doubled model name); "3 SERIES" + "320I" -> "3 SERIES 320I". */
function fullModel(modelName, grade) {
  const m = String(modelName || '').trim(), g = String(grade || '').trim()
  if (!g) return m
  if (g.toUpperCase().startsWith(m.toUpperCase())) return g
  // the grade may repeat the end of the model name (model "STEPWAGON SPADA" + grade "SPADA PREMIUM LINE"): join them once, not "SPADA SPADA"
  const mw = m.split(/\s+/), gw = g.split(/\s+/)
  for (let k = Math.min(mw.length, gw.length); k > 0; k--) {
    if (mw.slice(-k).join(' ').toUpperCase() === gw.slice(0, k).join(' ').toUpperCase()) return [...mw, ...gw.slice(k)].join(' ')
  }
  return `${m} ${g}`
}

// ── lots ─────────────────────────────────────────────────────────────────────

/** Does this listing already have its photos saved? (so a re-run only refreshes price/time instead of downloading images again) */
async function findExistingLot(exKey, auctionDate) {
  const { data } = await supabase.from('lots')
    .select('id, bid_deadline, start_price_jpy, photos').eq('ex_key', exKey).eq('auction_date', auctionDate).maybeSingle()
  if (!(data && Array.isArray(data.photos) && data.photos.length > 0)) return null
  // the saved cover link must really load: a link the photo host answers 404 means the images never landed, so the lot is treated as new and its photos are fetched again
  if (await coverIsGone(data.photos[0])) { console.log(`  [photos] saved cover link is dead (404), downloading the photos again`); return null }
  return data
}

/** true only when the photo host clearly says "not found"; a network error or any other answer keeps the saved photos */
async function coverIsGone(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) })
    return r.status === 404
  } catch { return false }
}

/** Refresh the fields that can change after the first scrape. */
async function updateLiveLot(id, row, target) {
  // a row with no closing time must not wipe a real time saved earlier with the 23:59 placeholder: keep what is saved
  const hasTime = /^\d{1,2}:\d{2}/.test(String(row.auction_time || '').trim())
  const { error } = await supabase.from('lots').update({
    ...(hasTime ? { bid_deadline: toDeadline(row.auction_date, row.auction_time) } : {}), start_price_jpy: row.start_price ?? null,
    ...(target ? { maker_code: target.maker_code, car_code: target.car_code } : {}),
  }).eq('id', id)
  if (error) console.log(`  [DB] lot update error: ${error.message}`)
  return !error
}

/**
 * @param {object} row     normalized row from scrape.js
 * @param {object} target  scrape_targets row (brand / model names)
 * @param {Array}  images  from images.js
 * @returns {{id:string, isNew:boolean}|null}
 */
async function upsertLot(row, target, images) {
  const sheet  = images.find((i) => i.suffix === 'sheet')
  const photos = images.filter((i) => i.imageType !== 'document').map((i) => i.fullUrl)

  const record = {
    ex_key: row.ex_key,
    venue: cleanVenue(row.venue),
    auction_date: row.auction_date,
    lot_no: String(row.lot_number ?? row.ex_key),
    bid_deadline: toDeadline(row.auction_date, row.auction_time),
    brand: target.brand_name,
    maker_code: target.maker_code,
    car_code: target.car_code,
    model: fullModel(target.model_name, row.grade),
    model_code: row.model_code || null,
    grade: row.auction_grade || null,
    interior_grade: row.raw_extra?.score_letter || null,
    mfg_year: row.manufacture_year ?? null,
    mileage_km: row.mileage_km ?? null,
    engine_cc: row.engine_cc ?? null,
    transmission: mapTransmission(row.transmission_raw),
    color: row.color || null,
    start_price_jpy: row.start_price ?? null,
    equipment: row.equipment_raw || null,
    photos,
    sheet_url: sheet?.fullUrl || null,
  }

  const { data: existing } = await supabase.from('lots').select('id')
    .eq('venue', record.venue).eq('auction_date', record.auction_date).eq('lot_no', record.lot_no).maybeSingle()

  const { data, error } = await supabase.from('lots')
    .upsert(record, { onConflict: 'venue,auction_date,lot_no' }).select('id').single()
  if (error) { console.log(`  [DB] lot upsert error: ${error.message}`); return null }
  return { id: data.id, isNew: !existing }
}

// ── scraped_models ───────────────────────────────────────────────────────────

/**
 * Called by the bid scrape once per target that found cars. The first time a model is seen it is added to scraped_models and its
 * history target is switched on, so history is only ever scraped for models we really have cars of. Seen before: only last_seen_at moves.
 * @returns {boolean} true when the model is new
 */
async function recordScrapedModel(target) {
  const { data: have, error } = await supabase.from('scraped_models').select('maker_code').eq('maker_code', target.maker_code).eq('car_code', target.car_code).maybeSingle()
  if (error) { console.log(`  [DB] scraped_models lookup error: ${error.message}`); return false }
  const now = new Date().toISOString()
  if (have) {
    await supabase.from('scraped_models').update({ last_seen_at: now }).eq('maker_code', target.maker_code).eq('car_code', target.car_code)
    return false
  }
  const ins = await supabase.from('scraped_models').insert({ maker_code: target.maker_code, car_code: target.car_code, brand_name: target.brand_name, model_name: target.model_name })
  if (ins.error) { console.log(`  [DB] scraped_models insert error: ${ins.error.message}`); return false }
  await supabase.from('scrape_targets').update({ enabled: true }).eq('lot_type', 'history').eq('maker_code', target.maker_code).eq('car_code', target.car_code)
  console.log(`  [MODEL] new model ${target.brand_name} / ${target.model_name}: history scrape switched on`)
  return true
}

// ── lot_history ──────────────────────────────────────────────────────────────

async function findExistingHistoryKeys(exKeys) {
  if (!exKeys.length) return new Set()
  const { data, error } = await supabase.from('lot_history').select('ex_key').in('ex_key', exKeys)
  if (error) { console.log(`  [DB] history lookup error: ${error.message}`); return new Set() }
  return new Set((data || []).map((r) => r.ex_key))
}

/** rows: { ex_key, venue_name, auction_date, lot_no, grade, model_code, manufacture_year, mileage_km, engine_cc, shift_type, color, won_price, auction_grade } */
async function upsertHistory(rows, target) {
  if (!rows.length) return { ok: true }
  const records = rows.map((r) => ({
    ex_key: r.ex_key,
    venue: cleanVenue(r.venue_name),
    auction_date: r.auction_date,
    lot_no: String(r.lot_no ?? r.ex_key),
    brand: target.brand_name,
    model: fullModel(target.model_name, r.grade),
    grade: r.auction_grade || null,
    model_code: r.model_code || null,
    mfg_year: r.manufacture_year ?? null,
    mileage_km: r.mileage_km ?? null,
    engine_cc: r.displacement_cc ?? null,
    transmission: mapTransmission(r.shift_type),
    color: r.color || null,
    result: 'sold',
    sold_price_jpy: r.won_price,
  }))
  // one row per venue+date+lot inside a single upsert
  const byKey = new Map(records.map((r) => [`${r.venue}|${r.auction_date}|${r.lot_no}`, r]))
  const { error } = await supabase.from('lot_history').upsert([...byKey.values()], { onConflict: 'venue,auction_date,lot_no' })
  if (error) { console.log(`  [DB] history upsert error: ${error.message}`); return { ok: false, error: error.message } }
  return { ok: true }
}

// ── variant names seen (the pick list on the Scrape targets page) ───────────────

/** Remember the variant names found on one listing page, so staff can pick them as a filter. */
async function recordGrades(target, names) {
  const uniq = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))]
  if (!uniq.length) return
  const now = new Date().toISOString()
  const { data } = await supabase.from('scraper_grades').select('name, seen').eq('maker_code', target.maker_code).eq('car_code', target.car_code).in('name', uniq)
  const seen = new Map((data || []).map((r) => [r.name, r.seen]))
  const { error } = await supabase.from('scraper_grades').upsert(uniq.map((name) => ({ maker_code: target.maker_code, car_code: target.car_code, name, seen: (seen.get(name) || 0) + 1, last_seen: now })), { onConflict: 'maker_code,car_code,name' })
  if (error) console.log(`  [DB] grades save error: ${error.message}`)
}

// ── one_price_lots ───────────────────────────────────────────────────────────

async function findExistingOnePrice(exKey) {
  const { data } = await supabase.from('one_price_lots').select('id, photos').eq('ex_key', exKey).maybeSingle()
  return data && Array.isArray(data.photos) && data.photos.length ? data : null
}

/** A car already saved with photos only gets its price and end time refreshed. */
async function updateOnePrice(id, row) {
  const { error } = await supabase.from('one_price_lots').update({
    deadline: toDeadline(row.auction_date, row.auction_time), price_jpy: row.wholesale_price ?? null,
    price_masked: !!row.raw_extra?.price_masked, price_reveal: toDeadline(row.raw_extra?.price_reveal_date, row.raw_extra?.price_reveal_time), last_seen_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) console.log(`  [DB] one price update error: ${error.message}`)
  return !error
}

/** @returns {{id:string, isNew:boolean}|null} */
async function upsertOnePrice(row, target, images) {
  const sheet = images.find((i) => i.suffix === 'sheet')
  const photos = images.filter((i) => i.imageType !== 'document').map((i) => i.fullUrl)
  const { data: had } = await supabase.from('one_price_lots').select('id').eq('ex_key', row.ex_key).maybeSingle()
  const record = {
    ex_key: row.ex_key, venue: cleanVenue(row.venue), deadline: toDeadline(row.auction_date, row.auction_time),
    brand: target.brand_name, model: target.model_name, maker_code: target.maker_code, car_code: target.car_code,
    grade: row.grade || null, model_code: row.model_code || null, mfg_year: row.manufacture_year ?? null, mileage_km: row.mileage_km ?? null,
    engine_cc: row.engine_cc ?? null, transmission: mapTransmission(row.transmission_raw), color: row.color || null, auction_grade: row.auction_grade || null,
    price_jpy: row.wholesale_price ?? null, price_masked: !!row.raw_extra?.price_masked, price_reveal: toDeadline(row.raw_extra?.price_reveal_date, row.raw_extra?.price_reveal_time),
    equipment: row.equipment_raw || null, photos, sheet_url: sheet?.fullUrl || null, last_seen_at: new Date().toISOString(),
  }
  const { data, error } = await supabase.from('one_price_lots').upsert(record, { onConflict: 'ex_key' }).select('id').single()
  if (error) { console.log(`  [DB] one price save error: ${error.message}`); return null }
  return { id: data.id, isNew: !had }
}

module.exports = { isOthersGrade, cleanVenue, mapTransmission, toDeadline, fullModel, findExistingLot, updateLiveLot, upsertLot, recordScrapedModel, findExistingHistoryKeys, upsertHistory, recordGrades, findExistingOnePrice, updateOnePrice, upsertOnePrice }

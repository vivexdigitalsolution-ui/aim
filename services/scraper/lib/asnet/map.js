'use strict'

/**
 * lib/asnet/map.js — turns one extracted ASNET list row (lib/asnet/extract.js) into a car of `one_price_lots`, and matches ASNET's
 * make and model names with ours. Pure: no browser, no database.
 * Only ASNET's AS-One Price cars are wanted: a fixed price, no auction date and no end date on the list.
 */

const crypto = require('crypto')
// names ASNET writes differently (the Scrape targets page reads the same file):
//   models: { MAKE: { our model: [ASNET models] } }   used to FIND our models on ASNET
//   makes:  { our make: { make: ASNET make, model?: the one ASNET model that holds all of that make } }
//   names:  { MAKE: { ASNET model: our name } }       used to NAME a saved car the way the other source names it
const { models: MODEL_ALIASES, makes: MAKE_ALIASES, names: SAVED_NAMES } = require('./aliases.json')
const { cleanVenue, mapTransmission } = require('../writer')

/**
 * The car's own key, also the name of its photo folder. The ASNET lot number is the only identity a fixed-price car has.
 * It is a code that names nothing: the photo link is visible to users and must not show the source.
 */
const exKey = (lotNo) => crypto.createHash('sha256').update('3|' + String(lotNo).replace(/\s+/g, '').toUpperCase()).digest('hex').slice(0, 32)

/** Who holds the saved row with this key: nobody ('free'), this ASNET car ('ours'), or a car of another source ('taken'). */
const slotOwner = (car, existing) => !existing ? 'free' : existing.source === 'asnet' && existing.ex_key === car.ex_key ? 'ours' : 'taken'

/** ASNET shows only the prefecture. The 47 of them, as the app shows them. */
const PREFECTURES = {
  北海道: 'Hokkaido', 青森県: 'Aomori', 岩手県: 'Iwate', 宮城県: 'Miyagi', 秋田県: 'Akita', 山形県: 'Yamagata', 福島県: 'Fukushima',
  茨城県: 'Ibaraki', 栃木県: 'Tochigi', 群馬県: 'Gunma', 埼玉県: 'Saitama', 千葉県: 'Chiba', 東京都: 'Tokyo', 神奈川県: 'Kanagawa',
  新潟県: 'Niigata', 富山県: 'Toyama', 石川県: 'Ishikawa', 福井県: 'Fukui', 山梨県: 'Yamanashi', 長野県: 'Nagano', 岐阜県: 'Gifu',
  静岡県: 'Shizuoka', 愛知県: 'Aichi', 三重県: 'Mie', 滋賀県: 'Shiga', 京都府: 'Kyoto', 大阪府: 'Osaka', 兵庫県: 'Hyogo', 奈良県: 'Nara',
  和歌山県: 'Wakayama', 鳥取県: 'Tottori', 島根県: 'Shimane', 岡山県: 'Okayama', 広島県: 'Hiroshima', 山口県: 'Yamaguchi',
  徳島県: 'Tokushima', 香川県: 'Kagawa', 愛媛県: 'Ehime', 高知県: 'Kochi', 福岡県: 'Fukuoka', 佐賀県: 'Saga', 長崎県: 'Nagasaki',
  熊本県: 'Kumamoto', 大分県: 'Oita', 宮崎県: 'Miyazaki', 鹿児島県: 'Kagoshima', 沖縄県: 'Okinawa',
}

/** "千葉県" -> "Chiba". Text that is already in English is kept; any other Japanese text becomes "Japan". */
function venueName(location) {
  const s = String(location || '').trim()
  if (PREFECTURES[s]) return PREFECTURES[s]
  return s && /^[\x20-\x7E]+$/.test(s) ? cleanVenue(s) : 'Japan'
}

/** Is this the wanted sale type? "AS-One Price", with or without the star mark. */
const isAsOne = (method) => /^\s*AS[-\s]*One/i.test(String(method || ''))

/** ASNET writes some model names with the make in front ("MINI CLUBMAN" where we say "CLUBMAN"). The name without it; unchanged when there is none. */
function bareModel(brand, model) {
  const b = String(brand || '').trim().toUpperCase(), m = String(model || '').trim()
  return b && m.toUpperCase().startsWith(b + ' ') ? m.slice(b.length).trim() : m
}

/** Normalised name for matching an ASNET dropdown entry to a name we already know: letters and digits only. */
const nameKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Is this ASNET model one of the names we already have? Tried as written and without the make in front. `want` = Set of nameKey(model) */
const wantedModel = (want, brand, model) => !!want && (want.has(nameKey(model)) || want.has(nameKey(bareModel(brand, model))))

/** Some of our names carry a count from a pick list: "CT5 (7)" -> "CT5". A bracket with letters ("COPEN(TOYOTA)") stays. */
const stripCount = (name) => String(name || '').replace(/\s*\(\d+\)\s*$/, '').trim()

/** Where one of our models sits on ASNET: usually the same make, but "ABARTH 595" is the model "ABARTH" of the make FIAT. */
function onAsnet(brand, model) {
  const a = MAKE_ALIASES[String(brand || '').trim().toUpperCase()]
  return { brand: a?.make || brand, model: a?.model || stripCount(model) }
}

/** The other way round, so a saved car carries the make name we use (the filters compare it). */
function ourMake(asnetMake, asnetModel) {
  const make = String(asnetMake || '').trim().toUpperCase(), model = nameKey(asnetModel)
  const hit = Object.entries(MAKE_ALIASES).find(([, a]) => a.make === make && (!a.model || nameKey(a.model) === model))
  return hit ? hit[0] : make
}

/** makes whose ASNET model names repeat the make */
const MAKE_IN_FRONT = ['MINI', 'CADILLAC', 'DODGE']

/** The model name a saved car gets. */
function savedModel(brand, asnetModel) {
  const name = String(asnetModel || '').trim().toUpperCase()
  const listed = SAVED_NAMES[brand]?.[name]
  if (listed) return listed
  return MAKE_IN_FRONT.includes(brand) ? bareModel(brand, name) : name
}

/** Every nameKey that one of our models may go by on ASNET. */
function keysOfOurs(brand, model) {
  const name = stripCount(model).toUpperCase()
  const other = MODEL_ALIASES[String(brand || '').trim().toUpperCase()]?.[name] || []
  return [name, ...other].map(nameKey).filter(Boolean)
}

/**
 * Which of one make's ASNET models are ours?
 * @param {string} brand      ASNET make name
 * @param {string[]} ours     our model names of that make
 * @param {{code:string,name:string}[]} cars  every ASNET model of that make
 * @returns {{keep:object[], missing:string[]}}  keep = ASNET models to list, missing = our models with no ASNET model
 */
function matchModels(brand, ours, cars) {
  const keys = ours.map((m) => ({ name: m, keys: new Set(keysOfOurs(brand, m)) }))
  const keep = cars.filter((c) => keys.some((o) => wantedModel(o.keys, brand, c.name)))
  return { keep, missing: keys.filter((o) => !keep.some((c) => wantedModel(o.keys, brand, c.name))).map((o) => o.name) }
}

/** Some listing texts arrive encoded twice: "SOUND &amp; MONITOR" -> "SOUND & MONITOR". */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" }
const decode = (s) => String(s || '').replace(/&(amp|lt|gt|quot|apos|#39);/gi, (_, e) => ENTITIES[e.toLowerCase()])

/**
 * @param {object} row  from extractRows()
 * @returns {object|null} the one_price_lots record without photos and without the target codes (null when the row cannot be used)
 */
function rowToCar(row) {
  if (!row.lot_no || !row.make || !row.car_name) return null
  const make = row.make.toUpperCase(), name = row.car_name.toUpperCase(), variant = decode(row.grade).trim().toUpperCase()
  const brand = ourMake(make, name)
  const moved = MAKE_ALIASES[brand]?.model      // a make that ASNET files as one model ("FIAT" / "ABARTH"): the variant says which car it is
  return {
    ex_key: exKey(row.lot_no),
    venue: venueName(row.location),
    deadline: null,                              // the list gives no end: the car stays until a later full run no longer finds it
    brand,
    model: moved ? variant || name : savedModel(brand, name),
    grade: variant || null,
    model_code: row.model_code_raw && row.model_code_raw !== '-1' ? row.model_code_raw.toUpperCase() : null,
    auction_grade: row.score_grade || null,
    mfg_year: row.mfg_year_western ?? null,
    mileage_km: row.mileage ?? null,
    engine_cc: row.engine_cc ?? null,
    transmission: mapTransmission(row.gear),
    color: row.color || null,
    price_jpy: row.wholesale_price ?? null,      // the list's "Start or wholesale price" (K yen): for AS-One Price it is the fixed price
    price_masked: false,
    source: 'asnet',
  }
}

module.exports = { exKey, slotOwner, venueName, isAsOne, bareModel, nameKey, wantedModel, stripCount, onAsnet, ourMake, savedModel, matchModels, rowToCar }

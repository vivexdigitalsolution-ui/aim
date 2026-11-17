// Example of how the (copied) scraper should write into THIS app's database.
// Use the SERVICE ROLE key in the scraper's own .env — it bypasses RLS. Never put it in the app or commit it.
//
//   AUCTION_SUPABASE_URL=https://xxxx.supabase.co  AUCTION_SERVICE_KEY=...  node scripts/ingest-example.mjs
//
// Rules:
//  - Only send Malaysia-eligible venues/days (e.g. tomorrow's Yokohama). Show only the plain venue name ("Yokohama") — strip any source-site prefix or brand, the app must not name the source. The database also marks cars older than
//    the age limit as my_eligible = false, and the app never shows those.
//  - bid_deadline MUST carry the Japan offset: '2026-11-05T12:58:00+09:00'. The app converts it to Malaysia time.
//  - Re-running is safe: the unique key is (venue, auction_date, lot_no), so it updates instead of duplicating.
//  - Sold prices of finished auctions go to lot_history the same way (result 'sold' or 'unsold').
import { createClient } from '@supabase/supabase-js'

const db = createClient(process.env.AUCTION_SUPABASE_URL, process.env.AUCTION_SERVICE_KEY, { auth: { persistSession: false } })

const lots = [{
  venue: 'Yokohama', auction_date: '2026-11-05', lot_no: '65384',
  bid_deadline: '2026-11-05T12:58:00+09:00',
  brand: 'BMW', model: 'M3 SEDAN COMPETITION M X DRIVE 3.0 (A)', model_code: '3BA-32AY30',
  grade: '4.5', interior_grade: 'B', mfg_year: 2024, mfg_month: 6, mileage_km: 19000, engine_cc: 2992,
  transmission: 'AT', fuel: 'Petrol', drive: '4WD', color: 'grey', chassis_no: 'WBS42AY0XXXXXXXXX',
  start_price_jpy: 6500000, equipment: 'Carbon roof, M compound brakes', notes: null, inspector_report: null,
  photos: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'], sheet_url: 'https://example.com/sheet.jpg',
}]

const { error } = await db.from('lots').upsert(lots, { onConflict: 'venue,auction_date,lot_no' })
if (error) throw error
console.log('lots upserted:', lots.length)

const history = [{ venue: 'Yokohama', auction_date: '2026-10-29', lot_no: '12001', brand: 'BMW', model: 'M3', grade: '4.5', mfg_year: 2024, mileage_km: 15000, engine_cc: 2992, transmission: 'AT', color: 'white', result: 'sold', sold_price_jpy: 9100000 }]
const h = await db.from('lot_history').upsert(history, { onConflict: 'venue,auction_date,lot_no' })
if (h.error) throw h.error
console.log('history upserted:', history.length)

'use strict'

/**
 * alerts.js — the alerts that are not instant (the instant ones are database triggers, migration 27), and the email / WhatsApp copies.
 *
 *   node alerts.js                 all three steps
 *   node alerts.js --only close    staff: bid orders still NOT placed whose car closes soon (run this every 15 minutes)
 *   node alerts.js --only match    dealers: new cars that fit their buy list (run daily, after the snapshot)
 *   node alerts.js --only watch    dealers: a car on their watchlist closes soon (run with the 15-minute job)
 *   node alerts.js --only prefs   dealers: new cars that fit a saved preference (run daily after the scrape); app, email and phone as each preference says
 *   node alerts.js --only top5    staff: a DRAFT personal list per dealer (run daily, after the snapshot; nothing is sent until staff press Send)
 *   node alerts.js --only send     email / WhatsApp copies of new alerts (only the channels whose keys are in .env)
 *   node alerts.js --dry           show what would happen, change nothing, send nothing
 *
 * Setup: docs/alerts-setup.md.
 */

require('dotenv').config()
const path = require('path')
const { pathToFileURL } = require('url')
const supabase = require('./lib/db')
const notify = require('./lib/notify')
const fcm = require('./lib/fcm')

const has = (n) => process.argv.includes(n)
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const only = (arg('--only') || '').split(',').filter(Boolean)
const run = (s) => !only.length || only.includes(s)
const DRY = has('--dry')
const CLOSE_HOURS = Number(process.env.ALERT_CLOSE_HOURS || 3)
const WATCH_HOURS = Number(process.env.ALERT_WATCH_HOURS || 6)
const RECON = 3000

async function closeSoon() {
  const soon = new Date(Date.now() + CLOSE_HOURS * 3600_000).toISOString()
  const { data: bids, error } = await supabase.from('bids').select('id,max_bid_jpy,ap:profiles!ap_id(company_name,contact_name),lots!inner(brand,model,venue,lot_no,bid_deadline)').eq('status', 'pending').gt('lots.bid_deadline', new Date().toISOString()).lt('lots.bid_deadline', soon)
  if (error) throw new Error(error.message)
  const staff = (await supabase.from('profiles').select('id').in('role', ['admin', 'staff']).eq('status', 'active')).data || []
  const rows = []
  for (const b of bids || []) {
    const mins = Math.round((new Date(b.lots.bid_deadline) - Date.now()) / 60000)
    for (const s of staff) rows.push({ user_id: s.id, kind: 'closing_soon', title: `Place before it closes: ${b.lots.brand} ${b.lots.model}`, body: `${b.ap?.company_name || b.ap?.contact_name || 'A dealer'} · JPY ${Number(b.max_bid_jpy).toLocaleString('en-US')} · closes in ${mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + ' min'} (${b.lots.venue} lot ${b.lots.lot_no})`, link: '/bids', dedupe: 'close:' + b.id })
  }
  console.log(`close: ${bids?.length || 0} unplaced order(s) closing within ${CLOSE_HOURS}h -> ${rows.length} alert(s) for ${staff.length} staff`)
  if (DRY || !rows.length) return
  const { error: e } = await supabase.from('notifications').upsert(rows, { onConflict: 'user_id,dedupe', ignoreDuplicates: true })
  if (e) throw new Error(e.message)
}

async function loadSegmentMap() {
  const { data, error } = await supabase.from('segment_models').select('segment_key,brand,model')
  if (error) throw new Error(/segment_models/.test(error.message) ? 'segments missing: run migration 30 first' : error.message)
  const map = {}
  for (const r of data || []) (map[r.segment_key] = map[r.segment_key] || []).push({ brand: r.brand, model: r.model || '' })
  return map
}

// dealers: a starred car closes soon
async function watchClosing() {
  const soon = new Date(Date.now() + WATCH_HOURS * 3600_000).toISOString()
  const { data, error } = await supabase.from('watchlist').select('ap_id,lot_id,ap:profiles!ap_id(status),lots!inner(id,brand,model,bid_deadline,venue,lot_no)').gt('lots.bid_deadline', new Date().toISOString()).lt('lots.bid_deadline', soon)
  if (error) throw new Error(/watchlist/.test(error.message) ? 'watchlist missing: run migration 30 first' : error.message)
  const rows = (data || []).filter((w) => w.ap?.status === 'active').map((w) => {
    const mins = Math.round((new Date(w.lots.bid_deadline) - Date.now()) / 60000)
    return { user_id: w.ap_id, kind: 'watch_closing', lot_id: w.lot_id, title: `Closing soon: ${w.lots.brand} ${w.lots.model}`, body: `On your watchlist · closes in ${mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + ' min'} (${w.lots.venue} lot ${w.lots.lot_no})`, link: '/cars/' + w.lot_id, dedupe: 'watch:' + w.lot_id }
  })
  console.log(`watch: ${rows.length} starred car(s) closing within ${WATCH_HOURS}h`)
  if (DRY || !rows.length) return
  const { error: e } = await supabase.from('notifications').upsert(rows, { onConflict: 'user_id,dedupe', ignoreDuplicates: true })
  if (e) throw new Error(e.message)
}

// staff: a DRAFT personal list per dealer (nothing is sent; the dealer sees nothing until staff press Send on the Dealer lists page)
async function draftTop5(core) {
  const { loadBoard } = require('./lib/board')
  const { data: lists, error } = await supabase.from('buy_lists').select('*, ap:profiles!ap_id(id,status,tier,role,company_name,contact_name)')
  if (error) throw new Error(error.message)
  const dealers = (lists || []).filter((l) => l.ap?.status === 'active' && l.ap.role === 'ap_holder' && l.ap.tier !== 'free')
  console.log(`top5: ${dealers.length} dealer(s) with a buy list`)
  if (!dealers.length) return
  const segMap = await loadSegmentMap()
  const board = await loadBoard(core)
  const since = new Date(Date.now() - 7 * 86400_000).toISOString()
  let made = 0
  for (const l of dealers) {
    const name = l.ap.company_name || l.ap.contact_name || 'dealer'
    const recent = (await supabase.from('dealer_lists').select('draft,revoked,items,created_at').eq('ap_id', l.ap_id).gt('created_at', since)).data || []
    if (recent.some((r) => r.draft)) { console.log(`  ${name}: a draft is already waiting`); continue }
    const sent = new Set(recent.filter((r) => !r.revoked).flatMap((r) => (r.items || []).map((i) => i.lot_id)))
    const bl = { brands: l.brands, models: l.models, segments: l.segments || [], year_from: l.year_from, budget_myr: l.budget_myr != null ? Number(l.budget_myr) : null, min_margin_pct: Number(l.min_margin_pct) }
    const s = { targetPct: bl.min_margin_pct, reconMyr: RECON, apFeeMyr: board.fees.apFeeMyr }
    const fits = board.lots.map((x) => board.evaluate(x, s)).filter((c) => c.market && c.sellMyr && c.dutyMyr != null && c.atHistory && !sent.has(c.id)
      && core.matchesBuyList(bl, { brand: c.brand, model: c.model, year: c.mfg_year, landedMyr: c.atHistory.landedMyr + RECON, marginPct: c.atHistory.marginPct }, segMap).ok)
      .map((c) => ({ ...c, marginPct: c.atHistory.marginPct, closesAt: c.bid_deadline }))
    const top = core.rankForDealer(fits).slice(0, Math.max(1, Math.min(5, l.aps_left ?? 5)))
    if (!top.length) { console.log(`  ${name}: no new car fits`); continue }
    const items = top.map((c) => { const r = c.market.row; return {
      lot_id: c.id, title: `${c.brand} ${c.model}`, year: c.mfg_year, km: c.mileage_km, grade: c.grade, photo: c.photos?.[0] || null, venue: c.venue, auction_date: c.auction_date, closes_at: c.bid_deadline,
      market_low: r.p25_myr, market_typical: r.median_myr, market_high: r.p75_myr, market_n: r.n, market_source: r.source || 'carznexus', confidence: c.confidence, wider: c.market.wider,
      usual_jpy: c.history?.price ?? null, max_bid_jpy: c.maxBid, landed_myr: c.atHistory.landedMyr, sell_myr: c.sellMyr, profit_myr: c.atHistory.profitMyr, margin_pct: c.atHistory.marginPct, target_pct: bl.min_margin_pct, jpy_rate: board.rate } })
    const message = core.listMessage({ dealer: l.ap.company_name || l.ap.contact_name || '', count: items.length, url: '[link]', expiresDays: 7 }).replace('[link]', '').trim()
    console.log(`  ${name}: draft with ${items.length} car(s), best margin ${items[0].margin_pct}%`)
    made++
    if (DRY) continue
    const { error: e } = await supabase.from('dealer_lists').insert({ ap_id: l.ap_id, draft: true, auto: true, message, items, expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() })
    if (e) throw new Error(e.message)
  }
  if (DRY || !made) return
  const staff = (await supabase.from('profiles').select('id').in('role', ['admin', 'staff']).eq('status', 'active')).data || []
  const day = new Date().toISOString().slice(0, 10)
  const { error: e } = await supabase.from('notifications').upsert(staff.map((u) => ({ user_id: u.id, kind: 'top5_draft', title: `${made} personal list draft${made === 1 ? '' : 's'} ready to send`, body: 'Check them and press Send on the Dealer lists page.', link: '/lists', dedupe: 'top5:' + day })), { onConflict: 'user_id,dedupe', ignoreDuplicates: true })
  if (e) throw new Error(e.message)
}

async function matchBuyLists(core) {
  const { loadBoard } = require('./lib/board')
  const segMap = await loadSegmentMap()
  const { data: lists, error } = await supabase.from('buy_lists').select('*, ap:profiles!ap_id(id,status,tier,role,company_name,contact_name)')
  if (error) throw new Error(/buy_lists/.test(error.message) ? 'buy_lists missing: run migration 26 first' : error.message)
  const dealers = (lists || []).filter((l) => l.ap?.status === 'active' && l.ap.role === 'ap_holder' && l.ap.tier !== 'free')
  console.log(`match: ${dealers.length} dealer(s) with a buy list`)
  if (!dealers.length) return
  const board = await loadBoard(core)
  const out = []
  for (const l of dealers) {
    const bl = { brands: l.brands, models: l.models, segments: l.segments || [], year_from: l.year_from, budget_myr: l.budget_myr != null ? Number(l.budget_myr) : null, min_margin_pct: Number(l.min_margin_pct) }
    const s = { targetPct: bl.min_margin_pct, reconMyr: RECON, apFeeMyr: board.fees.apFeeMyr }
    const fits = board.lots.map((x) => board.evaluate(x, s)).filter((c) => c.atHistory && core.matchesBuyList(bl, { brand: c.brand, model: c.model, year: c.mfg_year, landedMyr: c.atHistory.landedMyr + RECON, marginPct: c.atHistory.marginPct }, segMap).ok)
    const seen = new Set(((await supabase.from('buy_list_seen').select('lot_id').eq('ap_id', l.ap_id)).data || []).map((r) => r.lot_id))
    const fresh = core.rankForDealer(fits.filter((c) => !seen.has(c.id)).map((c) => ({ ...c, marginPct: c.atHistory.marginPct, closesAt: c.bid_deadline })))
    if (!fresh.length) continue
    console.log(`  ${l.ap.company_name || l.ap.contact_name}: ${fresh.length} new car(s) fit`)
    out.push({ ap: l.ap_id, fresh })
  }
  if (DRY || !out.length) return
  for (const o of out) {
    const top = o.fresh.slice(0, 3).map((c) => `${c.brand} ${c.model} ${c.mfg_year || ''} · ${c.atHistory.marginPct}% margin`).join('\n')
    const n = await supabase.from('notifications').insert({ user_id: o.ap, kind: 'buy_list', title: `${o.fresh.length} new car${o.fresh.length === 1 ? '' : 's'} fit your buy list`, body: top + (o.fresh.length > 3 ? `\n+ ${o.fresh.length - 3} more` : ''), link: '/today' })
    if (n.error) throw new Error(n.error.message)
    const s = await supabase.from('buy_list_seen').upsert(o.fresh.map((c) => ({ ap_id: o.ap, lot_id: c.id })), { onConflict: 'ap_id,lot_id', ignoreDuplicates: true })
    if (s.error) throw new Error(s.error.message)
  }
}

// dealers: new cars that fit one of their saved preferences (My preferences)
async function matchPreferences() {
  const { data: prefs, error } = await supabase.from('saved_preferences').select('*, ap:profiles!user_id(id,status,role)')
  if (error) throw new Error(error.message)
  const active = (prefs || []).filter((p) => p.ap?.status === 'active' && p.ap.role === 'ap_holder' && (p.notify_app || p.notify_email || p.notify_push))
  console.log(`prefs: ${active.length} saved preference(s) with alerts on`)
  if (!active.length) return
  const lots = []
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await supabase.from('lots').select('id,brand,model,grade,mfg_year,start_price_jpy').gt('bid_deadline', new Date().toISOString()).eq('my_eligible', true).range(from, from + 999)
    if (e) throw new Error(e.message)
    lots.push(...(data || []))
    if ((data || []).length < 1000) break
  }
  const rate = Number((await supabase.from('currency_rates').select('rate').eq('from_currency', 'JPY').eq('to_currency', 'MYR').order('rate_date', { ascending: false }).limit(1)).data?.[0]?.rate) || 0
  const rank = (g) => (String(g).toUpperCase() === 'S' ? 7 : Number(g))
  const today = new Date().toISOString().slice(0, 10)
  for (const p of active) {
    const brands = (p.brands || []).map((x) => x.toUpperCase()), models = (p.models || []).map((x) => x.toUpperCase())
    const fits = lots.filter((l) =>
      (!brands.length || brands.includes(String(l.brand).toUpperCase())) &&
      (!models.length || models.some((m) => String(l.model).toUpperCase().includes(m))) &&
      (!p.year_from || (l.mfg_year && l.mfg_year >= p.year_from)) && (!p.year_to || (l.mfg_year && l.mfg_year <= p.year_to)) &&
      (!p.max_price_myr || !(l.start_price_jpy > 0) || !rate || l.start_price_jpy * rate <= Number(p.max_price_myr)) &&
      (p.min_score == null || (Number.isFinite(rank(l.grade)) && rank(l.grade) >= Number(p.min_score))))
    const seen = new Set(((await supabase.from('preference_seen').select('lot_id').eq('pref_id', p.id)).data || []).map((r) => r.lot_id))
    const fresh = fits.filter((l) => !seen.has(l.id))
    if (!fresh.length) continue
    console.log(`  "${p.name}": ${fresh.length} new car(s) fit`)
    if (DRY) continue
    const top = fresh.slice(0, 3).map((c) => `${c.brand} ${c.model} ${c.mfg_year || ''}`.trim()).join('\n')
    const n = await supabase.from('notifications').insert({ user_id: p.user_id, kind: 'pref', title: `${fresh.length} new car${fresh.length === 1 ? '' : 's'} fit "${p.name}"`, body: top + (fresh.length > 3 ? `\n+ ${fresh.length - 3} more` : ''), link: `/cars?pref=${p.id}`, dedupe: `pref:${p.id}:${today}` })
    if (n.error && n.error.code !== '23505') throw new Error(n.error.message)
    const s = await supabase.from('preference_seen').upsert(fresh.map((c) => ({ pref_id: p.id, lot_id: c.id })), { onConflict: 'pref_id,lot_id', ignoreDuplicates: true })
    if (s.error) throw new Error(s.error.message)
  }
}

async function send() {
  const channels = [notify.emailReady() && 'email', notify.whatsappReady() && 'whatsapp', fcm.ready() && 'push'].filter(Boolean)
  if (!channels.length) { console.log('send: no email, WhatsApp or Google FCM keys in .env, so alerts stay in the app (see docs/alerts-setup.md)'); return }
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data: rows, error } = await supabase.from('notifications').select('id,user_id,kind,dedupe,title,body,link,emailed_at,whatsapped_at,pushed_at,user:profiles!user_id(email,whatsapp,phone,notify_email,notify_whatsapp,status)').gt('created_at', since).or('emailed_at.is.null,whatsapped_at.is.null,pushed_at.is.null').order('created_at').limit(200)
  if (error) throw new Error(error.message)
  let em = 0, wa = 0, ph = 0, fail = 0
  const prefs = new Map(((await supabase.from('saved_preferences').select('id,notify_email,notify_push')).data || []).map((p) => [p.id, p]))
  for (const r of rows || []) {
    if (r.user?.status !== 'active') continue
    const patch = {}
    const pref = r.kind === 'pref' ? prefs.get(String(r.dedupe || '').split(':')[1]) : null     // a saved-preference alert follows that preference's own channel choice
    const wantEmail = pref ? pref.notify_email : r.user.notify_email
    const wantPush = pref ? pref.notify_push : true
    if (channels.includes('push') && !r.pushed_at && wantPush) {
      if (DRY) ph++; else try { const n = await fcm.sendToUser(r.user_id, { title: r.title, body: r.body, url: r.link }); if (n > 0) ph++; patch.pushed_at = new Date().toISOString() } catch (e) { fail++; console.log('  push failed:', e.message) }
    }
    if (channels.includes('email') && !r.emailed_at && wantEmail && r.user.email) {
      if (DRY) em++; else try { await notify.sendEmail({ to: r.user.email, title: r.title, body: r.body, link: r.link, appUrl: process.env.APP_URL }); patch.emailed_at = new Date().toISOString(); em++ } catch (e) { fail++; console.log('  email failed:', e.message) }
    }
    const num = notify.waNumber(r.user.whatsapp || r.user.phone)
    if (channels.includes('whatsapp') && !r.whatsapped_at && r.user.notify_whatsapp && num) {
      if (DRY) wa++; else try { await notify.sendWhatsApp({ to: num, title: r.title, body: r.body }); patch.whatsapped_at = new Date().toISOString(); wa++ } catch (e) { fail++; console.log('  whatsapp failed:', e.message) }
    }
    if (!DRY && Object.keys(patch).length) await supabase.from('notifications').update(patch).eq('id', r.id)
  }
  console.log(`send: ${DRY ? 'would send' : 'sent'} ${em} email(s), ${wa} WhatsApp message(s), ${ph} phone notification(s)${fail ? ', ' + fail + ' failed' : ''}`)
  if (fail) process.exitCode = 1
}

async function main() {
  const core = await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'index.ts')).href)
  if (run('close')) await closeSoon()
  if (run('watch')) await watchClosing()
  if (run('match')) await matchBuyLists(core)
  if (run('prefs')) await matchPreferences()
  if (run('top5')) await draftTop5(core)
  if (run('send')) await send()
}
main().catch((e) => { console.error(e.message); process.exit(1) })

'use strict'

/**
 * alerts.js — the alerts that are not instant (the instant ones are database triggers, migration 27), and the email / WhatsApp copies.
 *
 *   node alerts.js                 all three steps
 *   node alerts.js --only close    staff: bid orders still NOT placed whose car closes soon (run this every 15 minutes)
 *   node alerts.js --only match    dealers: new cars that fit their buy list (run daily, after the snapshot)
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

const has = (n) => process.argv.includes(n)
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const only = (arg('--only') || '').split(',').filter(Boolean)
const run = (s) => !only.length || only.includes(s)
const DRY = has('--dry')
const CLOSE_HOURS = Number(process.env.ALERT_CLOSE_HOURS || 3)
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

async function matchBuyLists(core) {
  const { loadBoard } = require('./lib/board')
  const { data: lists, error } = await supabase.from('buy_lists').select('*, ap:profiles!ap_id(id,status,tier,role,company_name,contact_name)')
  if (error) throw new Error(/buy_lists/.test(error.message) ? 'buy_lists missing: run migration 26 first' : error.message)
  const dealers = (lists || []).filter((l) => l.ap?.status === 'active' && l.ap.role === 'ap_holder' && l.ap.tier !== 'free')
  console.log(`match: ${dealers.length} dealer(s) with a buy list`)
  if (!dealers.length) return
  const board = await loadBoard(core)
  const out = []
  for (const l of dealers) {
    const bl = { brands: l.brands, models: l.models, year_from: l.year_from, budget_myr: l.budget_myr != null ? Number(l.budget_myr) : null, min_margin_pct: Number(l.min_margin_pct) }
    const s = { targetPct: bl.min_margin_pct, reconMyr: RECON, apFeeMyr: board.fees.apFeeMyr }
    const fits = board.lots.map((x) => board.evaluate(x, s)).filter((c) => c.atHistory && core.matchesBuyList(bl, { brand: c.brand, model: c.model, year: c.mfg_year, landedMyr: c.atHistory.landedMyr + RECON, marginPct: c.atHistory.marginPct }).ok)
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

async function send() {
  const channels = [notify.emailReady() && 'email', notify.whatsappReady() && 'whatsapp'].filter(Boolean)
  if (!channels.length) { console.log('send: no email or WhatsApp keys in .env, so alerts stay in the app (see docs/alerts-setup.md)'); return }
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data: rows, error } = await supabase.from('notifications').select('id,title,body,link,emailed_at,whatsapped_at,user:profiles!user_id(email,whatsapp,phone,notify_email,notify_whatsapp,status)').gt('created_at', since).or('emailed_at.is.null,whatsapped_at.is.null').order('created_at').limit(200)
  if (error) throw new Error(error.message)
  let em = 0, wa = 0, fail = 0
  for (const r of rows || []) {
    if (r.user?.status !== 'active') continue
    const patch = {}
    if (channels.includes('email') && !r.emailed_at && r.user.notify_email && r.user.email) {
      if (DRY) em++; else try { await notify.sendEmail({ to: r.user.email, title: r.title, body: r.body, link: r.link, appUrl: process.env.APP_URL }); patch.emailed_at = new Date().toISOString(); em++ } catch (e) { fail++; console.log('  email failed:', e.message) }
    }
    const num = notify.waNumber(r.user.whatsapp || r.user.phone)
    if (channels.includes('whatsapp') && !r.whatsapped_at && r.user.notify_whatsapp && num) {
      if (DRY) wa++; else try { await notify.sendWhatsApp({ to: num, title: r.title, body: r.body }); patch.whatsapped_at = new Date().toISOString(); wa++ } catch (e) { fail++; console.log('  whatsapp failed:', e.message) }
    }
    if (!DRY && Object.keys(patch).length) await supabase.from('notifications').update(patch).eq('id', r.id)
  }
  console.log(`send: ${DRY ? 'would send' : 'sent'} ${em} email(s), ${wa} WhatsApp message(s)${fail ? ', ' + fail + ' failed' : ''}`)
  if (fail) process.exitCode = 1
}

async function main() {
  const core = await import(pathToFileURL(path.join(__dirname, '..', '..', 'packages', 'core', 'src', 'index.ts')).href)
  if (run('close')) await closeSoon()
  if (run('match')) await matchBuyLists(core)
  if (run('send')) await send()
}
main().catch((e) => { console.error(e.message); process.exit(1) })

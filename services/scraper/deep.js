'use strict'

/**
 * deep.js — the scraper PC's side of Admin › Deep search (a customer asks for one model, e.g. a Jeep Wrangler).
 * The app only records what staff want; this does it:
 *
 *   1. a new search     -> scrapes its models from every venue (bid cars, plus the sold history for the body price)
 *                          model codes chosen for a model: the codes are only used to list the cars; none chosen: every car of that model is listed
 *   2. units ticked     -> Claude reads the auction sheet of each ticked unit (chassis, first registration month, inspection, doors, seats,
 *                          fuel, notes) and the Customs docket is picked with the strict rule (staff can change it in the app)
 *
 *   node deep.js              do what is waiting now, then stop
 *   node deep.js --watch      stay open and check every 15 seconds (leave it running while you work in the app)
 *   node deep.js --dry        only say what is waiting
 *
 * Needs ANTHROPIC_API_KEY in scraper/.env for step 2. Step 1 opens the browser like `node scrape.js bid`.
 * Readings are done first (quick), then one scrape at a time. The year / score limits of a search override the .env ones for that run.
 */

const supabase = require('./lib/db')
const claude = require('./lib/claude')
const { enrichLot } = require('./lib/enrich')
const { loadRef } = require('./lib/ref')
const { ensureTargets, runScrape } = require('./lib/targets')
const { sameCode } = require('./lib/pick')
const { refreshBatchCopies } = require('./lib/batchcopy')
const { INSTANCE_ID } = require('./lib/lock')

const has = (f) => process.argv.includes(f)
const WATCH = has('--watch'), DRY = has('--dry')
const EVERY_MS = 15000
const STUCK_SEARCH_MIN = 180, STUCK_UNIT_MIN = 20      // a job that stays "running" this long (the worker was closed) goes back to the queue
const now = () => new Date().toISOString()
const log = (...a) => console.log(new Date().toLocaleTimeString('en-GB'), ...a)

async function putStuckJobsBack() {
  const s = await supabase.from('deep_searches').update({ status: 'pending', status_at: now(), status_note: 'the scraper was closed while scraping: queued again' })
    .eq('status', 'scraping').lt('status_at', new Date(Date.now() - STUCK_SEARCH_MIN * 60000).toISOString())
  const u = await supabase.from('deep_search_units').update({ enrich_status: 'requested', status_at: now() })
    .eq('enrich_status', 'working').lt('status_at', new Date(Date.now() - STUCK_UNIT_MIN * 60000).toISOString())
  if (s.error) log('stuck searches:', s.error.message)
  if (u.error) log('stuck units:', u.error.message)
}

// ── 2. the AI reading of ticked units ────────────────────────────────────────

async function readUnits() {
  const { data: units, error } = await supabase.from('deep_search_units').select('*').eq('enrich_status', 'requested').order('created_at').limit(50)
  if (error) throw new Error('units: ' + error.message)
  if (!units.length) return 0
  if (DRY) { log(`${units.length} unit(s) waiting for the AI reading`); return units.length }
  if (!claude.isReady()) { log(`${units.length} unit(s) are waiting, but ANTHROPIC_API_KEY is empty in scraper/.env`); return 0 }

  const ref = await loadRef()
  let done = 0
  for (const unit of units) {
    const mark = (patch) => supabase.from('deep_search_units').update({ ...patch, status_at: now() }).eq('id', unit.id)
    const claimed = await supabase.from('deep_search_units').update({ enrich_status: 'working', status_at: now() }).eq('id', unit.id).eq('enrich_status', 'requested').select('id')
    if (claimed.error || !claimed.data.length) continue      // someone else took it
    try {
      const { data: lot } = await supabase.from('lots').select('*').eq('id', unit.lot_id).maybeSingle()
      if (!lot) { await mark({ enrich_status: 'error', enrich_note: 'this car is no longer in the list (its auction has passed)' }); continue }
      const forceDocket = unit.docket_id ? ref.dockets.find((d) => d.id === unit.docket_id) || null : null      // a docket staff chose is kept
      const r = await enrichLot({ lot, ref, ask: claude.ask, imageBlock: claude.imageBlock, forceDocket })
      const up = await supabase.from('lots').update({ ...r.patch, enriched_at: now(), enrich_note: r.notes.join('; ') || null }).eq('id', lot.id)
      if (up.error) throw new Error(up.error.message)
      if (r.cost) {
        const c = await supabase.from('lot_costs').upsert({ lot_id: lot.id, ...r.cost, updated_at: now() }, { onConflict: 'lot_id' })
        if (c.error) throw new Error(c.error.message)
      } else await supabase.from('lot_costs').delete().eq('lot_id', lot.id)
      await refreshBatchCopies(lot.id)
      const note = r.cost ? `read · duty RM ${Math.round(r.cost.duty_myr)}` : 'read · ' + (r.notes.find((n) => /^no docket|not calculated|no exchange/.test(n)) || 'no duty')
      await mark({ enrich_status: 'done', enrich_note: note.slice(0, 300) })
      log(`read ${lot.brand} ${lot.model} lot ${lot.lot_no}: ${note}`)
      done++
    } catch (e) {
      log(`unit ${unit.lot_id}: FAILED ${e.message}`)
      if (/token cap|not set up/.test(e.message)) { await mark({ enrich_status: 'requested', enrich_note: 'AI limit reached: will try again' }); break }
      await mark({ enrich_status: 'error', enrich_note: ('AI: ' + e.message).slice(0, 300) })
    }
  }
  if (done) log(claude.summary())
  return done
}

/** "JEEP: WRANGLER (JL20L), WRANGLER UNLIMITED (all codes)" */
const describe = (search) => `${search.brand_name}: ${(search.models || []).map((m) => m.model_name + (m.codes?.length ? ' (' + m.codes.join(', ') + ')' : ' (all codes)')).join(', ')}`

// ── 1. scraping the searched models ─────────────────────────────────────────────

async function scrapeOne() {
  const { data: waiting, error } = await supabase.from('deep_searches').select('*').eq('status', 'pending').order('created_at').limit(1)
  if (error) throw new Error('searches: ' + error.message)
  const search = waiting[0]
  if (!search) return false
  if (DRY) { log(`search waiting: ${describe(search)} for "${search.title}"`); return true }

  const claimed = await supabase.from('deep_searches').update({ status: 'scraping', status_at: now(), status_note: 'scraping on the scraper PC…' }).eq('id', search.id).eq('status', 'pending').select('id')
  if (claimed.error || !claimed.data.length) return true      // taken by another worker
  const finish = (patch) => supabase.from('deep_searches').update({ ...patch, status_at: now() }).eq('id', search.id)
  log(`scraping ${describe(search)} for "${search.title}"`)
  try {
    const extraEnv = {}
    if (search.year_from) extraEnv.YEAR_FROM = String(search.year_from)
    if (search.score_min != null) extraEnv.SCORE_MIN = String(search.score_min)
    // every model of the request is scraped (all its codes: a code only filters the list afterwards)
    const models = (search.models || []).map((m) => ({ maker_code: m.maker_code, car_code: m.car_code, brand_name: search.brand_name, model_name: m.model_name }))
    if (!models.length) throw new Error('this request has no model')
    await ensureTargets(models)
    const startedAt = now()
    for (const m of models) {      // this PC runs one scrape at a time, so a lock of this PC on these models is left over from a window that was closed
      const rel = await supabase.from('scrape_targets').update({ locked_by: null, locked_at: null }).eq('maker_code', m.maker_code).eq('car_code', m.car_code).eq('locked_by', INSTANCE_ID)
      if (rel.error) log('could not release old locks:', rel.error.message)
    }
    runScrape('bid', models, { extraEnv, hint: 'Check the scraper PC window, then press "Scrape again" in the app.' })
    if (search.with_history) runScrape('history', models, { extraEnv })

    // scrape.js ends normally even when a target failed (e.g. the site did not show the venue page): look at what it recorded
    const tids = []
    for (const m of models) {
      const { data: tg } = await supabase.from('scrape_targets').select('id,label').eq('maker_code', m.maker_code).eq('car_code', m.car_code)
      ;(tg || []).filter((t) => search.with_history || /\(bid\)/.test(t.label)).forEach((t) => tids.push(t))
    }
    const { data: bad } = tids.length ? await supabase.from('scrape_runs').select('target_id,error_message').eq('status', 'failed').gte('started_at', startedAt).in('target_id', tids.map((t) => t.id)) : { data: [] }
    const failedTargets = [...new Set((bad || []).map((b) => (tids.find((t) => t.id === b.target_id) || {}).label))].filter(Boolean)
    const failReason = bad && bad[0] ? String(bad[0].error_message || '').split('\n')[0].slice(0, 120) : ''

    // how many cars are open now, per model, after each model's code filter
    let listed = 0
    const parts = []
    for (const m of search.models) {
      const { data: lots, error: e } = await supabase.from('lots').select('id,model_code').eq('maker_code', m.maker_code).eq('car_code', m.car_code).eq('my_eligible', true).gt('bid_deadline', now()).limit(5000)
      if (e) throw new Error('lots: ' + e.message)
      const kept = m.codes?.length ? lots.filter((l) => m.codes.some((c) => sameCode(l.model_code, c))) : lots
      listed += kept.length
      parts.push(`${m.model_name} ${kept.length}${m.codes?.length ? ` (code ${m.codes.join(', ')}, of ${lots.length})` : ''}`)
    }
    const summary = `${listed} car${listed === 1 ? '' : 's'} open for bidding: ${parts.join(' · ')}`
    if (failedTargets.length) {
      await finish({ status: 'error', scraped_at: now(), status_note: `Scrape failed for ${failedTargets.join(', ')} (${failReason}). Press Scrape again. Cars saved before: ${summary}`.slice(0, 300) })
      log(`FAILED for ${failedTargets.join(', ')}: ${failReason}`)
      return true
    }
    await finish({ status: 'done', scraped_at: now(), status_note: summary.slice(0, 300) })
    log(`done: ${listed} cars listed (${parts.join(' · ')})`)
  } catch (e) {
    log('scrape FAILED:', e.message)
    await finish({ status: 'error', status_note: String(e.message).slice(0, 300) })
  }
  return true
}

async function pass() {
  await putStuckJobsBack()
  const read = await readUnits()      // quick jobs first
  const scraped = await scrapeOne()
  return read > 0 || scraped
}

async function main() {
  log(`deep.js ${WATCH ? 'watching (Ctrl+C to stop)' : 'one pass'}${DRY ? ' (dry run)' : ''}`)
  if (!WATCH) {
    await putStuckJobsBack()
    await readUnits()
    if (DRY) await scrapeOne()
    else while (await scrapeOne()) { /* every waiting search, one after the other */ }
    log('nothing more waiting.')
    return
  }
  for (;;) {
    let busy = false
    try { busy = await pass() } catch (e) { log('ERROR:', e.message) }
    if (!busy) await new Promise((r) => setTimeout(r, EVERY_MS))      // something was done: look again straight away
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1) })

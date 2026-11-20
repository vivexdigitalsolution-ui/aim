'use strict'

/**
 * lib/lock.js — claim one scrape target at a time, so two PCs never scrape the same one.
 * Available = not locked (or the lock went stale) AND not already completed today (or, with minDays, not run recently).
 */

const supabase     = require('./db')
const config       = require('./config')
const INSTANCE_ID  = process.env.INSTANCE_ID || require('os').hostname()
const LOCK_TIMEOUT = parseInt(process.env.LOCK_TIMEOUT_MIN || '120', 10)
const PAGE_SIZE    = 1000      // Supabase's default maximum rows per request

/**
 * @param {'bid'|'history'|'one_price'} lotType
 * @param {number|null} minDays  null = skip targets completed today. A number picks by LAST RUN date instead:
 *   0 = only targets that never ran; N = never ran, or last ran N or more days ago.
 * @param {Set<string>|null} skipIds  targets that already failed in this run (not offered again)
 * @param {Iterable<string>|null} onlyModels  "maker|car" keys: claim only these models, even if done today
 */
async function claimTarget(lotType, minDays = null, skipIds = null, onlyModels = null) {
  if (!['bid', 'history', 'one_price'].includes(lotType)) throw new Error(`claimTarget: lotType must be 'bid', 'history' or 'one_price', got: ${lotType}`)

  const now        = new Date()
  const staleTime  = new Date(now.getTime() - LOCK_TIMEOUT * 60 * 1000).toISOString()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

  // Supabase returns at most 1000 rows per query, so read the targets page by page: a single query would silently drop
  // every target after the 1000th (they would never be claimed, and never scraped).
  const all = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('scrape_targets').select('*')
      .eq('enabled', true).eq('lot_type', lotType).eq('source', 'uss')
      .order('priority', { ascending: true }).order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) { console.log(`[LOCK] fetch error: ${error.message}`); return null }
    all.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) break
  }
  if (all.length === 0) return null

  // offer mode (offer.js): only the models of the offer report, whatever the skip list or today's runs say
  let offerSet = onlyModels ? new Set(onlyModels) : null      // onlyModels: "maker|car" keys (the photo repair of a combined run)
  if (!offerSet && config.offerOnly) {
    if (process.env.OFFER_MODELS) offerSet = new Set(process.env.OFFER_MODELS.split(',').filter(Boolean))      // offer.js --new: just these models
    else {
      const { data: om } = await supabase.from('offer_models').select('maker_code,car_code')
      offerSet = new Set((om || []).map((m) => m.maker_code + '|' + m.car_code))
    }
  }

  const dueCutoff = minDays == null ? null : new Date(now.getTime() - minDays * 86400000).toISOString()
  const candidates = all.filter((t) => {
    if (process.env.FILTER_MAKER_CODE && t.maker_code !== process.env.FILTER_MAKER_CODE) return false
    if (process.env.FILTER_CAR_CODE && t.car_code !== process.env.FILTER_CAR_CODE) return false
    if (skipIds && skipIds.has(t.id)) return false
    if (offerSet) { if (!offerSet.has(t.maker_code + '|' + t.car_code)) return false }
    else if (config.skipBrandCodes.has(String(t.maker_code).toUpperCase())) return false     // brands we never scrape (.env SKIP_BRAND_CODES)
    if (minDays == null) {
      if (!offerSet && t.completed_at && t.completed_at >= todayStart) return false
    } else {
      const neverRan = !t.last_run_at && !t.run_count
      if (!(minDays === 0 ? neverRan : (neverRan || (t.last_run_at && t.last_run_at <= dueCutoff)))) return false
    }
    return !t.locked_by || (t.locked_at && t.locked_at < staleTime)
  })
  if (candidates.length === 0) return null

  // never-run targets first, then by priority
  candidates.sort((a, b) => {
    const an = !a.completed_at && !a.run_count, bn = !b.completed_at && !b.run_count
    if (an !== bn) return an ? -1 : 1
    return a.priority !== b.priority ? a.priority - b.priority : (a.id < b.id ? -1 : 1)
  })

  for (const c of candidates) {
    const stale = c.locked_at && c.locked_at < staleTime
    let q = supabase.from('scrape_targets')
      .update({ locked_by: INSTANCE_ID, locked_at: now.toISOString(), completed_at: null })
      .eq('id', c.id)
    q = stale ? q.lt('locked_at', staleTime) : q.is('locked_by', null)
    const { data: claimed, error: claimErr } = await q.select().single()
    if (claimErr || !claimed) continue          // another PC got it first
    if (stale) console.log(`[LOCK] Reclaimed stale lock on "${claimed.label}" (was: ${c.locked_by})`)
    return claimed
  }
  return null
}

async function releaseTarget(targetId) {
  const { error } = await supabase.from('scrape_targets')
    .update({ locked_by: null, locked_at: null }).eq('id', targetId).eq('locked_by', INSTANCE_ID)
  if (error) console.log(`[LOCK] release error: ${error.message}`)
}

async function completeTarget(targetId, runId) {
  const now = new Date().toISOString()
  const { data: cur } = await supabase.from('scrape_targets').select('run_count').eq('id', targetId).single()
  const { error } = await supabase.from('scrape_targets').update({
    locked_by: null, locked_at: null, completed_at: now, last_run_at: now, last_run_id: runId || null, run_count: (cur?.run_count || 0) + 1,
  }).eq('id', targetId)
  if (error) console.log(`[LOCK] complete error: ${error.message}`)
}

module.exports = { claimTarget, releaseTarget, completeTarget, INSTANCE_ID }

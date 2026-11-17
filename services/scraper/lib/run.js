'use strict'

/** lib/run.js — one scrape_runs row per target processed (for checking what happened; trimmed by housekeeping). */

const supabase        = require('./db')
const { INSTANCE_ID } = require('./lock')

async function createRun(target) {
  const { data, error } = await supabase.from('scrape_runs')
    .insert({ target_id: target.id, instance_id: INSTANCE_ID, status: 'running' }).select('id').single()
  if (error) { console.log(`[RUN] create error: ${error.message}`); return null }
  return data.id
}

async function finalizeRun(runId, status, c, errorMessage) {
  if (!runId) return
  const started = c._startedAt || new Date()
  const { error } = await supabase.from('scrape_runs').update({
    status, finished_at: new Date().toISOString(), duration_seconds: Math.round((Date.now() - started.getTime()) / 1000),
    error_message: errorMessage || null,
    records_scraped: c.records_scraped || 0, records_inserted: c.records_inserted || 0, records_updated: c.records_updated || 0,
    records_failed: c.records_failed || 0, images_uploaded: c.images_uploaded || 0, images_failed: c.images_failed || 0,
  }).eq('id', runId)
  if (error) console.log(`[RUN] finalize error: ${error.message}`)
}

module.exports = { createRun, finalizeRun }

'use strict'

/**
 * daily.js — the whole daily refresh in one command, in the right order, with a log the staff can see (System status in the app).
 *
 *   node daily.js                    every step
 *   node daily.js --only link,snapshot       just these steps (names below)
 *   node daily.js --skip history     everything except these
 *   node daily.js --dry              show the plan, run nothing
 *   node daily.js --scheduled        marks the run as started by Task Scheduler (run-daily.bat does this)
 *
 * Steps (in order)         what it does
 *   scrape     node scrape.js bid         open cars from USS -> lots, photos
 *   oneprice   node scrape.js one_price   one-price cars (fixed price) -> one_price_lots
 *   history    node scrape.js history     past sold prices -> lot_history
 *   enrich     node enrich.js --limit 300 Claude reads the sheets of new cars; docket decision and features (only if scrape worked)
 *   features   node extract-features.js --free   free feature matcher for cars still without features
 *   link       node link-lots.js --write  link every open car to the CarzNexus catalog
 *   snapshot   node market-snapshot.js --write   Malaysian market prices from CarzNexus listings
 *   alerts     node alerts.js --only match,prefs,top5,send   dealers: new cars that fit their buy list; staff: a DRAFT personal list per dealer (nothing is sent until staff press Send); email / WhatsApp copies (the 15-minute job alerts.js --only close,watch,send is separate)
 *   housekeeping  housekeeping()          delete old cars / history, suspend inactive dealers (the app's own daily rule)
 *
 * A failed step does not stop the others, except that enrich is skipped when scrape failed. The run is saved in job_runs
 * (migration 24) and in logs/daily-YYYY-MM-DD.log. Two runs never overlap: a run that is still "running" for under 10 hours blocks a new one.
 */

require('dotenv').config()
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const supabase = require('./lib/db')

const has = (n) => process.argv.includes(n)
const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null }
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const H = 3600 * 1000

const STEPS = [
  { name: 'scrape', script: ['scrape.js', 'bid'], timeout: 6 * H },
  { name: 'oneprice', script: ['scrape.js', 'one_price'], timeout: 4 * H },
  { name: 'photos', script: ['refresh-photos.js', '--open'], timeout: 3 * H, needs: 'scrape' },
  { name: 'history', script: ['scrape.js', 'history'], timeout: 3 * H },
  { name: 'enrich', script: ['enrich.js', '--limit', process.env.ENRICH_LIMIT || '1500'], timeout: 5 * H, needs: 'scrape' },
  { name: 'features', script: ['extract-features.js', '--free'], timeout: H },
  { name: 'link', script: ['link-lots.js', '--write'], timeout: H },
  { name: 'snapshot', script: ['market-snapshot.js', '--write'], timeout: H },
  { name: 'alerts', script: ['alerts.js', '--only', 'match,prefs,top5,send'], timeout: H },
  { name: 'housekeeping', rpc: 'housekeeping', timeout: H },
]

const logDir = path.join(__dirname, 'logs')
fs.mkdirSync(logDir, { recursive: true })
const logFile = path.join(logDir, `daily-${new Date().toISOString().slice(0, 10)}.log`)
const log = (s) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(line); fs.appendFileSync(logFile, line + '\n') }

function runScript(step) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, step.script, { cwd: __dirname, env: process.env })
    let tail = ''
    const take = (b) => { const t = b.toString(); fs.appendFileSync(logFile, t); tail = (tail + t).slice(-4000) }
    child.stdout.on('data', take); child.stderr.on('data', take)
    const timer = setTimeout(() => { tail += '\nSTOPPED: took longer than ' + step.timeout / H + ' hours'; child.kill() }, step.timeout)
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, tail }) })
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: 1, tail: e.message }) })
  })
}
const lastLines = (t, n = 6) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-n).join('\n').slice(0, 1200)

async function main() {
  const only = list(arg('--only')), skip = list(arg('--skip'))
  const plan = STEPS.filter((s) => (!only.length || only.includes(s.name)) && !skip.includes(s.name))
  for (const n of [...only, ...skip]) if (!STEPS.some((s) => s.name === n)) { console.log('Unknown step: ' + n + '. Steps: ' + STEPS.map((s) => s.name).join(', ')); process.exit(1) }
  if (has('--dry')) { console.log('Plan:\n' + plan.map((s, i) => `  ${i + 1}. ${s.name}${s.script ? '  (node ' + s.script.join(' ') + ')' : '  (database function)'}`).join('\n')); return }

  // never two runs at once
  const busy = await supabase.from('job_runs').select('id,started_at,host').eq('status', 'running').gt('started_at', new Date(Date.now() - 10 * H).toISOString()).limit(1)
  if (busy.error) { console.error('job_runs is not ready: run supabase/migrations/24_job_runs.sql first. (' + busy.error.message + ')'); process.exit(1) }
  if (busy.data.length) { log(`Another run is still going (started ${busy.data[0].started_at} on ${busy.data[0].host}). Stopping.`); process.exit(2) }

  const ins = await supabase.from('job_runs').insert({ trigger: has('--scheduled') ? 'scheduled' : 'manual', host: os.hostname() }).select('id').single()
  if (ins.error) { console.error(ins.error.message); process.exit(1) }
  const runId = ins.data.id
  const results = []
  const save = (status, done) => supabase.from('job_runs').update({ steps: results, status, ...(done ? { finished_at: new Date().toISOString() } : {}) }).eq('id', runId)

  log(`Daily run started: ${plan.map((s) => s.name).join(' > ')}`)
  for (const step of plan) {
    const dep = step.needs && results.find((r) => r.name === step.needs)
    if (dep && dep.status !== 'ok') { results.push({ name: step.name, status: 'skipped', seconds: 0, note: `skipped: ${step.needs} did not finish` }); log(`- ${step.name}: skipped (${step.needs} failed)`); await save('running'); continue }
    const t0 = Date.now()
    log(`- ${step.name}: running ...`)
    let ok, note
    if (step.rpc) {
      const { data, error } = await supabase.rpc(step.rpc)
      ok = !error; note = error ? error.message : JSON.stringify(data)
    } else {
      const r = await runScript(step); ok = r.code === 0; note = lastLines(r.tail)
    }
    const seconds = Math.round((Date.now() - t0) / 1000)
    results.push({ name: step.name, status: ok ? 'ok' : 'failed', seconds, note })
    log(`- ${step.name}: ${ok ? 'ok' : 'FAILED'} (${seconds}s)`)
    await save('running')
  }
  const failed = results.filter((r) => r.status === 'failed').length
  const status = failed === 0 ? 'ok' : failed === results.filter((r) => r.status !== 'skipped').length ? 'failed' : 'partial'
  await save(status, true)
  log(`Daily run finished: ${status}${failed ? ' (' + failed + ' step' + (failed === 1 ? '' : 's') + ' failed)' : ''}`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

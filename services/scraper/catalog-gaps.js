'use strict'

/**
 * catalog-gaps.js — the to-do list for the CarzNexus catalog: what the open auction cars need that the catalog does not have yet.
 * Reads lot_catalog (made by link-lots.js) and the catalog names (read-only). Writes two Excel-ready CSV files into out/:
 *
 *   out/catalog-gaps-chassis-codes.csv   chassis codes the catalog does not know at all (add brand > model > model code > variants)
 *   out/catalog-gaps-variants.csv        known chassis codes where the grade is missing or unclear (add the variant, or one more alternate spelling)
 *
 * Biggest gaps first: fixing the top rows links the most cars. Run link-lots.js --write first so the data is current.
 *   node catalog-gaps.js
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const supabase = require('./lib/db')

const baseCode = (c) => String(c || '').toUpperCase().replace(/^[0-9A-Z]{2,4}-/, '').replace(/[^A-Z0-9]/g, '')
const csv = (rows, cols) => '﻿' + [cols.map((c) => c.label).join(','), ...rows.map((r) => cols.map((c) => { const v = String(c.get(r) ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }).join(','))].join('\r\n') + '\r\n'
const top = (arr, n) => { const m = new Map(); for (const a of arr) if (a) m.set(a, (m.get(a) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => (c > 1 ? `${k} (x${c})` : k)) }

async function main() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('lot_catalog').select('level,how,model_id,lots!inner(brand,model,model_code,engine_cc,mfg_year,bid_deadline)').gt('lots.bid_deadline', new Date().toISOString()).range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...data)
    if (data.length < 1000) break
  }
  if (!rows.length) { console.log('lot_catalog is empty: run  node link-lots.js --write  first.'); return }

  // catalog model names for the cars that did reach a model (so the sheet says "add a variant to Alphard", not just an id)
  const modelName = new Map()
  const url = process.env.CARZNEXUS_DB_URL
  if (url) {
    const { Client } = require('pg')
    const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await db.connect(); await db.query('set default_transaction_read_only = on')
    for (const r of (await db.query('select distinct model_id, brand, model from aim.catalog_variants')).rows) modelName.set(r.model_id, { brand: r.brand, model: r.model })
    await db.end()
  }

  // 1. chassis codes the catalog does not know
  const codes = new Map()
  for (const r of rows.filter((x) => x.level === 'none')) {
    const l = r.lots, code = baseCode(l.model_code)
    const key = (l.brand || '') + '|' + (code || '(no code)')
    const g = codes.get(key) || codes.set(key, { brand: l.brand, code: code || '(no chassis code on the sheet)', prefixes: [], lots: 0, years: [], cc: [], names: [] }).get(key)
    g.lots++; g.prefixes.push(l.model_code); if (l.mfg_year) g.years.push(l.mfg_year); if (l.engine_cc) g.cc.push(l.engine_cc); g.names.push(l.model)
  }
  const codeRows = [...codes.values()].sort((a, b) => b.lots - a.lots)

  // 2. known model, grade missing or unclear
  const variants = new Map()
  for (const r of rows.filter((x) => x.level === 'model')) {
    const l = r.lots, m = modelName.get(r.model_id) || { brand: l.brand, model: '' }
    const fam = String(m.model || '').toUpperCase()
    const grade = String(l.model || '').toUpperCase().startsWith(fam) && fam ? String(l.model).slice(fam.length).trim() : String(l.model || '')
    const key = m.brand + '|' + m.model + '|' + baseCode(l.model_code) + '|' + grade.toUpperCase()
    const g = variants.get(key) || variants.set(key, { brand: m.brand, model: m.model, code: baseCode(l.model_code), grade: grade || '(plain)', why: r.how, lots: 0, years: [], cc: [] }).get(key)
    g.lots++; if (l.mfg_year) g.years.push(l.mfg_year); if (l.engine_cc) g.cc.push(l.engine_cc)
  }
  const varRows = [...variants.values()].sort((a, b) => b.lots - a.lots)

  const range = (a) => (a.length ? (Math.min(...a) === Math.max(...a) ? String(Math.min(...a)) : Math.min(...a) + '-' + Math.max(...a)) : '')
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true })
  const f1 = path.join(__dirname, 'out', 'catalog-gaps-chassis-codes.csv'), f2 = path.join(__dirname, 'out', 'catalog-gaps-variants.csv')
  fs.writeFileSync(f1, csv(codeRows, [
    { label: 'Open cars waiting', get: (r) => r.lots }, { label: 'Brand', get: (r) => r.brand }, { label: 'Chassis code (add to catalog)', get: (r) => r.code },
    { label: 'As written on the sheet', get: (r) => top(r.prefixes, 3).join(' / ') }, { label: 'Years', get: (r) => range(r.years) }, { label: 'Engine cc', get: (r) => top(r.cc, 3).join(' / ') },
    { label: 'Car names seen (use these to find the model and the grades)', get: (r) => top(r.names, 6).join(' | ') },
    { label: 'Model to add it to (fill in)', get: () => '' }, { label: 'Done', get: () => '' },
  ]))
  fs.writeFileSync(f2, csv(varRows, [
    { label: 'Open cars waiting', get: (r) => r.lots }, { label: 'Brand', get: (r) => r.brand }, { label: 'Catalog model', get: (r) => r.model }, { label: 'Chassis code', get: (r) => r.code },
    { label: 'Grade as written by the auction (add as a variant, or as an alternate spelling)', get: (r) => r.grade }, { label: 'Years', get: (r) => range(r.years) }, { label: 'Engine cc', get: (r) => top(r.cc, 2).join(' / ') },
    { label: 'Problem', get: (r) => r.why }, { label: 'Variant to link to (fill in)', get: () => '' }, { label: 'Done', get: () => '' },
  ]))

  const none = rows.filter((x) => x.level === 'none').length, model = rows.filter((x) => x.level === 'model').length, variant = rows.filter((x) => x.level === 'variant').length
  console.log(`${rows.length} open cars: ${variant} linked to a variant, ${model} to a model only, ${none} not linked`)
  console.log(`\nChassis codes missing from the catalog: ${codeRows.length} codes, ${none} cars. The biggest 8:`)
  codeRows.slice(0, 8).forEach((r) => console.log(`  ${String(r.lots).padStart(3)} cars  ${r.brand} ${r.code}  e.g. ${top(r.names, 1)[0]}`))
  const top8 = codeRows.slice(0, 8).reduce((s, r) => s + r.lots, 0), top20 = codeRows.slice(0, 20).reduce((s, r) => s + r.lots, 0)
  console.log(`  adding the top 8 codes links ${top8} cars, the top 20 links ${top20}`)
  console.log(`\nGrades missing or unclear on known codes: ${varRows.length} grades, ${model} cars`)
  console.log(`\nWritten:\n  ${f1}\n  ${f2}`)
}
main().catch((e) => { console.error(e.message); process.exit(1) })

'use strict'

/**
 * lib/asnet/storage.js — where ASNET pictures live in R2, and removing them.
 *
 * USS pictures are under "l/", and R2 deletes those by itself after some days (docs/setup-r2.md). An ASNET car stays listed for as
 * long as ASNET lists it, so its pictures are under "a/", which has NO expiry rule. They are deleted here instead: when the car is
 * removed (no longer listed), replaced, or its pictures are fetched again. A deletion that fails is written down and tried again
 * at the start of the next --write run.
 */

const fs = require('fs')
const path = require('path')

const FOLDER = 'a', OLD_FOLDER = 'l'      // ASNET cars saved before 28 Nov 2026 are still under "l/"
// an ASNET car's key (map.js exKey). Nothing is listed or deleted for anything else: a short or empty key would reach other cars.
const CAR_KEY = /^[a-f0-9]{32}$/

const keyFor = (carKey, name) => {
  if (!CAR_KEY.test(carKey)) throw new Error('not an ASNET car key: ' + carKey)
  return `${FOLDER}/${carKey}/${String(name).toLowerCase().replace(/[^a-z0-9_]/g, '')}.jpg`
}
const keyOf = (url) => String(url || '').match(/(?:^|\/)((?:a|l)\/[a-z0-9]+\/[a-z0-9_]+\.jpg)$/)?.[1] || null
const onOldFolder = (url) => /^l\//.test(keyOf(url) || '')

/** Deletes every picture of one car except those `keep` links to. @param ops { list(prefix) -> keys, remove(keys) }, both throwing on failure */
async function removeCarFiles(ops, carKey, keep = []) {
  if (!CAR_KEY.test(String(carKey))) throw new Error('not an ASNET car key: ' + carKey)
  const wanted = new Set(keep.map(keyOf).filter(Boolean))
  let removed = 0
  for (const folder of [FOLDER, OLD_FOLDER]) {
    const prefix = `${folder}/${carKey}/`
    const gone = (await ops.list(prefix)).filter((k) => k.startsWith(prefix) && !wanted.has(k))
    if (gone.length) { await ops.remove(gone); removed += gone.length }
  }
  return removed
}

const readList = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { if (e.code === 'ENOENT') return []; throw e } }
const writeList = (file, list) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 2)) }

/** @returns cleanup(carKey, keep) -> null, or why the pictures could not be deleted (the car is then written into `file`) */
function cleaner({ ops, file, log = console.log }) {
  return async (carKey, keep = []) => {
    try { await removeCarFiles(ops, carKey, keep); return null }
    catch (e) {
      const list = readList(file)
      if (!list.includes(carKey)) writeList(file, [...list, carKey])
      log(`    pictures not deleted (tried again next run): ${e.message}`)
      return e.message
    }
  }
}

/** Tries the deletions that failed before. What a saved car still links to is always kept. */
async function retryLeftovers({ db, ops, file, log = console.log }) {
  const list = readList(file)
  if (!list.length) return { tried: 0, left: 0 }
  const left = []
  for (const carKey of list) {
    try {
      const { data, error } = await db.from('one_price_lots').select('photos,sheet_url').eq('ex_key', carKey).maybeSingle()
      if (error) throw new Error('database: ' + error.message)      // not knowing what is saved = delete nothing
      await removeCarFiles(ops, carKey, data ? [...(data.photos || []), data.sheet_url] : [])
    } catch (e) { left.push(carKey); log(`  old pictures still not deleted: ${e.message}`) }
  }
  writeList(file, left)
  log(`  deletions left over from earlier runs: ${list.length - left.length} done, ${left.length} still to do`)
  return { tried: list.length, left: left.length }
}

/** list / remove on the real bucket (the keys come from .env, as in lib/r2.js) */
function r2Ops() {
  require('dotenv').config()
  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3')
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_KEY } })
  const Bucket = process.env.R2_BUCKET
  return {
    async list(prefix) {
      const keys = []
      let token
      do {
        const r = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }))
        keys.push(...(r.Contents || []).map((o) => o.Key))
        token = r.IsTruncated ? r.NextContinuationToken : undefined
      } while (token)
      return keys
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const r = await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }))
        if (r.Errors?.length) throw new Error(`${r.Errors.length} file(s) refused: ${r.Errors[0].Code}`)
      }
    },
  }
}

/** Before anything is saved: the photo address must really serve a file of the ASNET folder, or every saved picture would be broken. */
async function assertServed({ upload, remove, picture, get = fetch }) {
  const key = `${FOLDER}/servecheck/ok.jpg`
  const { url } = await upload(key, picture)
  try {
    const res = await get(`${url}?t=${Date.now()}`, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new Error(`The photo address does not serve the ASNET folder "${FOLDER}/" yet (answer ${res.status}). Deploy the photo Worker first: cd services/photo-worker, then: npx wrangler deploy`)
  } finally { await remove([key]) }
}

module.exports = { keyFor, keyOf, onOldFolder, removeCarFiles, cleaner, retryLeftovers, r2Ops, assertServed }

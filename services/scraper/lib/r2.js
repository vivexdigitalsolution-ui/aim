'use strict'

/**
 * lib/r2.js — Cloudflare R2 for the Auction project's photos.
 * Keys are neutral ("l/<lot key>/<name>.jpg"): nothing in a photo link names the source or any company.
 * Old photos are removed by an R2 lifecycle rule (expire after ~3 days), so this file never has to delete old lots.
 */

require('dotenv').config()

const { S3Client, PutObjectCommand, DeleteObjectsCommand } = require('@aws-sdk/client-s3')

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID
const BUCKET     = process.env.R2_BUCKET
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID
const SECRET_KEY = process.env.R2_SECRET_KEY
const PUBLIC_URL = process.env.R2_PUBLIC_URL?.replace(/\/$/, '')

if (!ACCOUNT_ID || !BUCKET || !ACCESS_KEY || !SECRET_KEY || !PUBLIC_URL) {
  console.error('[R2] Missing R2 env vars — check .env')
  process.exit(1)
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
})

/** @param {string} lotKey unique per listing (the source's own key)  @param {string} suffix "sheet" | "front" | "rear" | "etc_01" ... */
function buildR2Key(lotKey, suffix) {
  const safe = String(lotKey).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 64) || 'unknown'
  return `l/${safe}/${suffix}.jpg`
}

const buildPublicUrl = (key) => `${PUBLIC_URL}/${key}`

const UPLOAD_RETRIES = 3
const RETRY_DELAY    = [1000, 2500, 5000]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function uploadImage(key, buffer) {
  let lastErr
  for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: buffer, ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=604800',
      }))
      return { key, url: buildPublicUrl(key), size: buffer.length }
    } catch (err) {
      lastErr = err
      if (attempt < UPLOAD_RETRIES) {
        console.log(`    [R2] Upload attempt ${attempt}/${UPLOAD_RETRIES} failed: ${err.message} — retry`)
        await sleep(RETRY_DELAY[attempt - 1] || 5000)
      }
    }
  }
  throw new Error(`R2 upload failed after ${UPLOAD_RETRIES} attempts: ${lastErr?.message}`)
}

/** Used only to undo a half-finished lot (the rest is cleaned by the lifecycle rule). */
async function deleteObjects(keys) {
  if (!keys || keys.length === 0) return
  try {
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys.map((k) => ({ Key: k })), Quiet: true } }))
  } catch (err) {
    console.log(`    [R2] Cleanup delete failed for ${keys.length} objects: ${err.message}`)
  }
}

module.exports = { uploadImage, deleteObjects, buildR2Key, buildPublicUrl }

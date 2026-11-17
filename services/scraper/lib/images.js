'use strict'

/**
 * lib/images.js
 * Download the images of one listing from the source site (needs the logged-in browser session, so every request goes through
 * page.request) and upload them to R2 — shrunk first, to keep storage and phone data small:
 *   - auction sheet: 1600 px wide (the small print must stay readable)
 *   - car photos:    1280 px wide, JPEG quality 72  (about 80-120 KB each)
 * Only the first MAX_PHOTOS car photos are kept (default 5; front, rear, then the first other shots).
 */

const sharp = require('sharp')
const { uploadImage, deleteObjects, buildR2Key } = require('./r2')

const MAX_PHOTOS = Math.max(1, parseInt(process.env.MAX_PHOTOS || '5', 10))

async function resolveUrl(page, relativePath) {
  return page.evaluate((rel) => new URL(rel, document.baseURI).href, relativePath)
}

async function fetchBuffer(page, url) {
  const resp = await page.request.get(url, { timeout: 30000 })
  if (resp.status() === 404) return null
  if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`)
  return Buffer.from(await resp.body())
}

const shrink = (buf, width, quality) =>
  sharp(buf).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer()

/**
 * @param {import('playwright').Page} page
 * @param {{basePath:string, hash:string}} thumbParsed  from extract.js
 * @param {string} lotKey  the listing's own key (R2 path + dedup)
 * @returns {{success:boolean, images:Array, imageCount:number, error:string|null}}
 *   images: { suffix, slotLabel, imageType, fullKey, fullUrl, fullSize }
 */
async function downloadAndUploadImages(page, thumbParsed, lotKey, logPrefix) {
  if (!thumbParsed) return { success: false, images: [], imageCount: 0, error: 'No parseable thumbnail URL' }

  const { basePath, hash } = thumbParsed
  const uploadedKeys = []
  const images = []
  let photos = 0

  async function tryUpload(rel, suffix, imageType, slotLabel, width, quality) {
    let buffer
    try {
      buffer = await fetchBuffer(page, await resolveUrl(page, rel))
    } catch (err) {
      console.log(`\n${logPrefix} [${suffix}] fetch error: ${err.message}`)
      return 'error'
    }
    if (buffer === null) return 'missing'
    const small = await shrink(buffer, width, quality)
    const key = buildR2Key(lotKey, suffix)
    const up = await uploadImage(key, small)
    uploadedKeys.push(key)
    images.push({ suffix, slotLabel, imageType, fullKey: up.key, fullUrl: up.url, fullSize: up.size })
    if (imageType !== 'document') photos++
    process.stdout.write(`[${suffix}]✓ `)
    return 'ok'
  }

  try {
    await tryUpload(`${basePath}Exhibit/${hash}_001_01.JPG`, 'sheet', 'document', 'Auction Sheet', 1600, 80)
    await tryUpload(`${basePath}Front/${hash}_002.JPG`,      'front', 'exterior', 'Front', 1280, 72)
    if (photos < MAX_PHOTOS) await tryUpload(`${basePath}Rear/${hash}_003.JPG`, 'rear', 'exterior', 'Rear', 1280, 72)
    for (let n = 101; n <= 106 && photos < MAX_PHOTOS; n++) {
      const suffix = `etc_${String(n - 100).padStart(2, '0')}`
      const r = await tryUpload(`${basePath}ETC/${hash}_${n}.JPG`, suffix, 'exterior', `ETC ${n - 100}`, 1280, 72)
      if (r !== 'ok') break          // sequential: stop at the first gap
    }
  } catch (err) {
    await deleteObjects(uploadedKeys)
    return { success: false, images: [], imageCount: 0, error: `R2 upload failed: ${err.message}` }
  }

  if (images.length === 0) return { success: false, images: [], imageCount: 0, error: 'No images found for this lot' }
  console.log(`\n${logPrefix} → ${images.length} images uploaded`)
  return { success: true, images, imageCount: images.length, error: null }
}

module.exports = { downloadAndUploadImages }

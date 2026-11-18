'use strict'

/**
 * lib/extract.js
 * Extract all fields from ASNET list-page result rows.
 * Based on confirmed live HTML from actual ASNET result page.
 *
 * Row selector: tr[data-key] (each result row has data-key, data-exhibitionnumber etc)
 *
 * Key HTML facts:
 *   - Lot number: td.exhibitionNumber ul li — split across TWO lines with <br>
 *     e.g. "157127\n0933" → join to "1571270933"
 *   - Thumbnail: td.carPhoto img[src] — may be imgm (AS-One) or imgs (USS/AA-Bid)
 *   - Make: td.maker_carName_grade h3
 *   - Car name: td.maker_carName_grade h4 a.showDetail
 *   - Grade: td.maker_carName_grade ul li:nth-child(3) — has translateAttribution anchor to remove
 *   - Model code: td.carForm_displacement ul li:first-child — e.g. "MXPK11" or "6AA-MXPK16"
 *   - Engine CC: td.carForm_displacement ul li:nth-child(2) — e.g. "1500" or "1490"
 *   - Mfg year: td.modelYear ul li — era format e.g. "R7"
 *   - Inspection: td.inspection_mileage ul li:first-child — e.g. "R9/03" or empty
 *   - Mileage: td.inspection_mileage ul li:nth-child(2) — e.g. "13K km" → 13000
 *   - Color: td.color ul li
 *   - Gear: td.shift_airConditioner ul li:first-child
 *   - AC: td.shift_airConditioner ul li:nth-child(2)
 *   - Score: td.pointTotal ul li — e.g. "5  " or "4.5" (trim whitespace)
 *   - Publish price: td.publishPrice ul li — e.g. "1,720" (strip commas, multiply by 1000)
 *   - Auction method: td.cornerType_cornerPlace_auctionDay li.cornerType p.styleCorner:first-child
 *   - Location: td.cornerType_cornerPlace_auctionDay li.cornerPlace
 *   - Auction date: td.cornerType_cornerPlace_auctionDay time[datetime]
 *   - Final/bid price: td.bidPrice ul li:first-child (not negotiation li)
 *   - Seller mark: td.storeMark img[alt] attributes joined
 */

/**
 * Extract data from all rows on the current page.
 * @param {import('playwright').Page} page
 * @param {string|null} venueFilter  Only include rows matching this venue text
 * @param {number}      pageOffset   Row count offset for page_position
 * @returns {object[]}
 */
async function extractRows(page, venueFilter, pageOffset) {
  const rows = await page.evaluate(({ venueFilter, pageOffset }) => {
    // Use data-key rows — more reliable than the old tr:has() selector
    const rowEls  = document.querySelectorAll('tr[data-key]')
    const results = []

    rowEls.forEach((row, idx) => {

      // ── Venue filter ────────────────────────────────────────────────────────
      const location = (row.querySelector('.cornerPlace')?.textContent || '').trim()
      if (venueFilter && location && !location.includes(venueFilter)) return

      // ── Lot number ──────────────────────────────────────────────────────────
      // The <li> contains the lot number split across text nodes and a <br>:
      //   "157127\n                <br>\n0933"
      // We grab all text nodes and join them, stripping all whitespace.
      const lotLi = row.querySelector('td.exhibitionNumber ul li')
      const lot_no = lotLi
        ? Array.from(lotLi.childNodes)
            .filter(n => n.nodeType === 3)           // text nodes only
            .map(n => n.textContent.replace(/\s+/g, ''))  // strip all whitespace
            .join('')                                 // join the two parts
        : ''

      // ── Auction method ──────────────────────────────────────────────────────
      // First p.styleCorner in the cornerType li
      const auction_method = (
        row.querySelector('td.cornerType_cornerPlace_auctionDay li.cornerType p.styleCorner')
          ?.textContent?.trim() || ''
      )

      // ── Auction date ────────────────────────────────────────────────────────
      const auctionDateEl  = row.querySelector('td.cornerType_cornerPlace_auctionDay time[datetime]')
      const auction_date   = auctionDateEl?.getAttribute('datetime') || null

      // ── Make / Car Name / Grade ─────────────────────────────────────────────
      const make     = (row.querySelector('td.maker_carName_grade h3')?.textContent || '').trim()
      const car_name = (row.querySelector('td.maker_carName_grade h4 a.showDetail')?.textContent || '').trim()

      // Grade: 3rd li — clone and remove translateAttribution anchor
      let grade = ''
      const gradeLi = row.querySelector('td.maker_carName_grade ul li:nth-child(3)')
      if (gradeLi) {
        const clone  = gradeLi.cloneNode(true)
        clone.querySelectorAll('a.translateAttribution').forEach(a => a.remove())
        grade = clone.textContent.trim()
      }

      // ── Model code (raw, keep as-is from ASNET) ─────────────────────────────
      // e.g. "MXPK11" or "6AA-MXPK16"
      const model_code_raw = (
        row.querySelector('td.carForm_displacement ul li:first-child')?.textContent || ''
      ).trim()

      // ── Engine CC ───────────────────────────────────────────────────────────
      const engine_cc_raw = (
        row.querySelector('td.carForm_displacement ul li:nth-child(2)')?.textContent || ''
      ).trim()
      const engine_cc = parseInt(engine_cc_raw.replace(/[^0-9]/g, ''), 10) || null

      // ── Manufacture year (era format) ───────────────────────────────────────
      const mfg_year_raw = (row.querySelector('td.modelYear ul li')?.textContent || '').trim()

      // ── Inspection date ─────────────────────────────────────────────────────
      // First li in inspection_mileage — e.g. "R9/03" or empty
      const inspection_raw = (
        row.querySelector('td.inspection_mileage ul li:first-child')?.textContent || ''
      ).trim()

      // ── Mileage ─────────────────────────────────────────────────────────────
      // "13K km" → 13000, "1K km" → 1000, "100K km" → 100000
      const mileage_raw = (
        row.querySelector('td.inspection_mileage ul li:nth-child(2)')?.textContent || ''
      ).trim()
      const mileageMatch  = mileage_raw.match(/([\d.]+)K?\s*km/i)
      const mileage = mileageMatch
        ? (mileage_raw.toUpperCase().includes('K')
            ? Math.round(parseFloat(mileageMatch[1]) * 1000)
            : parseInt(mileageMatch[1], 10))
        : null

      // ── Color ────────────────────────────────────────────────────────────────
      const color = (row.querySelector('td.color ul li')?.textContent || '').trim()

      // ── Gear & AC ───────────────────────────────────────────────────────────
      // Both in td.shift_airConditioner
      const shiftLis = row.querySelectorAll('td.shift_airConditioner ul li')
      const gear  = shiftLis[0]?.textContent?.trim() || ''
      const aircon = shiftLis[1]?.textContent?.trim() || ''

      // ── Score ────────────────────────────────────────────────────────────────
      // e.g. "5  " or "4.5" or "4  " — trim whitespace
      const score_raw = (row.querySelector('td.pointTotal ul li')?.textContent || '').trim()
      const score     = score_raw ? parseFloat(score_raw) : null
      // score_grade = raw string for DB (preserves 'S', '4.5', '4' etc)
      const score_grade = score_raw || null

      // ── Publish price ────────────────────────────────────────────────────────
      // e.g. "1,720" (K yen) → strip comma, parse as number (keep in K yen = JPY * 1000)
      // Store as actual JPY: multiply by 1000
      const publish_raw = (row.querySelector('td.publishPrice ul li')?.textContent || '').trim()
      const publish_num = parseFloat(publish_raw.replace(/,/g, '')) || null
      const wholesale_price = publish_num ? Math.round(publish_num * 1000) : null

      // ── Bid/Final price ──────────────────────────────────────────────────────
      // td.bidPrice may have "Negotiable" or a number like "2,164"
      // Skip li.negotiation — get the first li that looks like a number
      let final_price = null
      const bidLis = row.querySelectorAll('td.bidPrice ul li')
      for (const li of bidLis) {
        if (li.classList.contains('negotiation')) continue
        if (li.classList.contains('caution')) continue
        const txt = li.textContent.trim()
        const num = parseFloat(txt.replace(/,/g, ''))
        if (!isNaN(num) && num > 0) {
          final_price = Math.round(num * 1000)  // K yen → JPY
          break
        }
      }

      // ── Seller mark ──────────────────────────────────────────────────────────
      // td.storeMark contains img elements with alt text
      // e.g. alt="AS-One Price (5stars)", alt="New arrival"
      const sellerMarkImgs = row.querySelectorAll('td.storeMark img[alt]')
      const seller_mark = sellerMarkImgs.length > 0
        ? Array.from(sellerMarkImgs).map(img => img.getAttribute('alt')).filter(Boolean).join(', ')
        : null

      // ── Thumbnail URL ────────────────────────────────────────────────────────
      const thumbnail_url = row.querySelector('td.carPhoto img')?.getAttribute('src') || null

      results.push({
        lot_no,
        auction_method,
        auction_date,
        location,
        make,
        car_name,
        grade,
        model_code_raw,
        engine_cc,
        mfg_year_raw,
        inspection_raw,
        mileage,
        color,
        gear,
        aircon,
        score,
        score_grade,
        wholesale_price,
        final_price,
        seller_mark,
        thumbnail_url,
        page_position: pageOffset + idx + 1,
      })
    })

    return results

  }, { venueFilter, pageOffset })

  // Post-process in Node.js
  return rows.map(row => ({
    ...row,
    form_code_short:   normalizeFormCode(row.model_code_raw),
    mfg_year_western:  eraToYear(row.mfg_year_raw),
    inspection_date:   parseInspectionDate(row.inspection_raw),
  }))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize form code — store as-is from ASNET, just trim and uppercase.
 * ASNET shows: "MXPK11", "6AA-MXPK16", "3BA-AGH40W" etc.
 * We store the raw value. The short version is derived for R2 path only.
 */
function normalizeFormCode(raw) {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '-1') return null
  // Short form for R2 path: strip prefix like "6AA-", "3BA-", "DAA-"
  const match = trimmed.match(/^[0-9A-Z]+-([A-Z0-9]+)$/)
  return match ? match[1] : trimmed.toUpperCase()
}

/**
 * Convert Japanese era year to western integer.
 * "R7" → 2025, "R6" → 2024, "H30" → 2018
 */
function eraToYear(raw) {
  if (!raw) return null
  const str = raw.trim()
  if (/^\d{4}$/.test(str)) return parseInt(str, 10)
  const ERA_OFFSETS = { R: 2018, H: 1988, S: 1925 }
  const match = str.match(/^([RHSrhs])(\d+)/)
  if (match) {
    const offset = ERA_OFFSETS[match[1].toUpperCase()]
    if (offset) return offset + parseInt(match[2], 10)
  }
  return null
}

/**
 * Parse ASNET inspection date string to ISO date.
 * "R9/03" → 2027-03-01, "R10/01" → 2028-01-01
 * "R9/02" → era R, year 9, month 02
 */
function parseInspectionDate(raw) {
  if (!raw || raw.trim() === '') return null
  const str = raw.trim()

  // Era format: "R9/03", "R10/01", "H30/06"
  const eraMatch = str.match(/^([RHSrhs])(\d+)[\/\-\.](\d{1,2})/)
  if (eraMatch) {
    const ERA_OFFSETS = { R: 2018, H: 1988, S: 1925 }
    const offset = ERA_OFFSETS[eraMatch[1].toUpperCase()]
    if (offset) {
      const year  = offset + parseInt(eraMatch[2], 10)
      const month = eraMatch[3].padStart(2, '0')
      return `${year}-${month}-01`
    }
  }

  // Western format: "2027/06"
  const westernMatch = str.match(/^(\d{4})[\/\-](\d{1,2})/)
  if (westernMatch) {
    return `${westernMatch[1]}-${westernMatch[2].padStart(2, '0')}-01`
  }

  return null
}

module.exports = { extractRows, normalizeFormCode, eraToYear }

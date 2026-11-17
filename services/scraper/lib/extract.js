'use strict'

/**
 * lib/extract.js
 * Row extraction for both USS listing pages. Every selector is confirmed
 * from a live HTML capture — either listing.txt (one-price) or Bidding.txt
 * (bidding), not guessed.
 *
 * Shared: #MainContents_Exhibit_GridArea tbody tr[style*="background-color: rgb"]
 * row selector, and the equipment/aircon icon row structure
 * (td.other > div.multiRowBase > ul > li > div, positions fixed regardless of
 * language: [0]=aircon(fixAc), [1]=Navi, [2]=SR, [3]=AW, [4]=Leather, [5]=PS,
 * [6]=PW — read by position, not by text, so it works whether the session is
 * Japanese (ナビ/革) or English (Navi/Leather) without any translation table).
 *
 * One-price (jp/oneClick/model/modelThumb.aspx) columns:
 *   1. td.kaijo   -> venue_name_ja + counter_no
 *   2. td.mYear   -> manufacture_year (Japanese era, e.g. "R07")
 *   3. td.model   -> thumb_src + span.grade
 *   4. td.shift   -> shift_type + displacement_cc (inside div.multiRowBase)
 *   5. td.mile    -> mileage (thousands) + inspection date (era.month, "R10.11")
 *   6. td.color   -> color_ja
 *   7. td.cTypeDir -> model_code
 *   8. td.period  -> deadline date + time
 *   9. td.price   -> price_jpy, or masked reveal date/time
 *  10. td.score   -> score + score_letter
 *
 * Bidding (en|jp/prelim/model/modelThumb.aspx) columns — different DOM shape:
 *   1. td.aaDate  -> auction_date ("Sep 15.26") + schedule_time ("temp[14:28]")
 *      Also carries the chkExhibit checkbox (ex_key) here, not under bidNo.
 *   2. td.bidNo   -> lot_no (human bid number) + venue_name (plain English)
 *   3. td.mYear   -> manufacture_year (already international, e.g. "2026")
 *   4. td.model   -> thumb_src + span.grade + has_360/has_undercarriage/has_wheels
 *      (icon PRESENCE only — no confirmed URL pattern for the actual 360
 *      viewer without visiting the detail page, so not fabricated here)
 *   5. td.shift   -> shift_type + displacement_cc (NO div.multiRowBase wrapper
 *      here, unlike one-price — read directly from the <td>)
 *   6. td.mile    -> mileage (thousands) + inspection date (EN month.YY, "Aug.29")
 *   7. td.color   -> color (already English text)
 *   8. td.cTypeDir -> model_code
 *   9. td.aaResult.price -> auction_result text, won_price, start_price
 *  10. td.score   -> score + score_letter
 *
 * Market Price HISTORY (en/market/model/modelThumb.aspx) — same 10 columns as bidding, so
 * extractHistoryRows() reuses extractBiddingListingRows(). aaResult there reads "Sold" and the
 * two prices are FINAL then START (x1,000 JPY) — the bidding parser already returns them as
 * won_price / start_price. Rows are found through their chkExhibit checkbox instead of the
 * grid's id / inline background colour, so the history page's exact grid wrapper doesn't matter.
 */

const ERA_OFFSETS = { R: 2018, H: 1988, S: 1925 }
const EN_MONTHS = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
}

// Deliberately no JA->EN color translation here. One-price color names come
// through in Japanese and are kept that way at scrape time — normalization
// happens later, downstream, in one place, rather than half-translated here
// and half left raw depending on which fields happen to get re-synced.

// ── One-price listing ────────────────────────────────────────────────────────

async function extractOnePriceListingRows(page) {
  const rawRows = await page.evaluate(() => {
    function readEquipment(row) {
      const iconDivs = Array.from(row.querySelectorAll('div.multiRowBase ul li div'))
      const isOn = (i) => iconDivs[i] && iconDivs[i].classList.contains('iconOn')
      return {
        aircon_type:   isOn(0) ? iconDivs[0].textContent.trim() : null,
        equip_navi:    isOn(1),
        equip_sr:      isOn(2),
        equip_aw:      isOn(3),
        equip_leather: isOn(4),
        equip_ps:      isOn(5),
        equip_pw:      isOn(6),
      }
    }

    const rows = document.querySelectorAll(
      '#MainContents_Exhibit_GridArea tbody tr[style*="background-color: rgb"]'
    )

    return Array.from(rows).map(row => {
      const cb = row.querySelector('input[name="chkExhibit"]')
      const ex_key = cb ? cb.value : null
      if (!ex_key) return null

      const venueCell     = row.querySelector('td.kaijo')
      const venueFullText = venueCell ? venueCell.textContent : ''
      const venueNode     = venueCell ? venueCell.firstChild : null
      const venue_name_ja = venueNode ? venueNode.textContent.trim() : null
      const counterM      = venueFullText.match(/\((\d+)\)/)
      const counter_no    = counterM ? parseInt(counterM[1], 10) : null

      const mYearCell      = row.querySelector('td.mYear')
      const model_year_raw = mYearCell ? mYearCell.textContent.trim() : null

      const carLinkSpan = row.querySelector('span.carLink')
      let grade_ja = null
      if (carLinkSpan) {
        const gradeSpan = carLinkSpan.querySelector('span.grade')
        grade_ja = gradeSpan ? gradeSpan.textContent.trim() : null
      }
      const thumbImg  = row.querySelector('td.eximg img.carImg')
      const thumb_src = thumbImg ? thumbImg.getAttribute('src') : null

      let shift_type = null, displacement_cc = null
      const shiftCell = row.querySelector('td.shift')
      if (shiftCell) {
        const div = shiftCell.querySelector('div.multiRowBase')
        if (div) {
          const parts = div.innerHTML.split('<br>')
          shift_type = parts[0] ? parts[0].replace(/<[^>]*>/g, '').trim() : null
          const dispN = parseInt((parts[1] || '').replace(/<[^>]*>/g, '').trim(), 10)
          displacement_cc = isNaN(dispN) ? null : dispN
        }
      }

      let mileage_thousand_km = null, inspection_date_raw = null
      const mileCell = row.querySelector('td.mile')
      if (mileCell) {
        const div = mileCell.querySelector('div.multiRowBase')
        const html = div ? div.innerHTML : mileCell.innerHTML
        const parts   = html.split('<br>')
        const mileRaw = (parts[0] || '').replace(/<[^>]*>/g, '').replace(/,/g, '').trim()
        const mileN   = parseInt(mileRaw, 10)
        mileage_thousand_km = isNaN(mileN) ? null : mileN
        inspection_date_raw = (parts[1] || '').replace(/&nbsp;/g, '').replace(/<[^>]*>/g, '').trim() || null
      }

      const colorCell = row.querySelector('td.color')
      const color_ja  = colorCell ? colorCell.textContent.trim() : null

      const codeCell   = row.querySelector('td.cTypeDir')
      const model_code = codeCell ? codeCell.textContent.trim() : null

      const periodCell = row.querySelector('td.period')
      const periodParts = periodCell
        ? periodCell.innerHTML.split('<br>').map(s => s.replace(/<[^>]*>/g, '').trim())
        : []
      const deadline_date_raw = periodParts[0] || null
      const deadline_time_raw = periodParts[1] || null

      const priceCell = row.querySelector('td.price')
      let price_jpy = null, price_masked = false
      let price_reveal_date_raw = null, price_reveal_time_raw = null
      if (priceCell) {
        const maskDiv = priceCell.querySelector('div.maskOnePrice')
        if (maskDiv) {
          price_masked = true
          const parts = maskDiv.innerHTML.split('<br>').map(s => s.replace(/<[^>]*>/g, '').trim())
          price_reveal_date_raw = parts[0] || null
          price_reveal_time_raw = parts[1] || null
        } else {
          const n = parseInt(priceCell.textContent.replace(/,/g, '').trim(), 10)
          if (!isNaN(n) && n > 0) price_jpy = n
        }
      }

      const scoreCell = row.querySelector('td.score')
      let score_raw = null, score_letter = null
      if (scoreCell) {
        const parts = scoreCell.innerHTML
          .replace(/<br\s*\/?>/gi, '|')
          .replace(/<[^>]+>/g, '')
          .split('|').map(s => s.trim()).filter(Boolean)
        score_raw    = parts[0] || null
        score_letter = parts[1] ? parts[1].replace(/[()]/g, '') : null
      }

      return {
        ex_key, venue_name_ja, counter_no, model_year_raw, grade_ja, thumb_src,
        shift_type, displacement_cc, mileage_thousand_km, inspection_date_raw,
        color_ja, model_code, deadline_date_raw, deadline_time_raw,
        price_jpy, price_masked, price_reveal_date_raw, price_reveal_time_raw,
        score_raw, score_letter,
        ...readEquipment(row),
      }
    }).filter(Boolean)
  })

  return rawRows.map(row => ({
    ...row,
    manufacture_year:  eraToYear(row.model_year_raw),
    mileage_km:        row.mileage_thousand_km != null ? row.mileage_thousand_km * 1000 : null,
    inspection_date:   parseEraMonth(row.inspection_date_raw),
    deadline_date:     parseJaSlashDate(row.deadline_date_raw),
    deadline_time:     parseJaTime(row.deadline_time_raw),
    price_reveal_date: parseJaSlashDate(row.price_reveal_date_raw),
    price_reveal_time: parseJaTime(row.price_reveal_time_raw),
    auction_grade:     row.score_raw ? `${row.score_raw}${row.score_letter || ''}` : null,
    thumb_parsed:      parseThumbSrc(row.thumb_src),
    equipment_raw:     buildEquipmentRaw(row),
  }))
}

// ── Bidding listing ───────────────────────────────────────────────────────────

async function extractBiddingListingRows(page, opts = {}) {
  const byCheckbox = !!opts.byCheckbox
  const rawRows = await page.evaluate((byCheckbox) => {
    function readEquipment(row) {
      const iconDivs = Array.from(row.querySelectorAll('div.multiRowBase ul li div'))
      const isOn = (i) => iconDivs[i] && iconDivs[i].classList.contains('iconOn')
      return {
        aircon_type:   isOn(0) ? iconDivs[0].textContent.trim() : null,
        equip_navi:    isOn(1),
        equip_sr:      isOn(2),
        equip_aw:      isOn(3),
        equip_leather: isOn(4),
        equip_ps:      isOn(5),
        equip_pw:      isOn(6),
      }
    }

    const rows = byCheckbox
      ? Array.from(document.querySelectorAll('input[name="chkExhibit"]')).map(cb => cb.closest('tr')).filter(Boolean)
      : document.querySelectorAll('#MainContents_Exhibit_GridArea tbody tr[style*="background-color: rgb"]')

    return Array.from(rows).map(row => {
      const cb = row.querySelector('input[name="chkExhibit"]')
      const ex_key = cb ? cb.value : null
      if (!ex_key) return null

      // ── Column 1: aaDate — auction_date + schedule_time ─────────────────────
      const dateCell = row.querySelector('td.aaDate')
      const dateParts = dateCell
        ? dateCell.innerHTML.split('<br>').map(s => s.replace(/<[^>]*>/g, '').trim())
        : []
      const auction_date_raw = dateParts[0] || null
      const schedule_raw     = dateParts[1] || null

      // ── Column 2: bidNo — lot_no + venue (plain English) ────────────────────
      const bidNoCell = row.querySelector('td.bidNo')
      const bidNoParts = bidNoCell
        ? bidNoCell.innerHTML.split('<br>').map(s => s.replace(/<[^>]*>/g, '').trim()).filter(Boolean)
        : []
      const lot_no      = bidNoParts[0] || null
      const venue_name  = bidNoParts[1] || null

      // ── Column 3: mYear — already international ─────────────────────────────
      const mYearCell = row.querySelector('td.mYear')
      const manufacture_year_raw = mYearCell ? mYearCell.textContent.trim() : null

      // ── Column 4: model — grade, thumb, 360/undercarriage/wheels icons ──────
      const carLinkSpan = row.querySelector('span.carLink')
      let grade = null
      if (carLinkSpan) {
        const gradeSpan = carLinkSpan.querySelector('span.grade')
        grade = gradeSpan ? gradeSpan.textContent.trim() : null
      }
      const thumbImg  = row.querySelector('td.eximg img.carImg')
      const thumb_src = thumbImg ? thumbImg.getAttribute('src') : null
      const has_360            = !!row.querySelector('img.imgVarious1')
      const has_undercarriage  = !!row.querySelector('img.imgVarious2')
      const has_wheels         = !!row.querySelector('img.imgVarious3')

      // ── Column 5: shift — NO div.multiRowBase wrapper here ──────────────────
      let shift_type = null, displacement_cc = null
      const shiftCell = row.querySelector('td.shift')
      if (shiftCell) {
        const parts = shiftCell.innerHTML.split('<br>')
        shift_type = parts[0] ? parts[0].replace(/<[^>]*>/g, '').trim() : null
        const dispN = parseInt((parts[1] || '').replace(/<[^>]*>/g, '').trim(), 10)
        displacement_cc = isNaN(dispN) ? null : dispN
      }

      // ── Column 6: mile — mileage (thousands) + EN inspection month.YY ──────
      let mileage_thousand_km = null, inspection_date_raw = null
      const mileCell = row.querySelector('td.mile')
      if (mileCell) {
        const parts   = mileCell.innerHTML.split('<br>')
        const mileRaw = (parts[0] || '').replace(/<[^>]*>/g, '').replace(/,/g, '').trim()
        const mileN   = parseInt(mileRaw, 10)
        mileage_thousand_km = isNaN(mileN) ? null : mileN
        inspection_date_raw = (parts[1] || '').replace(/&nbsp;/g, '').replace(/<[^>]*>/g, '').trim() || null
      }

      // ── Column 7: color — plain English ──────────────────────────────────────
      const colorCell = row.querySelector('td.color')
      const color = colorCell ? colorCell.textContent.trim() : null

      // ── Column 8: model code ──────────────────────────────────────────────────
      const codeCell   = row.querySelector('td.cTypeDir')
      const model_code = codeCell ? codeCell.textContent.trim() : null

      // ── Column 9: aaResult/price — result text + won price + start price ────
      const resultCell = row.querySelector('td.aaResult')
      let auction_result_raw = null, won_price_raw = null, start_price_raw = null
      if (resultCell) {
        const resultDiv = resultCell.querySelector('div')
        auction_result_raw = resultDiv ? resultDiv.textContent.replace(/\s+/g, ' ').trim() : null

        const clone = resultCell.cloneNode(true)
        const cloneDiv = clone.querySelector('div')
        if (cloneDiv) cloneDiv.remove()
        const remainder = clone.innerHTML.split('<br>').map(s => s.replace(/<[^>]*>/g, '').trim())
        won_price_raw   = remainder[0] || null
        start_price_raw = remainder[1] || null
      }

      // ── Column 10: score ──────────────────────────────────────────────────────
      const scoreCell = row.querySelector('td.score')
      let score_raw = null, score_letter = null
      if (scoreCell) {
        const parts = scoreCell.innerHTML
          .replace(/<br\s*\/?>/gi, '|')
          .replace(/<[^>]+>/g, '')
          .split('|').map(s => s.trim()).filter(Boolean)
        score_raw    = parts[0] || null
        score_letter = parts[1] ? parts[1].replace(/[()]/g, '') : null
      }

      return {
        ex_key, auction_date_raw, schedule_raw,
        lot_no, venue_name,
        manufacture_year_raw,
        grade, thumb_src, has_360, has_undercarriage, has_wheels,
        shift_type, displacement_cc,
        mileage_thousand_km, inspection_date_raw,
        color, model_code,
        auction_result_raw, won_price_raw, start_price_raw,
        score_raw, score_letter,
        ...readEquipment(row),
      }
    }).filter(Boolean)
  }, byCheckbox)

  return rawRows.map(row => ({
    ...row,
    auction_date:      parseEnDateDotYY(row.auction_date_raw),
    schedule_time:      parseScheduleTime(row.schedule_raw),
    manufacture_year:   parseInt(row.manufacture_year_raw, 10) || null,
    mileage_km:         row.mileage_thousand_km != null ? row.mileage_thousand_km * 1000 : null,
    inspection_date:    parseEnMonthDotYY(row.inspection_date_raw),
    auction_grade:      row.score_raw ? `${row.score_raw}${row.score_letter || ''}` : null,
    thumb_parsed:       parseThumbSrc(row.thumb_src),
    equipment_raw:      buildEquipmentRaw(row),
    won_price:          parsePriceThousand(row.won_price_raw),
    start_price:        parsePriceThousand(row.start_price_raw),
  }))
}

/** Market Price history listing — same columns as bidding, rows located by their checkbox. */
function extractHistoryRows(page) {
  return extractBiddingListingRows(page, { byCheckbox: true })
}

// ── Shared helpers (Node-side — page.evaluate can't call these) ─────────────

function buildEquipmentRaw(row) {
  const parts = []
  if (row.aircon_type) parts.push(row.aircon_type)
  if (row.equip_navi) parts.push('Navi')
  if (row.equip_sr) parts.push('SR')
  if (row.equip_aw) parts.push('AW')
  if (row.equip_leather) parts.push('Leather')
  if (row.equip_ps) parts.push('PS')
  if (row.equip_pw) parts.push('PW')
  return parts.length ? parts.join(',') : null
}

/** "R07" -> 2025, "H30" -> 2018, plain "2007" -> 2007 */
function eraToYear(raw) {
  if (!raw) return null
  const str = raw.trim()
  if (/^\d{4}$/.test(str)) return parseInt(str, 10)
  const m = str.match(/^([RHSrhs])(\d+)/)
  if (m) {
    const offset = ERA_OFFSETS[m[1].toUpperCase()]
    if (offset) return offset + parseInt(m[2], 10)
  }
  return null
}

/** "R10.11" -> "2028-11-01" */
function parseEraMonth(raw) {
  if (!raw) return null
  const m = raw.trim().match(/^([RHSrhs])(\d+)\.(\d{1,2})$/)
  if (!m) return null
  const offset = ERA_OFFSETS[m[1].toUpperCase()]
  if (!offset) return null
  const year  = offset + parseInt(m[2], 10)
  const month = m[3].padStart(2, '0')
  return `${year}-${month}-01`
}

/** "26/09/18" -> "2026-09-18" */
function parseJaSlashDate(raw) {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{2})$/)
  if (!m) return null
  return `20${m[1]}-${m[2]}-${m[3]}`
}

/** "12:00まで" or "10:00公開" -> "12:00:00" */
function parseJaTime(raw) {
  if (!raw) return null
  const m = raw.match(/(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}:00` : null
}

/** "Sep 15.26" -> "2026-09-15" */
function parseEnDateDotYY(raw) {
  if (!raw) return null
  const m = raw.trim().match(/^([A-Za-z]{3})\s+(\d{1,2})\.(\d{2})$/)
  if (!m) return null
  const month = EN_MONTHS[m[1]]
  if (!month) return null
  return `20${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/** "Aug.29" -> "2029-08-01" */
function parseEnMonthDotYY(raw) {
  if (!raw) return null
  const m = raw.trim().match(/^([A-Za-z]{3})\.(\d{2})$/)
  if (!m) return null
  const month = EN_MONTHS[m[1]]
  if (!month) return null
  return `20${m[2]}-${String(month).padStart(2, '0')}-01`
}

/** "temp[14:28]" or "[--:--]" -> "14:28:00" | null */
function parseScheduleTime(raw) {
  if (!raw) return null
  const m = raw.match(/\[(\d{2}):(\d{2})\]/)
  return m ? `${m[1]}:${m[2]}:00` : null
}

/** "4,900" -> 4900000 (JPY, thousands). "----" or missing -> null. "0" -> 0. */
function parsePriceThousand(raw) {
  if (!raw) return null
  if (raw.replace(/-/g, '').trim() === '') return null
  const n = parseInt(raw.replace(/,/g, '').trim(), 10)
  return isNaN(n) ? null : n * 1000
}

/**
 * "ExhibitImage/HA/1316/ThumbFront/{hash}_T02.JPG" ->
 * { basePath: "ExhibitImage/HA/1316/", hash }
 * Used by lib/images.js to derive full-size image paths. Shared by both
 * listing pages — identical thumbnail URL pattern.
 */
function parseThumbSrc(thumbSrc) {
  if (!thumbSrc) return null
  const m = thumbSrc.match(/^ExhibitImage\/([A-Za-z]+)\/(\d+)\/ThumbFront\/([a-f0-9]+)_T\d+\.(JPG|jpg)$/)
  if (!m) return null
  return { basePath: `ExhibitImage/${m[1]}/${m[2]}/`, hash: m[3] }
}

module.exports = {
  extractOnePriceListingRows,
  extractBiddingListingRows,
  extractHistoryRows,
  eraToYear,
  parseThumbSrc,
}

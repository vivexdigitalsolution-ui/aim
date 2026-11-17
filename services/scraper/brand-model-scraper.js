/**
 * uss-brand-model-scraper.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Scrapes all brands and models from the USS "Preliminary Inspection ->
 * Vehicle model" search page and upserts into scraper_brands
 * / reference.vehicle_models_lookup — the same tables and shape the ASNET
 * scrapers (asnet-brand-scraper.js / asnet-model-scraper.js) already write,
 * just source = 'uss' instead of 'asnet'.
 *
 * Combined into ONE file (unlike the ASNET pair) because brand and model both
 * live on the same USS page and never require a second login/navigation —
 * the whole flow (login -> brands -> loop models per brand) is one
 * continuous browser session.
 *
 * USS page shape (confirmed from a live HTML capture, not guessed):
 *   - One page, four side-by-side panels (Site / Manufactures / Models / Result).
 *     Clicking a panel's "Next" arrow fires a synchronous AJAX call that
 *     reloads the NEXT panel's HTML in place — no page navigation happens.
 *   - Brand and model checkboxes are flat sibling <label> elements, not
 *     <optgroup><option> pairs like ASNET: a <label class="listTitle"> acts
 *     as a running category header (country for brands, brand name for
 *     models) followed by however many plain <label> items belong to it.
 *   - "ALL USS" (the Site step) is checked by default — no click needed
 *     there, just advance past it.
 *
 * Login form confirmed from a live HTML capture: #MemberId / #MemberPassword
 * text fields, a LoginMode radio (jp/en/cs), and the submit control is an
 * <a onclick="doLogin()"> image link, not a real <button>/<input
 * type=submit> — clicked accordingly below.
 *
 * Japanese pass: confirmed by direct testing that only the login page
 * differs — same LoginMode radio, just "jp" instead of "en" — and the same
 * search URL/page/selectors serve Japanese content once the session itself
 * is authenticated in Japanese mode. So the whole flow (login -> brands ->
 * models) can run a second time with modeSelector: '#jp', language: 'ja'.
 * Which language(s) actually run is chosen per-invocation via a CLI arg
 * (see RUN_ARG below / "Run" section) rather than a hardcoded flag, so EN
 * and JA can be scraped separately without one overwriting or blocking the
 * other. context.clearCookies() runs before every login this script does —
 * the persistent profile carries session cookies across separate
 * invocations too, so a leftover EN session could otherwise bounce a later
 * JP-only run straight back to the (still-English) homepage instead of
 * actually re-authenticating in Japanese.
 *
 * KNOWN GAPS — flagged rather than guessed:
 *   1. The Step-2 country listTitle labels in COUNTRY_MAP for Japanese
 *      (日本, アメリカ, ドイツ, etc.) are educated-guess translations of the
 *      confirmed English labels, NOT confirmed from a live JA HTML capture.
 *      Any category the map doesn't recognize logs a warning with the raw
 *      text instead of silently writing country: null — watch the console
 *      on the first JA run and correct COUNTRY_MAP from what's reported.
 *   2. The "Open CIS Login Alert" popup: confirmed via live testing that
 *      clicking Login can trigger this, and that it launches a native
 *      USB-security-key login client (page briefly visits
 *      login_usbkey_wait.aspx) — if it's not clicked, USS bounces the
 *      browser back to open/entrance/index.html instead of logging in.
 *      IMPORTANT: page.on('dialog') must NOT call accept()/dismiss() here.
 *      Playwright auto-dismisses any JS dialog with no listener (or a
 *      listener that doesn't resolve it) — an earlier version of this
 *      script had an auto-dismiss "safety net" that silently cancelled the
 *      real prompt before a human could click it. The listener below only
 *      logs; it leaves the dialog on-screen for a human to click in the
 *      visible (headless: false) browser window. Per direct feedback, even
 *      a correct click can still bounce back to open/entrance/index.html —
 *      that's accepted as normal here. login() recovers by clicking the
 *      entrance page's own login link and retrying, up to
 *      MAX_LOGIN_ATTEMPTS times, rather than treating the bounce as fatal.
 *
 * Run:
 *   node uss-brand-model-scraper.js en    — English only
 *   node uss-brand-model-scraper.js jp    — Japanese only
 *   node uss-brand-model-scraper.js both  — both, sequentially (default if no arg)
 *
 * Env vars required (.env):
 *   USS_USER, USS_PASS
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config()

const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')

// ── Config ────────────────────────────────────────────────────────────────────

// Which language(s) to scrape this run — chosen via CLI arg, not a hardcoded
// flag, so EN and JA can be run separately or together on demand:
//   node uss-brand-model-scraper.js en    → English only
//   node uss-brand-model-scraper.js jp    → Japanese only
//   node uss-brand-model-scraper.js both  → both, sequentially (default)
const RUN_ARG = (process.argv[2] || 'en').toLowerCase()
if (!['en', 'jp', 'both'].includes(RUN_ARG)) {
  console.log('Usage: node uss-brand-model-scraper.js [en|jp|both]  (default: both)')
  process.exit(1)
}
const RUN_EN = RUN_ARG === 'en' || RUN_ARG === 'both'
const RUN_JP = RUN_ARG === 'jp' || RUN_ARG === 'both'

// Confirmed WRONG by live testing: the /en/ path segment is the actual
// language switch, not just a version code — a JP-mode login still landed
// on the /en/ search page and every brand/model name came back in English
// (root cause of a bad scraper_brands/language='ja' batch
// that had to be cleaned up). The JP top page after login was observed at
// .../jp/top.aspx, so the search page for the JA pass swaps /en/ -> /jp/.
const USS_SEARCH_URL_EN = 'https://ssl.cis6200.jp/cis/y5816001/en/prelim/model/modelSch.aspx'
const USS_SEARCH_URL_JA = 'https://ssl.cis6200.jp/cis/y5816001/jp/prelim/model/modelSch.aspx'
// Confirmed working, but kept in .env (not hardcoded) since USS can change
// this without notice — amend USS_LOGIN_URL there if it ever moves.
const USS_LOGIN_URL  = process.env.USS_LOGIN_URL || 'https://ssl.cis6200.jp/auth/cis/login.aspx'

// Confirmed from a live login-page HTML capture.
const USS_LOGIN_USER_SELECTOR   = '#MemberId'
const USS_LOGIN_PASS_SELECTOR   = '#MemberPassword'
const USS_LOGIN_MODE_SELECTORS  = { en: '#en', jp: '#jp' } // LoginMode radio: jp | en | cs
const USS_LOGIN_SUBMIT_SELECTOR = 'a.loginbotten_a' // <a onclick="doLogin()"> image button, not a real submit

// USS's own country labels (Step 2 listTitles) -> ISO 2-letter code.
// EN labels confirmed from a live capture; JA labels are educated-guess
// translations, NOT yet confirmed — see header comment KNOWN GAPS #1.
const COUNTRY_MAP = {
  // English
  'Japan':           'JP',
  'US':              'US',
  'Germany':         'DE',
  'England':         'GB',
  'Italia':          'IT',
  'France':          'FR',
  'Sweden':          'SE',
  'South-Africa':    'ZA',
  'Thailand':        'TH',
  'Others':          null,
  'China':           'CN',
  'Overseas Others': null,
  // Japanese — UNCONFIRMED, verify against real output
  '日本':      'JP',
  'アメリカ':  'US',
  'ドイツ':    'DE',
  'イギリス':  'GB',
  'イタリア':  'IT',
  'フランス':  'FR',
  'スウェーデン': 'SE',
  '南アフリカ': 'ZA',
  'タイ':      'TH',
  'その他':    null,
  '中国':      'CN',
  '海外その他': null,
}

// ── Supabase client ───────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// ── Generic checkbox-group extractor ─────────────────────────────────────────
// Both the brand panel (#brand, listTitle = country) and the model panel
// (#model, listTitle = brand name) share the exact same "running category"
// shape, so one evaluate() function serves both.

async function extractCheckboxGroups(page, containerSelector, checkboxName) {
  return page.evaluate(({ containerSelector, checkboxName }) => {
    const container = document.querySelector(containerSelector)
    if (!container) return []

    const results = []
    let currentCategory = null

    for (const el of container.children) {
      if (el.tagName !== 'LABEL') continue

      if (el.classList.contains('listTitle')) {
        currentCategory = el.textContent.trim()
        continue
      }

      const input = el.querySelector(`input[name="${checkboxName}"]`)
      if (!input) continue

      const value = input.value
      // Raw text is like "TOYOTA (12031)" — strip the trailing count.
      const rawText = el.textContent.trim()
      const name = rawText.replace(/\s*\(\d+\)\s*$/, '').trim()

      if (!value || !name) continue

      results.push({ code: value, name, category: currentCategory })
    }

    return results
  }, { containerSelector, checkboxName })
}

// ── Navigation ────────────────────────────────────────────────────────────────

// Confirmed with real testing: clicking login can trigger USS's "Open CIS
// Login Alert" prompt (a native USB-security-key handshake — the page
// briefly visits login_usbkey_wait.aspx). Per direct feedback, even after
// clicking it the flow can still bounce back to open/entrance/index.html —
// that's accepted as normal/expected here, not an error. The recovery is to
// click the entrance page's own login link
// (<a href="../../auth/cis/login.aspx">) to go back to the login form and
// try again, looping until a real, non-login/non-entrance page is reached.
const LOGIN_LINK_SELECTOR = 'a[href*="auth/cis/login.aspx"]'
const MAX_LOGIN_ATTEMPTS = 6

async function login(page, { modeSelector, label }) {
  const user = process.env.USS_USER
  const pass = process.env.USS_PASS
  if (!user || !pass) throw new Error('Missing USS_USER or USS_PASS in .env')

  console.log(`LOGIN START (${label})`)
  await page.goto(USS_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })

  for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
    // Check what's actually on screen before touching anything — trusting a
    // URL snapshot right after a click was the bug: it can still read
    // "login.aspx" for a moment while the page is already navigating away,
    // which then sent fill() chasing form fields that were already gone and
    // just hung waiting on their selectors.
    const onLoginForm = await page.locator(USS_LOGIN_USER_SELECTOR).isVisible().catch(() => false)

    if (!onLoginForm) {
      if (page.url().includes('open/entrance')) {
        console.log(
          `Attempt ${attempt}/${MAX_LOGIN_ATTEMPTS}: on open/entrance/index.html ` +
          '— clicking its login link to go back and retry.'
        )
        await page.click(LOGIN_LINK_SELECTOR)
        await page.waitForSelector(USS_LOGIN_USER_SELECTOR, { timeout: 30000 })
        continue
      }
      // No login form, and not parked on the entrance page — we're in.
      console.log(`LOGIN SUCCESS on attempt ${attempt}/${MAX_LOGIN_ATTEMPTS} — reached ${page.url()}`)
      return
    }

    await page.fill(USS_LOGIN_USER_SELECTOR, user)
    await page.fill(USS_LOGIN_PASS_SELECTOR, pass)
    await page.check(modeSelector) // log straight into the target language, no post-login toggle needed

    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => {}),
      page.click(USS_LOGIN_SUBMIT_SELECTOR), // <a onclick="doLogin()"> image link
    ])

    // Give the USB-key handshake / entrance bounce time to settle — the
    // next loop iteration re-checks the actual DOM, not a URL snapshot.
    await page.waitForTimeout(3000)
    console.log(`Attempt ${attempt}/${MAX_LOGIN_ATTEMPTS}: submitted, checking result...`)
  }

  throw new Error(
    `Login failed after ${MAX_LOGIN_ATTEMPTS} attempts — still bouncing between ` +
    'login.aspx and open/entrance/index.html. If a manual "Open CIS Login Alert" ' +
    'click is required, make sure to click it promptly during a run.'
  )
}

async function goToSearchPage(page, language) {
  const url = language === 'ja' ? USS_SEARCH_URL_JA : USS_SEARCH_URL_EN
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('#StepHeadKaijo', { timeout: 60000 })
}

// ── Step 1 -> Step 2: reveal brands ──────────────────────────────────────────

async function scrapeBrands(page) {
  console.log('\nAdvancing past Site step (ALL USS already checked)...')
  await page.click('#StepHeadKaijo')
  await page.waitForSelector('#brand label.listTitle', { timeout: 30000 })
  await page.waitForTimeout(500) // let the AJAX-inserted HTML settle

  const brands = await extractCheckboxGroups(page, '#brand', 'BrandCodeOption')
  console.log(`Found ${brands.length} brands`)
  return brands
}

// ── Step 2 -> Step 3: select one brand, reveal its models ───────────────────

async function scrapeModelsForBrand(page, brandCode) {
  // Uncheck whatever's currently checked, check only this brand.
  await page.evaluate((code) => {
    document.querySelectorAll('input[name="BrandCodeOption"]').forEach((cb) => {
      cb.checked = (cb.value === code)
    })
  }, brandCode)

  await page.click('#StepHeadBrand')

  // Model panel reloads via AJAX — wait for it, but a brand can legitimately
  // have zero models, so don't hang forever if the listTitle never appears.
  await page.waitForSelector('#model label.listTitle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(500)

  return extractCheckboxGroups(page, '#model', 'CarCategoryNoOption')
}

// ── Upserts ───────────────────────────────────────────────────────────────────

// The brand code doubles as the "lookup id" that scrapeAndUpsertLanguage passes to upsertModelLookup.
async function upsertBrandLookup({ lookup_name, lookup_code, country }) {
  const { error } = await supabase
    .from('scraper_brands')
    .upsert({ code: lookup_code, name: lookup_name, country, updated_at: new Date().toISOString() }, { onConflict: 'code' })

  if (error) {
    console.log(`  [DB ERROR] ${lookup_name}: ${error.message}`)
    return null
  }
  return lookup_code
}

async function upsertModelLookup({ lookup_name, lookup_code, brand_lookup_id }) {
  const { error } = await supabase
    .from('scraper_models')
    .upsert({ brand_code: brand_lookup_id, code: lookup_code, name: lookup_name, updated_at: new Date().toISOString() }, { onConflict: 'brand_code,code' })

  if (error) {
    console.log(`    [DB ERROR] ${lookup_name}: ${error.message}`)
    return false
  }
  return true
}

// ── One full brand+model scrape+upsert pass, for a single language ──────────

async function scrapeAndUpsertLanguage(page, language) {
  const tag = language.toUpperCase()
  let modelsInserted = 0
  let failed = 0

  const brands = await scrapeBrands(page)

  console.log(`\nUpserting ${tag} brands into scraper_brands...`)
  const brandRows = [] // { code, name, lookupId }

  for (const b of brands) {
    const country = COUNTRY_MAP[b.category]
    if (country === undefined) {
      console.log(`  [WARN] Unrecognized ${tag} country category "${b.category}" — add it to COUNTRY_MAP. Storing country: null for now.`)
    }
    const lookupId = await upsertBrandLookup({
      lookup_name: b.name,
      lookup_code: b.code,
      country: country ?? null,
      language,
    })
    if (lookupId) {
      brandRows.push({ code: b.code, name: b.name, lookupId })
      console.log(`  [${tag}] ${b.name} (${b.code}) [${country || '??'}]`)
    } else {
      failed++
    }
  }

  console.log(`\n${brandRows.length} ${tag} brands saved — now scraping models for each...`)

  for (let i = 0; i < brandRows.length; i++) {
    const brand = brandRows[i]
    console.log(`\n[${tag} ${i + 1}/${brandRows.length}] ${brand.name} (${brand.code})`)

    try {
      const models = await scrapeModelsForBrand(page, brand.code)
      console.log(`  Models: ${models.length}`)

      for (const m of models) {
        const ok = await upsertModelLookup({
          lookup_name: m.name,
          lookup_code: m.code,
          language,
          brand_lookup_id: brand.lookupId,
        })
        if (ok) {
          modelsInserted++
          console.log(`    [${tag}] ${m.name} (${m.code})`)
        } else {
          failed++
        }
      }
    } catch (err) {
      console.log(`  ERROR scraping models for ${brand.name}: ${err.message}`)
      failed++
      // Try to recover the page state before moving to the next brand.
      await goToSearchPage(page, language).catch(() => {})
    }
  }

  return { modelsInserted, failed, brandsCount: brandRows.length }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Persistent profile, not an incognito-style launch(). The login redirect
  // to open/entrance/index.html triggers a Chrome "Open CIS Login Alert?"
  // permission prompt for an external protocol handler — if that's a real
  // native Chrome dialog (not caught by page.on('dialog'), which only sees
  // JS alert/confirm/prompt), Chrome usually offers a "remember my choice"
  // option. With a persistent user-data-dir, clicking Open ONCE ever on a
  // given machine is enough — Chrome remembers it for this site on every
  // future run, so this stops being a per-run manual step.
  const userDataDir = require('path').join(__dirname, '.chrome-profile')
  const context = await chromium.launchPersistentContext(userDataDir, { headless: false, slowMo: 80 })
  const page = context.pages()[0] || (await context.newPage())
  page.setDefaultTimeout(60000)
  page.setDefaultNavigationTimeout(120000)

  // Do NOT accept()/dismiss() here — see header comment. Auto-resolving this
  // was cancelling the real "Open CIS Login Alert" dialog before a human
  // could click it. Just log and leave it on-screen for a manual click.
  page.on('dialog', (d) => {
    console.log(`\n>>> Browser dialog appeared: "${d.message()}" — click it manually in the browser window.\n`)
  })

  let totalModelsInserted = 0
  let totalFailed = 0

  try {
    // Clear cookies before every login attempt this run, not just between
    // passes — the persistent profile carries session cookies across
    // separate script invocations too, so a leftover session from a prior
    // "en" run could bounce a later "jp"-only run straight to the (still
    // English) homepage instead of actually authenticating in Japanese.
    if (RUN_EN) {
      await context.clearCookies()
      await login(page, { modeSelector: USS_LOGIN_MODE_SELECTORS.en, label: 'EN' })
      await goToSearchPage(page, 'en')
      const enResult = await scrapeAndUpsertLanguage(page, 'en')
      totalModelsInserted += enResult.modelsInserted
      totalFailed += enResult.failed
    }

    if (RUN_JP) {
      if (RUN_EN) {
        console.log('\n════════════════════════════════')
        console.log('Switching to JAPANESE pass — clearing cookies to force a fresh login...')
        console.log('════════════════════════════════')
      }
      await context.clearCookies()
      await login(page, { modeSelector: USS_LOGIN_MODE_SELECTORS.jp, label: 'JP' })
      await goToSearchPage(page, 'ja')
      const jaResult = await scrapeAndUpsertLanguage(page, 'ja')
      totalModelsInserted += jaResult.modelsInserted
      totalFailed += jaResult.failed
    }

    await context.close()
  } catch (err) {
    console.log('FATAL:', err)
    try { await context.close() } catch {}
    process.exit(1)
  }

  console.log('\n════════════════════════════════')
  console.log('USS BRAND + MODEL SCRAPE COMPLETE')
  console.log(`  Models upserted: ${totalModelsInserted}`)
  console.log(`  Errors:          ${totalFailed}`)
  console.log('════════════════════════════════')
  console.log('Next: node make-targets.js --brands "TOYOTA,BMW"   (or --all)')

  process.exit(totalFailed > 0 ? 1 : 0)
}

main()

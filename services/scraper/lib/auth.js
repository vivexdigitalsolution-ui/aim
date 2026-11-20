'use strict'

/**
 * lib/auth.js
 * USS login — language-aware. One-Price (ワンクリック) is JP-only; Bidding
 * (Preliminary Inspection) can log in English, confirmed by direct
 * instruction. Callers pass langMode: 'jp' | 'en'.
 *
 * Same confirmed selectors and retry logic as uss-brand-model-scraper.js's
 * login(): #MemberId / #MemberPassword / LoginMode radio / a.loginbotten_a
 * image-link submit. Clicking login can trigger USS's "Open CIS Login Alert"
 * prompt (a native USB-security-key handshake — the page briefly visits
 * login_usbkey_wait.aspx). Per direct testing feedback, even a correct click
 * can still bounce back to open/entrance/index.html — that's normal here,
 * not an error. Recovery: click the entrance page's own login link and
 * retry, checking the actual DOM (not a URL snapshot) before each attempt.
 */

const USS_LOGIN_URL = process.env.USS_LOGIN_URL || 'https://ssl.cis6200.jp/auth/cis/login.aspx'

const USS_LOGIN_USER_SELECTOR   = '#MemberId'
const USS_LOGIN_PASS_SELECTOR   = '#MemberPassword'
const USS_LOGIN_MODE_SELECTORS  = { en: '#en', jp: '#jp' }
const USS_LOGIN_SUBMIT_SELECTOR = 'a.loginbotten_a'
const LOGIN_LINK_SELECTOR       = 'a[href*="auth/cis/login.aspx"]'
const MAX_LOGIN_ATTEMPTS        = 6

async function login(page, langMode = 'jp') {
  const modeSelector = USS_LOGIN_MODE_SELECTORS[langMode]
  if (!modeSelector) throw new Error(`Unknown langMode: ${langMode} (expected 'en' or 'jp')`)

  const user = process.env.USS_USER
  const pass = process.env.USS_PASS
  if (!user || !pass) throw new Error('Missing USS_USER or USS_PASS in .env')

  console.log(`LOGIN START (${langMode.toUpperCase()})`)
  await page.goto(USS_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 120000 })

  for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
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
      // right after the password USS passes through waiting pages (login_usbkey_wait.aspx -> usb_login.aspx) before the real home page:
      // wait until they are done, or the next page.goto cuts the redirect in half and the session is never finished
      if (/usbkey|usb_login/i.test(page.url())) {
        console.log(`Login passes through ${page.url()} - waiting for the home page (up to 90 s) ...`)
        await page.waitForURL((u) => !/usbkey|usb_login/i.test(u.toString()), { timeout: 90000 }).catch(() => console.log('Still on the waiting page after 90 s - carrying on'))
        await page.waitForLoadState('domcontentloaded').catch(() => {})
      }
      console.log(`LOGIN SUCCESS on attempt ${attempt}/${MAX_LOGIN_ATTEMPTS} — reached ${page.url()}`)
      return
    }

    await page.fill(USS_LOGIN_USER_SELECTOR, user)
    await page.fill(USS_LOGIN_PASS_SELECTOR, pass)
    await page.check(modeSelector)

    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => {}),
      page.click(USS_LOGIN_SUBMIT_SELECTOR),
    ])

    await page.waitForTimeout(3000)
    console.log(`Attempt ${attempt}/${MAX_LOGIN_ATTEMPTS}: submitted, checking result...`)
  }

  throw new Error(
    `Login failed after ${MAX_LOGIN_ATTEMPTS} attempts — still bouncing between ` +
    'login.aspx and open/entrance/index.html. If a manual "Open CIS Login Alert" ' +
    'click is required, make sure to click it promptly during a run.'
  )
}

module.exports = { login }

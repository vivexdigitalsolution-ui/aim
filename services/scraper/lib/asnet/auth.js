'use strict'

/**
 * lib/auth.js
 * ASNET login and language switch.
 * Matches v1 proven approach exactly — simple fixed wait after language click.
 */

async function login(page) {
  const user = process.env.ASNET_USER
  const pass = process.env.ASNET_PASS

  if (!user || !pass) throw new Error('Missing ASNET_USER or ASNET_PASS in .env')

  console.log('LOGIN START')
  await page.goto('https://www.asnet.jp/asnet/authentication/login', {
    waitUntil: 'domcontentloaded',
    timeout:   120000,
  })

  await page.fill('#MemberAccount', user)
  await page.fill('#Password',      pass)

  await Promise.all([
    page.waitForNavigation({ timeout: 120000 }),
    page.click('button[type="submit"]'),
  ])

  console.log('LOGIN SUCCESS')

  // Switch to English — simple click + fixed wait, same as v1
  await page.click('#changeLanguage')
  await page.waitForTimeout(5000)
  console.log('LANGUAGE CHANGED TO ENGLISH')
}

module.exports = { login }

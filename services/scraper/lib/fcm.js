'use strict'

/**
 * lib/fcm.js: send a notification to a user's phones and browsers through Google FCM (HTTP v1).
 * Off until the Firebase service account is in .env:  FCM_SERVICE_ACCOUNT=C:\path\to\service-account.json   (or the JSON itself)
 * (Firebase console > Project settings > Service accounts > Generate new private key.)  The project id is read from that file.
 * A "data" message is sent so the app / service worker shows it and opens `url` when tapped. Dead tokens are removed from fcm_tokens.
 */

const fs = require('fs')
const { GoogleAuth } = require('google-auth-library')
const supabase = require('./db')

let creds = null, auth = null
function load() {
  if (creds !== null) return creds
  const raw = process.env.FCM_SERVICE_ACCOUNT
  if (!raw) return (creds = false)
  try { creds = JSON.parse(raw.trim().startsWith('{') ? raw : fs.readFileSync(raw, 'utf8')) } catch (e) { console.log('[FCM] cannot read FCM_SERVICE_ACCOUNT: ' + e.message); creds = false }
  return creds
}
const ready = () => !!load()

async function accessToken() {
  auth = auth || new GoogleAuth({ credentials: load(), scopes: ['https://www.googleapis.com/auth/firebase.messaging'] })
  const t = await (await auth.getClient()).getAccessToken()
  return t.token
}

/** @returns number of devices reached (0 = none registered or all dead) */
async function sendToUser(userId, { title, body, url }) {
  if (!ready()) return 0
  const { data: toks, error } = await supabase.from('fcm_tokens').select('token').eq('user_id', userId)
  if (error) throw new Error(error.message)
  if (!toks?.length) return 0
  const bearer = await accessToken()
  let ok = 0
  for (const { token } of toks) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${load().project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, data: { title: String(title).slice(0, 120), body: String(body || '').slice(0, 300), url: url || '/' }, android: { priority: 'high' } } }),
    })
    if (res.ok) { ok++; continue }
    const txt = await res.text()
    if (res.status === 404 || /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/.test(txt)) await supabase.from('fcm_tokens').delete().eq('token', token)   // the app was removed, or the token is stale
    else console.log('  [FCM] ' + res.status + ' ' + txt.slice(0, 160))
  }
  return ok
}

module.exports = { ready, sendToUser }

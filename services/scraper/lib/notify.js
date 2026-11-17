'use strict'

/**
 * lib/notify.js — the outside copies of an alert: email (Resend) and WhatsApp (Meta Cloud API template message, same pattern as CarzNexus admin-notify).
 * Each channel is OFF until its keys are in .env; nothing is sent and nothing fails without them.
 *
 *   Email:     RESEND_API_KEY, MAIL_FROM            (e.g. "AIM <alerts@yourdomain.com>")
 *   WhatsApp:  WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE   (+ WHATSAPP_TEMPLATE_LANG, default en; WHATSAPP_API_VERSION, default v21.0)
 *              The template is a Utility template with two body variables: {{1}} = title, {{2}} = details. It must be approved in Meta first.
 */

const emailReady = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
const whatsappReady = () => !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE)

/** Malaysian numbers as a WhatsApp wants them: digits only, country code first (012-345 6789 -> 60123456789). */
function waNumber(raw) {
  let d = String(raw || '').replace(/[^\d]/g, '')
  if (!d) return null
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('0')) d = '60' + d.slice(1)
  return d.length >= 9 && d.length <= 15 ? d : null
}

const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

async function sendEmail({ to, title, body, link, appUrl }) {
  const url = appUrl && link ? appUrl.replace(/\/$/, '') + link : null
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM, to: [to], subject: title,
      html: `<p><b>${esc(title)}</b></p>${body ? `<p>${esc(body).replace(/\n/g, '<br>')}</p>` : ''}${url ? `<p><a href="${url}">Open in AIM</a></p>` : ''}`,
    }),
  })
  if (!res.ok) throw new Error('email ' + res.status + ' ' + (await res.text()).slice(0, 200))
}

async function sendWhatsApp({ to, title, body }) {
  const res = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || 'v21.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: process.env.WHATSAPP_TEMPLATE, language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: String(title).slice(0, 200) }, { type: 'text', text: String(body || '-').replace(/\s*\n\s*/g, ' · ').slice(0, 400) }] }] },
    }),
  })
  if (!res.ok) throw new Error('whatsapp ' + res.status + ' ' + (await res.text()).slice(0, 200))
}

module.exports = { emailReady, whatsappReady, waNumber, sendEmail, sendWhatsApp }

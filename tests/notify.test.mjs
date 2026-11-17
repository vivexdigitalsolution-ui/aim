// The outside-message helpers: phone numbers and which channels are on.   node tests/notify.test.mjs
import { createRequire } from 'node:module'
const notify = createRequire(import.meta.url)('../services/scraper/lib/notify.js')

let fails = 0
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++ }

ok(notify.waNumber('012-345 6789') === '60123456789', 'a Malaysian mobile number becomes 60123456789')
ok(notify.waNumber('+60 12-345 6789') === '60123456789', 'a number with +60 stays as it is')
ok(notify.waNumber('0060123456789') === '60123456789', 'a 00 prefix is removed')
ok(notify.waNumber('') === null && notify.waNumber(null) === null && notify.waNumber('12') === null, 'an empty or too short number gives nothing')
const keep = { ...process.env }
for (const k of ['RESEND_API_KEY', 'MAIL_FROM', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TEMPLATE']) delete process.env[k]
ok(!notify.emailReady() && !notify.whatsappReady(), 'without keys both channels are off')
process.env.RESEND_API_KEY = 'x'; process.env.MAIL_FROM = 'a@b.c'
ok(notify.emailReady() && !notify.whatsappReady(), 'email needs its key and a from address, independent of WhatsApp')
Object.assign(process.env, keep)

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
process.exit(fails ? 1 : 0)

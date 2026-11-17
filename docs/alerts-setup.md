# Alerts: what is sent, to whom, and how to switch on email and WhatsApp

## What alerts exist
| Alert | Goes to | When |
|---|---|---|
| New bid order / order changed / order cancelled | every active staff user | the moment a dealer does it (database trigger) |
| Your bid was placed / won / not won / rejected | that dealer | the moment staff record it (database trigger) |
| Place before it closes | every active staff user | an order is still **not placed** and its car closes within 3 hours (checked every 15 minutes) |
| N new cars fit your buy list | that dealer | after the daily refresh, for cars not announced before |

Everyone sees them in the app under **Alerts** (a badge counts the unread ones). Email and WhatsApp copies are optional and off until you add keys.
Each person chooses on the Alerts page whether they also want an email and/or a WhatsApp copy (email is on by default, WhatsApp is opt-in and needs a number on their profile).

## Step 1. Database (once)
Run `supabase/migrations/27_notifications.sql` in the Japan Auction SQL Editor.

## Step 2. The 15-minute job (on the scraper PC, once)
It raises the "place before it closes" alerts and sends the email / WhatsApp copies. In PowerShell:

```
schtasks /Create /TN "AIM alerts" /TR "\"C:\Users\Alex\Projects\aim\services\scraper\run-alerts.bat\"" /SC MINUTE /MO 15 /F
```
Test it by hand: `node alerts.js --dry` (shows what it would do) or double-click `run-alerts.bat`.
The daily job (`daily.js`) also runs the buy-list step by itself; nothing more to schedule for that.

## Step 3 (optional). Email: Resend
1. Make a free account at resend.com and add your sending domain.
2. Add to `services/scraper/.env`:
```
RESEND_API_KEY=re_xxxxxxxx
MAIL_FROM=AIM <alerts@yourdomain.com>
APP_URL=https://your-aim-address
```
`APP_URL` makes the "Open in AIM" link in each email work. Until the app is deployed, leave it empty.

## Step 4 (optional). WhatsApp: the same Meta Cloud API as CarzNexus
Use the setup in `carznexus/docs/whatsapp-cloud-api-setup.md` (same phone number and access token). Then:
1. In Meta, create one **Utility** message template, for example `aim_alert`, language English, body exactly:
   `{{1}} - {{2}}`
   (variable 1 is the alert title, variable 2 the details). Wait for approval.
2. Add to `services/scraper/.env`:
```
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_TEMPLATE=aim_alert
WHATSAPP_TEMPLATE_LANG=en
```
Malaysian numbers such as 012-345 6789 are turned into 60123456789 automatically.

Cost: a Utility message in Malaysia is about USD 0.01 to 0.03, and Meta gives 1,000 free conversations a month.

## Good to know
- No keys = no outside messages and nothing breaks; alerts simply stay in the app.
- Only alerts from the last 24 hours are sent, so switching a channel on never floods anyone with old news.
- A failed send is logged and retried on the next run.
- An alert is never raised twice for the same order (the job remembers it).

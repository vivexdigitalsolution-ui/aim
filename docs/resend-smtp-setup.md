# Resend for the login emails (invitation, password reset)

Supabase sends these emails itself. Its built-in sender only reaches your own team and only a few emails an hour, so it must send through your Resend account (SMTP). The alerts already use Resend by its API (`RESEND_API_KEY` in the scraper `.env`): this is a second, separate connection to the same account.

## 1. In Resend (resend.com)
1. **Domains**: your sending domain must show **Verified** (the DNS records for SPF and DKIM are added at your domain host). Without it Resend only sends to your own address.
2. **API Keys > Create API Key**: name it `supabase-auth`, permission **Sending access**, domain = your domain. Copy the key (shown once). Use a separate key from the alerts one, so either can be changed without breaking the other.

## 2. In Supabase (project Japan Auction)
Authentication > **Emails** > **SMTP Settings** > turn on **Enable custom SMTP**:

| Field | Value |
|---|---|
| Sender email | an address on your verified domain, e.g. `no-reply@yourdomain.com` |
| Sender name | your business name, e.g. `PAW Japan` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the API key from step 1 |

Save. Then **Authentication > Rate Limits**: raise "emails sent per hour" (it starts low, about 30). It is enough for walk-in invitations; raise it if you invite more.

## 3. The invitation email text
Authentication > Emails > **Templates** > **Invite user**. Subject and body (keep `{{ .ConfirmationURL }}` exactly):

Subject: `Your cars to look at – choose your password`

```html
<h2>Welcome</h2>
<p>Thank you for visiting us. We picked some cars for you to look at on your own phone.</p>
<p><a href="{{ .ConfirmationURL }}">Choose your password and see your cars</a></p>
<p>Your viewing time starts when you open this link for the first time. If the link has stopped working, please ask our team to send it again.</p>
```

## 4. Where the link goes
Authentication > **URL Configuration**: **Site URL** = the address of the app (once deployed), and the same address followed by `/reset` in **Redirect URLs**. The invitation link opens that page, so **invitations only work from the deployed app**, not from a PC's local test address.

## 5. Test
Invite your own second email address from the Walk-in customers page. It should arrive in a minute, from your domain. Resend > Logs shows each email and whether it was delivered.

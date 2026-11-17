# Account: forgot password and "my account"

Both apps have **Forgot your password?** on the sign-in page, a **My account** page (contact details and change password), and a `/reset` page that the e-mail link opens.
They work as soon as the apps run. Two settings in the Supabase dashboard decide whether the e-mail link works for real users.

## 1. Allow the link address (once, and again when the apps are deployed)
Supabase dashboard > the Japan Auction project > **Authentication > URL Configuration**.
- **Site URL:** the address of the full app once it is deployed (until then `http://localhost:3040`).
- **Redirect URLs:** add one line per app address followed by `/reset`, for example
  `http://localhost:3040/reset`, `http://localhost:3041/reset`, and later `https://your-aim-address/reset` and `https://your-lite-address/reset`.
  A link to an address that is not in this list is refused by Supabase.

## 2. Use your own sender for the e-mails (before real users)
Supabase's built-in e-mail sender is only for testing: it allows about 2-3 e-mails an hour and sends from a shared address.
Authentication > **SMTP Settings** > turn on custom SMTP and use the same Resend account as the alerts (host `smtp.resend.com`, port 465, user `resend`, password = your Resend API key, sender = your own domain address).
Optional: Authentication > **Email Templates** > "Reset Password" to change the wording.

## What a user sees
1. Sign-in page > "Forgot your password?" (they type their e-mail first). The page always says "If that email has an account, we sent a link": it never reveals whether an address is registered.
2. The e-mail link opens `/reset` (one use, then it stops working). They choose a new password (at least 8 characters) and are signed in.
3. **My account** (click your name in the sidebar, or at the top of the lite app): change company, name, phone, WhatsApp and address, and change the password (the current password is asked first). Plan, role and bid limits can only be changed by staff.

## Android app note
The e-mail link opens in the phone's browser, not inside the app. When we build the APK we will add a link that opens the app. Until then a user can finish the reset in the browser and sign in to the app with the new password.

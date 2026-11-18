# Walk-in customers: one-time setup

Staff enter the customer's email on the **Walk-in customers** page and press **Send the invitation**. The customer gets an email, chooses a password, and browses only the cars you chose, for the hours you set (the clock starts at their first visit).

## 1. Database
Run `supabase/migrations/33_customer_role.sql`, then `35_customer_invite.sql`, in the Japan Auction SQL Editor.

## 2. The invitation function (once)
The app cannot create logins by itself (that needs the service key, which must never be in the app), so a small Supabase function does it: `supabase/functions/invite-customer`.

```
supabase login
supabase link --project-ref ettsohrbedakmqadkpga
supabase functions deploy invite-customer
```
The function checks that the caller is active staff before it sends anything.

## 3. Email sending
Invitation emails use the same Supabase email sender as the password reset. Supabase's built-in sender only sends a few emails an hour and only to your own team: set up **custom SMTP** (Authentication > Emails > SMTP Settings) as in `docs/account-setup.md`, or invitations will not reach customers.
Also add your app address to Authentication > URL Configuration > Redirect URLs (the same `/reset` address as the password reset). Optionally edit the "Invite user" email template (Authentication > Emails) to say who you are.

## Using it
- Pick a make, model, year, mileage and features, check the **Preview**, set the hours, **Send the invitation**.
- Not opened yet: **Send the invitation again**. Extend with **+24 h / +48 h**, or **End access now**.
- The customer sees photos, features and specs only: no price, venue, lot number or auction sheet. A heart on a car alerts staff.

## No command line? Deploy from the Supabase dashboard
The Supabase CLI is not installed on this PC. Instead: Supabase dashboard > Edge Functions > **Deploy a new function** > Via Editor, name it `invite-customer`, paste the whole content of `supabase/functions/invite-customer/index.ts`, and Deploy. Leave "Verify JWT" on.

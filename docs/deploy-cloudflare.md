# Deploying the two apps on Cloudflare

Both apps are static websites (`nuxt generate`, no server code), so Cloudflare serves them as plain files: no worker code is needed. Use **Workers & Pages > Create > Pages > Connect to Git** (Workers with static assets also works the same way).

| Site | Repo folder | Build command | Output folder | Suggested address |
|---|---|---|---|---|
| Full AIM (AP holders, staff, walk-in customers) | `apps/aim` | `pnpm install && pnpm --filter ./apps/aim generate` | `apps/aim/.output/public` | `aim.carznexus.com` |
| Lite (Dealer PublicGo, your boss) | `apps/lite` | `pnpm install && pnpm --filter ./apps/lite generate` | `apps/lite/.output/public` | `dealer.publicgo.my` |

Environment variables for each Pages project (Settings > Variables, **Production**; they are baked in at build time):
- `NUXT_PUBLIC_SUPABASE_URL` = the Supabase project URL
- `NUXT_PUBLIC_SUPABASE_KEY` = the anon / publishable key (never the service key)
- `NODE_VERSION` = `24`

The `_redirects` file in each app's `public` folder sends every page address to the app, so a link such as `/reset` or `/for-you/123` opens correctly.

## One codebase, many addresses
The address is not in the code. Every website you deploy is the same repo with its own Pages project, its own two variables above, and its own custom domain (Pages project > Custom domains). To sell the system to someone else: a new Supabase project (run migrations 01 to 36), a new Pages project with that project's two variables, their domain. Nothing in the code changes.

## After the first deploy
1. Open the `*.pages.dev` address that Cloudflare gives and check sign-in works.
2. In Supabase > Authentication > URL Configuration: Site URL = the main app address; Redirect URLs = every deployed address followed by `/reset` (the full app, the lite app, the pages.dev ones while testing).
3. Attach the custom domain, then update the two lists above.
4. Then Resend (docs/resend-smtp-setup.md) and the `invite-customer` function (docs/customer-setup.md).

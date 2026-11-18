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

---
# Step by step (two Cloudflare accounts)

Both sites use the same Supabase project for now (`ettsohrbedakmqadkpga`): set `NUXT_PUBLIC_SUPABASE_URL=https://ettsohrbedakmqadkpga.supabase.co` and `NUXT_PUBLIC_SUPABASE_KEY` = the value in `apps/aim/.env` (the public key). The build command below was run on this PC and takes about 10 seconds.

## A. Your boss's account: Dealer PublicGo at dealer.publicgo.my
1. Easiest: the boss invites you into his Cloudflare account (dash.cloudflare.com > Manage Account > Members > Invite, role **Administrator**), you accept and switch to his account (top-left account switcher). He never has to touch GitHub.
2. **Workers & Pages > Create > Pages > Connect to Git.** Sign in to GitHub as `vivexdigitalsolution-ui`, install the "Cloudflare Workers and Pages" app and give it access to the one repository `aim`.
3. Pick `vivexdigitalsolution-ui/aim`, **Begin setup**:
   - Project name: `dealer-publicgo`
   - Production branch: `main`
   - Framework preset: None
   - Build command: `pnpm install --frozen-lockfile && pnpm --filter ./apps/lite generate`
   - Build output directory: `apps/lite/.output/public`
   - Root directory: leave empty (the repo root)
   - Environment variables: the three above (`NUXT_PUBLIC_SUPABASE_URL`, `NUXT_PUBLIC_SUPABASE_KEY`, `NODE_VERSION` = `24`)
4. **Save and Deploy.** The first build takes 2-4 minutes. Open the `dealer-publicgo.pages.dev` address and sign in.
5. **Custom domains > Set up a custom domain:** `dealer.publicgo.my`.
   - If the `publicgo.my` DNS is in this same Cloudflare account, Cloudflare adds the record by itself.
   - If the DNS is at the registrar or another host, add a **CNAME**: name `dealer`, target `dealer-publicgo.pages.dev`, then press verify.

## B. Your carznexus account: the full AIM at aim.carznexus.com
Same as A, with these differences: project name `aim-app`; build command `pnpm install --frozen-lockfile && pnpm --filter ./apps/aim generate`; output `apps/aim/.output/public`; custom domain `aim.carznexus.com` (if `carznexus.com` is in this account the record is added automatically).
In this account the GitHub step is just step 2 again (the same GitHub login, the same repository).

## If a build fails
- "lockfile" or pnpm version message: add the variable `PNPM_VERSION` = `10` and retry.
- A white page on a deep link: the `_redirects` file is missing from the output; redeploy.

## After both are live
Supabase > Authentication > URL Configuration: Site URL = `https://dealer.publicgo.my`; Redirect URLs: `https://dealer.publicgo.my/reset`, `https://aim.carznexus.com/reset`, and the two `*.pages.dev/reset` addresses while testing.
Every push to `main` on GitHub deploys both sites again by itself.

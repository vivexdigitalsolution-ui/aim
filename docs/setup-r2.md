# Photo storage (Cloudflare R2) — setup

Use a **new Cloudflare account** with a neutral email, not the company's. Nothing below needs a domain name.

## 1. Account
Sign up at cloudflare.com. R2 may ask for a payment card to switch it on; you are only charged if you go past the free allowance
(about 10 GB stored — check Cloudflare's current pricing page).

## 2. Create the bucket
Dashboard → **R2 Object Storage → Create bucket**. Name it `lot-photos` (any neutral name; keep it the same in `worker/wrangler.toml`).
Leave public access **off**: the photos are served through the Worker in step 4.

## 3. Delete old photos automatically
Bucket → **Settings → Object lifecycle rules → Add rule**: delete objects **8 days** after they were created (prefix `l/`). The auction house lists cars about once a week, so a car's photos must outlive the days between its scrape and its auction (3 days was too short).
This is what keeps storage small — a car is only listed for a day or two.

**The rule must have the prefix `l/`.** ASNET pictures are under `a/` and must NOT expire: an ASNET car stays listed for as long as ASNET lists it. The ASNET scraper deletes them itself when the car is removed. A rule without a prefix (or for `a/`) would delete them too. The Worker (step 4) serves both folders: deploy it again after pulling this change.

## 4. Photo address (Worker, no domain)
On a PC with Node:
```
cd services/photo-worker
npx wrangler login
npx wrangler deploy
```
It prints an address like `https://photos.<something>.workers.dev`. That is your **R2_PUBLIC_URL**.
Test later: open `<that address>/l/anything/front.jpg` — "Not found" is correct until a photo with that name exists.

## 5. Keys for the scraper
Dashboard → R2 → **Manage API tokens → Create API token**, permission **Object Read & Write**, only for the `lot-photos` bucket.
Copy the **Access Key ID** and **Secret Access Key** (shown once). Your **Account ID** is on the R2 overview page.

Put them in `scraper/.env` (copy `scraper/.env.example`):
```
R2_ACCOUNT_ID=...
R2_BUCKET=lot-photos
R2_ACCESS_KEY_ID=...
R2_SECRET_KEY=...
R2_PUBLIC_URL=https://photos.<something>.workers.dev
```
Never commit `.env`, and never put these keys in the app.

## Keeping it cheap
- `MAX_PHOTOS=5` in `scraper/.env` keeps the front, rear and the first other shots (plus the auction sheet). Lower it to save space.
- The scraper shrinks every photo (1280 px, about 100 KB; the auction sheet 1600 px) before upload.
- Photos are cached at the edge for 7 days, so repeat views are free.

# Scraper commands

Run all of these on the scraper PC, in `services/scraper`. Ctrl+C once = stop cleanly after the current car; twice = quit now.

## The three scrapes (USS) — each one loops over ALL its enabled targets

| Command | What it does | Saved to |
|---|---|---|
| `node scrape.js bid` | bidding cars of every enabled "Bidding" target | `lots` (+ photos to R2) |
| `node scrape.js one_price` | one-price (fixed price) cars of every enabled "One price" target — Japanese site, own login | `one_price_lots` (+ photos) |
| `node scrape.js history` | sold prices of every enabled "History" target | `lot_history` |

Options after the mode (any order):

```
node scrape.js bid yokohama            one venue (names in lib/venues.js; several: yokohama,tokyo)
node scrape.js bid tuesday             a weekday: only the venues set for that day in the table scrape_venue_days
node scrape.js bid today | tomorrow    the same, for today's / tomorrow's weekday (Japan time)
node scrape.js bid 0day                only targets that never ran      (3days = never ran or last run 3+ days ago)
node scrape.js bid offer               only the Offer report models, every venue
node scrape.js one_price osaka         one price has venues but no weekday
node scrape.js bid --include-today     also keep cars of today's auction
```

## Which venue on which day

Table `scrape_venue_days` (weekday 1 = Monday … 7 = Sunday, venue code) with the venue list in `scrape_venues`.
Edit them in the Supabase table editor — no code change:

* New venue → add a row to `scrape_venues` (its code is the value of the venue checkbox on the USS site), then a row per weekday in `scrape_venue_days`.
* Closed venue → untick `active` in `scrape_venues` (or delete its day rows).
* Moved day → change/add/delete the rows of `scrape_venue_days`.
* A weekday with no row falls back to the old rule (the site's own day list minus `SKIP_VENUES` in `.env`).
* The seed has two examples: Tuesday = Yokohama, Thursday = Tokyo. Change them.

## Daily run (everything in order, with a log)

```
node daily.js                         all steps
node daily.js --dry                   show the plan only
node daily.js --only scrape,oneprice  just these steps
node daily.js --skip history          everything except these
```
Steps: `scrape` → `oneprice` → `photos` → `history` → `enrich` → `features` → `link` → `snapshot` → `alerts` → `housekeeping`.

## ASNET

```
node asnet.js --probe                 list ASNET makes/models we scrape; writes out/asnet-codes.json AND the table asnet_catalog (the pick list on the Scrape targets page)
node asnet.js --probe --all           the same for every ASNET make (slow)
node asnet.js --from-db               DRY RUN of the ASNET targets set on the Scrape targets page
node asnet.js --from-db --write       the real run (cars, photos, `lots`)
node asnet.js --maker 1010 --car 12345 [--write]   one model by hand
```

## Catalog and targets

```
node brand-model-scraper.js en        read the USS makes and models into scraper_brands / scraper_models
node make-targets.js --list-brands    list the makes and their codes
node make-targets.js --brands "TOYOTA,BMW"   bulk-create targets (the Scrape targets page does the same, per model, with filters)
node ../scripts/copy-reference.mjs --codes   copy the model code lists (scraper_model_codes) from CarzNexus
```
The variant (grade) pick list `scraper_grades` fills itself: every bidding scrape saves the variant names it sees.

## After the scrape

```
node enrich.js [--limit 300] [--force] [--dry]   Claude reads the auction sheets, finds the docket, works out the duty
node refresh-photos.js --open                    renew expired photo links of open cars
node extract-features.js --free                  free feature matcher
node link-lots.js --write                        link open cars to the CarzNexus catalog
node market-snapshot.js --write                  Malaysian market prices
node alerts.js --only match,prefs,top5,send      buyer alerts (the 15-minute job is alerts.js --only close,watch,send)
node reprice.js | decide-dockets.js | catalog-gaps.js   maintenance / reports
```

## Narrowing a target (Scrape targets page)

* **Model codes** or **Variants** per model — never both. Bidding and ASNET use either; **One price** uses model codes only (its site is Japanese, so the variant names do not match); **History** always takes every variant.
* Years, scores and the narrowing are shared by the Bidding / One price / History lines of one model: changing them in Edit changes all three.

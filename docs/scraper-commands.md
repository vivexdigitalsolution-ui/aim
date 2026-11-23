# Scraper commands

Run all of these on the scraper PC, in `services/scraper`. Ctrl+C once = stop cleanly after the current car; twice = quit now.

## The three scrapes (USS) — each one loops over ALL its enabled targets

| Command | What it does | Saved to |
|---|---|---|
| `node scrape.js bid` | bidding cars of every enabled "Bidding" target | `lots` (+ photos to R2) |
| `node scrape.js one_price` | one-price (fixed price) cars of every enabled "One price" target — Japanese site, own login | `one_price_lots` (+ photos) |
| `node scrape.js history` | sold prices of every enabled "History" target | `lot_history` |

All three in ONE browser session (one login; bidding and history on the English site, then one price on the Japanese site, which reuses the same login and only logs in again if USS refuses):

```
node scrape.js all saturday            same as: node scrape.js bid,history,one_price saturday
node scrape.js bid,one_price tuesday   any two
```
`node daily.js` runs its USS scrapes this way. The day applies to bidding only; one price and history ignore it.

Options after the mode (any order):

```
node scrape.js bid yokohama            one venue (names in lib/venues.js; several: yokohama,tokyo)
node scrape.js bid tuesday             a weekday: picks it on the USS site (that day's venues get ticked), then unticks the venues listed for it in scrape_day_skips
node scrape.js bid today | tomorrow    the same, for today's / tomorrow's weekday (Japan time)
node scrape.js bid 0day                only targets that never ran      (3days = never ran or last run 3+ days ago)
node scrape.js bid offer               only the Offer report models, every venue
node scrape.js one_price osaka         one price takes a venue but no weekday (its page has no day box)
node scrape.js bid --include-today     also keep cars of today's auction
```

## Which venues on which day

USS has a "day" list on its search page: choosing a weekday ticks that day's venues (Tuesday = Yokohama + R-Nagoya, and so on).
The scraper does the same, then **unticks** the venues you listed for that weekday. Everything is data, no code change:

* `scrape_day_skips` (weekday 1 = Monday … 7 = Sunday, venue code): the venues to untick on that day. Seed: Tuesday -> R-Nagoya (`NR`), because R-score cars are not imported.
* `scrape_venues` (code, name, active): the venue codes. Untick `active` when a venue closes: it is then unticked on every day.
* New USS venue: nothing to do, it appears in the site's own day list. Add a row to `scrape_venues` only if you may want to skip it later.
* If the database cannot be read, `SKIP_VENUES` in `.env` is used.

## Daily run (everything in order, with a log)

```
node daily.js                         all steps
node daily.js --dry                   show the plan only
node daily.js --only scrape,oneprice  just these steps (scrape = bidding, history, oneprice: they share one login)
node daily.js --skip history          everything except these
node daily.js --day tuesday           the bidding scrape picks Tuesday on the USS site and unticks that day's skipped venues; also today / tomorrow
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

## Weekly model check (which models are still worth scraping)
`cd services/scraper` then `node model-watch.js` — run it **once a week**, it walks every brand and model on the USS site for **Bidding, History and One price** (years from YEAR_FROM in .env, 2022+; each type on its own page of the site) and takes a while; leave the browser window alone. Do not run it at the same time as `scrape.js` (same login). Needs migration `49_model_watch.sql` first.

- A model with 2022+ cars that is **not in the scrape list** is added as a target of that type with status **New** and switched **off**. Open Admin › Scrape targets, filter "New", switch the type on for the ones you want (that makes it Live).
- Every model already in the list is **Live** (all current rows). They are never re-added.
- A Live, switched-on model with **0 cars** gets a warning count (`0 cars × N` on the Scrape targets page, filter "Warning"). Cars found again = back to 0. After **more than 8** weekly checks in a row with 0 cars it is switched **off** automatically (tag "Auto-off"); switch it on by hand to start over.
- Each type is checked and counted on its own (a model can be live for Bidding and off for One price). Rows you switched off, and rows still New, are not checked.
- **History only looks at models that have cars on Bidding or One price** (this run, or the last check saved in the list). A model with none there is skipped completely, History is checked last, and a brand with no such model is not opened. This saves most of the History time.
- Options: `--types bid,history,one_price` (default all three), `--brand "TOYOTA,BMW"` (just these), `--dry` (look and report, write nothing), `--force` (recheck models already checked in the last 5 days; normally they are skipped so an interrupted run continues and a model is never counted twice in one week), `--max-zero 8`.
- Safety: if the first 15 models checked of a type all show 0 cars, that type stops and writes nothing (the year filter is probably not working). A model that fails to open is skipped, not counted.
- The report is saved in `services/scraper/out/model-watch-DATE.csv`.

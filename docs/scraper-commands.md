# Scraper commands

Run all of these on the scraper PC, in `services/scraper`. Ctrl+C once = stop cleanly after the current car; twice = quit now.

## Finish the targets that have not run yet

A target (one model of one type) is saved as **done** when its scrape ends. So an interrupted run is simply started again, it carries on:

```
node scrape.js all                     skips every target already finished TODAY, runs the rest (the normal "continue")
node scrape.js all 0day                only targets that NEVER ran (new targets, e.g. after the weekly model check or Make targets)
node scrape.js all 3days               never ran, or last run 3+ days ago (catch-up after a few days off)
node scrape.js bid 0day                the same, bidding only (one_price / history likewise)
```
Order I suggest after a big target change: `node scrape.js all 0day` -> `node enrich.js` -> `node link-lots.js --write` -> `node market-snapshot.js --write`.
The Scrape targets page shows each target's last run and run count, so you can see what is still waiting. Do not run two scrapes (or the weekly check) at once: same USS login.

## Which command is for which feature

| Feature in the app | Command that fills it |
|---|---|
| Bidding cars (Find, Today for you, Margin, Buy list) | `node scrape.js bid` |
| One price cars | `node scrape.js one_price` |
| History / "usually sells" / recommended bid | `node scrape.js history` |
| Docket, duty, selling points, car facts (Docket review) | `node enrich.js` |
| Duty again after a vehicle type / rate change | `node recalc-duty.js` (`--write` to save) |
| Market prices (Margin, Today for you) | `node link-lots.js --write` then `node market-snapshot.js --write` |
| Dashboard graphs (KPI cards) | `node daily.js --only kpi` |
| Offer report (staff) | `node offer.js` |
| Yen rate | `node fx.js` |
| New models / dead models | `node model-watch.js` (weekly) |



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
Steps: `scrape` → `oneprice` → `photos` → `history` → `enrich` → `features` → `link` → `snapshot` → `alerts` → `kpi` → `housekeeping`.

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

## Maintenance and one-off tools

```
node recalc-duty.js                   DRY RUN: duty of open cars again with each model's vehicle type (Saloon / Non-saloon) and the newest rate; prints what would change
node recalc-duty.js --write           save it. Run after migration 54, or after you change a model's vehicle type
node reprice.js                       docket + duty again from what is saved, no AI (after the docket rule or the docket list changed)
node decide-dockets.js                the docket decision (free rule + Claude) on cars already read; sheets are not read again
node clean-features.js                remove car features the auction sheet does not prove (free)
node extract-features.js --free       features for cars that still have none (free)
node compare-docket.js                docket accuracy test, read-only
node fx.js                            today's CIMB yen / AUD / GBP rates -> currency_rates
node offer.js                         build the offer report (scrape the offer models, pick cars, make the batch); offer.js --refill picks again after a car was removed
node restore-batch.js                 merge today's offer batches into one (offer.js does it itself; this is for a manual clean-up)
node mark-lhd.js                      mark left-hand-drive cars so they are never recommended
node deep.js                          the work behind Admin > Deep search (one model a customer asked for)
node catalog-gaps.js                  to-do list of what the CarzNexus catalog still misses, CSV in out/
node probe-catalog.js                 how filled the CarzNexus catalog is (counts only)
node test-ap-access.js                checks what an AP holder can and cannot read (run after SQL / RLS changes)
```
Each tool has its usage in the comment at the top of its file (`node <file> --help` where it takes options).

## Narrowing a target (Scrape targets page)

* **Model codes** or **Variants** per model — never both. Bidding and ASNET use either; **One price** uses model codes only (its site is Japanese, so the variant names do not match); **History** always takes every variant.
* Years, scores and the narrowing are shared by the Bidding / One price / History lines of one model: changing them in Edit changes all three.

## Scrape just one model
`node scrape.js bid --model "GR COROLLA"` scrapes only that model on every venue, even if it already ran today (add `--brand TOYOTA` to be exact). Use `all` instead of `bid` for Bidding, History and One price together, or `one_price` / `history` for one of them. The name is matched inside the model name with spaces and dashes ignored, so `--model COROLLA` takes every Corolla. The model must be switched on in Scrape targets, and the scrape and the weekly check must not run at the same time (same USS login).

## Weekly model check (which models are still worth scraping)
`cd services/scraper` then `node model-watch.js` — run it **once a week**, it walks every brand and model on the USS site for **Bidding, History and One price** (years from YEAR_FROM in .env, 2022+; each type on its own page of the site) and takes a while; leave the browser window alone. Do not run it at the same time as `scrape.js` (same login). Needs migration `49_model_watch.sql` first.

- A model with 2022+ cars that is **not in the scrape list** is added as a target of that type with status **New** and switched **off**. Open Admin › Scrape targets, filter "New", switch the type on for the ones you want (that makes it Live).
- Every model already in the list is **Live** (all current rows). They are never re-added.
- A Live, switched-on model with **0 cars** gets a warning count (`0 cars × N` on the Scrape targets page, filter "Warning"). Cars found again = back to 0. After **more than 8** weekly checks in a row with 0 cars it is switched **off** automatically (tag "Auto-off"); switch it on by hand to start over.
- Each type is checked and counted on its own (a model can be live for Bidding and off for One price). Rows you switched off, and rows still New, are not checked.
- **Default = History only.** The run walks only the History (sold prices) page. A model with 2022+ sold results can be imported to Malaysia, so if it is not in the list yet it is added as **Bidding + One price + History**, all New and off. Bidding and One price pages are not walked, which saves most of the time. A live History model that sold again also gets any missing Bidding / One price row.
- Old behaviour: `--types bid,one_price,history` walks all three pages (0-car warnings and auto-off then work for Bidding / One price too); add `--stocked-only` to make History look only at models that have cars on Bidding or One price.
- Options: `--types bid,history,one_price` (default `history`), `--brand "TOYOTA,BMW"` (just these), `--dry` (look and report, write nothing), `--force` (recheck models already checked in the last 5 days; normally they are skipped so an interrupted run continues and a model is never counted twice in one week), `--max-zero 8`.
- Safety: if the first 15 models checked of a type all show 0 cars, that type stops and writes nothing (the year filter is probably not working). A model that fails to open is skipped, not counted.
- The report is saved in `services/scraper/out/model-watch-DATE.csv`.

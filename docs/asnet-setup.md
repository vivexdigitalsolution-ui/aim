# ASNET as a second source of One price cars

`services/scraper/asnet.js` reads ASNET's **AS-One Price** cars and saves them as One price cars (table `one_price_lots`, marked `source = 'asnet'`, never shown to anyone). The USS scrape keeps running as it is. It was built from the CarzNexus ASNET scraper (login, search form, list rows).

## One-time setup
1. Run `supabase/migrations/63_one_price_source.sql` in the Supabase SQL Editor. **Do this before deploying the web apps that go with it:** their One price lists read the new column.
2. Add two lines to `services/scraper/.env`: `ASNET_USER=` and `ASNET_PASS=`.
3. `cd services/scraper`

## Step 1: find the make and model codes
```
node asnet.js --probe
```
A Chrome window opens, logs in and walks the brand list. Our models are every model switched on for USS plus every model USS has found cars for. For each it records ASNET's own code (in `out/asnet-codes.json` and the list the Scrape targets page offers). It prints the models it did not find.

Names ASNET writes differently are in `services/scraper/lib/asnet/aliases.json`:
- `models`: under which ASNET names one of our models is looked for. Some sit under a broader name (Golf GTI under Golf): a target for it also brings the other versions unless model codes narrow it.
- `makes`: Abarth sits under Fiat, Mercedes Maybach under Maybach.
- `names`: how a saved car is named, so it matches the other source.

## Step 2: targets
On the **Scrape targets** page choose **ASNET**, pick make and model and add. ASNET targets are One price only.

## Step 3: dry run (saves nothing)
```
node asnet.js --from-db --pages 1
node asnet.js --maker 1010 --car <model code> --year-from 2022 --pages 1
```
One line per car: place, lot number, name, chassis code, year, mileage, score, price and sale type. Only AS-One Price is searched (AA-Bid and AA-One Price are unticked, and the search stops if that fails); a row of any other sale type is left out and counted as `wrong_type`.

## Step 4: a small real test
```
node asnet.js --from-db --max-cars 3 --write
```
Saves the first 3 cars of each target. Nothing is removed. Check them in the app: photos, auction sheet, price.

## Step 5: the full run
```
node asnet.js --from-db --write
```
- **Reading comes first:** every result page is read, then the cars are saved.
- **New cars** are saved with photos and the auction sheet. **Saved cars** get the new price, place and "last seen" time; what the sheet reading filled in is left alone.
- **Removing sold cars:** ASNET's list gives no end date. A car stays until a later full run of its target no longer finds it. Removing a car also removes its favourites, recommendation and poster.
- **No car is removed** when the list was not read completely (page limit, a page that did not load, a count that does not match the site's "units found", or the list changing while it was read), when `--max-cars` is used, or in a one-off `--maker` search.
- **Safety stop:** if more than 5 cars and more than half of a model's saved cars are missing at once, they are kept and reported (`removal_blocked`). If they are really sold, run again with `--remove-many`.
- **Cars of a target that is switched off or deleted are not checked any more, so they stay.**
- **Missing photos** (removed from storage) are fetched again when the run meets the car.
- **Photos have no expiry.** They are under `a/` in R2 (the 8-day rule is for `l/` only, see `setup-r2.md`). When a complete read no longer finds a car, its record is removed and then its photos and sheet. A deletion that fails is retried at the next `--write` run (`out/asnet-r2-leftovers.json`). Before saving anything, a `--write` run checks that the photo Worker serves `a/`; if not, deploy it: `cd services/photo-worker` then `npx wrangler deploy`.
- A car that sells while the pages are being read can, rarely, make a neighbouring car be missed. If the site's count then looks unchanged, that car is removed and comes back as new in the next run (without its favourites and poster).

## Sheet reading and import price
`enrich.js` (part of the daily job) also reads ASNET sheets: One price cars with no end date count as open. USS cars with an end date are read first. Each new car costs a Claude call.

## Not done yet
- ASNET is not part of the daily job. After steps 4 and 5 are checked, add to `daily.js` STEPS before `enrich`: `{ name: 'asnet', script: ['asnet.js', '--from-db', '--write'], timeout: 4 * H }`.
- No sold-price history is read from ASNET, and the 10-hour rule does not apply (there is no end time).
- A USS car and an ASNET car that are the same physical car are not matched.

## Rules
- The agreement with ASNET (and with the sellers behind it) must allow showing its photos and data to your dealers and customers. That check is yours, not the code's.

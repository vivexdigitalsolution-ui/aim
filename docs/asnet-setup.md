# ASNET as a second source of cars

The USS scrape keeps running as it is. `services/scraper/asnet.js` reads the ASNET list the same way the CarzNexus ASNET scraper does (login, search form, list rows) and saves the cars into the same `lots` table, so dealers and customers see one list. A car that came from ASNET is marked `source = 'asnet'` (never shown to anyone).

**What is proven and what is not.** The login, the search form and the list reading are the CarzNexus code that already works. The mapping from an ASNET row to a car is tested offline. What no one has seen yet is a real ASNET row going through AIM, so the first runs are DRY RUNS that save nothing.

## One-time setup (scraper PC)
1. Run `supabase/migrations/34_lots_source.sql` in the Japan Auction SQL Editor.
2. Add two lines to `services/scraper/.env`: `ASNET_USER=` and `ASNET_PASS=` (your ASNET login, the same one the CarzNexus scraper uses).
3. `cd services/scraper`

## Step 1: find the codes (about 5-10 minutes)
```
node asnet.js --probe
```
A Chrome window opens, logs in and walks the brand list. For every brand and model we already scrape from USS it records ASNET's own code in `out/asnet-codes.json`. The screen prints how many of our models ASNET has under each brand. Models whose name is spelled differently on ASNET are not matched: tell me which, and I add them by hand.

## Step 2: one DRY RUN
```
node asnet.js --maker 1010 --car <a model code from asnet-codes.json> --pages 1
```
It prints one line per car: venue, date, lot number, name, chassis code, year, mileage, grade, price and the **auction method**. Nothing is saved. Please send me (or paste) that output. I check three things in it:
- **the price**: is ASNET's "publish price" the auction start price? (it goes into the start price of the car)
- **the deadline**: the page may give only a date; then the deadline is the end of that day in Japan, which is too late for a real bid cut-off.
- **the auction method**: whether fixed-price AS-One cars are mixed in with the real auction cars, and which ones we want.

## Step 3: save for real (after those checks)
```
node asnet.js --maker 1010 --car <code> --pages 1 --write
node asnet.js --from-codes --write
```
Photos go to the same R2 bucket (shrunk like the USS photos). A car that matches one we already have from USS (same day, make, year, mileage and chassis code) is skipped, so nothing shows twice.

## When it is trusted
Add it to the daily job (`daily.js` STEPS, after `scrape`): `{ name: 'asnet', script: ['asnet.js', '--from-codes', '--write'], timeout: 4 * H }`. I will do this once step 2 and 3 are checked.

## Rules
- The agreement with ASNET (and with the auction houses behind it) must allow showing its photos and data to your dealers and customers. That check is yours, not the code's.
- ASNET sold-price history is not read yet: only the cars about to be auctioned.

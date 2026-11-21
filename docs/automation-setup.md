# Daily automation: setup on the scraper PC

One job refreshes everything every day, in order: open cars from USS, sold prices, sheet reading (Claude), features, catalog links, Malaysian market prices, housekeeping.
Staff see the result in the app under **System status**. This is done once, on the PC that does the scraping.

## What the PC needs
- Windows, switched on at the scheduled time. **Turn off sleep** (Settings > System > Power > Screen and sleep: "When plugged in, put the PC to sleep" = Never).
- **Someone signed in to Windows.** The scraper opens a visible Chrome window with the saved USS login, so the task must run "only when the user is logged on". A locked screen is fine; a signed-out PC is not.
- Node.js installed, and this repo cloned (`C:\Users\Alex\Projects\aim`) with `pnpm install` done.
- `services/scraper/.env` filled in: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `CARZNEXUS_DB_URL`, the R2 keys, `USS_USER`, `USS_PASS` (copy it from the PC you use today).

## Step 1. Database (once, in the Japan Auction SQL Editor)
Run `supabase/migrations/24_job_runs.sql`. It creates the log table the status page reads.

## Step 2. Log in to USS once, by hand
Open a terminal in `services/scraper` and run:

```
node scrape.js bid yokohama 0day
```

Chrome opens. If it asks for the USS login, sign in. When the first page of cars is read, press Ctrl+C once (it finishes the current car and stops). The login is now saved in `services/scraper/.chrome-profile` and the job reuses it. Redo this step if the USS password changes or the login expires.

## Step 3. Try the job by hand
```
node daily.js --dry                      (shows the plan, runs nothing)
node daily.js --only link,snapshot       (a quick real run of two steps)
```
Then open the app > **System status**: the run is listed.

## Step 4. Schedule it (once)
Open **PowerShell** (normal, not as administrator) and paste one line. It runs every day at 07:00 Malaysia time; change `07:00` if the PC is not on Malaysian time.

```
schtasks /Create /TN "AIM daily refresh" /TR "\"C:\Users\Alex\Projects\aim\services\scraper\run-daily.bat\"" /SC DAILY /ST 07:00 /F
```

Check it: `schtasks /Query /TN "AIM daily refresh"`. Run it now to test: `schtasks /Run /TN "AIM daily refresh"`.
Remove it: `schtasks /Delete /TN "AIM daily refresh" /F`.

(If you prefer clicking: Task Scheduler > Create Basic Task > Daily > Start a program > the `run-daily.bat` file > tick "Run only when user is logged on".)

## Using it
- **Run it now from the PC:** double-click `services/scraper/run-daily.bat`.
- **Run only some steps:** `node daily.js --only link,snapshot` or `node daily.js --skip history`.
- **Steps:** scrape, history, enrich, features, link, snapshot, housekeeping.
- **A failed step does not stop the others** (enrich is skipped when the scrape failed). The status page shows each step, how long it took and the last lines of its output.
- **Logs:** `services/scraper/logs/daily-YYYY-MM-DD.log` on the PC.
- **Two runs never overlap.** If a run is still going, a second one stops at once.

## When the status page shows red or amber
| You see | Most likely cause | What to do |
|---|---|---|
| No run for over 26 hours | PC off, asleep, or signed out | Wake the PC, sign in, run `run-daily.bat` |
| scrape failed | USS login expired | Do Step 2 again |
| enrich failed | ANTHROPIC_API_KEY empty or out of credit | Check the key and the Anthropic balance |
| link or snapshot failed | CarzNexus read-only login changed | Check `CARZNEXUS_DB_URL` |
| snapshot ok but "0 linked" | CarzNexus has not linked its listings yet | Nothing to fix here: prices appear when it does |

## Cost
The only step that costs money is **enrich** (Claude reads the sheet of each new car, at most 300 a day). Everything else is free.

## Daily exchange rates (CIMB)
The calculators and car pages use the newest yen rate saved in `currency_rates`. `fx.js` fills it every morning with the CIMB **Selling TT/OD** rate for the Australian dollar, British pound and Japanese yen (yen is read from the "per 100 units" table and divided by 100, so every rate is ringgit per one unit).

1. Run `supabase/migrations/48_live_exchange_rate.sql` in the Supabase SQL editor (once). Until then the old fixed rate (0.0270) is still used.
2. Test: `cd services/scraper` then `node fx.js --dry` (shows the rates and the page's "Last Updated" line, writes nothing), then `node fx.js` to save.
3. Schedule (PowerShell, once): 9:30 am, repeated every 30 minutes for 3 hours, so a slow CIMB update or a sleeping PC at 9:30 is still caught:
```
schtasks /Create /TN "AIM exchange rates" /TR "\"C:\Users\Alex\Projects\aim\services\scraper\run-fx.bat\"" /SC DAILY /ST 09:30 /RI 30 /DU 03:00 /F
```

How it checks the rate is current: the CIMB page prints `Last Updated: 5:08 pm, 20 Nov 2026, Friday`. The rate is saved under that date. If the date is today (Malaysia time) the run ends "up to date"; if it is an older day (CIMB not updated yet, weekend, public holiday) it keeps the newest rate the page shows and logs that it will check again. A rate that moved more than 20% since the last one is refused, in case the page layout changed. Look at `services/scraper/logs/fx.log`.

CIMB blocks headless browsers (why the old scraper stopped), but a plain web request works, so `fx.js` makes one request, no browser. If that is ever blocked too, it falls back to the installed Microsoft Edge.

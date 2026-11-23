-- 49: the weekly model check (services/scraper/model-watch.js). It looks at the USS site (bidding, history, one price) brand by brand, model by model, with the
-- year filter (YEAR_FROM in .env, 2022 and later), and keeps the scrape list to models we can still import:
--   * a model with such cars that is NOT in the list yet is added with status 'new' and OFF (enabled = false), for you to switch on
--   * every model already in the list is 'live' (all your current rows)
--   * a live, switched-on model with 0 cars: zero_count goes up by one each weekly check (the warning count); a car found resets it to 0;
--     after more than 8 checks in a row with 0 cars it is switched off (disabled_reason says why)
-- Bidding, History and One price are each checked on their own page of the site and counted separately (one row per type). Safe to run again.
alter table public.scrape_targets add column if not exists status          text not null default 'live' check (status in ('live', 'new'));
alter table public.scrape_targets add column if not exists zero_count      int  not null default 0;     -- weekly checks in a row that found 0 cars
alter table public.scrape_targets add column if not exists last_hits       int;                          -- cars the last weekly check found (year filter on)
alter table public.scrape_targets add column if not exists checked_at      timestamptz;                  -- when the weekly check last looked at this model
alter table public.scrape_targets add column if not exists disabled_reason text;                         -- set when the weekly check switched the model off

-- =============================================================================
-- Auction — 08 scraped models
-- History prices are scraped ONLY for models we have seen a car for in the bid scrape (not every model of every brand).
-- scraper/scrape.js bid adds a row here the first time it finds a car of a model, and switches that model's history target on.
-- Only the scraper (service_role key) uses this table: RLS on, no policies. Run after 01–07.
-- =============================================================================

create table if not exists public.scraped_models (
  maker_code     text not null,
  car_code       text not null,
  brand_name     text not null,
  model_name     text not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  primary key (maker_code, car_code)
);
alter table public.scraped_models enable row level security;

-- One-time seed: every model whose bid scrape ever found a car.
insert into public.scraped_models (maker_code, car_code, brand_name, model_name, first_seen_at, last_seen_at)
select t.maker_code, t.car_code, t.brand_name, t.model_name, min(r.started_at), max(r.started_at)
from public.scrape_runs r
join public.scrape_targets t on t.id = r.target_id
where t.lot_type = 'bid' and r.records_scraped > 0
group by t.maker_code, t.car_code, t.brand_name, t.model_name
on conflict (maker_code, car_code) do nothing;

-- History targets: only the scraped models are switched on (the rest stay in the table, switched off).
update public.scrape_targets t set enabled = false where t.lot_type = 'history';
update public.scrape_targets t set enabled = true
from public.scraped_models m
where t.lot_type = 'history' and t.maker_code = m.maker_code and t.car_code = m.car_code;

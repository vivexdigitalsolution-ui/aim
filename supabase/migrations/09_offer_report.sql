-- =============================================================================
-- Auction — 09 offer report
-- Staff list up to 10 models (the limit is in the app: admin/report.vue MAX_MODELS); `node offer.js` (scraper PC) scrapes them fully (all venues, bid + history), has Claude read the
-- auction sheets, and stores the chosen cars in offer_picks (2 nearly-perfect + 3 mid-tier per model). Run after 01–08.
-- =============================================================================

-- The models the offer report is about (brand + model as named by the source site)
create table if not exists public.offer_models (
  id          uuid primary key default gen_random_uuid(),
  maker_code  text not null,
  car_code    text not null,
  brand_name  text not null,
  model_name  text not null,
  sort        int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (maker_code, car_code)
);

-- The cars chosen for the report. tier: 'top' = nearly perfect, 'mid' = grade 4–5 with something worth selling
create table if not exists public.offer_picks (
  lot_id     uuid primary key references public.lots(id) on delete cascade,
  maker_code text not null,
  car_code   text not null,
  tier       text not null check (tier in ('top', 'mid')),
  picked_at  timestamptz not null default now()
);
create index if not exists offer_picks_model_idx on public.offer_picks(maker_code, car_code);

-- Which scrape target a lot came from (so a lot is matched to its model exactly, not by name)
alter table public.lots add column if not exists maker_code text;
alter table public.lots add column if not exists car_code text;
create index if not exists lots_model_idx on public.lots(maker_code, car_code);

-- What Claude saw on the sheet when it chose the cars
alter table public.lots add column if not exists pick_score smallint;      -- 0–10: how much there is to sell (modified, high spec, low mileage for the year ...)
alter table public.lots add column if not exists pick_reason text;
alter table public.lots add column if not exists accident boolean;         -- repair history / accident shown on the sheet

alter table public.offer_models enable row level security;
alter table public.offer_picks  enable row level security;
alter table public.scrape_targets enable row level security;

drop policy if exists offermodels_staff on public.offer_models;
drop policy if exists offerpicks_staff  on public.offer_picks;
drop policy if exists targets_staff     on public.scrape_targets;
create policy offermodels_staff on public.offer_models for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy offerpicks_staff  on public.offer_picks  for select to authenticated using (public.is_staff());
-- staff can look up the model names to choose from (read only)
create policy targets_staff     on public.scrape_targets for select to authenticated using (public.is_staff());

grant select, insert, update, delete on public.offer_models to authenticated;
grant select on public.offer_picks, public.scrape_targets to authenticated;

-- The sea freight default for the report: ¥300,000 (staff change it in the report page; same key as Calculator › Default settings)
insert into public.calc_presets (preset_key, amount) values ('freight_foreign', 300000) on conflict (preset_key) do nothing;

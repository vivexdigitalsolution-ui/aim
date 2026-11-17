-- =============================================================================
-- Auction — 15 target unit deep search
-- A customer asks for one or more models of a brand (say a Jeep Wrangler and Wrangler Unlimited). Staff pick the brand, the models and, per model,
-- the model codes (none = every code) in Admin › Deep search; `node deep.js` on the scraper PC scrapes those models from every venue,
-- and has Claude read the auction sheet of the units staff tick.
-- Staff then choose up to 6 units, a Customs docket and a margin % for each, and print two copies of the offer report:
-- an internal one (shows the margin) and a customer one (the margin is inside the price). Run after 14.
-- =============================================================================

-- One row per customer request
create table if not exists public.deep_searches (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  title        text not null default '',                 -- who it is for / what was asked, e.g. "Mr Lim - Wrangler Rubicon"
  brand_name   text not null,
  -- the models asked for: [{ "maker_code": "32", "car_code": "1070", "model_name": "JEEP WRANGLER UNLIMITED", "codes": ["JL36L", "JL20L"] }]
  -- "codes" empty = every code of that model (scrape and list all)
  models       jsonb not null default '[]'::jsonb,
  year_from    int,                                      -- null = the scraper's YEAR_FROM (.env)
  score_min    numeric,                                  -- null = the scraper's SCORE_MIN (.env)
  with_history boolean not null default true,            -- also scrape the sold history (the body price comes from it)
  status       text not null default 'pending' check (status in ('pending', 'scraping', 'done', 'error')),
  status_note  text,
  status_at    timestamptz not null default now(),      -- when the status last changed (a job stuck for hours is put back in the queue)
  scraped_at   timestamptz,
  margin_pct   numeric not null default 3,               -- default margin for the units of this request
  margin_mode  text not null default 'import_price' check (margin_mode in ('cif', 'import_price'))
);
create index if not exists deep_searches_created_idx on public.deep_searches(created_at desc);

-- An earlier version of this file kept ONE model per request (maker_code, car_code, model_name, model_code): move those rows to `models`
alter table public.deep_searches add column if not exists models jsonb not null default '[]'::jsonb;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deep_searches' and column_name = 'maker_code') then
    update public.deep_searches set models = jsonb_build_array(jsonb_build_object(
      'maker_code', maker_code, 'car_code', car_code, 'model_name', model_name,
      'codes', case when model_code is null then '[]'::jsonb else jsonb_build_array(model_code) end));
    alter table public.deep_searches drop column maker_code, drop column car_code, drop column model_name, drop column model_code;
  end if;
end $$;

-- What staff did with a unit (a lot) of that request. The lot itself stays in `lots`; no foreign key because finished lots are deleted by housekeeping.
create table if not exists public.deep_search_units (
  id            uuid primary key default gen_random_uuid(),
  search_id     uuid not null references public.deep_searches(id) on delete cascade,
  lot_id        uuid not null,
  created_at    timestamptz not null default now(),
  enrich_status text check (enrich_status in ('requested', 'working', 'done', 'error')),      -- the AI reading of the auction sheet
  enrich_note   text,
  status_at     timestamptz not null default now(),
  picked        boolean not null default false,          -- in the customer's option (at most 6, enforced in the page)
  docket_id     uuid,                                    -- the Customs docket staff chose (null = the automatic one)
  body_jpy      numeric,                                 -- body price override in yen (null = the history price)
  margin_pct    numeric,                                 -- margin override (null = the request's margin)
  unique (search_id, lot_id)
);
create index if not exists deep_units_search_idx on public.deep_search_units(search_id);
create index if not exists deep_units_enrich_idx on public.deep_search_units(enrich_status) where enrich_status in ('requested', 'working');

alter table public.deep_searches      enable row level security;
alter table public.deep_search_units  enable row level security;
drop policy if exists deepsearches_staff on public.deep_searches;
drop policy if exists deepunits_staff    on public.deep_search_units;
create policy deepsearches_staff on public.deep_searches     for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy deepunits_staff    on public.deep_search_units for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.deep_searches, public.deep_search_units to authenticated;

-- =============================================================================
-- Auction — 07 market prices + enrich bookkeeping
-- =============================================================================

-- Malaysian market price (RM), keyed in by staff when they find one. Every entry is kept (price history); the report uses
-- the latest entry for the same model and shows the date it was recorded. Staff only.
create table if not exists public.market_prices (
  id          uuid primary key default gen_random_uuid(),
  brand       text not null,                 -- upper case
  model_key   text not null,                 -- chassis code without its emission prefix (AGH40W), or the model name when there is no code
  mfg_year    int,                           -- null = any year
  price_myr   numeric(12,0) not null check (price_myr > 0),
  recorded_on date not null default current_date,
  note        text,
  recorded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists market_prices_lookup_idx on public.market_prices(brand, model_key, recorded_on desc);
alter table public.market_prices enable row level security;
create policy marketprices_staff on public.market_prices for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.market_prices to authenticated;

-- The latest price for each brand + model (+ year), for the report
create or replace view public.market_prices_latest with (security_invoker = true) as
  select distinct on (brand, model_key, coalesce(mfg_year, 0)) brand, model_key, mfg_year, price_myr, recorded_on, note
  from public.market_prices
  order by brand, model_key, coalesce(mfg_year, 0), recorded_on desc, created_at desc;
grant select on public.market_prices_latest to authenticated;

-- Why a lot could not be filled (shown to staff; cleared on the next successful run)
alter table public.lots add column if not exists enrich_note text;

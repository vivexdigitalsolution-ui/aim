-- 25: catalog names inside AIM (for pickers) + hand-entered market prices.   Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. A copy of the CarzNexus catalog NAMES (brand > model > variant), refreshed by link-lots.js. Names only, no prices. Lets staff pick a car by name.
create table if not exists public.catalog_index (
  level      text not null check (level in ('variant', 'model')),
  ref_id     uuid not null,                  -- the CarzNexus variant_id (level variant) or model_id (level model)
  brand_id   uuid,
  model_id   uuid,
  brand      text not null,
  model      text not null,
  variant    text,                           -- null at model level
  model_code text,
  engine_cc  int,
  updated_at timestamptz not null default now(),
  primary key (level, ref_id)
);
create index if not exists idx_catalog_index_names on public.catalog_index (brand, model);
alter table public.catalog_index enable row level security;
drop policy if exists catalog_index_read on public.catalog_index;
create policy catalog_index_read on public.catalog_index for select using (public.tier_at_least('member'));
drop policy if exists catalog_index_staff on public.catalog_index;
create policy catalog_index_staff on public.catalog_index for all using (public.is_staff()) with check (public.is_staff());
revoke all on public.catalog_index from anon;
grant select, insert, update, delete on public.catalog_index to authenticated;

-- 2. Hand-entered market prices live in market_stats with source = 'manual' (the snapshot only ever replaces its own 'carznexus' rows).
--    A manual row overrides the CarzNexus row for the same car and year; delete it to fall back.
alter table public.market_stats add column if not exists note       text;
alter table public.market_stats add column if not exists entered_by uuid references public.profiles(id) on delete set null;

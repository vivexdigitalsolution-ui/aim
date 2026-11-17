-- 20: compare by CarzNexus catalog ids (brand_id / model_id / variant_id), not by names.
-- Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. Each auction lot's link into the CarzNexus catalog (made by services/scraper/link-lots.js; no link = no market price yet)
create table if not exists public.lot_catalog (
  lot_id     uuid primary key references public.lots(id) on delete cascade,
  brand_id   uuid,
  model_id   uuid,
  variant_id uuid,
  level      text not null check (level in ('variant', 'model', 'none')),
  how        text,
  linked_at  timestamptz not null default now()
);
create index if not exists idx_lot_catalog_variant on public.lot_catalog(variant_id) where variant_id is not null;
create index if not exists idx_lot_catalog_model   on public.lot_catalog(model_id)   where model_id   is not null;
alter table public.lot_catalog enable row level security;
drop policy if exists lot_catalog_read  on public.lot_catalog;
create policy lot_catalog_read  on public.lot_catalog for select using (public.is_staff() or public.is_active_ap());
drop policy if exists lot_catalog_staff on public.lot_catalog;
create policy lot_catalog_staff on public.lot_catalog for all using (public.is_staff()) with check (public.is_staff());
revoke all on public.lot_catalog from anon;
grant select, insert, update, delete on public.lot_catalog to authenticated;

-- 2. market_stats: one row per catalog variant (or model) and year window. The old name-based rows are dropped (the snapshot rebuilds them).
delete from public.market_stats;
alter table public.market_stats drop constraint if exists market_stats_pkey;
alter table public.market_stats drop constraint if exists market_stats_n_check;   -- every listing counts, even a single one; the app labels the confidence
alter table public.market_stats add column if not exists level        text not null default 'model' check (level in ('variant', 'model'));
alter table public.market_stats add column if not exists ref_id       uuid;
alter table public.market_stats add column if not exists brand_id     uuid;
alter table public.market_stats add column if not exists model_id     uuid;
alter table public.market_stats add column if not exists variant_id   uuid;
alter table public.market_stats add column if not exists variant_name text;
alter table public.market_stats alter column ref_id set not null;
alter table public.market_stats add primary key (level, ref_id, year_from, year_to, as_of, source);

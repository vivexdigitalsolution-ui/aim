-- 18: AIM v2 on the SAME database as the current app (additive only: nothing existing is changed or dropped, the old app keeps working).
-- Adds: remembered docket confirmations, per-car docket decisions (rule + AI compared), searchable car features,
-- Malaysian market statistics (aggregated, no dealer identities), and an access tier on profiles (free / member / partner).
-- Not applied yet. Safe to run again.

-- 1. Access tier for the full AIM app (the lite app needs no tier). Existing AP holders start as 'member' so nothing they use disappears.
alter table public.profiles add column if not exists tier text not null default 'member' check (tier in ('free', 'member', 'partner'));

-- 2. Remembered confirmations: a person confirmed this exact car's docket once; the same car later gets it with no AI cost.
--    key = packages/core confirmKey(): brand | code without prefix | engine cc | model name | seats | AT/MT
create table if not exists public.docket_confirmations (
  key           text primary key,
  docket_id     uuid not null references public.custom_dockets(id),
  confirmed_by  uuid references auth.users(id),
  confirmed_at  timestamptz not null default now(),
  example_lot   uuid references public.lots(id) on delete set null,
  note          text
);

-- 3. One row per car: what the rule and the AI said, and what was decided (core decideDocket()).
--    Only status confirmed / trusted carries a docket into duty, the offer report and the daily count.
create table if not exists public.lot_docket_decisions (
  lot_id          uuid primary key references public.lots(id) on delete cascade,
  status          text not null check (status in ('confirmed', 'trusted', 'review', 'none')),
  docket_id       uuid references public.custom_dockets(id),   -- the docket USED (null for review / none)
  rule_docket_id  uuid references public.custom_dockets(id),
  ai_docket_id    uuid references public.custom_dockets(id),
  ai_confidence   text check (ai_confidence in ('high', 'medium', 'low')),
  ai_words        text,
  ai_reason       text,
  reason          text,
  decided_at      timestamptz not null default now()
);
create index if not exists idx_docket_decisions_review on public.lot_docket_decisions (status) where status = 'review';

-- 4. Searchable features (core features.ts): one row per car per feature.
create table if not exists public.lot_features (
  lot_id    uuid not null references public.lots(id) on delete cascade,
  key       text not null,         -- catalog key (jbl, gr_kit, sunroof ...) or x:<slug> for a feature the catalog does not know
  label     text not null,
  grp       text not null default 'Other',
  source    text not null default 'unknown' check (source in ('factory', 'dealer_option', 'aftermarket', 'unknown')),
  evidence  text,
  primary key (lot_id, key)
);
create index if not exists idx_lot_features_key on public.lot_features (key, lot_id);   -- "jbl AND gr_kit" = intersect on lot_id

-- 5. Free-text search over the English notes, selling points and equipment.
alter table public.lots add column if not exists search tsvector
  generated always as (to_tsvector('simple', coalesce(inspector_report_en, '') || ' ' || coalesce(sales_points, '') || ' ' || coalesce(equipment, ''))) stored;
create index if not exists idx_lots_search on public.lots using gin (search);

-- 6. Malaysian market statistics from the CarzNexus snapshot: aggregated per model key and year band, ASKING prices.
--    No dealer names or codes ever reach this table. Fewer than 3 listings are not stored as a range (core confidence()).
create table if not exists public.market_stats (
  brand       text not null,
  model_key   text not null,       -- core marketKey()
  year_from   int  not null,
  year_to     int  not null,
  n           int  not null check (n >= 3),
  min_myr     numeric, p25_myr numeric, median_myr numeric, p75_myr numeric, max_myr numeric,
  avg_km      int,
  as_of       date not null,
  source      text not null default 'carznexus',
  primary key (brand, model_key, year_from, year_to, as_of)
);

-- ── Security: staff do everything; an active AP holder reads features and market stats only ──
alter table public.docket_confirmations enable row level security;
alter table public.lot_docket_decisions enable row level security;
alter table public.lot_features         enable row level security;
alter table public.market_stats          enable row level security;

drop policy if exists docket_confirmations_staff on public.docket_confirmations;
create policy docket_confirmations_staff on public.docket_confirmations for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists lot_docket_decisions_staff on public.lot_docket_decisions;
create policy lot_docket_decisions_staff on public.lot_docket_decisions for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists lot_features_read on public.lot_features;
create policy lot_features_read on public.lot_features for select using (public.is_staff() or public.is_active_ap());
drop policy if exists lot_features_staff on public.lot_features;
create policy lot_features_staff on public.lot_features for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists market_stats_read on public.market_stats;
create policy market_stats_read on public.market_stats for select using (public.is_staff() or public.is_active_ap());
drop policy if exists market_stats_staff on public.market_stats;
create policy market_stats_staff on public.market_stats for all using (public.is_staff()) with check (public.is_staff());

revoke all on public.docket_confirmations, public.lot_docket_decisions, public.lot_features, public.market_stats from anon;
grant select, insert, update, delete on public.docket_confirmations, public.lot_docket_decisions, public.lot_features, public.market_stats to authenticated;

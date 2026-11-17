-- 28: the individual comparable listings behind the market prices (for the Market comparables explorer).
-- One row per linked CarzNexus listing: price, year, mileage, days on market. NO dealer id, name or listing id is stored.
-- Written by market-snapshot.js; members and staff read. Run in the Japan Auction project > SQL Editor. Safe to run again.
create table if not exists public.market_comps (
  id          bigint generated always as identity primary key,
  brand_id    uuid,
  model_id    uuid,
  variant_id  uuid,
  year        int not null,
  price_myr   numeric(12,0) not null,
  km          int,
  days_listed int,
  as_of       date not null,
  source      text not null default 'carznexus'
);
create index if not exists idx_market_comps_variant on public.market_comps (variant_id, as_of);
create index if not exists idx_market_comps_model   on public.market_comps (model_id, as_of);
alter table public.market_comps enable row level security;
drop policy if exists market_comps_read on public.market_comps;
create policy market_comps_read on public.market_comps for select using (public.tier_at_least('member'));
drop policy if exists market_comps_staff on public.market_comps;
create policy market_comps_staff on public.market_comps for all using (public.is_staff()) with check (public.is_staff());
revoke all on public.market_comps from anon;
grant select, insert, update, delete on public.market_comps to authenticated;

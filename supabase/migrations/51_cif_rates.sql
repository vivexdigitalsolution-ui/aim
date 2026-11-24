-- 51: the CIF rate table (lite app, page "CIF rates"): what we charge an AP holder to bring in a BIDDING car, by the price of the car.
-- Staff edit the rows and the rules; active AP holders only view and print it; customers never see it. Safe to run again.
--   cif_rates     one row per price band: from_jpy (included) up to to_jpy (not included; empty = "and above").
--                 mode 'fixed' = value is an amount in yen; mode 'percent' = value is a % of the car price.
--                 active = false hides the row (a band we do not offer). The % rule above ¥14,000,000 is seeded but OFF: switch it on to offer cars above that price.
--   cif_settings  one row: the line under the title and the notes printed under the table.
create table if not exists public.cif_rates (
  id        uuid primary key default gen_random_uuid(),
  from_jpy  bigint not null check (from_jpy >= 0),
  to_jpy    bigint check (to_jpy is null or to_jpy > from_jpy),
  mode      text not null default 'fixed' check (mode in ('fixed', 'percent')),
  value     numeric not null check (value > 0),
  active    boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.cif_settings (
  id        boolean primary key default true check (id),
  subtitle  text not null default 'Port Klang North & West',
  notes     text not null default E'CIF includes ocean freight, insurance and handling charges in Japan.\nCIF is based on the vehicle price (car cost).',
  updated_at timestamptz not null default now()
);
alter table public.cif_rates enable row level security;
alter table public.cif_settings enable row level security;
drop policy if exists cif_rates_read on public.cif_rates;     create policy cif_rates_read on public.cif_rates for select to authenticated using (public.is_staff() or public.is_active_ap());
drop policy if exists cif_rates_write on public.cif_rates;    create policy cif_rates_write on public.cif_rates for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists cif_settings_read on public.cif_settings;  create policy cif_settings_read on public.cif_settings for select to authenticated using (public.is_staff() or public.is_active_ap());
drop policy if exists cif_settings_write on public.cif_settings; create policy cif_settings_write on public.cif_settings for all to authenticated using (public.is_staff()) with check (public.is_staff());

insert into public.cif_settings(id) values (true) on conflict (id) do nothing;
insert into public.cif_rates(from_jpy, to_jpy, mode, value, active)
select * from (values
  (0::bigint,        5000000::bigint,  'fixed',   250000::numeric, true),
  (5000000,          8000000,          'fixed',   300000,          true),
  (8000000,          11000000,         'fixed',   350000,          true),
  (11000000,         14000000,         'fixed',   400000,          true),
  (14000000,         null,             'percent', 5,               false)
) v(a, b, c, d, e)
where not exists (select 1 from public.cif_rates);

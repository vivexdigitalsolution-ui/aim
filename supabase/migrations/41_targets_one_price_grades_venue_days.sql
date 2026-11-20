-- 41: scrape targets get a third type (One price), a variant (grade) filter, a grade catalog, and a table that says which USS venue is scraped on which day.
-- Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. One price is a third scrape type next to bid (bidding cars) and history (sold prices)
alter table public.scrape_targets drop constraint if exists scrape_targets_lot_type_check;
alter table public.scrape_targets add constraint scrape_targets_lot_type_check check (lot_type in ('bid', 'history', 'one_price'));
alter table public.scrape_targets add column if not exists grades text[];       -- variant (grade) names to keep, e.g. {"Z PREMIUM","G"}; empty = every variant. A target uses model_codes OR grades, not both.

-- 2. The cars found by the One price scrape. Kept apart from `lots` (bidding) because a one-price car has a fixed price, not a bid.
create table if not exists public.one_price_lots (
  id            uuid primary key default gen_random_uuid(),
  ex_key        text not null unique,            -- the source's own key of the car
  venue         text,
  deadline      timestamptz,                     -- the day the offer ends
  brand         text not null,
  model         text not null,
  maker_code    text,
  car_code      text,
  grade         text,                            -- variant name as the site shows it (Japanese)
  model_code    text,
  mfg_year      int,
  mileage_km    int,
  engine_cc     int,
  transmission  text,
  color         text,
  auction_grade text,
  price_jpy     int,                             -- null while the site still hides the price
  price_masked  boolean not null default false,
  price_reveal  timestamptz,
  equipment     text,
  photos        text[] not null default '{}',
  sheet_url     text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists one_price_lots_model_idx on public.one_price_lots (maker_code, car_code);
alter table public.one_price_lots enable row level security;
drop policy if exists one_price_staff on public.one_price_lots;
create policy one_price_staff on public.one_price_lots for select to authenticated using (public.is_staff());
grant select on public.one_price_lots to authenticated;

-- 3. The variant (grade) names the scraper has seen per make + model: the pick list on the Scrape targets page
create table if not exists public.scraper_grades (
  maker_code text not null,
  car_code   text not null,
  name       text not null,
  seen       int  not null default 1,
  last_seen  timestamptz not null default now(),
  primary key (maker_code, car_code, name)
);
alter table public.scraper_grades enable row level security;
drop policy if exists grades_staff on public.scraper_grades;
create policy grades_staff on public.scraper_grades for select to authenticated using (public.is_staff());
grant select on public.scraper_grades to authenticated;

-- start the list from the cars already saved (the grade is what follows the model name in lots.model)
insert into public.scraper_grades (maker_code, car_code, name, seen)
select l.maker_code, l.car_code, trim(substr(l.model, length(t.model_name) + 1)), count(*)
from public.lots l
join (select distinct maker_code, car_code, model_name from public.scrape_targets) t on t.maker_code = l.maker_code and t.car_code = l.car_code
where l.maker_code is not null and upper(l.model) like upper(t.model_name) || ' %'
group by 1, 2, 3
having trim(substr(l.model, length(t.model_name) + 1)) <> ''
on conflict do nothing;

-- 4. USS venues and which weekday each one is scraped on.
create table if not exists public.scrape_venues (
  code   text primary key,                       -- the site's venue code (TK, YK ...)
  name   text not null,
  active boolean not null default true,          -- untick when a venue closes
  sort   int not null default 100
);
insert into public.scrape_venues (code, name, sort) values
  ('SP', 'Sapporo', 10), ('TH', 'Tohoku', 20), ('GM', 'Gunma', 30), ('TK', 'Tokyo', 40), ('JT', 'JAA', 50), ('WT', 'Saitama', 60),
  ('YK', 'Yokohama', 70), ('NT', 'Niigata', 80), ('SZ', 'Shizuoka', 90), ('NG', 'Nagoya', 100), ('NR', 'R-Nagoya', 110), ('OS', 'Osaka', 120),
  ('KB', 'Kobe', 130), ('HA', 'HAA Kobe', 140), ('OK', 'Okayama', 150), ('KF', 'Fukuoka', 160), ('KG', 'Kyushu', 170)
on conflict (code) do nothing;

create table if not exists public.scrape_venue_days (
  weekday    int  not null check (weekday between 1 and 7),     -- 1 = Monday ... 7 = Sunday (the weekday of the auction)
  venue_code text not null references public.scrape_venues(code) on update cascade on delete cascade,
  primary key (weekday, venue_code)
);
-- examples only: change them in the table editor. A weekday with NO row is scraped the old way (the site's own day list minus SKIP_VENUES in .env).
insert into public.scrape_venue_days (weekday, venue_code) values (2, 'YK'), (4, 'TK') on conflict do nothing;

alter table public.scrape_venues enable row level security;
alter table public.scrape_venue_days enable row level security;
drop policy if exists venues_staff on public.scrape_venues;
create policy venues_staff on public.scrape_venues for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists venue_days_staff on public.scrape_venue_days;
create policy venue_days_staff on public.scrape_venue_days for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.scrape_venues, public.scrape_venue_days to authenticated;

-- 5. A catalog of the ASNET makes and models (filled by `node asnet.js --probe`), so the targets page can offer a pick list
create table if not exists public.asnet_catalog (
  maker_code text not null,
  maker      text not null,
  car_code   text not null,
  car        text not null,
  primary key (maker_code, car_code)
);
alter table public.asnet_catalog enable row level security;
drop policy if exists asnet_catalog_staff on public.asnet_catalog;
create policy asnet_catalog_staff on public.asnet_catalog for select to authenticated using (public.is_staff());
grant select on public.asnet_catalog to authenticated;

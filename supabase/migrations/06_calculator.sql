-- =============================================================================
-- Auction — 06 import cost calculator
-- Reference data for the duty maths (copied from the source project once, with scripts/copy-reference.mjs) and the
-- calculator's saved defaults. The maths itself runs in the browser / scraper: no edge function, no server cost.
-- Staff only: AP holders never see dockets, duty or our margins.
-- =============================================================================

-- Malaysia Customs price guide: one row per vehicle (docket), the value used for duty by the car's age
create table if not exists public.custom_dockets (
  id            uuid primary key,
  bil           int,                 -- edition number of the guide
  year          int,
  brand         text not null,
  model         text not null,       -- "ALPHARD (3BA-AGH40W)": the model code is inside the brackets
  cc            int,
  currency_code text,
  amt_12m_24m   numeric(14,2),
  amt_24m_36m   numeric(14,2),
  amt_36m_48m   numeric(14,2),
  amt_48m_60m   numeric(14,2),
  amt_60m_plus  numeric(14,2),
  updated_at    timestamptz not null default now()
);
create index if not exists custom_dockets_brand_idx on public.custom_dockets(upper(brand), cc);

-- Duty multiplier by engine size ('car' or 'non_car')
create table if not exists public.duty_rates (
  id               uuid primary key,
  vehicle_type     text not null check (vehicle_type in ('car', 'non_car')),
  cc_range         text,
  cc_min           int,
  cc_max           int,
  multiplier       numeric(10,6) not null,
  is_active        boolean not null default true
);

create table if not exists public.currencies (
  code                text primary key,
  name                text,
  rate_unit           smallint not null default 1,     -- JPY is quoted per 100
  standard_fare_myr   numeric(12,2),
  standard_fare_label text
);

create table if not exists public.currency_rates (
  id            uuid primary key,
  from_currency text not null,
  to_currency   text not null,
  rate          numeric(18,8) not null,               -- per single unit
  rate_date     date not null
);
create index if not exists currency_rates_idx on public.currency_rates(from_currency, to_currency, rate_date desc);

-- Calculator defaults (margin %, freight, fees ...) saved by an admin
create table if not exists public.calc_presets (
  preset_key text primary key,
  amount     numeric(14,4) not null default 0
);

-- Which docket a car model uses, worked out once and then reused for every later car of that model.
-- source: 'code' = matched by the chassis code, 'ai' = chosen by Claude, 'manual' = chosen by staff (never overwritten)
create table if not exists public.docket_map (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,
  model_code    text not null default '',            -- the lot's chassis code, '' when unknown
  model_text    text not null default '',            -- the lot's model name (upper case), used when there is no code
  cc            int,
  docket_id     uuid references public.custom_dockets(id) on delete set null,
  confidence    numeric(3,2),
  source        text not null default 'code' check (source in ('code', 'ai', 'manual')),
  note          text,
  created_at    timestamptz not null default now(),
  unique (brand, model_code, model_text, cc)
);

-- Extra facts for a lot that the scraper's listing page does not give (filled by the enrich step, never typed by hand)
alter table public.lots add column if not exists first_reg_month int;
alter table public.lots add column if not exists doors int;
alter table public.lots add column if not exists seats int;
alter table public.lots add column if not exists inspection_until text;
alter table public.lots add column if not exists sales_points text;
alter table public.lots add column if not exists notes_en text;            -- seller's note, English
alter table public.lots add column if not exists inspector_report_en text; -- inspection note, English
alter table public.lots add column if not exists enriched_at timestamptz;

-- Our costs for a lot: staff only (AP holders never see duty or the docket behind it)
create table if not exists public.lot_costs (
  lot_id                 uuid primary key references public.lots(id) on delete cascade,
  docket_id              uuid references public.custom_dockets(id) on delete set null,
  age_months             int,
  duty_myr               numeric(12,2),     -- duty for the car as it is today
  duty_after_matang_myr  numeric(12,2),     -- duty once the car has aged into the next band
  matang_from            date,              -- first day the after-matang figure can be used
  updated_at             timestamptz not null default now()
);

alter table public.custom_dockets  enable row level security;
alter table public.duty_rates      enable row level security;
alter table public.currencies      enable row level security;
alter table public.currency_rates  enable row level security;
alter table public.calc_presets    enable row level security;
alter table public.docket_map      enable row level security;
alter table public.lot_costs       enable row level security;
create policy lotcosts_staff  on public.lot_costs     for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy dockets_staff   on public.custom_dockets for select to authenticated using (public.is_staff());
create policy dutyrates_staff on public.duty_rates     for select to authenticated using (public.is_staff());
create policy currencies_staff on public.currencies    for select to authenticated using (public.is_staff());
create policy rates_staff     on public.currency_rates for select to authenticated using (public.is_staff());
create policy presets_staff   on public.calc_presets   for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy docketmap_staff on public.docket_map     for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select on public.custom_dockets, public.duty_rates, public.currencies, public.currency_rates to authenticated;
grant select, insert, update, delete on public.calc_presets, public.docket_map, public.lot_costs to authenticated;

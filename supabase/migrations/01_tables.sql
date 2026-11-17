-- =============================================================================
-- Auction (standalone app) — 01 tables
-- Run the files in this folder in order (01 -> 04) in the Supabase SQL editor of the NEW project.
-- All times are stored as timestamptz (UTC); the app shows them in Malaysia time (Asia/Kuala_Lumpur).
-- =============================================================================

-- ── Settings (one row) ───────────────────────────────────────────────────────
create table if not exists public.app_settings (
  id                    boolean primary key default true check (id),
  max_car_age_years     int  not null default 5,    -- Malaysia rule: car must be within N years old
  inactive_suspend_days int  not null default 14,   -- AP holder with no order for N days is suspended
  history_weeks         int  not null default 4,    -- how far back the History Price page goes
  updated_at            timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict do nothing;

-- ── Agent fee rules ──────────────────────────────────────────────────────────
-- Charged to the AP holder when a bid is WON. A rule applies to a price band; the AP holder can also be pinned to one rule.
create table if not exists public.fee_rules (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  fee_type       text not null check (fee_type in ('flat_jpy', 'percent')),
  fee_value      numeric(12,2) not null check (fee_value >= 0),
  min_price_jpy  numeric(12,0) not null default 0,       -- band start (won price >= this)
  max_price_jpy  numeric(12,0),                          -- band end (won price <  this); null = no upper end
  is_default     boolean not null default false,         -- used when the AP holder has no rule of their own
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ── People ───────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  role             text not null default 'ap_holder' check (role in ('admin', 'staff', 'ap_holder')),
  status           text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  company_name     text,
  contact_name     text,
  phone            text,
  whatsapp         text,
  email            text,
  address          text,
  bid_limit_jpy    numeric(12,0) not null default 0,    -- highest single bid this AP holder may place; 0 = cannot bid until set
  open_limit_jpy   numeric(12,0),                        -- optional cap on the total of all their open bids; null = no cap
  fee_rule_id      uuid references public.fee_rules(id) on delete set null,
  history_until    date,                                 -- History Price subscription end date; null/past = no access
  activated_at     timestamptz,                          -- start of the inactivity clock
  last_order_at    timestamptz,
  suspended_at     timestamptz,
  suspended_reason text,
  notes            text,                                 -- internal, staff only
  created_at       timestamptz not null default now()
);

-- Extra contact people for one AP holder (the main contact is on the profile itself)
create table if not exists public.ap_contacts (
  id          uuid primary key default gen_random_uuid(),
  ap_id       uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  position    text,
  phone       text,
  whatsapp    text,
  email       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists ap_contacts_ap_idx on public.ap_contacts(ap_id);

-- ── Auction lots (filled by the scraper with the service key) ────────────────
create table if not exists public.lots (
  id              uuid primary key default gen_random_uuid(),
  venue           text not null,                 -- 'Yokohama'
  auction_date    date not null,                 -- Japan date of the auction
  lot_no          text not null,
  bid_deadline    timestamptz not null,          -- send as a full timestamp WITH offset (+09:00)
  brand           text not null,
  model           text not null,
  model_code      text,
  grade           text,                          -- '4.5', 'S', 'R', 'RA' ...
  grade_num       numeric(3,1),                  -- filled by trigger: 4.5 for '4.5B'; null for S/R/RA
  interior_grade  text,
  mfg_year        int,
  mfg_month       int,
  mileage_km      int,
  engine_cc       int,
  transmission    text,
  fuel            text,
  drive           text,
  color           text,
  chassis_no      text,
  start_price_jpy numeric(12,0),
  equipment       text,
  notes           text,
  inspector_report text,
  photos          jsonb not null default '[]',   -- ["https://...jpg", ...]
  sheet_url       text,                          -- the auction sheet image
  my_eligible     boolean not null default true, -- filled by trigger from max_car_age_years; the app only shows eligible lots
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (venue, auction_date, lot_no)
);
create index if not exists lots_auction_date_idx on public.lots(auction_date);
create index if not exists lots_deadline_idx on public.lots(bid_deadline);
create index if not exists lots_brand_idx on public.lots(upper(brand));

-- Past results (sold prices) for the History Price page
create table if not exists public.lot_history (
  id              uuid primary key default gen_random_uuid(),
  venue           text not null,
  auction_date    date not null,
  lot_no          text not null,
  brand           text not null,
  model           text not null,
  grade           text,
  grade_num       numeric(3,1),
  mfg_year        int,
  mileage_km      int,
  engine_cc       int,
  transmission    text,
  color           text,
  result          text not null default 'sold' check (result in ('sold', 'unsold')),
  sold_price_jpy  numeric(12,0),
  created_at      timestamptz not null default now(),
  unique (venue, auction_date, lot_no)
);
create index if not exists lot_history_date_idx on public.lot_history(auction_date);
create index if not exists lot_history_brand_idx on public.lot_history(upper(brand), upper(model));

-- ── What each AP holder wants to see ─────────────────────────────────────────
create table if not exists public.preferences (
  id              uuid primary key default gen_random_uuid(),
  ap_id           uuid not null references public.profiles(id) on delete cascade,
  name            text not null default 'My preference',
  brands          text[] not null default '{}',   -- upper-case; empty = any brand
  models          text[] not null default '{}',   -- partial text match; empty = any model
  venues          text[] not null default '{}',   -- empty = any venue
  year_min        int,
  mileage_max     int,
  grade_min       numeric(3,1),
  price_max_jpy   numeric(12,0),
  transmission    text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists preferences_ap_idx on public.preferences(ap_id);

-- ── Bid orders (the AP holder asks us; our staff place the bid at the auction) ─
create table if not exists public.bids (
  id               uuid primary key default gen_random_uuid(),
  ap_id            uuid not null references public.profiles(id) on delete restrict,
  lot_id           uuid not null references public.lots(id) on delete restrict,
  max_bid_jpy      numeric(12,0) not null check (max_bid_jpy > 0),
  status           text not null default 'pending' check (status in ('pending', 'placed', 'won', 'lost', 'cancelled', 'rejected')),
  ap_note          text,                          -- from the AP holder
  team_note        text,                          -- from our staff, visible to the AP holder
  final_price_jpy  numeric(12,0),                 -- winning price (won only)
  fee_type         text,                          -- the fee rule that was applied, copied so later rule edits don't change old bids
  fee_value        numeric(12,2),
  agent_fee_jpy    numeric(12,0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  decided_at       timestamptz
);
create index if not exists bids_ap_idx on public.bids(ap_id, created_at desc);
create index if not exists bids_lot_idx on public.bids(lot_id);
create index if not exists bids_status_idx on public.bids(status);
-- one open order per AP holder per car
create unique index if not exists bids_one_open_per_lot on public.bids(ap_id, lot_id) where status in ('pending', 'placed');

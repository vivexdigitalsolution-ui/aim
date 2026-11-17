-- =============================================================================
-- Auction — 05 scraper support tables
-- Only the scraper (service_role key) uses these. RLS is on with no policies, so the app/AP holders can never read them.
-- Run after 01–04.
-- =============================================================================

-- source id of a car (kept to tell "already scraped" apart from "new")
alter table public.lots         add column if not exists ex_key text;
alter table public.lot_history  add column if not exists ex_key text;
create index if not exists lots_ex_key_idx on public.lots(ex_key, auction_date);

-- Brand / model codes found on the source site (filled by scraper/brand-model-scraper.js)
create table if not exists public.scraper_brands (
  code     text primary key,
  name     text not null,
  country  text,
  updated_at timestamptz not null default now()
);
create table if not exists public.scraper_models (
  brand_code text not null references public.scraper_brands(code) on delete cascade,
  code       text not null,
  name       text not null,
  updated_at timestamptz not null default now(),
  primary key (brand_code, code)
);

-- What to scrape: one row = one brand + model (+ year range). Created by scraper/make-targets.js.
create table if not exists public.scrape_targets (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  lot_type      text not null check (lot_type in ('bid', 'history')),   -- bid = tomorrow's cars, history = sold prices
  maker_code    text not null,
  car_code      text not null,
  brand_name    text not null,
  model_name    text not null,
  year_from     int,
  year_to       int,
  score_min     numeric(3,1),
  priority      int not null default 100,
  enabled       boolean not null default true,
  -- locking, so two PCs never scrape the same target
  locked_by     text,
  locked_at     timestamptz,
  completed_at  timestamptz,
  last_run_at   timestamptz,
  last_run_id   uuid,
  run_count     int not null default 0,
  created_at    timestamptz not null default now(),
  unique (lot_type, maker_code, car_code)
);

create table if not exists public.scrape_runs (
  id                uuid primary key default gen_random_uuid(),
  target_id         uuid references public.scrape_targets(id) on delete set null,
  instance_id       text,
  status            text not null default 'running',
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  duration_seconds  int,
  error_message     text,
  records_scraped   int not null default 0,
  records_inserted  int not null default 0,
  records_updated   int not null default 0,
  records_failed    int not null default 0,
  images_uploaded   int not null default 0,
  images_failed     int not null default 0
);

alter table public.scraper_brands enable row level security;
alter table public.scraper_models enable row level security;
alter table public.scrape_targets enable row level security;
alter table public.scrape_runs    enable row level security;

-- housekeeping also trims old run logs
create or replace function public.housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.app_settings; jst_today date := (now() at time zone 'Asia/Tokyo')::date; n_lots int; n_hist int; n_susp int; n_cancel int; n_runs int;
begin
  if auth.uid() is not null and not public.is_staff() then raise exception 'Staff only'; end if;
  select * into s from public.app_settings where id;

  delete from public.bids b using public.lots l
    where b.lot_id = l.id and l.auction_date < jst_today and b.status = 'cancelled'
      and not exists (select 1 from public.bids o where o.lot_id = l.id and o.status <> 'cancelled');
  get diagnostics n_cancel = row_count;

  delete from public.lots l where l.auction_date < jst_today and not exists (select 1 from public.bids b where b.lot_id = l.id);
  get diagnostics n_lots = row_count;

  delete from public.lot_history where auction_date < jst_today - (s.history_weeks * 7 + 7);
  get diagnostics n_hist = row_count;

  delete from public.scrape_runs where started_at < now() - interval '14 days';
  get diagnostics n_runs = row_count;

  update public.profiles set status = 'suspended', suspended_at = now(),
         suspended_reason = 'No order for ' || s.inactive_suspend_days || ' days'
   where role = 'ap_holder' and status = 'active'
     and coalesce(last_order_at, activated_at, created_at) < now() - make_interval(days => s.inactive_suspend_days);
  get diagnostics n_susp = row_count;

  return jsonb_build_object('lots_deleted', n_lots, 'cancelled_bids_cleared', n_cancel, 'history_deleted', n_hist, 'run_logs_deleted', n_runs, 'ap_suspended', n_susp);
end $$;

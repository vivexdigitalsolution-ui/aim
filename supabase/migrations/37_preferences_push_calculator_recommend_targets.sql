-- 37: saved preferences, phone push, calculator uses, recommend picks, scrape-target settings.   Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. Saved preferences: many named sets per AP holder. Used on the Cars page (one tap to apply) and to tell the dealer when a new car fits.
create table if not exists public.saved_preferences (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  brands       text[] not null default '{}',
  models       text[] not null default '{}',
  year_from    int,
  year_to      int,
  max_price_myr numeric,
  min_score    numeric(3,1),
  notify_app   boolean not null default true,
  notify_email boolean not null default false,
  notify_push  boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists idx_saved_pref_user on public.saved_preferences (user_id);
alter table public.saved_preferences enable row level security;
drop policy if exists saved_pref_own on public.saved_preferences;
create policy saved_pref_own on public.saved_preferences for all using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.saved_preferences from anon;
grant select, insert, update, delete on public.saved_preferences to authenticated;

-- which cars were already announced for which preference (service key only)
create table if not exists public.preference_seen (
  pref_id uuid not null references public.saved_preferences(id) on delete cascade,
  lot_id  uuid not null references public.lots(id) on delete cascade,
  primary key (pref_id, lot_id)
);
alter table public.preference_seen enable row level security;

-- 2. Phone / browser push (standard web push with VAPID keys, the same way the CarzNexus portal does it)
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;   -- only the two functions below and the service key touch it

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$ delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() $$;
create or replace function public.push_device_count() returns int
language sql stable security definer set search_path = public as $$ select count(*)::int from public.push_subscriptions where user_id = auth.uid() $$;
revoke all on function public.push_subscribe(text, text, text), public.push_unsubscribe(text), public.push_device_count() from public, anon;
grant execute on function public.push_subscribe(text, text, text), public.push_unsubscribe(text), public.push_device_count() to authenticated;

alter table public.notifications add column if not exists pushed_at timestamptz;

-- 3. Calculator: who may use it and how often. Staff: unlimited. Buyers (customer role): never.
create table if not exists public.calculator_limits (
  tier       text primary key check (tier in ('free', 'member', 'partner')),
  period     text not null check (period in ('once', 'day', 'month', 'unlimited')),
  uses       int not null default 0
);
insert into public.calculator_limits (tier, period, uses) values ('free', 'once', 1), ('member', 'unlimited', 0), ('partner', 'unlimited', 0)
on conflict (tier) do nothing;
alter table public.calculator_limits enable row level security;
drop policy if exists calc_limits_read on public.calculator_limits;
create policy calc_limits_read on public.calculator_limits for select to authenticated using (true);
drop policy if exists calc_limits_admin on public.calculator_limits;
create policy calc_limits_admin on public.calculator_limits for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.calculator_limits to authenticated;
grant insert, update, delete on public.calculator_limits to authenticated;

create table if not exists public.calculator_uses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  input      jsonb
);
create index if not exists idx_calc_uses_user on public.calculator_uses (user_id, created_at desc);
alter table public.calculator_uses enable row level security;
drop policy if exists calc_uses_own on public.calculator_uses;
create policy calc_uses_own on public.calculator_uses for select using (user_id = auth.uid() or public.is_staff());
revoke all on public.calculator_uses from anon, authenticated;
grant select on public.calculator_uses to authenticated;

-- what the signed-in user may do right now: { allowed, left, period, uses }
create or replace function public.calculator_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p public.profiles; lim public.calculator_limits; used int; since timestamptz;
begin
  select * into p from public.profiles where id = auth.uid();
  if p.id is null or p.status <> 'active' or p.role = 'customer' then return jsonb_build_object('allowed', false, 'reason', 'not available for this account'); end if;
  if p.role in ('admin', 'staff') then return jsonb_build_object('allowed', true, 'left', null, 'period', 'unlimited'); end if;
  select * into lim from public.calculator_limits where tier = coalesce(p.tier, 'member');
  if lim.tier is null or lim.period = 'unlimited' then return jsonb_build_object('allowed', true, 'left', null, 'period', 'unlimited'); end if;
  since := case lim.period when 'day' then date_trunc('day', now()) when 'month' then date_trunc('month', now()) else '-infinity'::timestamptz end;
  select count(*) into used from public.calculator_uses where user_id = p.id and created_at >= since;
  return jsonb_build_object('allowed', used < lim.uses, 'left', greatest(lim.uses - used, 0), 'period', lim.period, 'uses', lim.uses);
end $$;
-- one calculation = one use (checked on the server, so the limit cannot be skipped in the browser)
create or replace function public.calculator_use(p_input jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  s := public.calculator_status();
  if not (s->>'allowed')::boolean then raise exception 'calculator_limit' using errcode = '42501'; end if;
  if not public.is_staff() then insert into public.calculator_uses (user_id, input) values (auth.uid(), p_input); end if;
  return public.calculator_status();
end $$;
revoke all on function public.calculator_status(), public.calculator_use(jsonb) from public, anon;
grant execute on function public.calculator_status(), public.calculator_use(jsonb) to authenticated;

-- 4. Recommend picks: staff tick cars on the Cars page / car page; the Offer report is built from them.
create table if not exists public.recommend_picks (
  lot_id   uuid primary key references public.lots(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  note     text
);
alter table public.recommend_picks enable row level security;
drop policy if exists recommend_staff on public.recommend_picks;
create policy recommend_staff on public.recommend_picks for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.recommend_picks from anon;
grant select, insert, update, delete on public.recommend_picks to authenticated;

-- 5. Scrape targets: source (USS / ASNET), exact scores, model codes, and staff may edit them.
alter table public.scrape_targets add column if not exists source text not null default 'uss' check (source in ('uss', 'asnet'));
alter table public.scrape_targets add column if not exists scores text[];            -- exact auction scores to take, e.g. {S,6,5,4.5,4}; empty = use the scraper's .env limit
alter table public.scrape_targets add column if not exists model_codes text[];       -- chassis codes to keep; empty = every code of the model
alter table public.scrape_targets drop constraint if exists scrape_targets_lot_type_maker_code_car_code_key;
drop index if exists public.uq_scrape_targets_source;
create unique index if not exists uq_scrape_targets_source on public.scrape_targets (source, lot_type, maker_code, car_code);

drop policy if exists targets_staff_write on public.scrape_targets;
create policy targets_staff_write on public.scrape_targets for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant insert, update, delete on public.scrape_targets to authenticated;
drop policy if exists scraper_brands_staff on public.scraper_brands;
create policy scraper_brands_staff on public.scraper_brands for select to authenticated using (public.is_staff());
drop policy if exists scraper_models_staff on public.scraper_models;
create policy scraper_models_staff on public.scraper_models for select to authenticated using (public.is_staff());
grant select on public.scraper_brands, public.scraper_models to authenticated;

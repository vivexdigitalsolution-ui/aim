-- 33: CUSTOMER role: a walk-in customer of the shop gets a short-lived account that only sees the cars staff chose for them.   Run in the Japan Auction project > SQL Editor. Safe to run again.
--   1. Staff make a viewing pass (customer name, the model and filters they want, hours of access) and give the customer the code or link.
--   2. The customer signs up with the code. The account becomes role 'customer' and runs for the hours staff set, counted from the first sign-up.
--   3. A customer sees ONLY the cars that fit the pass filters (through customer_cars / customer_car): no price, no cost, no venue, no lot number, no other page.
--   4. When the time is up the data stops at once (the functions return nothing) and the app signs the customer out.

-- 1. the new role, and the time limit + filters on the profile (a customer can never change them: see profiles_guard)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'staff', 'ap_holder', 'customer'));
alter table public.profiles add column if not exists expires_at       timestamptz;
alter table public.profiles add column if not exists customer_filters jsonb;
alter table public.app_settings add column if not exists customer_default_hours int not null default 48;

create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.activated_at := now();
    new.suspended_at := null; new.suspended_reason := null;
  end if;
  if auth.uid() is null or coalesce(current_setting('auction.system', true), '') = 'on' or public.is_staff() then return new; end if;
  if tg_op = 'UPDATE' and (
       new.role is distinct from old.role or new.status is distinct from old.status
    or new.bid_limit_jpy is distinct from old.bid_limit_jpy or new.open_limit_jpy is distinct from old.open_limit_jpy
    or new.fee_rule_id is distinct from old.fee_rule_id or new.history_until is distinct from old.history_until
    or new.activated_at is distinct from old.activated_at or new.last_order_at is distinct from old.last_order_at
    or new.suspended_at is distinct from old.suspended_at or new.suspended_reason is distinct from old.suspended_reason
    or new.notes is distinct from old.notes
    or new.tier is distinct from old.tier
    or new.service_level_id is distinct from old.service_level_id
    or new.expires_at is distinct from old.expires_at
    or new.customer_filters is distinct from old.customer_filters) then
    raise exception 'You can only change your contact details';
  end if;
  return new;
end $$;

create or replace function public.is_live_customer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'customer' and status = 'active' and expires_at > now())
$$;
grant execute on function public.is_live_customer() to authenticated;

-- 2. viewing passes (staff only). filters: {"brands":["TOYOTA"],"models":["VELLFIRE"],"year_from":2020,"year_to":2024,"max_mileage":60000,"features":["sunroof"]}
create table if not exists public.customer_passes (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  label           text not null,                              -- the customer's name
  phone           text,
  filters         jsonb not null default '{}',
  hours           int not null default 48 check (hours between 1 and 720),
  code_expires_at timestamptz not null default (now() + interval '7 days'),     -- an unused code stops working after this
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  redeemed_by     uuid references public.profiles(id) on delete set null,
  redeemed_at     timestamptz,
  revoked         boolean not null default false
);
alter table public.customer_passes enable row level security;
drop policy if exists customer_passes_staff on public.customer_passes;
create policy customer_passes_staff on public.customer_passes for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.customer_passes from anon;
grant select, insert, update, delete on public.customer_passes to authenticated;

-- 3. what a customer picked ("I like this one"): staff see them
create table if not exists public.customer_picks (
  customer_id uuid not null references public.profiles(id) on delete cascade,
  lot_id      uuid not null references public.lots(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (customer_id, lot_id)
);
alter table public.customer_picks enable row level security;
drop policy if exists customer_picks_own on public.customer_picks;
create policy customer_picks_own on public.customer_picks for all to authenticated using (customer_id = auth.uid() and public.is_live_customer()) with check (customer_id = auth.uid() and public.is_live_customer());
drop policy if exists customer_picks_staff on public.customer_picks;
create policy customer_picks_staff on public.customer_picks for select to authenticated using (public.is_staff());
revoke all on public.customer_picks from anon;
grant select, insert, delete on public.customer_picks to authenticated;

create or replace function public.customer_pick_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; car text;
begin
  select coalesce(contact_name, company_name, email, 'A customer') into who from public.profiles where id = new.customer_id;
  select brand || ' ' || model || coalesce(' ' || mfg_year, '') into car from public.lots where id = new.lot_id;
  perform public.notify_staff('customer_pick', 'Customer likes a car: ' || coalesce(car, ''), who, '/customers', new.lot_id);
  return null;
end $$;
drop trigger if exists customer_pick_notify_trg on public.customer_picks;
create trigger customer_pick_notify_trg after insert on public.customer_picks for each row execute function public.customer_pick_notify();

-- 4. the customer signs up normally, then uses the code. Only a brand-new account that waits for approval can use it.
create or replace function public.redeem_customer_pass(p_code text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare ps public.customer_passes; me public.profiles; ends timestamptz;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into me from public.profiles where id = auth.uid();
  if me.role is distinct from 'ap_holder' or me.status is distinct from 'pending' then raise exception 'This account cannot use a viewing code'; end if;
  select * into ps from public.customer_passes where code = upper(trim(p_code)) and redeemed_by is null and not revoked and code_expires_at > now() for update;
  if ps.id is null then raise exception 'This code is not valid, was already used, or has expired'; end if;
  ends := now() + make_interval(hours => ps.hours);
  perform set_config('auction.system', 'on', true);
  update public.profiles set role = 'customer', status = 'active', expires_at = ends, customer_filters = ps.filters,
    contact_name = coalesce(nullif(contact_name, ''), ps.label), phone = coalesce(nullif(phone, ''), ps.phone), company_name = null
  where id = auth.uid();
  update public.customer_passes set redeemed_by = auth.uid(), redeemed_at = now() where id = ps.id;
  perform public.notify_staff('customer_started', 'Customer started viewing: ' || ps.label, 'Access until ' || to_char(ends at time zone 'Asia/Kuala_Lumpur', 'DD Mon HH24:MI') || ' (Malaysia time)', '/customers', null);
  return jsonb_build_object('expires_at', ends);
end $$;
revoke all on function public.redeem_customer_pass(text) from public;
grant execute on function public.redeem_customer_pass(text) to authenticated;

-- 5. does a car fit the filters?
create or replace function public.customer_lot_ok(l public.lots, f jsonb) returns boolean
language sql stable security definer set search_path = public as $$
  select l.bid_deadline > now() and l.my_eligible
    and (coalesce(jsonb_array_length(f -> 'brands'), 0) = 0 or exists (select 1 from jsonb_array_elements_text(f -> 'brands') b where upper(l.brand) = upper(b)))
    and (coalesce(jsonb_array_length(f -> 'models'), 0) = 0 or exists (select 1 from jsonb_array_elements_text(f -> 'models') m where upper(l.model) like '%' || upper(m) || '%'))
    and (nullif(f ->> 'year_from', '') is null or l.mfg_year >= (f ->> 'year_from')::int)
    and (nullif(f ->> 'year_to', '') is null or l.mfg_year <= (f ->> 'year_to')::int)
    and (nullif(f ->> 'max_mileage', '') is null or l.mileage_km <= (f ->> 'max_mileage')::int)
    and not exists (select 1 from jsonb_array_elements_text(coalesce(f -> 'features', '[]'::jsonb)) k where not exists (select 1 from public.lot_features lf where lf.lot_id = l.id and lf.key = k))
$$;
revoke all on function public.customer_lot_ok(public.lots, jsonb) from public;

create or replace function public.customer_car_json(l public.lots) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'brand', l.brand, 'model', l.model, 'grade', l.grade, 'interior_grade', l.interior_grade, 'mfg_year', l.mfg_year,
    'mileage_km', l.mileage_km, 'engine_cc', l.engine_cc, 'transmission', l.transmission, 'color', l.color, 'photos', coalesce(l.photos, '[]'::jsonb),     -- no auction sheet: it shows the auction house, the lot number and the start price
    'equipment', l.equipment, 'features', coalesce((select jsonb_agg(jsonb_build_object('key', lf.key, 'label', lf.label, 'source', lf.source) order by lf.label) from public.lot_features lf where lf.lot_id = l.id), '[]'::jsonb))
$$;
revoke all on function public.customer_car_json(public.lots) from public;

-- the customer's cars. Staff may pass filters to preview what a customer would see.
create or replace function public.customer_cars(p_filters jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f jsonb;
begin
  if public.is_staff() and p_filters is not null then f := p_filters;
  elsif public.is_live_customer() then select customer_filters into f from public.profiles where id = auth.uid();
  else return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(public.customer_car_json(l) order by l.mfg_year desc nulls last, l.mileage_km nulls last)
    from (select * from public.lots x where public.customer_lot_ok(x, coalesce(f, '{}'::jsonb)) order by x.mfg_year desc nulls last, x.mileage_km nulls last limit 300) l), '[]'::jsonb);
end $$;
revoke all on function public.customer_cars(jsonb) from public;
grant execute on function public.customer_cars(jsonb) to authenticated;

create or replace function public.customer_car(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f jsonb; l public.lots;
begin
  if public.is_live_customer() then select customer_filters into f from public.profiles where id = auth.uid();
  else return null; end if;
  select * into l from public.lots where id = p_id;
  if l.id is null or not public.customer_lot_ok(l, coalesce(f, '{}'::jsonb)) then return null; end if;
  return public.customer_car_json(l);
end $$;
revoke all on function public.customer_car(uuid) from public;
grant execute on function public.customer_car(uuid) to authenticated;

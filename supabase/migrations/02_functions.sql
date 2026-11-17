-- =============================================================================
-- Auction — 02 functions & triggers
-- =============================================================================

-- ── Helpers used by the RLS policies (security definer: no recursion on profiles) ──
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'staff') and status = 'active')
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active')
$$;

create or replace function public.is_active_ap() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'ap_holder' and status = 'active')
$$;

-- ── New sign-up -> a pending profile (staff approve it later) ─────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, company_name, contact_name, phone, whatsapp)
  values (new.id, new.email,
          new.raw_user_meta_data ->> 'company_name', new.raw_user_meta_data ->> 'contact_name',
          new.raw_user_meta_data ->> 'phone', new.raw_user_meta_data ->> 'whatsapp')
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ── Profiles: an AP holder can edit their own contact details, never role/status/limits ──
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    new.activated_at := now();                 -- restarts the inactivity clock
    new.suspended_at := null; new.suspended_reason := null;
  end if;
  -- place_bid() raises this flag for its own last_order_at update; the SQL editor / service role have no auth.uid(); staff may change anything
  if auth.uid() is null or coalesce(current_setting('auction.system', true), '') = 'on' or public.is_staff() then return new; end if;
  if tg_op = 'UPDATE' and (
       new.role is distinct from old.role or new.status is distinct from old.status
    or new.bid_limit_jpy is distinct from old.bid_limit_jpy or new.open_limit_jpy is distinct from old.open_limit_jpy
    or new.fee_rule_id is distinct from old.fee_rule_id or new.history_until is distinct from old.history_until
    or new.activated_at is distinct from old.activated_at or new.last_order_at is distinct from old.last_order_at
    or new.suspended_at is distinct from old.suspended_at or new.suspended_reason is distinct from old.suspended_reason
    or new.notes is distinct from old.notes) then
    raise exception 'You can only change your contact details';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before insert or update on public.profiles for each row execute function public.profiles_guard();

-- ── Lots: grade number + Malaysia age rule ───────────────────────────────────
create or replace function public.grade_to_num(g text) returns numeric
language sql immutable as $$ select nullif(substring(coalesce(g, '') from '^[0-9]+(?:\.[0-9])?'), '')::numeric $$;

create or replace function public.lots_prepare() returns trigger
language plpgsql set search_path = public as $$
declare max_age int;
begin
  select max_car_age_years into max_age from public.app_settings where id;
  new.grade_num := public.grade_to_num(new.grade);
  -- within N years: manufactured in (auction year - N) or later. Unknown year -> not eligible.
  new.my_eligible := new.mfg_year is not null and new.mfg_year >= extract(year from new.auction_date)::int - coalesce(max_age, 5);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists lots_prepare_trg on public.lots;
create trigger lots_prepare_trg before insert or update on public.lots for each row execute function public.lots_prepare();

create or replace function public.history_prepare() returns trigger
language plpgsql set search_path = public as $$
begin new.grade_num := public.grade_to_num(new.grade); return new; end $$;
drop trigger if exists history_prepare_trg on public.lot_history;
create trigger history_prepare_trg before insert or update on public.lot_history for each row execute function public.history_prepare();

-- ── AP holder: lots that match any of my active preferences ──────────────────
-- Returned as a table, so the app can still add its own filters / sort / paging on top (PostgREST supports that).
create or replace function public.my_preferred_lots() returns setof public.lots
language sql stable security invoker set search_path = public as $$
  select l.* from public.lots l
  where l.my_eligible and exists (
    select 1 from public.preferences p
    where p.ap_id = auth.uid() and p.is_active
      and (cardinality(p.brands) = 0 or upper(l.brand) = any (p.brands))
      and (cardinality(p.models) = 0 or exists (select 1 from unnest(p.models) m where l.model ilike '%' || m || '%'))
      and (cardinality(p.venues) = 0 or l.venue = any (p.venues))
      and (p.year_min is null or l.mfg_year >= p.year_min)
      and (p.mileage_max is null or l.mileage_km <= p.mileage_max)
      and (p.grade_min is null or l.grade_num >= p.grade_min)
      and (p.price_max_jpy is null or l.start_price_jpy <= p.price_max_jpy)
      and (p.transmission is null or p.transmission = '' or l.transmission ilike p.transmission || '%')
  )
$$;

-- ── Place / change / cancel a bid (the only way an AP holder writes to bids) ─
create or replace function public.place_bid(p_lot uuid, p_max numeric, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare me public.profiles; lot public.lots; open_total numeric; existing public.bids; new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or me.role <> 'ap_holder' or me.status <> 'active' then raise exception 'Your account is not active'; end if;
  select * into lot from public.lots where id = p_lot and my_eligible;
  if lot.id is null then raise exception 'This car is not available'; end if;
  if lot.bid_deadline <= now() then raise exception 'The bid deadline for this car has passed'; end if;
  if p_max is null or p_max <= 0 then raise exception 'Enter your bid price'; end if;
  if me.bid_limit_jpy <= 0 then raise exception 'Your bidding limit has not been set yet. Please contact us'; end if;
  if p_max > me.bid_limit_jpy then raise exception 'Your bid is above your limit of JPY %', to_char(me.bid_limit_jpy, 'FM999,999,999,999'); end if;

  select * into existing from public.bids where ap_id = me.id and lot_id = p_lot and status in ('pending', 'placed');
  if existing.id is not null and existing.status = 'placed' then raise exception 'This bid is already placed by our team and cannot be changed'; end if;

  if me.open_limit_jpy is not null then
    select coalesce(sum(max_bid_jpy), 0) into open_total from public.bids
      where ap_id = me.id and status in ('pending', 'placed') and id is distinct from existing.id;
    if open_total + p_max > me.open_limit_jpy then
      raise exception 'This would take your open bids above your total limit of JPY %', to_char(me.open_limit_jpy, 'FM999,999,999,999');
    end if;
  end if;

  if existing.id is not null then
    update public.bids set max_bid_jpy = p_max, ap_note = p_note, updated_at = now() where id = existing.id;
    new_id := existing.id;
  else
    insert into public.bids (ap_id, lot_id, max_bid_jpy, ap_note) values (me.id, p_lot, p_max, p_note) returning id into new_id;
  end if;
  perform set_config('auction.system', 'on', true);          -- lets the profile guard accept this system update
  update public.profiles set last_order_at = now() where id = me.id;
  perform set_config('auction.system', '', true);
  return new_id;
end $$;

create or replace function public.cancel_bid(p_bid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bids; dl timestamptz;
begin
  select * into b from public.bids where id = p_bid and ap_id = auth.uid();
  if b.id is null then raise exception 'Bid not found'; end if;
  if b.status <> 'pending' then raise exception 'Only a bid that is not yet placed can be cancelled'; end if;
  select bid_deadline into dl from public.lots where id = b.lot_id;
  if dl <= now() then raise exception 'The bid deadline has passed'; end if;
  update public.bids set status = 'cancelled', updated_at = now(), decided_at = now() where id = b.id;
end $$;

-- ── Staff: agent fee for a won price ─────────────────────────────────────────
create or replace function public.agent_fee_for(p_ap uuid, p_price numeric)
returns table (fee_type text, fee_value numeric, fee_jpy numeric)
language plpgsql stable security definer set search_path = public as $$
declare r public.fee_rules;
begin
  select fr.* into r from public.fee_rules fr join public.profiles p on p.fee_rule_id = fr.id
    where p.id = p_ap and fr.active;
  if r.id is null then
    select * into r from public.fee_rules
      where active and is_default and min_price_jpy <= p_price and (max_price_jpy is null or p_price < max_price_jpy)
      order by min_price_jpy desc limit 1;
  end if;
  if r.id is null then return query select null::text, 0::numeric, 0::numeric; return; end if;
  return query select r.fee_type, r.fee_value,
    case when r.fee_type = 'percent' then round(p_price * r.fee_value / 100) else r.fee_value end;
end $$;

-- ── Staff: mark a bid placed / won / lost / rejected ─────────────────────────
create or replace function public.staff_set_bid(p_bid uuid, p_status text, p_final numeric default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bids; f record;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  if p_status not in ('placed', 'won', 'lost', 'rejected', 'pending') then raise exception 'Bad status'; end if;
  select * into b from public.bids where id = p_bid;
  if b.id is null then raise exception 'Bid not found'; end if;
  if p_status = 'won' then
    if p_final is null or p_final <= 0 then raise exception 'Enter the winning price'; end if;
    select * into f from public.agent_fee_for(b.ap_id, p_final);
    update public.bids set status = 'won', final_price_jpy = p_final, fee_type = f.fee_type, fee_value = f.fee_value,
      agent_fee_jpy = f.fee_jpy, team_note = coalesce(p_note, team_note), updated_at = now(), decided_at = now() where id = p_bid;
  else
    update public.bids set status = p_status, team_note = coalesce(p_note, team_note), updated_at = now(),
      decided_at = case when p_status = 'pending' then null else now() end,
      final_price_jpy = null, fee_type = null, fee_value = null, agent_fee_jpy = null where id = p_bid;
  end if;
end $$;

-- ── Housekeeping (run daily; also a button in Admin > Settings) ──────────────
--  1. lots from a past auction day that nobody ordered are deleted (lots with a bid are kept)
--  2. old history rows are deleted
--  3. AP holders with no order for N days are suspended
create or replace function public.housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.app_settings; jst_today date := (now() at time zone 'Asia/Tokyo')::date; n_lots int; n_hist int; n_susp int; n_cancel int;
begin
  if auth.uid() is not null and not public.is_staff() then raise exception 'Staff only'; end if;
  select * into s from public.app_settings where id;

  -- a cancelled order does not count as someone bidding: clear it so its car can be deleted
  delete from public.bids b using public.lots l
    where b.lot_id = l.id and l.auction_date < jst_today and b.status = 'cancelled'
      and not exists (select 1 from public.bids o where o.lot_id = l.id and o.status <> 'cancelled');
  get diagnostics n_cancel = row_count;

  delete from public.lots l where l.auction_date < jst_today and not exists (select 1 from public.bids b where b.lot_id = l.id);
  get diagnostics n_lots = row_count;

  delete from public.lot_history where auction_date < jst_today - (s.history_weeks * 7 + 7);
  get diagnostics n_hist = row_count;

  update public.profiles set status = 'suspended', suspended_at = now(),
         suspended_reason = 'No order for ' || s.inactive_suspend_days || ' days'
   where role = 'ap_holder' and status = 'active'
     and coalesce(last_order_at, activated_at, created_at) < now() - make_interval(days => s.inactive_suspend_days);
  get diagnostics n_susp = row_count;

  return jsonb_build_object('lots_deleted', n_lots, 'cancelled_bids_cleared', n_cancel, 'history_deleted', n_hist, 'ap_suspended', n_susp);
end $$;

-- ── Which auction days still have cars open for bidding (drives the day chips on the Cars page) ──
create or replace function public.open_auction_days() returns table (auction_date date, venue text, cars bigint)
language sql stable security invoker set search_path = public as $$
  select l.auction_date, l.venue, count(*) from public.lots l
  where l.my_eligible and l.bid_deadline > now() group by 1, 2 order by 1, 2
$$;

-- 21: tier gating + the AP-holder view of costs.   Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. SECURITY FIX: an AP holder must not be able to change their own tier (migration 18 added the column but the guard did not know it).
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
    or new.notes is distinct from old.notes
    or new.tier is distinct from old.tier) then
    raise exception 'You can only change your contact details';
  end if;
  return new;
end $$;

-- 2. Tier helpers: free < member < partner. Staff pass every tier.
create or replace function public.tier_rank(t text) returns int
language sql immutable as $$ select case t when 'partner' then 2 when 'member' then 1 else 0 end $$;

create or replace function public.tier_at_least(min_tier text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'ap_holder' and p.status = 'active' and public.tier_rank(p.tier) >= public.tier_rank(min_tier))
$$;
grant execute on function public.tier_at_least(text) to authenticated;

-- 3. What an AP holder may know about the cost of a car: ONE number, never the docket or the duty on its own.
--    fixed_myr = duty + port clearance + inland transfer (the Offer report's staff-set presets, else 2,500 and 250).
--    The app adds the car price, the agent fee & shipping and the AP's own fee. Members and partners only (staff may call it too).
create or replace function public.ap_lot_costs(p_lot_ids uuid[]) returns table (lot_id uuid, fixed_myr numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_port numeric; v_inland numeric;
begin
  if not public.tier_at_least('member') then raise exception 'Member tier needed' using errcode = '42501'; end if;
  select coalesce((select amount from public.calc_presets where preset_key = 'offer_port_myr'), 2500) into v_port;
  select coalesce((select amount from public.calc_presets where preset_key = 'offer_inland_myr'), 250) into v_inland;
  return query
    select c.lot_id, round(c.duty_myr + v_port + v_inland, 0)
    from public.lot_costs c join public.lots l on l.id = c.lot_id
    where c.lot_id = any (p_lot_ids) and c.duty_myr is not null and (l.my_eligible or public.is_staff());
end $$;
revoke all on function public.ap_lot_costs(uuid[]) from public, anon;
grant execute on function public.ap_lot_costs(uuid[]) to authenticated;

-- 3b. The yen rate for the AP's own maths: the Offer report's manual rate if staff set one, else the latest stored rate. A single number.
create or replace function public.ap_jpy_rate() returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  if not public.tier_at_least('member') then raise exception 'Member tier needed' using errcode = '42501'; end if;
  select amount into v from public.calc_presets where preset_key = 'fx_jpy_myr';
  if v is null or v <= 0 then
    select rate into v from public.currency_rates where from_currency = 'JPY' and to_currency = 'MYR' order by rate_date desc limit 1;
  end if;
  return v;
end $$;
revoke all on function public.ap_jpy_rate() from public, anon;
grant execute on function public.ap_jpy_rate() to authenticated;

-- 4. Market numbers and catalog links are member-tier data (free tier keeps Find by feature)
drop policy if exists market_stats_read on public.market_stats;
create policy market_stats_read on public.market_stats for select using (public.tier_at_least('member'));
drop policy if exists lot_catalog_read on public.lot_catalog;
create policy lot_catalog_read on public.lot_catalog for select using (public.tier_at_least('member'));

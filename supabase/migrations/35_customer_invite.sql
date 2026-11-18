-- 35: walk-in customers are created BY STAFF and invited by email (the customer does not sign up).   Run after 33. Safe to run again.
--   Staff enter the customer's email, filters and hours on the Walk-in customers page. The invite-customer function (supabase/functions/invite-customer)
--   sends the invitation email and calls attach_customer() below. The customer opens the link, chooses a password, and the viewing time starts at that first visit.

alter table public.customer_passes add column if not exists email text;
alter table public.profiles add column if not exists access_hours int;                  -- how long a customer may look, counted from the first visit

-- the old sign-up-with-a-code door is closed
drop function if exists public.redeem_customer_pass(text);

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
    or new.customer_filters is distinct from old.customer_filters
    or new.access_hours is distinct from old.access_hours) then
    raise exception 'You can only change your contact details';
  end if;
  return new;
end $$;

-- Called ONLY by the invite function (service key): turns the invited account into a customer account. The clock has not started yet.
create or replace function public.attach_customer(p_pass uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = public as $$
declare ps public.customer_passes; me public.profiles;
begin
  select * into ps from public.customer_passes where id = p_pass and not revoked;
  if ps.id is null then raise exception 'Pass not found or cancelled'; end if;
  select * into me from public.profiles where id = p_user;
  if me.id is null then raise exception 'Account not found'; end if;
  if me.role not in ('ap_holder', 'customer') or (me.role = 'ap_holder' and me.status = 'active') then raise exception 'That email already belongs to another kind of account'; end if;
  perform set_config('auction.system', 'on', true);
  update public.profiles set role = 'customer', status = 'active', customer_filters = ps.filters, access_hours = ps.hours,
    expires_at = case when me.role = 'customer' then me.expires_at else null end,
    contact_name = coalesce(nullif(contact_name, ''), ps.label), phone = coalesce(nullif(phone, ''), ps.phone), company_name = null
  where id = p_user;
  update public.customer_passes set redeemed_by = p_user, redeemed_at = coalesce(redeemed_at, now()) where id = p_pass;
end $$;
revoke all on function public.attach_customer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_customer(uuid, uuid) to service_role;

-- The customer's first visit starts the clock (once). Anything later returns the same end time.
create or replace function public.start_customer_access() returns timestamptz
language plpgsql volatile security definer set search_path = public as $$
declare me public.profiles; ends timestamptz;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role is distinct from 'customer' or me.status is distinct from 'active' then return null; end if;
  if me.expires_at is not null then return me.expires_at; end if;
  ends := now() + make_interval(hours => coalesce(me.access_hours, 48));
  perform set_config('auction.system', 'on', true);
  update public.profiles set expires_at = ends where id = auth.uid();
  perform public.notify_staff('customer_started', 'Customer started viewing: ' || coalesce(me.contact_name, me.email), 'Access until ' || to_char(ends at time zone 'Asia/Kuala_Lumpur', 'DD Mon HH24:MI') || ' (Malaysia time)', '/customers', null);
  return ends;
end $$;
revoke all on function public.start_customer_access() from public, anon;
grant execute on function public.start_customer_access() to authenticated;

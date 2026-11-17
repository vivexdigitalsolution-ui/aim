-- 29: service levels, volume rebate, and the steps after a win (payment > deregistration > shipping > delivery).
-- Run in the Japan Auction project > SQL Editor. Safe to run again. NO fee numbers are set here: staff define them in AP holders > Service levels / Volume rebate.
-- Until they do, fees work exactly as before (the dealer's own rule, else the default rule by winning price).

-- 1. Service levels: a named package with its own agent fee (e.g. Basic / Professional / Premium).
create table if not exists public.service_levels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  fee_type    text not null check (fee_type in ('flat_jpy', 'percent')),
  fee_value   numeric(12,2) not null check (fee_value >= 0),
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.service_levels enable row level security;
drop policy if exists service_levels_read on public.service_levels;
create policy service_levels_read on public.service_levels for select to authenticated using (true);
drop policy if exists service_levels_admin on public.service_levels;
create policy service_levels_admin on public.service_levels for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.service_levels to authenticated;

alter table public.profiles add column if not exists service_level_id uuid references public.service_levels(id) on delete set null;

-- 2. Volume rebate: the more cars a dealer WINS in a calendar month (Malaysia time), the bigger the discount on the agent fee of that win.
create table if not exists public.volume_rebates (
  min_units  int primary key check (min_units >= 2),   -- from this many won cars in the month (this win included)
  rebate_pct numeric(5,2) not null check (rebate_pct > 0 and rebate_pct <= 100)
);
alter table public.volume_rebates enable row level security;
drop policy if exists volume_rebates_read on public.volume_rebates;
create policy volume_rebates_read on public.volume_rebates for select to authenticated using (true);
drop policy if exists volume_rebates_admin on public.volume_rebates;
create policy volume_rebates_admin on public.volume_rebates for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.volume_rebates to authenticated;

alter table public.bids add column if not exists rebate_pct numeric(5,2);
alter table public.bids add column if not exists rebate_jpy numeric(12,0);

-- 3. The guard must know the new column: a dealer must not pick their own service level.
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
    or new.service_level_id is distinct from old.service_level_id) then
    raise exception 'You can only change your contact details';
  end if;
  return new;
end $$;

-- 4. The agent fee: (1) a rule pinned to the dealer, else (2) the dealer's service level, else (3) the default rule for the winning price.
create or replace function public.agent_fee_for(p_ap uuid, p_price numeric)
returns table (fee_type text, fee_value numeric, fee_jpy numeric)
language plpgsql stable security definer set search_path = public as $$
declare r public.fee_rules; sl public.service_levels;
begin
  select fr.* into r from public.fee_rules fr join public.profiles p on p.fee_rule_id = fr.id where p.id = p_ap and fr.active;
  if r.id is null then
    select s.* into sl from public.service_levels s join public.profiles p on p.service_level_id = s.id where p.id = p_ap and s.active;
    if sl.id is not null then
      return query select sl.fee_type, sl.fee_value, case when sl.fee_type = 'percent' then round(p_price * sl.fee_value / 100) else sl.fee_value end;
      return;
    end if;
    select * into r from public.fee_rules
      where active and is_default and min_price_jpy <= p_price and (max_price_jpy is null or p_price < max_price_jpy)
      order by min_price_jpy desc limit 1;
  end if;
  if r.id is null then return query select null::text, 0::numeric, 0::numeric; return; end if;
  return query select r.fee_type, r.fee_value, case when r.fee_type = 'percent' then round(p_price * r.fee_value / 100) else r.fee_value end;
end $$;

-- 5. Marking a bid: the win now applies the volume rebate and keeps both the fee and the rebate on the bid.
create or replace function public.staff_set_bid(p_bid uuid, p_status text, p_final numeric default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b public.bids; f record; units int; pct numeric; fee numeric;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  if p_status not in ('placed', 'won', 'lost', 'rejected', 'pending') then raise exception 'Bad status'; end if;
  select * into b from public.bids where id = p_bid;
  if b.id is null then raise exception 'Bid not found'; end if;
  if p_status = 'won' then
    if p_final is null or p_final <= 0 then raise exception 'Enter the winning price'; end if;
    select * into f from public.agent_fee_for(b.ap_id, p_final);
    select count(*) + 1 into units from public.bids
      where ap_id = b.ap_id and status = 'won' and id <> b.id and decided_at is not null
        and date_trunc('month', decided_at at time zone 'Asia/Kuala_Lumpur') = date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur');
    select rebate_pct into pct from public.volume_rebates where min_units <= units order by min_units desc limit 1;
    pct := coalesce(pct, 0);
    fee := round(coalesce(f.fee_jpy, 0) * (1 - pct / 100));
    update public.bids set status = 'won', final_price_jpy = p_final, fee_type = f.fee_type, fee_value = f.fee_value,
      agent_fee_jpy = fee, rebate_pct = nullif(pct, 0), rebate_jpy = nullif(coalesce(f.fee_jpy, 0) - fee, 0),
      team_note = coalesce(p_note, team_note), updated_at = now(), decided_at = now() where id = p_bid;
  else
    update public.bids set status = p_status, team_note = coalesce(p_note, team_note), updated_at = now(),
      decided_at = case when p_status = 'pending' then null else now() end,
      final_price_jpy = null, fee_type = null, fee_value = null, agent_fee_jpy = null, rebate_pct = null, rebate_jpy = null where id = p_bid;
  end if;
end $$;

-- 6. After a win: the steps of the order. Staff add a step; the dealer sees the timeline and gets an alert.
create table if not exists public.order_updates (
  id         uuid primary key default gen_random_uuid(),
  bid_id     uuid not null references public.bids(id) on delete cascade,
  stage      text not null check (stage in ('payment_due', 'paid', 'deregistered', 'shipped', 'arrived', 'cleared', 'delivered')),
  note       text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_order_updates_bid on public.order_updates (bid_id, created_at);
alter table public.order_updates enable row level security;
drop policy if exists order_updates_staff on public.order_updates;
create policy order_updates_staff on public.order_updates for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists order_updates_own on public.order_updates;
create policy order_updates_own on public.order_updates for select using (exists (select 1 from public.bids b where b.id = bid_id and b.ap_id = auth.uid()));
revoke all on public.order_updates from anon;
grant select, insert, update, delete on public.order_updates to authenticated;

create or replace function public.order_update_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare b public.bids; car text; label text;
begin
  select * into b from public.bids where id = new.bid_id;
  select brand || ' ' || model into car from public.lots where id = b.lot_id;
  label := case new.stage when 'payment_due' then 'Payment due' when 'paid' then 'Payment received' when 'deregistered' then 'Deregistered in Japan'
                          when 'shipped' then 'Shipped' when 'arrived' then 'Arrived in Malaysia' when 'cleared' then 'Cleared customs' else 'Delivered' end;
  insert into public.notifications (user_id, kind, title, body, link, lot_id) values (b.ap_id, 'order_stage', label || ': ' || coalesce(car, 'your car'), new.note, '/orders', b.lot_id);
  return null;
end $$;
drop trigger if exists order_update_notify_trg on public.order_updates;
create trigger order_update_notify_trg after insert on public.order_updates for each row execute function public.order_update_notify();

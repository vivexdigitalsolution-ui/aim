-- 27: alerts. An inbox for everyone (staff and dealers) + automatic alerts on bids.   Run in the Japan Auction project > SQL Editor. Safe to run again.
--   Staff:   a dealer places / changes / cancels a bid order.        (instant, by trigger)
--   Dealers: their order is placed / won / not won / rejected.        (instant, by trigger)
--   Staff:   an order is still not placed and its car closes soon.    (alerts.js, every 15 minutes)
--   Dealers: new cars that fit their buy list.                        (alerts.js, daily)
-- Email and WhatsApp copies are sent by alerts.js only when its keys are set (see docs/alerts-setup.md).

alter table public.profiles add column if not exists notify_email    boolean not null default true;
alter table public.profiles add column if not exists notify_whatsapp boolean not null default false;   -- opt-in: needs the dealer's WhatsApp number

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kind          text not null,                 -- new_bid, bid_changed, bid_cancelled, bid_placed, bid_won, bid_lost, bid_rejected, closing_soon, buy_list
  title         text not null,
  body          text,
  link          text,                          -- a page in the app, e.g. /bids
  lot_id        uuid,
  dedupe        text,                          -- one alert per key per user (the job never repeats itself)
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  emailed_at    timestamptz,
  whatsapped_at timestamptz
);
create unique index if not exists uq_notifications_dedupe on public.notifications (user_id, dedupe);   -- empty (null) keys never clash
create index if not exists idx_notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for select using (user_id = auth.uid());
drop policy if exists notifications_own_read on public.notifications;
create policy notifications_own_read on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.notifications from anon;
revoke all on public.notifications from authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;     -- a user can only mark their own alerts as read

-- which cars were already announced to a dealer as "fits your buy list" (service key only)
create table if not exists public.buy_list_seen (
  ap_id  uuid not null references public.profiles(id) on delete cascade,
  lot_id uuid not null references public.lots(id) on delete cascade,
  primary key (ap_id, lot_id)
);
alter table public.buy_list_seen enable row level security;

-- ── automatic alerts on bids ──
create or replace function public.notify_staff(p_kind text, p_title text, p_body text, p_link text, p_lot uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, title, body, link, lot_id)
  select id, p_kind, p_title, p_body, p_link, p_lot from public.profiles where role in ('admin', 'staff') and status = 'active'
$$;

create or replace function public.bids_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; car text; yen text;
begin
  select coalesce(company_name, contact_name, email, 'A dealer') into who from public.profiles where id = new.ap_id;
  select brand || ' ' || model into car from public.lots where id = new.lot_id;
  yen := 'JPY ' || to_char(new.max_bid_jpy, 'FM999,999,999');
  if tg_op = 'INSERT' then
    perform public.notify_staff('new_bid', 'New bid order: ' || coalesce(car, 'a car'), who || ' · ' || yen, '/bids', new.lot_id);
  elsif tg_op = 'UPDATE' then
    if new.status = 'pending' and old.status = 'pending' and new.max_bid_jpy is distinct from old.max_bid_jpy then
      perform public.notify_staff('bid_changed', 'Bid order changed: ' || coalesce(car, 'a car'), who || ' · now ' || yen, '/bids', new.lot_id);
    elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      perform public.notify_staff('bid_cancelled', 'Bid order cancelled: ' || coalesce(car, 'a car'), who || ' · was ' || yen, '/bids', new.lot_id);
    elsif new.status is distinct from old.status and new.status in ('placed', 'won', 'lost', 'rejected') then
      insert into public.notifications (user_id, kind, title, body, link, lot_id) values (
        new.ap_id, 'bid_' || new.status,
        case new.status when 'placed' then 'Your bid was placed' when 'won' then 'You won the car' when 'lost' then 'Not won this time' else 'Your bid was rejected' end || ': ' || coalesce(car, 'a car'),
        case new.status when 'won' then 'Winning price JPY ' || to_char(coalesce(new.final_price_jpy, 0), 'FM999,999,999') else coalesce(new.team_note, yen) end,
        '/orders', new.lot_id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists bids_notify_ins on public.bids;
create trigger bids_notify_ins after insert on public.bids for each row execute function public.bids_notify();
drop trigger if exists bids_notify_upd on public.bids;
create trigger bids_notify_upd after update on public.bids for each row execute function public.bids_notify();

-- 64: the dashboard's "Open cars" card counts bidding AND One price cars, so its line graph needs the One price count of each day too.
-- Run in the Japan Auction project > SQL Editor. Safe to run again. kpi_daily.open_cars keeps meaning the bidding cars.
alter table public.kpi_daily add column if not exists one_price_open int;

create or replace function public.record_kpi_daily() returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kuala_Lumpur')::date; n_open int; n_read int;
begin
  if auth.uid() is not null and not public.is_staff() then raise exception 'Staff only'; end if;
  select count(*), count(*) filter (where enriched_at is not null) into n_open, n_read from public.lots where bid_deadline > now() and my_eligible;
  insert into public.kpi_daily(day, open_cars, one_price_open, pending_bids, closing_24h, active_aps, read_pct, updated_at)
  values (d, n_open,
    (select count(*) from public.one_price_lots where deadline > now() or (source = 'asnet' and deadline is null)),
    (select count(*) from public.bids where status = 'pending'),
    (select count(*) from public.lots where bid_deadline > now() and bid_deadline < now() + interval '24 hours' and my_eligible
        and to_char(bid_deadline at time zone 'Asia/Tokyo', 'HH24:MI') <> '23:59'),
    (select count(*) from public.profiles where role = 'ap_holder' and status = 'active'),
    case when n_open > 0 then round(100.0 * n_read / n_open)::int end, now())
  on conflict (day) do update set open_cars = excluded.open_cars, one_price_open = excluded.one_price_open, pending_bids = excluded.pending_bids,
    closing_24h = excluded.closing_24h, active_aps = excluded.active_aps, read_pct = excluded.read_pct, updated_at = now();
end $$;
revoke all on function public.record_kpi_daily() from public, anon;
grant execute on function public.record_kpi_daily() to authenticated, service_role;

-- past days, ESTIMATED from the One price rows still saved: first seen by the end of that day and not yet ended then.
-- (Cars removed since, and offer end dates changed by a later scrape, make these approximate. From today on the count is exact.)
update public.kpi_daily k set one_price_open = (
  select count(*) from public.one_price_lots o
   where o.first_seen_at < (k.day + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
     and (o.deadline > (k.day + 1)::timestamp at time zone 'Asia/Kuala_Lumpur' or (o.source = 'asnet' and o.deadline is null)))
 where k.one_price_open is null and k.open_cars is not null and k.day < (now() at time zone 'Asia/Kuala_Lumpur')::date;

select public.record_kpi_daily();

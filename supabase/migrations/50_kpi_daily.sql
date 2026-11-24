-- 50: one row per day for the five dashboard cards, so each card can draw its small line graph.
-- Open cars, cars closing in 24 hours and the share of sheets read cannot be rebuilt for past days (cars are deleted once their auction day has passed),
-- so they are saved every day from now on. Bids waiting and active AP holders are filled back 14 days from the bids / profiles tables.
-- record_kpi_daily() is called by the daily job (step "kpi") and each time staff open the dashboard (updates today's row). Safe to run again.
create table if not exists public.kpi_daily (
  day          date primary key,                 -- Malaysia date
  open_cars    int,
  pending_bids int,
  closing_24h  int,
  active_aps   int,
  read_pct     int,
  updated_at   timestamptz not null default now()
);
alter table public.kpi_daily enable row level security;
drop policy if exists kpi_daily_staff_read on public.kpi_daily;
create policy kpi_daily_staff_read on public.kpi_daily for select to authenticated using (public.is_staff());

create or replace function public.record_kpi_daily() returns void
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Kuala_Lumpur')::date; n_open int; n_read int;
begin
  if auth.uid() is not null and not public.is_staff() then raise exception 'Staff only'; end if;
  select count(*), count(*) filter (where enriched_at is not null) into n_open, n_read from public.lots where bid_deadline > now() and my_eligible;
  insert into public.kpi_daily(day, open_cars, pending_bids, closing_24h, active_aps, read_pct, updated_at)
  values (d, n_open,
    (select count(*) from public.bids where status = 'pending'),
    (select count(*) from public.lots where bid_deadline > now() and bid_deadline < now() + interval '24 hours' and my_eligible
        and to_char(bid_deadline at time zone 'Asia/Tokyo', 'HH24:MI') <> '23:59'),
    (select count(*) from public.profiles where role = 'ap_holder' and status = 'active'),
    case when n_open > 0 then round(100.0 * n_read / n_open)::int end, now())
  on conflict (day) do update set open_cars = excluded.open_cars, pending_bids = excluded.pending_bids, closing_24h = excluded.closing_24h,
    active_aps = excluded.active_aps, read_pct = excluded.read_pct, updated_at = now();
end $$;
revoke all on function public.record_kpi_daily() from public, anon;
grant execute on function public.record_kpi_daily() to authenticated, service_role;

-- fill back the two numbers that can be rebuilt (the 13 days before today; today comes from record_kpi_daily)
insert into public.kpi_daily(day, pending_bids, active_aps)
select g::date,
  (select count(*) from public.bids b where b.created_at < (g::date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
      and (b.status = 'pending' or (b.decided_at is not null and b.decided_at >= (g::date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'))),
  (select count(*) from public.profiles p where p.role = 'ap_holder' and p.status = 'active' and p.created_at < (g::date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
from generate_series((now() at time zone 'Asia/Kuala_Lumpur')::date - 13, (now() at time zone 'Asia/Kuala_Lumpur')::date - 1, interval '1 day') g
on conflict (day) do nothing;
select public.record_kpi_daily();

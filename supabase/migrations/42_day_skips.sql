-- 42: the weekday rule is "pick the day on the USS site (it ticks that day's venues), then UNTICK these venues".
-- Replaces the table scrape_venue_days from migration 41 (that one listed the venues to tick, which was the wrong way round).
-- Run in the Japan Auction project > SQL Editor. Safe to run again.

drop table if exists public.scrape_venue_days;

create table if not exists public.scrape_day_skips (
  weekday    int  not null check (weekday between 1 and 7),     -- 1 = Monday ... 7 = Sunday (the weekday picked on the USS site)
  venue_code text not null references public.scrape_venues(code) on update cascade on delete cascade,
  primary key (weekday, venue_code)
);
-- Tuesday = Yokohama + R-Nagoya on the site; R-Nagoya is unticked (R-score cars are not imported)
insert into public.scrape_day_skips (weekday, venue_code) values (2, 'NR') on conflict do nothing;

alter table public.scrape_day_skips enable row level security;
drop policy if exists day_skips_staff on public.scrape_day_skips;
create policy day_skips_staff on public.scrape_day_skips for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.scrape_day_skips to authenticated;

-- 58: One price cars can be starred too (aim: Watchlist, lite: Favourites). The existing watchlist table points at lots(id), and a One price car lives in
--     one_price_lots, so it gets its own table with the same rules: a dealer sees and changes only their own rows, staff can read. Safe to run again.
create table if not exists public.watchlist_one_price (
  ap_id        uuid not null references public.profiles(id) on delete cascade,
  one_price_id uuid not null references public.one_price_lots(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (ap_id, one_price_id)
);
create index if not exists idx_watchlist_op on public.watchlist_one_price (one_price_id);
alter table public.watchlist_one_price enable row level security;
drop policy if exists watchlist_op_own on public.watchlist_one_price;
create policy watchlist_op_own on public.watchlist_one_price for all to authenticated
  using (ap_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'))
  with check (ap_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'));
drop policy if exists watchlist_op_staff on public.watchlist_one_price;
create policy watchlist_op_staff on public.watchlist_one_price for select to authenticated using (public.is_staff());
revoke all on public.watchlist_one_price from anon;
grant select, insert, delete on public.watchlist_one_price to authenticated;

-- 60: staff can recommend One price cars too. recommend_picks points at lots(id); a One price car lives in one_price_lots, so it gets its own table with the same rule
--     (staff only). Safe to run again.
create table if not exists public.recommend_picks_one_price (
  one_price_id uuid primary key references public.one_price_lots(id) on delete cascade,
  added_by     uuid references public.profiles(id) on delete set null,
  added_at     timestamptz not null default now(),
  note         text
);
alter table public.recommend_picks_one_price enable row level security;
drop policy if exists recommend_op_staff on public.recommend_picks_one_price;
create policy recommend_op_staff on public.recommend_picks_one_price for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.recommend_picks_one_price from anon;
grant select, insert, update, delete on public.recommend_picks_one_price to authenticated;

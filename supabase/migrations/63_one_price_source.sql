-- 63: One price cars can come from a second source whose list gives no end date. Safe to run again.
--   source     'uss' (every car so far) or 'asnet'. An ASNET car has no deadline: the ASNET scrape removes it once its list no longer has it.
-- RUN THIS BEFORE deploying the web apps that go with it: their One price lists read the new column.
alter table public.one_price_lots add column if not exists source text not null default 'uss';
create index if not exists one_price_lots_source_model_idx on public.one_price_lots (source, maker_code, car_code);

-- AP holders see the open One price cars (migration 46): an ASNET car with no end date is open too. Same age rule as before.
-- A car of the other source without a deadline stays hidden, as before.
drop policy if exists one_price_ap on public.one_price_lots;
create policy one_price_ap on public.one_price_lots for select to authenticated
  using (public.is_active_ap() and (deadline > now() or (source = 'asnet' and deadline is null)) and mfg_year is not null
         and mfg_year >= extract(year from now())::int - coalesce((select max_car_age_years from public.app_settings where id), 5));

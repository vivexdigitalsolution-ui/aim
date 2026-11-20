-- 46: AP holders can see the open One price cars (the cars page "One price" filter). Safe to run again.
-- Same age rule as the bidding cars (max_car_age_years). Staff already see every row (migration 41).
drop policy if exists one_price_ap on public.one_price_lots;
create policy one_price_ap on public.one_price_lots for select to authenticated
  using (public.is_active_ap() and deadline > now() and mfg_year is not null
         and mfg_year >= extract(year from now())::int - coalesce((select max_car_age_years from public.app_settings where id), 5));

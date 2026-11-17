-- 22: the lite app shows prices in RM for ANY active AP holder (any tier), so it needs the yen rate without the member-tier gate.
-- The rate is public information (one number); ap_lot_costs / market data stay member-tier.   Safe to run again.
create or replace function public.lite_jpy_rate() returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v numeric;
begin
  if not (public.is_staff() or public.is_active_ap()) then raise exception 'Not signed in as an active account' using errcode = '42501'; end if;
  select amount into v from public.calc_presets where preset_key = 'fx_jpy_myr';
  if v is null or v <= 0 then
    select rate into v from public.currency_rates where from_currency = 'JPY' and to_currency = 'MYR' order by rate_date desc limit 1;
  end if;
  return v;
end $$;
revoke all on function public.lite_jpy_rate() from public, anon;
grant execute on function public.lite_jpy_rate() to authenticated;

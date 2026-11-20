-- 47: the customs-docket list and duty rates for the car pages, so any active AP holder (and staff) can pick a docket and work out the duty
-- on a car themselves. Not counted against the calculator plan limit (that limit stays on the Import calculator page). Safe to run again.
create or replace function public.car_duty_reference() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f jsonb;
begin
  if not (public.is_staff() or public.is_active_ap()) then raise exception 'not allowed' using errcode = '42501'; end if;
  f := public.import_fees();
  return jsonb_build_object(
    'dockets', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from (
        select id, brand, model, cc, currency_code, bil, year, amt_12m_24m, amt_24m_36m, amt_36m_48m, amt_48m_60m, amt_60m_plus from public.custom_dockets) d),
    'rates', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
        select vehicle_type, cc_min, cc_max, multiplier, is_active from public.duty_rates) r),
    'currencies', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select code, standard_fare_myr from public.currencies) c),
    'jpy_rate', (select coalesce((select amount from public.calc_presets where preset_key = 'fx_jpy_myr' and amount > 0),
                  (select rate from public.currency_rates where from_currency = 'JPY' and to_currency = 'MYR' order by rate_date desc limit 1))),
    'port_myr', f->'effective'->'port_myr', 'inland_myr', f->'effective'->'inland_myr', 'ap_fee_myr', f->'effective'->'ap_fee_myr'
  );
end $$;
revoke all on function public.car_duty_reference() from public, anon;
grant execute on function public.car_duty_reference() to authenticated;

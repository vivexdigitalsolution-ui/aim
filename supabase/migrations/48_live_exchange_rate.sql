-- 48: the live exchange rate. Every calculation now uses the LATEST rate in currency_rates (filled every morning from CIMB by services/scraper/fx.js).
-- Before, a fixed number saved in calc_presets ('fx_jpy_myr' = 0.0270) won over the stored rate, so the maths never moved. That number is now only
-- the last-resort fallback when currency_rates has no yen row at all.   Safe to run again.

-- 1. currency_rates: one row per currency pair per day, and remember where the rate came from
alter table public.currency_rates alter column id set default gen_random_uuid();
alter table public.currency_rates add column if not exists source            text;
alter table public.currency_rates add column if not exists source_updated_at timestamptz;   -- the "Last Updated" time printed on the CIMB page
alter table public.currency_rates add column if not exists fetched_at        timestamptz default now();

delete from public.currency_rates a using public.currency_rates b
 where a.from_currency = b.from_currency and a.to_currency = b.to_currency and a.rate_date = b.rate_date and a.ctid < b.ctid;
create unique index if not exists currency_rates_day_uq on public.currency_rates(from_currency, to_currency, rate_date);

-- 2. one place that decides the yen rate: latest stored rate, else the old preset
create or replace function public.current_jpy_rate() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select rate from public.currency_rates where from_currency = 'JPY' and to_currency = 'MYR' and rate > 0 order by rate_date desc, source_updated_at desc nulls last limit 1),
    (select amount from public.calc_presets where preset_key = 'fx_jpy_myr' and amount > 0));
$$;
revoke all on function public.current_jpy_rate() from public, anon, authenticated;

-- 3. the functions the apps call
create or replace function public.ap_jpy_rate() returns numeric
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tier_at_least('member') then raise exception 'Member tier needed' using errcode = '42501'; end if;
  return public.current_jpy_rate();
end $$;
revoke all on function public.ap_jpy_rate() from public, anon;
grant execute on function public.ap_jpy_rate() to authenticated;

create or replace function public.lite_jpy_rate() returns numeric
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_staff() or public.is_active_ap()) then raise exception 'Not signed in as an active account' using errcode = '42501'; end if;
  return public.current_jpy_rate();
end $$;
revoke all on function public.lite_jpy_rate() from public, anon;
grant execute on function public.lite_jpy_rate() to authenticated;

create or replace function public.calculator_reference() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb; f jsonb;
begin
  s := public.calculator_status();
  if not coalesce((s->>'allowed')::boolean, false) then raise exception 'calculator_limit' using errcode = '42501'; end if;
  f := public.import_fees();
  return jsonb_build_object(
    'dockets', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from (
        select id, brand, model, cc, currency_code, bil, year, amt_12m_24m, amt_24m_36m, amt_36m_48m, amt_48m_60m, amt_60m_plus from public.custom_dockets) d),
    'rates', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
        select vehicle_type, cc_min, cc_max, multiplier, is_active from public.duty_rates) r),
    'currencies', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select code, standard_fare_myr from public.currencies) c),
    'jpy_rate', public.current_jpy_rate(),
    'port_myr', f->'effective'->'port_myr', 'inland_myr', f->'effective'->'inland_myr', 'ap_fee_myr', f->'effective'->'ap_fee_myr'
  );
end $$;
revoke all on function public.calculator_reference() from public, anon;
grant execute on function public.calculator_reference() to authenticated;

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
    'jpy_rate', public.current_jpy_rate(),
    'port_myr', f->'effective'->'port_myr', 'inland_myr', f->'effective'->'inland_myr', 'ap_fee_myr', f->'effective'->'ap_fee_myr'
  );
end $$;
revoke all on function public.car_duty_reference() from public, anon;
grant execute on function public.car_duty_reference() to authenticated;

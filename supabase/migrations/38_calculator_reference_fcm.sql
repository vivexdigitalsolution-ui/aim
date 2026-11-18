-- 38: calculator reference data for AP holders + Google FCM device tokens.   Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. The calculator needs the Customs docket list, duty rates and exchange rates. Staff already read them. An AP holder gets them only through
--    this function, and only while the calculator is open to their plan (calculator_status). Reading the list does not use up a calculation.
create or replace function public.calculator_reference() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb;
begin
  s := public.calculator_status();
  if not coalesce((s->>'allowed')::boolean, false) then raise exception 'calculator_limit' using errcode = '42501'; end if;
  return jsonb_build_object(
    'dockets', (select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) from (
        select id, brand, model, cc, currency_code, bil, year, amt_12m_24m, amt_24m_36m, amt_36m_48m, amt_48m_60m, amt_60m_plus from public.custom_dockets) d),
    'rates', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
        select vehicle_type, cc_min, cc_max, multiplier, is_active from public.duty_rates) r),
    'currencies', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select code, standard_fare_myr from public.currencies) c),
    'jpy_rate', (select coalesce((select amount from public.calc_presets where preset_key = 'fx_jpy_myr' and amount > 0),
                  (select rate from public.currency_rates where from_currency = 'JPY' and to_currency = 'MYR' order by rate_date desc limit 1))),
    'port_myr', coalesce((select amount from public.calc_presets where preset_key = 'offer_port_myr'), 2500),
    'inland_myr', coalesce((select amount from public.calc_presets where preset_key = 'offer_inland_myr'), 250),
    'ap_fee_myr', coalesce((select amount from public.calc_presets where preset_key = 'offer_ap_fee_myr'), 10500)
  );
end $$;
revoke all on function public.calculator_reference() from public, anon;
grant execute on function public.calculator_reference() to authenticated;

-- 2. Google FCM: one row per phone / browser the user allowed notifications on.
create table if not exists public.fcm_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  platform   text not null default 'web' check (platform in ('web', 'android', 'ios')),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists idx_fcm_user on public.fcm_tokens (user_id);
alter table public.fcm_tokens enable row level security;
revoke all on public.fcm_tokens from anon, authenticated;       -- only the functions below and the service key (the sender) touch it

create or replace function public.fcm_register(p_token text, p_platform text default 'web') returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into public.fcm_tokens (token, user_id, platform) values (p_token, auth.uid(), coalesce(p_platform, 'web'))
  on conflict (token) do update set user_id = auth.uid(), platform = excluded.platform, last_seen = now();
end $$;
create or replace function public.fcm_unregister(p_token text) returns void
language sql security definer set search_path = public as $$ delete from public.fcm_tokens where token = p_token and user_id = auth.uid() $$;
create or replace function public.fcm_device_count() returns int
language sql stable security definer set search_path = public as $$ select count(*)::int from public.fcm_tokens where user_id = auth.uid() $$;
revoke all on function public.fcm_register(text, text), public.fcm_unregister(text), public.fcm_device_count() from public, anon;
grant execute on function public.fcm_register(text, text), public.fcm_unregister(text), public.fcm_device_count() to authenticated;

-- 3. The web-push table from migration 37 is replaced by FCM (the same function covers browsers and the Android app).
drop function if exists public.push_subscribe(text, text, text);
drop function if exists public.push_unsubscribe(text);
drop function if exists public.push_device_count();
drop table if exists public.push_subscriptions;

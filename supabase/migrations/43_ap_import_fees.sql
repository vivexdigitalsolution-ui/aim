-- 43: port clearance, inland transfer and AP fee: the team sets the shared default (calc_presets, edited on My account by staff),
--     and every AP holder can keep their own figures. Safe to run again.

-- 1. one row per AP holder; an empty figure = use the shared default
create table if not exists public.ap_fee_defaults (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  port_myr   numeric(12,2) check (port_myr is null or port_myr >= 0),
  inland_myr numeric(12,2) check (inland_myr is null or inland_myr >= 0),
  ap_fee_myr numeric(12,2) check (ap_fee_myr is null or ap_fee_myr >= 0),
  updated_at timestamptz not null default now()
);
alter table public.ap_fee_defaults enable row level security;
revoke all on public.ap_fee_defaults from anon, authenticated;
grant select on public.ap_fee_defaults to authenticated;
drop policy if exists apfee_own on public.ap_fee_defaults;
create policy apfee_own on public.ap_fee_defaults for select to authenticated using (user_id = auth.uid() or public.is_staff());

-- 2. shared / own / effective figures of the signed-in user
create or replace function public.import_fees() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sp numeric; si numeric; sa numeric; m public.ap_fee_defaults;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  sp := coalesce((select amount from public.calc_presets where preset_key = 'offer_port_myr'), 2500);
  si := coalesce((select amount from public.calc_presets where preset_key = 'offer_inland_myr'), 250);
  sa := coalesce((select amount from public.calc_presets where preset_key = 'offer_ap_fee_myr'), 10500);
  select * into m from public.ap_fee_defaults where user_id = auth.uid();
  return jsonb_build_object(
    'shared', jsonb_build_object('port_myr', sp, 'inland_myr', si, 'ap_fee_myr', sa),
    'mine', jsonb_build_object('port_myr', m.port_myr, 'inland_myr', m.inland_myr, 'ap_fee_myr', m.ap_fee_myr),
    'effective', jsonb_build_object('port_myr', coalesce(m.port_myr, sp), 'inland_myr', coalesce(m.inland_myr, si), 'ap_fee_myr', coalesce(m.ap_fee_myr, sa)));
end $$;
revoke all on function public.import_fees() from public, anon;
grant execute on function public.import_fees() to authenticated;

-- 3. an AP holder saves their own figures (null = back to the shared default)
create or replace function public.save_my_import_fees(p_port numeric, p_inland numeric, p_ap_fee numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ap_holder' and p.status = 'active') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_port is null and p_inland is null and p_ap_fee is null then
    delete from public.ap_fee_defaults where user_id = auth.uid();
  else
    insert into public.ap_fee_defaults (user_id, port_myr, inland_myr, ap_fee_myr, updated_at) values (auth.uid(), p_port, p_inland, p_ap_fee, now())
    on conflict (user_id) do update set port_myr = excluded.port_myr, inland_myr = excluded.inland_myr, ap_fee_myr = excluded.ap_fee_myr, updated_at = now();
  end if;
end $$;
revoke all on function public.save_my_import_fees(numeric, numeric, numeric) from public, anon;
grant execute on function public.save_my_import_fees(numeric, numeric, numeric) to authenticated;

-- 4. the breakdown and the calculator now start from the user's own figures
create or replace function public.ap_lot_breakdown(p_lot_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.lot_costs; d public.custom_dockets; f jsonb;
begin
  if not (public.is_staff() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ap_holder' and p.status = 'active')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lots where id = p_lot_id and (my_eligible or public.is_staff())) then return null; end if;
  select * into c from public.lot_costs where lot_id = p_lot_id;
  if c.lot_id is null or c.duty_myr is null then return null; end if;
  select * into d from public.custom_dockets where id = c.docket_id;
  f := public.import_fees();
  return jsonb_build_object(
    'docket', case when d.id is null then null else jsonb_build_object('id', d.id, 'brand', d.brand, 'model', d.model, 'cc', d.cc, 'year', d.year, 'currency_code', d.currency_code,
        'amt_12m_24m', d.amt_12m_24m, 'amt_24m_36m', d.amt_24m_36m, 'amt_36m_48m', d.amt_36m_48m, 'amt_48m_60m', d.amt_48m_60m, 'amt_60m_plus', d.amt_60m_plus) end,
    'duty_myr', c.duty_myr, 'age_months', c.age_months,
    'port_myr', f->'effective'->'port_myr', 'inland_myr', f->'effective'->'inland_myr', 'ap_fee_myr', f->'effective'->'ap_fee_myr',
    'shared', f->'shared');
end $$;
revoke all on function public.ap_lot_breakdown(uuid) from public, anon;
grant execute on function public.ap_lot_breakdown(uuid) to authenticated;

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
    'jpy_rate', (select coalesce((select amount from public.calc_presets where preset_key = 'fx_jpy_myr' and amount > 0),
                  (select rate from public.currency_rates where from_currency = 'JPY' and to_currency = 'MYR' order by rate_date desc limit 1))),
    'port_myr', f->'effective'->'port_myr', 'inland_myr', f->'effective'->'inland_myr', 'ap_fee_myr', f->'effective'->'ap_fee_myr'
  );
end $$;
revoke all on function public.calculator_reference() from public, anon;
grant execute on function public.calculator_reference() to authenticated;

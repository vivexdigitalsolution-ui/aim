-- 40: the import price breakdown of a car (docket, duty, port, inland, AP fee) for every active AP holder, so the lite app can show it.   Safe to run again.
-- Margin, the Malaysian market price and the sold results stay Member-only; this is only the cost of importing the car.
create or replace function public.ap_lot_breakdown(p_lot_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.lot_costs; d public.custom_dockets;
begin
  if not (public.is_staff() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ap_holder' and p.status = 'active')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lots where id = p_lot_id and (my_eligible or public.is_staff())) then return null; end if;
  select * into c from public.lot_costs where lot_id = p_lot_id;
  if c.lot_id is null or c.duty_myr is null then return null; end if;
  select * into d from public.custom_dockets where id = c.docket_id;
  return jsonb_build_object(
    'docket', case when d.id is null then null else jsonb_build_object('id', d.id, 'brand', d.brand, 'model', d.model, 'cc', d.cc, 'year', d.year, 'currency_code', d.currency_code,
        'amt_12m_24m', d.amt_12m_24m, 'amt_24m_36m', d.amt_24m_36m, 'amt_36m_48m', d.amt_36m_48m, 'amt_48m_60m', d.amt_48m_60m, 'amt_60m_plus', d.amt_60m_plus) end,
    'duty_myr', c.duty_myr, 'age_months', c.age_months,
    'port_myr', coalesce((select amount from public.calc_presets where preset_key = 'offer_port_myr'), 2500),
    'inland_myr', coalesce((select amount from public.calc_presets where preset_key = 'offer_inland_myr'), 250),
    'ap_fee_myr', coalesce((select amount from public.calc_presets where preset_key = 'offer_ap_fee_myr'), 10500));
end $$;
revoke all on function public.ap_lot_breakdown(uuid) from public, anon;
grant execute on function public.ap_lot_breakdown(uuid) to authenticated;

-- 53: the AP holder's margin screen shows the cost in its three parts (duty, port clearance, inland transfer) instead of one mixed number.
-- ap_lot_costs() keeps fixed_myr (the sum, as before) and now also returns the three parts. The duty part is the sum minus port minus inland, so the parts always add up
-- to fixed_myr. Member tier and above only, as before. The docket itself is still never returned. Safe to run again.
drop function if exists public.ap_lot_costs(uuid[]);
create function public.ap_lot_costs(p_lot_ids uuid[]) returns table(lot_id uuid, fixed_myr numeric, duty_myr numeric, port_myr numeric, inland_myr numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_port numeric; v_inland numeric;
begin
  if not public.tier_at_least('member') then raise exception 'Member tier needed' using errcode = '42501'; end if;
  select coalesce((select amount from public.calc_presets where preset_key = 'offer_port_myr'), 2500) into v_port;
  select coalesce((select amount from public.calc_presets where preset_key = 'offer_inland_myr'), 250) into v_inland;
  return query
    select c.lot_id, round(c.duty_myr + v_port + v_inland, 0), round(c.duty_myr + v_port + v_inland, 0) - round(v_port, 0) - round(v_inland, 0), round(v_port, 0), round(v_inland, 0)
    from public.lot_costs c join public.lots l on l.id = c.lot_id
    where c.lot_id = any (p_lot_ids) and c.duty_myr is not null and (l.my_eligible or public.is_staff());
end $$;
revoke all on function public.ap_lot_costs(uuid[]) from public, anon;
grant execute on function public.ap_lot_costs(uuid[]) to authenticated;

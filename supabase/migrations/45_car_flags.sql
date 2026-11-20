-- 45: two yes/no flags per car for the cars page cards (docket found? sheet needs a human look?).
-- Run in the Japan Auction project > SQL Editor. Safe to run again.
-- Only yes/no leave the database: an AP holder never sees the docket or the duty itself.
create or replace function public.car_flags(p_lot_ids uuid[]) returns table (lot_id uuid, has_docket boolean, needs_review boolean)
language sql stable security definer set search_path = public as $$
  select l.id,
         (exists (select 1 from public.lot_costs c where c.lot_id = l.id and c.duty_myr is not null)
          or exists (select 1 from public.lot_docket_decisions d where d.lot_id = l.id and d.docket_id is not null)),
         coalesce(l.needs_review, false)
  from public.lots l
  where l.id = any (p_lot_ids) and (l.my_eligible or public.is_staff()) and (public.is_staff() or public.is_active_ap())
$$;
revoke all on function public.car_flags(uuid[]) from public, anon;
grant execute on function public.car_flags(uuid[]) to authenticated;

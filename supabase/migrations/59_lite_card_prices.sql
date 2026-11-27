-- 59: lite cars page: the import price on each card. One call for a whole page of cars (up to 60): for each car the saved duty (lot_costs) and the suggested price
--     from the sold history (recommended_bid). The page does the rest (fees, CIF, docket to pick) in the browser. Only active AP holders and staff may call it
--     (customers get "not allowed" and the page then shows no import price). Safe to run again.
create or replace function public.lite_card_prices(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb := '[]'::jsonb; i uuid; c public.lot_costs; r jsonb;
begin
  if not (public.is_staff() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ap_holder' and p.status = 'active')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) > 60 then raise exception 'too many cars at once'; end if;
  foreach i in array coalesce(p_ids, '{}'::uuid[]) loop
    select * into c from public.lot_costs where lot_id = i;
    r := public.recommended_bid(i);
    out := out || jsonb_build_array(jsonb_build_object('id', i, 'duty_myr', c.duty_myr, 'docket_id', c.docket_id, 'price_jpy', r -> 'price_jpy'));
  end loop;
  return out;
end $$;
revoke all on function public.lite_card_prices(uuid[]) from public, anon;
grant execute on function public.lite_card_prices(uuid[]) to authenticated;

-- 57: the lite app (PAW-J Partner) has its own shared default for port clearance, carrier fee and AP fee, kept apart from the AIM app's:
--     staff set them on My account in lite (calc_presets keys lite_port_myr, lite_inland_myr, lite_ap_fee_myr); when nothing is set they are 0.
--     An AP holder's own saved figures (ap_fee_defaults) still win. Same answer shape as import_fees(). Safe to run again.
create or replace function public.import_fees_lite() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sp numeric; si numeric; sa numeric; m public.ap_fee_defaults;
begin
  if auth.uid() is null then raise exception 'not allowed' using errcode = '42501'; end if;
  sp := coalesce((select amount from public.calc_presets where preset_key = 'lite_port_myr'), 0);
  si := coalesce((select amount from public.calc_presets where preset_key = 'lite_inland_myr'), 0);
  sa := coalesce((select amount from public.calc_presets where preset_key = 'lite_ap_fee_myr'), 0);
  select * into m from public.ap_fee_defaults where user_id = auth.uid();
  return jsonb_build_object(
    'shared', jsonb_build_object('port_myr', sp, 'inland_myr', si, 'ap_fee_myr', sa),
    'mine', jsonb_build_object('port_myr', m.port_myr, 'inland_myr', m.inland_myr, 'ap_fee_myr', m.ap_fee_myr),
    'effective', jsonb_build_object('port_myr', coalesce(m.port_myr, sp), 'inland_myr', coalesce(m.inland_myr, si), 'ap_fee_myr', coalesce(m.ap_fee_myr, sa)));
end $$;
revoke all on function public.import_fees_lite() from public, anon;
grant execute on function public.import_fees_lite() to authenticated;

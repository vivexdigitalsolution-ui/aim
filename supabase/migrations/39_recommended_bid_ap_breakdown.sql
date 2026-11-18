-- 39: a recommended bid for every plan, and the docket + duty lines for Member / Partner dealers.   Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. Recommended bid: the usual winning price of the same model and grade (the History price rule of packages/core historyPrice.ts), as ONE number.
--    Free dealers cannot read the sold results themselves; this gives them the one figure, nothing else.
--      same grade (e.g. 4.5A) -> the average of those sales; none -> the sales of the same main grade and the grade above, interior A or B
--      the average is rounded UP to the next ¥5,000 (auction bids move in ¥5,000 steps)
create or replace function public.recommended_bid(p_lot_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.lots; t_main text; t_letter text; up text; avgp numeric; n int; basis text;
  ladder text[] := array['3','3.5','4','4.5','5','6','S'];
begin
  if not (public.is_staff() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ap_holder' and p.status = 'active')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into l from public.lots where id = p_lot_id and (my_eligible or public.is_staff());
  if l.id is null or l.grade is null then return null; end if;
  select (regexp_match(upper(trim(l.grade)), '^(\d+(?:\.\d+)?|[A-Z]{1,2}?)\s*([A-D])?$'))[1], coalesce((regexp_match(upper(trim(l.grade)), '^(\d+(?:\.\d+)?|[A-Z]{1,2}?)\s*([A-D])?$'))[2], '') into t_main, t_letter;
  if t_main is null then return null; end if;

  -- the recent sold results of this model, with the grade split into its number and its interior letter
  with sales as (
    select m[1] as gm, coalesce(m[2], '') as gl, h.sold_price_jpy as pr
    from (select grade, sold_price_jpy from public.lot_history
          where brand = l.brand and model ilike split_part(l.model, ' ', 1) || '%' and result = 'sold' and sold_price_jpy > 0
            and (l.mfg_year is null or (mfg_year is not null and abs(mfg_year - l.mfg_year) <= 1))
          order by auction_date desc limit 500) h,
         lateral regexp_match(upper(trim(h.grade)), '^(\d+(?:\.\d+)?|[A-Z]{1,2}?)\s*([A-D])?$') m
    where m is not null)
  select avg(pr), count(*) into avgp, n from sales where gm = t_main and gl = t_letter;
  basis := t_main || t_letter;
  if n = 0 then
    up := ladder[array_position(ladder, t_main) + 1];
    with sales as (
      select m[1] as gm, coalesce(m[2], '') as gl, h.sold_price_jpy as pr
      from (select grade, sold_price_jpy from public.lot_history
            where brand = l.brand and model ilike split_part(l.model, ' ', 1) || '%' and result = 'sold' and sold_price_jpy > 0
              and (l.mfg_year is null or (mfg_year is not null and abs(mfg_year - l.mfg_year) <= 1))
            order by auction_date desc limit 500) h,
           lateral regexp_match(upper(trim(h.grade)), '^(\d+(?:\.\d+)?|[A-Z]{1,2}?)\s*([A-D])?$') m
      where m is not null)
    select avg(pr), count(*), string_agg(distinct gm || gl, ' / ') into avgp, n, basis
      from sales where (gm = t_main or gm = up) and gl in ('A', 'B') and not (gm = t_main and gl = t_letter);
  end if;
  if n = 0 or avgp is null then return null; end if;
  return jsonb_build_object('price_jpy', (ceil(avgp / 5000) * 5000)::bigint, 'sales', n, 'basis', basis);
end $$;
revoke all on function public.recommended_bid(uuid) from public, anon;
grant execute on function public.recommended_bid(uuid) to authenticated;

-- 2. For Member and Partner dealers: which docket a car uses and its duty, port and inland lines (the report shows these too).
create or replace function public.ap_lot_breakdown(p_lot_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.lot_costs; d public.custom_dockets;
begin
  if not public.tier_at_least('member') then raise exception 'Member tier needed' using errcode = '42501'; end if;
  if not exists (select 1 from public.lots where id = p_lot_id and (my_eligible or public.is_staff())) then return null; end if;
  select * into c from public.lot_costs where lot_id = p_lot_id;
  if c.lot_id is null or c.duty_myr is null then return null; end if;
  select * into d from public.custom_dockets where id = c.docket_id;
  return jsonb_build_object(
    'docket', case when d.id is null then null else jsonb_build_object('id', d.id, 'brand', d.brand, 'model', d.model, 'cc', d.cc, 'year', d.year, 'currency_code', d.currency_code,
        'amt_12m_24m', d.amt_12m_24m, 'amt_24m_36m', d.amt_24m_36m, 'amt_36m_48m', d.amt_36m_48m, 'amt_48m_60m', d.amt_48m_60m, 'amt_60m_plus', d.amt_60m_plus) end,
    'duty_myr', c.duty_myr, 'age_months', c.age_months,
    'port_myr', coalesce((select amount from public.calc_presets where preset_key = 'offer_port_myr'), 2500),
    'inland_myr', coalesce((select amount from public.calc_presets where preset_key = 'offer_inland_myr'), 250));
end $$;
revoke all on function public.ap_lot_breakdown(uuid) from public, anon;
grant execute on function public.ap_lot_breakdown(uuid) to authenticated;

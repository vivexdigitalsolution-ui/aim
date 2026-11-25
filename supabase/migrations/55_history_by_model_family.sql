-- 55: the "usual selling price" (history price) and the Recommended bid were taken from the sold results of every model whose name STARTS WITH THE SAME FIRST WORD.
-- For a GR Corolla that first word is "GR", so the GR86 (about ¥3.1M), GR Yaris (¥4.4M) and GR Corolla (¥4.9M) were averaged together: ¥3.96M instead of about ¥4.9M.
-- Now a sold result counts only when
--   * its model name starts with the car's model family (lots.model_family, the model name USS lists it under, e.g. "GR COROLLA"), and
--   * its model code is the same, when both the car and the sold result have one (GZEA14H, ignoring the "4BA-" type prefix).
-- lots.model_family is filled by the trigger from migration 54 (scraper_models.name). Safe to run again.
alter table public.lots add column if not exists model_family text;

create or replace function public.set_vehicle_type_from_model() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select m.vehicle_type into new.vehicle_type from public.scraper_models m where m.brand_code = new.maker_code and m.code = new.car_code;
  if tg_table_name = 'lots' then
    select m.name into new.model_family from public.scraper_models m where m.brand_code = new.maker_code and m.code = new.car_code;
  end if;
  return new;
end $$;

update public.lots l set model_family = m.name from public.scraper_models m where m.brand_code = l.maker_code and m.code = l.car_code and l.model_family is distinct from m.name;

create or replace function public.recommended_bid(p_lot_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.lots; t_main text; t_letter text; up text; avgp numeric; n int; basis text; fam text; lcode text;
  ladder text[] := array['3','3.5','4','4.5','5','6','S'];
begin
  if not (public.is_staff() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ap_holder' and p.status = 'active')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into l from public.lots where id = p_lot_id and (my_eligible or public.is_staff());
  if l.id is null or l.grade is null then return null; end if;
  select (regexp_match(upper(trim(l.grade)), '^(\d+(?:\.\d+)?|[A-Z]{1,2}?)\s*([A-D])?$'))[1], coalesce((regexp_match(upper(trim(l.grade)), '^(\d+(?:\.\d+)?|[A-Z]{1,2}?)\s*([A-D])?$'))[2], '') into t_main, t_letter;
  if t_main is null then return null; end if;
  fam   := coalesce(nullif(trim(l.model_family), ''), split_part(l.model, ' ', 1));
  lcode := regexp_replace(upper(coalesce(l.model_code, '')), '^[0-9A-Z]{2,4}-', '');

  -- the recent sold results of this model family (same chassis code when both have one), with the grade split into its number and its interior letter
  with sales as (
    select m[1] as gm, coalesce(m[2], '') as gl, h.sold_price_jpy as pr
    from (select grade, sold_price_jpy from public.lot_history
          where brand = l.brand and upper(model) like upper(fam) || '%' and result = 'sold' and sold_price_jpy > 0
            and (lcode = '' or coalesce(model_code, '') = '' or regexp_replace(upper(model_code), '^[0-9A-Z]{2,4}-', '') = lcode)
            and (l.mfg_year is null or (mfg_year is not null and abs(mfg_year - l.mfg_year) <= 1))
          order by auction_date desc limit 1000) h,
         lateral regexp_match(upper(trim(h.grade)), '^(\d+(?:\.\d+)?|[A-Z]{1,2}?)\s*([A-D])?$') m
    where m is not null)
  select avg(pr), count(*) into avgp, n from sales where gm = t_main and gl = t_letter;
  basis := t_main || t_letter;
  if n = 0 then
    up := ladder[array_position(ladder, t_main) + 1];
    with sales as (
      select m[1] as gm, coalesce(m[2], '') as gl, h.sold_price_jpy as pr
      from (select grade, sold_price_jpy from public.lot_history
            where brand = l.brand and upper(model) like upper(fam) || '%' and result = 'sold' and sold_price_jpy > 0
              and (lcode = '' or coalesce(model_code, '') = '' or regexp_replace(upper(model_code), '^[0-9A-Z]{2,4}-', '') = lcode)
              and (l.mfg_year is null or (mfg_year is not null and abs(mfg_year - l.mfg_year) <= 1))
            order by auction_date desc limit 1000) h,
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

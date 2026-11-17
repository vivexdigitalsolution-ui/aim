-- =============================================================================
-- Auction — 13 offer report batches
-- Every `node offer.js` run saves its recommended cars as one BATCH, kept for 10 days (offer.js removes older batches).
--   * a batch keeps its own copy of each car (lot row + duty row), so it still prints after the lot is deleted
--   * the next run never recommends a car that is already in a kept batch
--   * removing an offer model no longer removes the cars it recommended
-- offer_picks (the old "current picks") is no longer used. Run after 12.
-- =============================================================================

create table if not exists public.offer_batches (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  car_count  int not null default 0
);

create table if not exists public.offer_batch_cars (
  id          uuid primary key default gen_random_uuid(),
  batch_id    uuid not null references public.offer_batches(id) on delete cascade,
  lot_id      uuid not null,                  -- no foreign key: finished lots are deleted by housekeeping, the batch keeps its copy
  tier        text not null check (tier in ('top', 'mid')),
  model_brand text not null,
  model_name  text not null,
  model_code  text,
  docket_id   uuid,                           -- the docket staff chose for the model (null = the automatic one)
  lot         jsonb not null,                 -- the lots row as it was when recommended
  cost        jsonb,                          -- the lot_costs row (duty, docket) at that time
  unique (batch_id, lot_id)
);
create index if not exists offer_batch_cars_batch_idx on public.offer_batch_cars(batch_id);
create index if not exists offer_batch_cars_lot_idx   on public.offer_batch_cars(lot_id);

alter table public.offer_batches     enable row level security;
alter table public.offer_batch_cars  enable row level security;
drop policy if exists offerbatches_staff    on public.offer_batches;
drop policy if exists offerbatchcars_staff  on public.offer_batch_cars;
create policy offerbatches_staff   on public.offer_batches    for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy offerbatchcars_staff on public.offer_batch_cars for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.offer_batches, public.offer_batch_cars to authenticated;

-- keep the cars already recommended (offer_picks) as the first batch
do $$
declare b uuid;
begin
  if exists (select 1 from public.offer_picks) and not exists (select 1 from public.offer_batches) then
    insert into public.offer_batches (created_at, car_count)
      select min(picked_at), count(*) from public.offer_picks returning id into b;
    insert into public.offer_batch_cars (batch_id, lot_id, tier, model_brand, model_name, model_code, docket_id, lot, cost)
      select b, p.lot_id, p.tier, coalesce(m.brand_name, l.brand), coalesce(m.model_name, l.model), m.model_code, m.docket_id,
             to_jsonb(l), (select to_jsonb(c) from public.lot_costs c where c.lot_id = l.id)
        from public.offer_picks p
        join public.lots l on l.id = p.lot_id
        left join public.offer_models m on m.id = p.offer_model_id;
    update public.offer_batches set car_count = (select count(*) from public.offer_batch_cars where batch_id = b) where id = b;
  end if;
end $$;

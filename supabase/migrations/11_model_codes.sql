-- =============================================================================
-- Auction — 11 model codes per model
-- The model (chassis) codes the source site lists for each brand + model, copied from the main project's
-- reference.vehicle_model_codes_lookup (source = 'uss') by `node scripts/copy-reference.mjs --codes`.
-- Staff pick from this list in Admin › Offer report. Run after 10.
-- =============================================================================

create table if not exists public.scraper_model_codes (
  maker_code  text not null,        -- same codes as scraper_brands.code / scrape_targets.maker_code
  car_code    text not null,        -- same codes as scraper_models.code / scrape_targets.car_code
  code        text not null,        -- the model code as the site shows it, e.g. AGH40W
  brand_name  text,
  model_name  text,
  updated_at  timestamptz not null default now(),
  primary key (maker_code, car_code, code)
);
create index if not exists scraper_model_codes_model_idx on public.scraper_model_codes(maker_code, car_code);

alter table public.scraper_model_codes enable row level security;
drop policy if exists modelcodes_staff on public.scraper_model_codes;
create policy modelcodes_staff on public.scraper_model_codes for select to authenticated using (public.is_staff());
grant select on public.scraper_model_codes to authenticated;

-- =============================================================================
-- Auction — 10 offer models: model code + chosen docket
-- Each offer model can name the exact model (chassis) code, e.g. 3BA-AGH40W, and the Customs docket line to use for its duty.
-- The same brand + model may be listed twice with different codes (e.g. Alphard AGH30W and AGH40W). Run after 09.
-- =============================================================================

alter table public.offer_models add column if not exists model_code text;
alter table public.offer_models add column if not exists docket_id uuid references public.custom_dockets(id) on delete set null;

alter table public.offer_models drop constraint if exists offer_models_maker_code_car_code_key;
create unique index if not exists offer_models_unique_idx on public.offer_models (maker_code, car_code, coalesce(model_code, ''));

-- picks belong to one offer model row
alter table public.offer_picks add column if not exists offer_model_id uuid references public.offer_models(id) on delete cascade;
create index if not exists offer_picks_offer_model_idx on public.offer_picks(offer_model_id);

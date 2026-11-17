-- =============================================================================
-- Auction — 12 model code on sold history
-- The history scrape now saves each sold car's model code, so the offer report's history price can use the same model code
-- as the car (e.g. AGH40W only). Older history rows have no code until the history is scraped again. Run after 11.
-- =============================================================================
alter table public.lot_history add column if not exists model_code text;

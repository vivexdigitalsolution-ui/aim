-- 16: backup models for the offer report.
-- The daily target is 50 cars (10 models x 5). Some models have fewer than 5 usable cars today, so the models marked "backup"
-- are only used (scraped, read, picked) when the main models do not reach the target. Nothing else changes.
alter table public.offer_models add column if not exists reserve boolean not null default false;

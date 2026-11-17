-- Offer report: cars that have neither a history price nor a duty are not recommended, but they are kept in the batch
-- (held_back = true) so the report's on/off switch can show them. A held-back car does not count as "already recommended".
alter table public.offer_batch_cars add column if not exists held_back boolean not null default false;

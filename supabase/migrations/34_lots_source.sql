-- 34: where a car came from (the USS scrape or the ASNET scrape). Never shown to dealers or customers.   Run in the Japan Auction project > SQL Editor. Safe to run again.
alter table public.lots add column if not exists source text not null default 'uss';
create index if not exists idx_lots_source on public.lots (source, auction_date);

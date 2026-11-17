-- 19: how many different sellers stand behind a market row (so the app can show "12 listings from 4 dealers" and never call one dealer's list a market).
alter table public.market_stats add column if not exists sellers int not null default 1;

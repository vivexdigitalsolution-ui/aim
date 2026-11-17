-- 17: steering side of a lot, read from the auction sheet by the AI step (LHD = left-hand drive).
-- A left-hand-drive car is never recommended (app/utils/recommendRules.ts); null = not read / not shown.
alter table public.lots add column if not exists steering text check (steering in ('LHD', 'RHD'));

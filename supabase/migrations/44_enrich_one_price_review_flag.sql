-- 44: the Claude sheet read for One price cars too, and a "check the sheet" flag for cars whose sheet is handwritten or unclear.
-- Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. bidding cars: the flag and the reason shown to buyers and staff
alter table public.lots add column if not exists needs_review boolean not null default false;
alter table public.lots add column if not exists review_note  text;      -- short English reason, e.g. "Handwritten first-registration date; chassis number unclear"

-- 2. One price cars get the same read as bidding cars (same column names as lots), plus the docket and the duty (no lot_costs row: they are not in lots)
alter table public.one_price_lots add column if not exists chassis_no           text;
alter table public.one_price_lots add column if not exists first_reg_month      int;
alter table public.one_price_lots add column if not exists mfg_month            int;
alter table public.one_price_lots add column if not exists inspection_until     text;
alter table public.one_price_lots add column if not exists doors                int;
alter table public.one_price_lots add column if not exists seats                int;
alter table public.one_price_lots add column if not exists drive                text;
alter table public.one_price_lots add column if not exists fuel                 text;
alter table public.one_price_lots add column if not exists steering             text check (steering in ('LHD', 'RHD'));
alter table public.one_price_lots add column if not exists sales_points         text;
alter table public.one_price_lots add column if not exists pick_score           smallint;
alter table public.one_price_lots add column if not exists pick_reason          text;
alter table public.one_price_lots add column if not exists accident             boolean;
alter table public.one_price_lots add column if not exists inspector_report_en  text;
alter table public.one_price_lots add column if not exists features             jsonb;
alter table public.one_price_lots add column if not exists enriched_at          timestamptz;
alter table public.one_price_lots add column if not exists enrich_note          text;
alter table public.one_price_lots add column if not exists needs_review         boolean not null default false;
alter table public.one_price_lots add column if not exists review_note          text;
alter table public.one_price_lots add column if not exists docket_id            uuid references public.custom_dockets(id) on delete set null;
alter table public.one_price_lots add column if not exists docket_status        text;           -- confirmed / trusted / review / none (same words as lot_docket_decisions)
alter table public.one_price_lots add column if not exists docket_reason        text;
alter table public.one_price_lots add column if not exists age_months           int;
alter table public.one_price_lots add column if not exists duty_myr             numeric(12,2);
alter table public.one_price_lots add column if not exists duty_after_matang_myr numeric(12,2);
alter table public.one_price_lots add column if not exists matang_from          date;
create index if not exists one_price_lots_enrich_idx on public.one_price_lots (enriched_at);

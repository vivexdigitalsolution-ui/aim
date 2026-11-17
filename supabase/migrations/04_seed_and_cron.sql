-- =============================================================================
-- Auction — 04 starter data, first admin, daily housekeeping
-- =============================================================================

-- A starter agent fee (edit it in the app: Admin > Fees). RM/JPY are set by you — this is only a placeholder.
insert into public.fee_rules (name, fee_type, fee_value, is_default)
select 'Standard fee', 'flat_jpy', 50000, true
where not exists (select 1 from public.fee_rules);

-- FIRST ADMIN: sign up in the app once with your own email, then run this with that email:
--   update public.profiles set role = 'admin', status = 'active' where email = 'you@example.com';

-- DAILY HOUSEKEEPING at 03:00 Japan time (18:00 UTC). Needs the pg_cron extension:
--   Supabase dashboard > Database > Extensions > enable "pg_cron", then run:
-- select cron.schedule('auction-housekeeping', '0 18 * * *', $$ select public.housekeeping() $$);
-- To see runs:   select * from cron.job_run_details order by start_time desc limit 10;
-- To remove:     select cron.unschedule('auction-housekeeping');

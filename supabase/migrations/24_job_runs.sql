-- 24: the log of the daily automation (services/scraper/daily.js). Staff read it (System status); only the scraper PC writes it (service key).
-- Run in the Japan Auction project > SQL Editor. Safe to run again.
create table if not exists public.job_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  trigger     text not null default 'manual',            -- 'scheduled' (Task Scheduler) or 'manual'
  host        text,                                      -- which PC ran it
  steps       jsonb not null default '[]'                -- [{ name, status: ok|failed|skipped, seconds, note }]
);
create index if not exists idx_job_runs_started on public.job_runs (started_at desc);
alter table public.job_runs enable row level security;
drop policy if exists job_runs_staff on public.job_runs;
create policy job_runs_staff on public.job_runs for select using (public.is_staff());
revoke all on public.job_runs from anon;
grant select on public.job_runs to authenticated;

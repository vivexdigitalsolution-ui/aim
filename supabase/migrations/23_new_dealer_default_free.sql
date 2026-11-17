-- 23: a newly registered dealer starts on the FREE plan (migration 18 defaulted to 'member').
-- Existing profiles keep their plan. Staff choose the plan when they approve a dealer (AP holders screen).   Safe to run again.
alter table public.profiles alter column tier set default 'free';

-- PRIVACY FIX: a dealer can read their OWN profile row, and that row held the internal staff notes. Notes move to a staff-only table.
-- (profiles.notes stays as a column because the guard trigger knows it, but it is emptied and no longer used by AIM.)
create table if not exists public.ap_notes (
  ap_id      uuid primary key references public.profiles(id) on delete cascade,
  notes      text,
  updated_at timestamptz not null default now()
);
alter table public.ap_notes enable row level security;
drop policy if exists ap_notes_staff on public.ap_notes;
create policy ap_notes_staff on public.ap_notes for all using (public.is_staff()) with check (public.is_staff());
revoke all on public.ap_notes from anon;
grant select, insert, update, delete on public.ap_notes to authenticated;
insert into public.ap_notes (ap_id, notes) select id, notes from public.profiles where notes is not null and notes <> '' on conflict (ap_id) do nothing;
update public.profiles set notes = null where notes is not null;

-- 31: sourcing requests. A dealer asks "find me this car"; staff answer and mark it found or closed.   Run in the Japan Auction project > SQL Editor. Safe to run again.
--   Free dealers: 2 requests in total. Member and Partner dealers: no limit. Staff are told at once; the dealer is told when staff reply or change the status.

create table if not exists public.sourcing_requests (
  id            uuid primary key default gen_random_uuid(),
  ap_id         uuid not null references public.profiles(id) on delete cascade,
  brand         text,
  model         text not null,
  year_from     int,
  budget_myr    numeric(12,0),                        -- the most they want to pay, all in
  notes         text,
  status        text not null default 'open' check (status in ('open', 'found', 'closed')),
  staff_reply   text,                                 -- what staff tell the dealer (shown to the dealer)
  found_lot_id  uuid references public.lots(id) on delete set null,   -- the car staff found, when it is in the auction list
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_sourcing_ap on public.sourcing_requests (ap_id, created_at desc);
create index if not exists idx_sourcing_status on public.sourcing_requests (status, created_at desc);
alter table public.sourcing_requests enable row level security;

drop policy if exists sourcing_own_read on public.sourcing_requests;
create policy sourcing_own_read on public.sourcing_requests for select to authenticated using (ap_id = auth.uid());
drop policy if exists sourcing_own_insert on public.sourcing_requests;
create policy sourcing_own_insert on public.sourcing_requests for insert to authenticated
  with check (ap_id = auth.uid() and status = 'open' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.role = 'ap_holder'));
drop policy if exists sourcing_own_close on public.sourcing_requests;
create policy sourcing_own_close on public.sourcing_requests for update to authenticated using (ap_id = auth.uid()) with check (ap_id = auth.uid() and status = 'closed');
drop policy if exists sourcing_staff on public.sourcing_requests;
create policy sourcing_staff on public.sourcing_requests for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.sourcing_requests from anon;
revoke all on public.sourcing_requests from authenticated;
grant select on public.sourcing_requests to authenticated;
grant insert (ap_id, brand, model, year_from, budget_myr, notes) on public.sourcing_requests to authenticated;
grant update (status) on public.sourcing_requests to authenticated;                                     -- a dealer can only close their own (the policy allows nothing else)
grant update (staff_reply, found_lot_id) on public.sourcing_requests to authenticated;                  -- staff (the policy only lets staff in)
grant delete on public.sourcing_requests to authenticated;                                              -- the policies leave delete to staff

-- Free dealers: 2 requests in total.
create or replace function public.sourcing_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text; n int;
begin
  select tier into t from public.profiles where id = new.ap_id;
  if coalesce(t, 'free') = 'free' then
    select count(*) into n from public.sourcing_requests where ap_id = new.ap_id;
    if n >= 2 then raise exception 'The Free plan includes 2 sourcing requests. Upgrade to Member for unlimited requests.' using errcode = 'P0001'; end if;
  end if;
  return new;
end $$;
drop trigger if exists sourcing_quota_trg on public.sourcing_requests;
create trigger sourcing_quota_trg before insert on public.sourcing_requests for each row execute function public.sourcing_quota();

-- a dealer can only close their own request: the reply and the found car are staff's
create or replace function public.sourcing_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() and (new.staff_reply is distinct from old.staff_reply or new.found_lot_id is distinct from old.found_lot_id) then
    raise exception 'Only staff write the reply' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sourcing_touch_trg on public.sourcing_requests;
create trigger sourcing_touch_trg before update on public.sourcing_requests for each row execute function public.sourcing_touch();

-- Alerts: staff on a new request; the dealer when staff reply or change the status.
create or replace function public.sourcing_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; car text;
begin
  car := trim(coalesce(new.brand, '') || ' ' || new.model);
  if tg_op = 'INSERT' then
    select coalesce(company_name, contact_name, email, 'A dealer') into who from public.profiles where id = new.ap_id;
    perform public.notify_staff('sourcing_new', 'Sourcing request: ' || car, who || coalesce(' · up to RM ' || to_char(new.budget_myr, 'FM999,999,999'), ''), '/requests', null);
  elsif tg_op = 'UPDATE' and (new.status is distinct from old.status or new.staff_reply is distinct from old.staff_reply) and public.is_staff() then
    insert into public.notifications (user_id, kind, title, body, link, lot_id)
    values (new.ap_id, 'sourcing_update',
      case new.status when 'found' then 'We found a car for you: ' when 'closed' then 'Request closed: ' else 'Update on your request: ' end || car,
      new.staff_reply, '/requests', new.found_lot_id);
  end if;
  return null;
end $$;
drop trigger if exists sourcing_notify_ins on public.sourcing_requests;
create trigger sourcing_notify_ins after insert on public.sourcing_requests for each row execute function public.sourcing_notify();
drop trigger if exists sourcing_notify_upd on public.sourcing_requests;
create trigger sourcing_notify_upd after update on public.sourcing_requests for each row execute function public.sourcing_notify();

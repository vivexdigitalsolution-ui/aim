-- 32: Partner tier on sourcing requests: PRIORITY (a Partner's request goes first) and PRE-SOLD (the dealer already has a customer and commits to buy).   Run after 31. Safe to run again.

alter table public.sourcing_requests add column if not exists priority  boolean not null default false;   -- set by the system for Partner dealers, never by the dealer
alter table public.sourcing_requests add column if not exists presold   boolean not null default false;   -- the dealer has a customer waiting and commits to buy a matching car
alter table public.sourcing_requests add column if not exists needed_by date;                             -- when the customer needs the car (pre-sold requests)
grant insert (presold, needed_by) on public.sourcing_requests to authenticated;

-- one trigger on insert: Partner = priority; pre-sold is for Partners only; the Free plan limit as before
create or replace function public.sourcing_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text; n int;
begin
  select tier into t from public.profiles where id = new.ap_id;
  t := coalesce(t, 'free');
  if t = 'free' then
    select count(*) into n from public.sourcing_requests where ap_id = new.ap_id;
    if n >= 2 then raise exception 'The Free plan includes 2 sourcing requests. Upgrade to Member for unlimited requests.' using errcode = 'P0001'; end if;
  end if;
  new.priority := (t = 'partner');
  if new.presold and t <> 'partner' then raise exception 'Pre-sold requests are part of the Partner plan.' using errcode = 'P0001'; end if;
  return new;
end $$;

-- a dealer can never change priority / pre-sold after the fact (they cannot update them anyway: no column grant), and the alert tells staff
create or replace function public.sourcing_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; car text; tag text;
begin
  car := trim(coalesce(new.brand, '') || ' ' || new.model);
  if tg_op = 'INSERT' then
    select coalesce(company_name, contact_name, email, 'A dealer') into who from public.profiles where id = new.ap_id;
    tag := case when new.presold then 'PRE-SOLD ' when new.priority then 'PRIORITY ' else '' end;
    perform public.notify_staff('sourcing_new', tag || 'Sourcing request: ' || car, who || coalesce(' · up to RM ' || to_char(new.budget_myr, 'FM999,999,999'), '') || coalesce(' · needed by ' || new.needed_by, ''), '/requests', null);
  elsif tg_op = 'UPDATE' and (new.status is distinct from old.status or new.staff_reply is distinct from old.staff_reply) and public.is_staff() then
    insert into public.notifications (user_id, kind, title, body, link, lot_id)
    values (new.ap_id, 'sourcing_update',
      case new.status when 'found' then 'We found a car for you: ' when 'closed' then 'Request closed: ' else 'Update on your request: ' end || car,
      new.staff_reply, '/requests', new.found_lot_id);
  end if;
  return null;
end $$;

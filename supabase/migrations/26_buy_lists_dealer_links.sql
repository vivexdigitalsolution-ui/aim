-- 26: the dealer's buy list, and the personal "Today for you" link with tracking.   Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. What each dealer wants to buy. The dealer edits their own; staff can edit any.
create table if not exists public.buy_lists (
  ap_id          uuid primary key references public.profiles(id) on delete cascade,
  brands         text[] not null default '{}',          -- upper case as USS writes them; empty = any make
  models         text[] not null default '{}',          -- upper case text, matched against the car's model name; empty = any model
  year_from      int,                                   -- no older than this build year
  budget_myr     numeric(12,0),                         -- the most they want to put in (landed cost + recon + AP fee); null = no limit
  min_margin_pct numeric(5,1) not null default 10,      -- only cars that can make at least this much, measured on cost
  aps_left       int,                                   -- how many APs they still have this year (helps staff decide how many cars to send)
  speed          text not null default 'any' check (speed in ('fast', 'normal', 'any')),   -- how fast they want to sell on
  notes          text,
  updated_at     timestamptz not null default now()
);
alter table public.buy_lists enable row level security;
drop policy if exists buy_lists_own on public.buy_lists;
create policy buy_lists_own on public.buy_lists for all using (ap_id = auth.uid() and public.tier_at_least('member')) with check (ap_id = auth.uid() and public.tier_at_least('member'));
drop policy if exists buy_lists_staff on public.buy_lists;
create policy buy_lists_staff on public.buy_lists for all using (public.is_staff()) with check (public.is_staff());
revoke all on public.buy_lists from anon;
grant select, insert, update, delete on public.buy_lists to authenticated;

-- 2. A list staff prepared for one dealer: 3-5 cars with the figures AS THEY WERE when it was made (numbers only: no duty, no docket).
create table if not exists public.dealer_lists (
  id          uuid primary key default gen_random_uuid(),
  ap_id       uuid not null references public.profiles(id) on delete cascade,
  token       text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  message     text,
  items       jsonb not null default '[]',
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '7 days'),
  revoked     boolean not null default false
);
create index if not exists idx_dealer_lists_ap on public.dealer_lists (ap_id, created_at desc);

create table if not exists public.dealer_list_events (
  id         bigint generated always as identity primary key,
  list_id    uuid not null references public.dealer_lists(id) on delete cascade,
  event      text not null check (event in ('open', 'view_car', 'open_calc', 'bid_click', 'request_sheet')),
  lot_id     uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_dealer_list_events_list on public.dealer_list_events (list_id, created_at desc);

alter table public.dealer_lists enable row level security;
alter table public.dealer_list_events enable row level security;
drop policy if exists dealer_lists_staff on public.dealer_lists;
create policy dealer_lists_staff on public.dealer_lists for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists dealer_lists_own on public.dealer_lists;
create policy dealer_lists_own on public.dealer_lists for select using (ap_id = auth.uid());
drop policy if exists dealer_list_events_staff on public.dealer_list_events;
create policy dealer_list_events_staff on public.dealer_list_events for select using (public.is_staff());
revoke all on public.dealer_lists, public.dealer_list_events from anon;
grant select, insert, update, delete on public.dealer_lists to authenticated;
grant select on public.dealer_list_events to authenticated;

-- 3. The link opens WITHOUT a login: the long random token is the key. These two functions are the only door for a visitor.
--    The list stops working when it expires or staff revoke it; closed cars are left out.
create or replace function public.dealer_list_get(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare l public.dealer_lists; who text; items jsonb;
begin
  select * into l from public.dealer_lists where token = p_token and not revoked and expires_at > now();
  if l.id is null then return null; end if;
  insert into public.dealer_list_events (list_id, event) values (l.id, 'open');
  select coalesce(company_name, contact_name, '') into who from public.profiles where id = l.ap_id;
  select coalesce(jsonb_agg(i), '[]'::jsonb) into items
    from jsonb_array_elements(l.items) i
    where exists (select 1 from public.lots x where x.id = (i ->> 'lot_id')::uuid and x.bid_deadline > now());
  return jsonb_build_object('dealer', who, 'message', l.message, 'created_at', l.created_at, 'expires_at', l.expires_at, 'items', items);
end $$;

create or replace function public.dealer_list_event(p_token text, p_event text, p_lot uuid default null) returns void
language plpgsql volatile security definer set search_path = public as $$
declare l public.dealer_lists;
begin
  select * into l from public.dealer_lists where token = p_token and not revoked and expires_at > now();
  if l.id is null then return; end if;
  if p_event not in ('view_car', 'open_calc', 'bid_click', 'request_sheet') then return; end if;
  insert into public.dealer_list_events (list_id, event, lot_id) values (l.id, p_event, p_lot);
end $$;

revoke all on function public.dealer_list_get(text), public.dealer_list_event(text, text, uuid) from public;
grant execute on function public.dealer_list_get(text), public.dealer_list_event(text, text, uuid) to anon, authenticated;

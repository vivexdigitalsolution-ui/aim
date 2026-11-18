-- 30: sold-price history for members, buy-list segments, watchlist, auto-drafted personal lists.   Run in the Japan Auction project > SQL Editor. Safe to run again.

-- 1. HISTORY PRICE: the sold results (lot_history) are for Member and Partner dealers and staff. (The old rule needed a subscription date; that still works too.)
--    This also fixes the margin screens: a Member's usual-winning-price comes from this table and the old rule hid it from them.
drop policy if exists history_ap on public.lot_history;
create policy history_ap on public.lot_history for select to authenticated using (
  public.tier_at_least('member')
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active' and p.history_until >= current_date)
);

-- 2. SEGMENTS: groups of cars a dealer can pick on the buy list (SUV, MPV, luxury ...). Staff decide which models belong to which segment.
--    An entry is a make, plus a model name (the car's model name must contain it). An empty model = every model of that make.
create table if not exists public.segments (
  key   text primary key,
  label text not null,
  sort  int not null default 0
);
create table if not exists public.segment_models (
  id          uuid primary key default gen_random_uuid(),
  segment_key text not null references public.segments(key) on delete cascade,
  brand       text not null,                  -- upper case, as USS writes it
  model       text not null default '',       -- upper case; '' = any model of the make
  unique (segment_key, brand, model)
);
alter table public.segments enable row level security;
alter table public.segment_models enable row level security;
drop policy if exists segments_read on public.segments;
create policy segments_read on public.segments for select to authenticated using (true);
drop policy if exists segments_staff on public.segments;
create policy segments_staff on public.segments for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists segment_models_read on public.segment_models;
create policy segment_models_read on public.segment_models for select to authenticated using (true);
drop policy if exists segment_models_staff on public.segment_models;
create policy segment_models_staff on public.segment_models for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.segments, public.segment_models from anon;
grant select, insert, update, delete on public.segments, public.segment_models to authenticated;

alter table public.buy_lists add column if not exists segments text[] not null default '{}';   -- segment keys the dealer picked; works together with brands/models (either fits)

-- a starter set so the page is not empty: staff review and change it in the app (Segments page)
insert into public.segments (key, label, sort) values
  ('suv', 'SUV', 1), ('mpv', 'MPV / van', 2), ('luxury', 'Luxury', 3), ('sedan', 'Sedan', 4), ('hatchback', 'Hatchback', 5), ('sports', 'Sports', 6), ('pickup', 'Pickup', 7)
on conflict (key) do nothing;
insert into public.segment_models (segment_key, brand, model) values
  ('mpv', 'TOYOTA', 'ALPHARD'), ('mpv', 'TOYOTA', 'VELLFIRE'), ('mpv', 'TOYOTA', 'NOAH'), ('mpv', 'TOYOTA', 'VOXY'), ('mpv', 'TOYOTA', 'SIENTA'),
  ('mpv', 'HONDA', 'STEP WGN'), ('mpv', 'HONDA', 'STEPWGN'), ('mpv', 'HONDA', 'ODYSSEY'), ('mpv', 'HONDA', 'FREED'), ('mpv', 'NISSAN', 'SERENA'), ('mpv', 'NISSAN', 'ELGRAND'),
  ('suv', 'TOYOTA', 'HARRIER'), ('suv', 'TOYOTA', 'RAV4'), ('suv', 'TOYOTA', 'LAND CRUISER'), ('suv', 'TOYOTA', 'C-HR'), ('suv', 'TOYOTA', 'RAIZE'), ('suv', 'TOYOTA', 'CROWN'),
  ('suv', 'HONDA', 'VEZEL'), ('suv', 'HONDA', 'CR-V'), ('suv', 'MAZDA', 'CX-5'), ('suv', 'MAZDA', 'CX-8'), ('suv', 'MAZDA', 'CX-30'),
  ('suv', 'SUBARU', 'FORESTER'), ('suv', 'SUBARU', 'XV'), ('suv', 'NISSAN', 'X-TRAIL'), ('suv', 'MITSUBISHI', 'OUTLANDER'),
  ('luxury', 'LEXUS', ''), ('luxury', 'BMW', ''), ('luxury', 'AUDI', ''), ('luxury', 'PORSCHE', ''), ('luxury', 'MERCEDES BENZ', ''), ('luxury', 'LAND ROVER', ''),
  ('sports', 'TOYOTA', 'GR86'), ('sports', 'TOYOTA', '86'), ('sports', 'TOYOTA', 'SUPRA'), ('sports', 'NISSAN', 'GT-R'), ('sports', 'NISSAN', 'FAIRLADY'), ('sports', 'HONDA', 'S660'),
  ('pickup', 'TOYOTA', 'HILUX')
on conflict (segment_key, brand, model) do nothing;

-- 3. WATCHLIST: a dealer stars a car; alerts.js tells them when it is about to close.
create table if not exists public.watchlist (
  ap_id      uuid not null references public.profiles(id) on delete cascade,
  lot_id     uuid not null references public.lots(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (ap_id, lot_id)
);
create index if not exists idx_watchlist_lot on public.watchlist (lot_id);
alter table public.watchlist enable row level security;
drop policy if exists watchlist_own on public.watchlist;
create policy watchlist_own on public.watchlist for all to authenticated
  using (ap_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'))
  with check (ap_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active'));
drop policy if exists watchlist_staff on public.watchlist;
create policy watchlist_staff on public.watchlist for select to authenticated using (public.is_staff());
revoke all on public.watchlist from anon;
grant select, insert, delete on public.watchlist to authenticated;

-- 4. AUTO-DRAFTED PERSONAL LISTS: the daily job writes a DRAFT for each dealer. A draft has no working link and the dealer cannot see it until staff press Send.
alter table public.dealer_lists add column if not exists draft boolean not null default false;
alter table public.dealer_lists add column if not exists auto  boolean not null default false;
drop policy if exists dealer_lists_own on public.dealer_lists;
create policy dealer_lists_own on public.dealer_lists for select using (ap_id = auth.uid() and not draft);

create or replace function public.dealer_list_get(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare l public.dealer_lists; who text; items jsonb;
begin
  select * into l from public.dealer_lists where token = p_token and not revoked and not draft and expires_at > now();
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
  select * into l from public.dealer_lists where token = p_token and not revoked and not draft and expires_at > now();
  if l.id is null then return; end if;
  if p_event not in ('view_car', 'open_calc', 'bid_click', 'request_sheet') then return; end if;
  insert into public.dealer_list_events (list_id, event, lot_id) values (l.id, p_event, p_lot);
end $$;
revoke all on function public.dealer_list_get(text), public.dealer_list_event(text, text, uuid) from public;
grant execute on function public.dealer_list_get(text), public.dealer_list_event(text, text, uuid) to anon, authenticated;

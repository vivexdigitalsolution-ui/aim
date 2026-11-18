-- 36: ORDER COSTING (internal): the cost lines of each car (what your PAWJ VEHICLE COSTING sheet does), a rate card for the estimates, and the deal terms agreed with the dealer.   Run in the Japan Auction SQL Editor. Safe to run again.
--   Everything here is STAFF ONLY. A dealer or customer never sees a cost line, a rate or the profit.
--   No amounts are preset: the rate card starts empty and staff fill it (a new rate = a new line; old lines stay as history).

-- 1. the standard cost lines (names only). kind 'refundable' = lines that come back to you (SST, recycling deposit, automobile tax)
create table if not exists public.cost_items (
  key   text primary key,
  label text not null,
  kind  text not null default 'cost' check (kind in ('cost', 'refundable')),
  sort  int not null default 0
);
insert into public.cost_items (key, label, kind, sort) values
  ('auction_fee', 'Auction fee', 'cost', 10), ('land_transport', 'Land / inland transport (Japan)', 'cost', 20), ('export_handling', 'Export handling fee', 'cost', 30),
  ('customs_inspection', 'Customs inspection fee', 'cost', 40), ('inspection_attendance', 'Inspection attendance fee', 'cost', 50), ('insurance', 'Insurance', 'cost', 60),
  ('handling', 'Handling fee', 'cost', 70), ('vessel_loading', 'Vessel loading', 'cost', 80), ('radiation', 'Radiation inspection', 'cost', 90),
  ('accessories_transfer', 'Accessories transfer (Japan)', 'cost', 100), ('ocean_freight', 'Ocean freight', 'cost', 110), ('plate_postage', 'Engine no. verification / plate postage', 'cost', 120),
  ('bank_my', 'Bank charge (Malaysia)', 'cost', 130), ('bank_jp', 'Bank charge (Japan)', 'cost', 140), ('document', 'Document cost', 'cost', 150), ('relisting', 'Relisting fee', 'cost', 160),
  ('sst', 'SST paid (refundable)', 'refundable', 200), ('recycling', 'Recycling deposit (refundable)', 'refundable', 210), ('auto_tax', 'Automobile tax (refundable)', 'refundable', 220)
on conflict (key) do nothing;

-- 2. the rate card: what a cost line normally costs, by party and (for transport) by venue. The newest line that has started wins.
create table if not exists public.rate_card (
  id          uuid primary key default gen_random_uuid(),
  item_key    text not null references public.cost_items(key) on delete cascade,
  party       text,                                  -- the forwarder / transport company / insurer
  venue       text,                                  -- as the car list names it ('Yokohama'); empty = every venue
  amount_jpy  numeric(12,0) not null check (amount_jpy >= 0),
  valid_from  date not null default current_date,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists idx_rate_card_item on public.rate_card (item_key, valid_from desc);

-- 3. the cost lines of one order. amount = what you pay, refundable = the part that comes back. 'estimate' until the real invoice is in, then 'confirmed'.
create table if not exists public.order_costs (
  id             uuid primary key default gen_random_uuid(),
  bid_id         uuid not null references public.bids(id) on delete cascade,
  item_key       text references public.cost_items(key) on delete set null,
  label          text not null,
  amount_jpy     numeric(12,0) not null default 0,
  refundable_jpy numeric(12,0) not null default 0,
  status         text not null default 'estimate' check (status in ('estimate', 'confirmed')),
  party          text,
  note           text,
  updated_at     timestamptz not null default now()
);
create index if not exists idx_order_costs_bid on public.order_costs (bid_id);

-- 4. the deal agreed with the dealer
--    bid_plus_fixed: the dealer's amount is for BIDDING; you add a fixed freight + insurance charge in the invoice.
--    cif:            the dealer's amount is ALL IN (freight and insurance included): the invoice is that amount.
--    show_won_price: false = the dealer did not ask to see the winning price: the invoice uses their amount even if you won lower, and the difference is yours (you may give a little back).
alter table public.bids add column if not exists deal_basis      text not null default 'bid_plus_fixed' check (deal_basis in ('bid_plus_fixed', 'cif'));
alter table public.bids add column if not exists offer_jpy       numeric(12,0);
alter table public.bids add column if not exists fixed_charge_jpy numeric(12,0);
alter table public.bids add column if not exists show_won_price  boolean not null default true;
alter table public.bids add column if not exists giveback_jpy    numeric(12,0) not null default 0 check (giveback_jpy >= 0);

-- staff only (the dealer's own bid row stays readable to them, but these three tables hold the internal numbers)
alter table public.cost_items enable row level security;
alter table public.rate_card enable row level security;
alter table public.order_costs enable row level security;
drop policy if exists cost_items_staff on public.cost_items;
create policy cost_items_staff on public.cost_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists rate_card_staff on public.rate_card;
create policy rate_card_staff on public.rate_card for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists order_costs_staff on public.order_costs;
create policy order_costs_staff on public.order_costs for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.cost_items, public.rate_card, public.order_costs from anon;
grant select, insert, update, delete on public.cost_items, public.rate_card, public.order_costs to authenticated;

-- a dealer must never be able to set their own deal terms through the bid row (bids are written by staff and by place_bid / cancel_bid only; this is a second lock)
create or replace function public.bids_deal_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_staff() then return new; end if;
  if tg_op = 'INSERT' then
    if new.deal_basis <> 'bid_plus_fixed' or new.offer_jpy is not null or new.fixed_charge_jpy is not null or new.show_won_price is not true or new.giveback_jpy <> 0 then
      raise exception 'Only staff set the deal terms' using errcode = '42501';
    end if;
  elsif new.deal_basis is distinct from old.deal_basis or new.offer_jpy is distinct from old.offer_jpy or new.fixed_charge_jpy is distinct from old.fixed_charge_jpy
     or new.show_won_price is distinct from old.show_won_price or new.giveback_jpy is distinct from old.giveback_jpy then
    raise exception 'Only staff set the deal terms' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists bids_deal_guard_trg on public.bids;
create trigger bids_deal_guard_trg before insert or update on public.bids for each row execute function public.bids_deal_guard();

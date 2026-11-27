-- 61: the marketing poster of a car (PAW-J Partner car page, staff only): what staff key in is kept per car so it can be opened again.
--     Market price, Posting price, WhatsApp / phone number, Selling point note, show the footer or not, and which slide (A customer / B broker).
--     The row belongs to the car: it points at lots(id) or one_price_lots(id) with ON DELETE CASCADE, so when housekeeping deletes the car (lots after their auction date,
--     the same for One price cars) the poster details go with it. Nothing is left behind. Staff only. Safe to run again.
create table if not exists public.lot_posters (
  id               uuid primary key default gen_random_uuid(),
  lot_id           uuid unique references public.lots(id) on delete cascade,
  one_price_id     uuid unique references public.one_price_lots(id) on delete cascade,
  kind             text not null default 'b2c' check (kind in ('b2c', 'b2b')),
  market_price_myr numeric,
  posting_price_myr numeric,
  phone            text,
  selling_note     text,
  show_footer      boolean not null default true,
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now(),
  check ((lot_id is not null)::int + (one_price_id is not null)::int = 1)
);
alter table public.lot_posters enable row level security;
drop policy if exists lot_posters_staff on public.lot_posters;
create policy lot_posters_staff on public.lot_posters for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.lot_posters from anon;
grant select, insert, update, delete on public.lot_posters to authenticated;

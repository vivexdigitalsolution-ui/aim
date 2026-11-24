-- 52: the CIF table now has two columns: CIF (Bidding) = the amounts of the table, CIF (One Price) = the bidding CIF plus a fixed extra (¥50,000 to start with,
-- changeable on the CIF rates page). The car-price (RM) column is gone, so the note about the exchange rate goes too. Safe to run again.
alter table public.cif_settings add column if not exists one_price_extra_jpy numeric not null default 50000 check (one_price_extra_jpy >= 0);
update public.cif_settings
   set notes = btrim(regexp_replace(notes, E'(^|\n)[^\n]*exchange rate[^\n]*', '', 'gi'), E'\n')
 where notes ~* 'exchange rate';

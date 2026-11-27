-- 62: the poster keeps two more things the user keys in: the colour (the sheet's colour is often Japanese, so the user can write it in English) and the chassis number.
--     Run after 61. Safe to run again.
alter table public.lot_posters add column if not exists colour  text;
alter table public.lot_posters add column if not exists chassis text;

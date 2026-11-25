-- 54: the vehicle type of a model (Saloon = 'car', everything else = 'non_car') decides the duty rate. Until now every car was worked out as a saloon, so a Jimny,
-- an Alphard or a Hilux got the saloon rate (150.25% up to 1,800 cc) instead of the non-saloon rate (135.95%).
--   scraper_models.vehicle_type   the type of each USS model (default 'car'); vehicle_type_by = 'auto' (first guess from the name below) or 'staff' (corrected by a person)
--   lots / one_price_lots .vehicle_type   copied from the model, by a trigger, when a car is saved
-- Staff correct a model on the car page (Vehicle type box in the import price); the change is kept for every car of that model.
-- After changing types run `node recalc-duty.js` (services/scraper) so the saved duty of the open cars follows. Safe to run again.
alter table public.scraper_models add column if not exists vehicle_type    text not null default 'car' check (vehicle_type in ('car', 'non_car'));
alter table public.scraper_models add column if not exists vehicle_type_by text;
alter table public.lots           add column if not exists vehicle_type    text check (vehicle_type in ('car', 'non_car'));
alter table public.one_price_lots add column if not exists vehicle_type    text check (vehicle_type in ('car', 'non_car'));

-- first guess: models that are MPV / SUV / 4WD / pick-up / van by name. Never overwrites a type a person set. Check the list on the car pages and correct what is wrong.
update public.scraper_models set vehicle_type = 'non_car', vehicle_type_by = 'auto'
 where vehicle_type_by is null and vehicle_type = 'car'
   and upper(name) ~ '\m(JIMNY|LAND CRUISER|PRADO|RAV4|HARRIER|C-HR|CH-R|YARIS CROSS|COROLLA CROSS|RAIZE|ROCKY|ALPHARD|VELLFIRE|NOAH|VOXY|ESQUIRE|SIENTA|ROOMY|TANK|HIACE|COASTER|HILUX|TOWNACE|LITEACE|PROBOX|SUCCEED|DYNA|TOYOACE|CAMROAD|GRANACE|FJ CRUISER|4RUNNER|TUNDRA|TACOMA|SEQUOIA|KLUGER|HIGHLANDER|VENZA|BZ4X|WISH|ISIS|ESTIMA|PREVIA|NX|RX|UX|LX|GX|LM|SERENA|ELGRAND|X-TRAIL|KICKS|JUKE|PATROL|TERRA|NAVARA|CARAVAN|NV[0-9]+|FREED|STEPWGN|STEP WGN|ODYSSEY|VEZEL|HR-V|CR-V|ZR-V|PILOT|ELYSION|CROSSROAD|N-VAN|ACTY|CX-3|CX-30|CX-5|CX-60|CX-8|CX-80|CX-9|MX-30|BONGO|FORESTER|XV|CROSSTREK|OUTBACK|ASCENT|EXIGA|SAMBAR|PAJERO|DELICA|OUTLANDER|ECLIPSE CROSS|EK CROSS|MINICAB|XBEE|EVERY|CARRY|VITARA|ESCUDO|S-CROSS|APV|HIJET|ATRAI|ROCKY|TAFT|TERIOS|ROCKY|WRANGLER|GRAND CHEROKEE|CHEROKEE|COMPASS|RENEGADE|GLADIATOR|DEFENDER|DISCOVERY|RANGE ROVER|VELAR|EVOQUE|G-CLASS|G CLASS|GLA|GLB|GLC|GLE|GLS|V-CLASS|V CLASS|VITO|SPRINTER|X1|X2|X3|X4|X5|X6|X7|IX|Q2|Q3|Q4|Q5|Q7|Q8|E-TRON|CAYENNE|MACAN|URUS|BENTAYGA|CULLINAN|DBX|PUROSANGUE|TUCSON|SANTA FE|PALISADE|KONA|CAYENNE|T-ROC|TIGUAN|TOUAREG|TAYRON|CADDY|TRANSPORTER|MULTIVAN|SORENTO|SPORTAGE|CARNIVAL|STONIC|SELTOS|TRAILBLAZER|EXPLORER|EXPEDITION|BRONCO|RANGER|ESCAPE|F-150|SILVERADO|TAHOE|SUBURBAN|YUKON|ESCALADE|NAVIGATOR)\M'
   and upper(name) !~ 'RX-[0-9]';      -- Mazda RX-7 / RX-8 are coupes, not the Lexus RX
update public.scraper_models set vehicle_type = 'non_car', vehicle_type_by = 'auto'      -- added after the first check: names that say it, and models the list missed
 where vehicle_type_by is null and vehicle_type = 'car'
   and (upper(name) ~ '\m(STEPWAGON|LBX|LIFE STEP VAN)\M' or upper(name) ~ '\m(SUV|AIRCROSS|CROSSOVER[0-9]*)\M')
   and upper(name) !~ 'RX-[0-9]';

-- the trigger: every car saved or re-pointed to another model takes the model's type
create or replace function public.set_vehicle_type_from_model() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select m.vehicle_type into new.vehicle_type from public.scraper_models m where m.brand_code = new.maker_code and m.code = new.car_code;
  return new;
end $$;
drop trigger if exists lots_vehicle_type on public.lots;
create trigger lots_vehicle_type before insert or update of maker_code, car_code on public.lots for each row execute function public.set_vehicle_type_from_model();
drop trigger if exists one_price_lots_vehicle_type on public.one_price_lots;
create trigger one_price_lots_vehicle_type before insert or update of maker_code, car_code on public.one_price_lots for each row execute function public.set_vehicle_type_from_model();

-- a model's type changed: every car of that model follows
create or replace function public.model_vehicle_type_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.lots           set vehicle_type = new.vehicle_type where maker_code = new.brand_code and car_code = new.code and vehicle_type is distinct from new.vehicle_type;
  update public.one_price_lots set vehicle_type = new.vehicle_type where maker_code = new.brand_code and car_code = new.code and vehicle_type is distinct from new.vehicle_type;
  return new;
end $$;
drop trigger if exists scraper_models_vehicle_type on public.scraper_models;
create trigger scraper_models_vehicle_type after update of vehicle_type on public.scraper_models for each row execute function public.model_vehicle_type_changed();

-- fill the cars already saved
update public.lots l           set vehicle_type = m.vehicle_type from public.scraper_models m where m.brand_code = l.maker_code and m.code = l.car_code and l.vehicle_type is distinct from m.vehicle_type;
update public.one_price_lots l set vehicle_type = m.vehicle_type from public.scraper_models m where m.brand_code = l.maker_code and m.code = l.car_code and l.vehicle_type is distinct from m.vehicle_type;

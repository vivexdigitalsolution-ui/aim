-- Run this in the CarzNexus CORE (v3) Supabase project: Dashboard > SQL Editor. Safe to run again.
-- Adds to the private schema "aim" (the same one as aim.market_source):
--   * aim.catalog_variants : brand > model > model code > variant, one row per variant (ids, names, cc, seats, fuel, gearbox, years)
--   * aim.catalog_aliases  : other spellings of a variant (vehicle_variants_lookup, e.g. "2.5S Type Gold 3")
--   * aim.market_source    : live used cars in MYR with their catalog links (brand_id / model_id / variant_id)
-- Only catalog names and listing specs. No seller names, contacts, supplier or trade prices. aim_readonly still cannot write.

drop view if exists aim.catalog_variants;
create view aim.catalog_variants as
  select b.id as brand_id, b.name as brand, b.name_ja as brand_ja,
         m.id as model_id, m.name as model, m.name_ja as model_ja, m.series, m.start_year as model_from, m.end_year as model_to,
         c.code as model_code,
         v.id as variant_id, v.name as variant, v.name_ja as variant_ja,
         v.engine_cc, v.seats, v.fuel_type_code as fuel, v.transmission_code as gearbox, v.drive_type_code as drive,
         v.start_year as variant_from, v.end_year as variant_to
  from reference.vehicle_variants v
  join reference.vehicle_models m on m.id = v.model_id
  join reference.vehicle_brands b on b.id = m.brand_id
  left join reference.vehicle_model_codes c on c.id = v.model_code_id
  where v.is_active and m.is_active;

create or replace view aim.catalog_aliases as
  select variant_id, lookup_name as name, language, source
  from reference.vehicle_variants_lookup
  where variant_id is not null and is_active;

drop view if exists aim.market_source;
create view aim.market_source as
  select brand_name, model_name, variant_name, manufacture_year, asking_price, mileage, seller_tenant_id,
         engine_cc, seats, fuel_type, transmission, body_type, variant_id, model_id, brand_id,
         coalesce(published_at, created_at) as listed_at      -- when it went on sale: gives days on market
  from marketplace.listings
  where status = 'active' and condition in ('used', 'recon') and currency_code = 'MYR' and asking_price > 0;

revoke all on aim.catalog_variants, aim.catalog_aliases, aim.market_source from public, anon, authenticated;
grant select on aim.catalog_variants, aim.catalog_aliases, aim.market_source to aim_readonly;

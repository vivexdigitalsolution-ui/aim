-- Run this ONCE in the CarzNexus Supabase project (the one that holds marketplace.listings): Dashboard > SQL Editor.
-- It creates a database user that can read ONLY the 9 columns the market snapshot needs, and only active listings.
-- It cannot write anything and cannot see seller names, contact details, supplier or trade prices, photos or descriptions.
-- Replace CHOOSE-A-LONG-RANDOM-PASSWORD before running. Keep that password out of chat; it only goes into services/scraper/.env.

create role aim_readonly login password 'CHOOSE-A-LONG-RANDOM-PASSWORD' nobypassrls;
grant usage on schema marketplace to aim_readonly;

grant select (status, condition, currency_code, brand_name, model_name, manufacture_year, asking_price, mileage, seller_tenant_id)
  on marketplace.listings to aim_readonly;

-- listings has row level security: this user sees only live listings
drop policy if exists aim_readonly_select on marketplace.listings;
create policy aim_readonly_select on marketplace.listings for select to aim_readonly using (status = 'active');

-- Connection string for CARZNEXUS_DB_URL (Dashboard > Project settings > Database > Connection string > Session pooler):
--   postgresql://aim_readonly.<PROJECT-REF>:<PASSWORD>@<pooler-host>:5432/postgres
-- (with the pooler the user name is aim_readonly.<project ref>)
--
-- To remove it later:  drop policy aim_readonly_select on marketplace.listings;  drop owned by aim_readonly;  drop role aim_readonly;

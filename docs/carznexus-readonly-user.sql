-- Run this in the CarzNexus Supabase project (the one that holds marketplace.listings): Dashboard > SQL Editor.
-- The user aim_readonly (created earlier) can read ONLY one view: aim.market_source.
-- The view holds 6 columns of live used cars priced in MYR: make, model, year, asking price, mileage, seller id (used only to count sellers).
-- No seller names, contacts, supplier or trade prices, photos or descriptions. The user cannot write anything.
-- If the user does not exist yet, first run:
--   create role aim_readonly login password 'CHOOSE-A-LONG-PASSWORD-LETTERS-AND-NUMBERS-ONLY' nobypassrls;

create schema if not exists aim;                      -- a private schema: the Supabase API does not expose it

create or replace view aim.market_source as
  select brand_name, model_name, manufacture_year, asking_price, mileage, seller_tenant_id
  from marketplace.listings
  where status = 'active' and condition in ('used', 'recon') and currency_code = 'MYR' and asking_price > 0;

revoke all on aim.market_source from public, anon, authenticated;
grant usage on schema aim to aim_readonly;
grant select on aim.market_source to aim_readonly;

-- remove the direct access given by the first version of this file (if it was run)
drop policy if exists aim_readonly_select on marketplace.listings;
revoke all on marketplace.listings from aim_readonly;
revoke usage on schema marketplace from aim_readonly;

-- Connection string for CARZNEXUS_DB_URL (Session pooler): postgresql://aim_readonly.<PROJECT-REF>:<PASSWORD>@<pooler-host>:5432/postgres
-- To remove everything later:  drop view aim.market_source;  drop schema aim;  drop owned by aim_readonly;  drop role aim_readonly;

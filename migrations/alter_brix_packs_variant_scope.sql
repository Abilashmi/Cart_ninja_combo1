-- BRIX Packs — add product-level variant coverage (pack_type / variant_scope /
-- allowed_variant_ids_json) to an EXISTING brix_packs table.
--
-- Safe to run any number of times against a live table:
--   - Every new column is nullable or has a default, so no existing row can
--     violate a NOT NULL constraint on insert.
--   - No column is dropped, renamed or narrowed. `variant_id` keeps its exact
--     old meaning (the Pack's anchor/base-price variant) and its existing
--     UNIQUE KEY (shop_domain, product_id, variant_id) is left untouched, so
--     no existing Pack row can disappear or be merged with another.
--   - The UPDATE below only touches rows that don't have pack_type/variant_scope
--     set yet, so it's idempotent.
--
-- Not run automatically — see CLAUDE.md "BRIX Packs" and the redesign report
-- for why. Run this once against the brix_packs database before relying on
-- pack_type / variant_scope / allowed_variant_ids_json in the app:
--
--   mysql -u <user> -p <database> < migrations/alter_brix_packs_variant_scope.sql
--
-- (or paste the statements into whatever MySQL client/host panel you use for
-- the shared cart_drawer_ninja database).

ALTER TABLE brix_packs
  ADD COLUMN IF NOT EXISTS pack_type VARCHAR(20) NOT NULL DEFAULT 'same_variant' AFTER template,
  ADD COLUMN IF NOT EXISTS variant_scope VARCHAR(20) NOT NULL DEFAULT 'selected' AFTER pack_type,
  ADD COLUMN IF NOT EXISTS allowed_variant_ids_json LONGTEXT NULL AFTER variant_scope;

-- Backfill existing rows: every pre-existing Pack represented exactly one
-- product + one variant, so normalize that into the new model as
-- pack_type='same_variant', variant_scope='selected', with the existing
-- variant_id preserved as the (only) allowed variant. `template='choose_each_item'`
-- rows (the in-progress "Mix & Match" WIP) become pack_type='mix_match'.
UPDATE brix_packs
SET
  pack_type = CASE WHEN template = 'choose_each_item' THEN 'mix_match' ELSE 'same_variant' END,
  variant_scope = 'selected',
  allowed_variant_ids_json = JSON_ARRAY(variant_id)
WHERE allowed_variant_ids_json IS NULL;

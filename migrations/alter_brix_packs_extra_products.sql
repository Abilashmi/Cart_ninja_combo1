-- BRIX Packs — let a Mix & Match Pack include OTHER products, and choose the
-- product pages it is shown on, on an EXISTING brix_packs table.
--
--   extra_products_json  [{ productId, handle, title, image, variantScope, allowedVariantIds }]  (max 6)
--   show_on_json         [productId, ...]   extra product pages the Pack is shown on
--   show_on_ids          ",123,456,"        the same ids, so packs_storefront.php can match a page with a plain LIKE
--   product_handle       the main product's handle: on an extra page the widget loads it from /products/<handle>.js
--
-- Safe to run any number of times against a live table: every column is nullable, nothing is
-- dropped, renamed or narrowed, and the UNIQUE KEY (shop_domain, product_id, variant_id) is
-- untouched (product_id / variant_id stay the Pack's main product). Packs that don't use the
-- feature never write these columns, so they keep saving even before this migration is run.
--
-- Not run automatically. Run once against the brix_packs database:
--   mysql -u <user> -p <database> < migrations/alter_brix_packs_extra_products.sql

ALTER TABLE brix_packs
  ADD COLUMN IF NOT EXISTS extra_products_json LONGTEXT NULL AFTER allowed_variant_ids_json,
  ADD COLUMN IF NOT EXISTS show_on_json TEXT NULL AFTER extra_products_json,
  ADD COLUMN IF NOT EXISTS show_on_ids VARCHAR(2000) NULL AFTER show_on_json,
  ADD COLUMN IF NOT EXISTS product_handle VARCHAR(255) NULL AFTER show_on_ids;

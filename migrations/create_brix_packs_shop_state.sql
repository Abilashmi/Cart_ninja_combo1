-- BRIX Packs: the last checkout-discount verification per shop.
--
-- Written by the Node app (saveStorefrontDiscountState in
-- app/services/packs.server.js) whenever it verifies the "BRIX Packs"
-- automatic discount with Shopify (Pack save / status change / Packs admin
-- page load). Read by php_backend/packs_storefront.php, which has no Shopify
-- access, to decide whether shoppers may see a Pack's savings.
--
-- verified_packs_json: {"<pack id>": <version>} for the Packs whose current
-- version was confirmed in the Function config. A Pack saved after the last
-- verification is hidden until Node verifies again.
--
-- Safe to run more than once. Run it on the cart_drawer_ninja database:
--   mysql -u <user> -p <database> < migrations/create_brix_packs_shop_state.sql

CREATE TABLE IF NOT EXISTS brix_packs_shop_state (
  shop_domain VARCHAR(255) NOT NULL,
  discount_verified TINYINT(1) NOT NULL DEFAULT 0,
  discount_state VARCHAR(32) NOT NULL DEFAULT 'unknown',
  discount_message VARCHAR(255) NOT NULL DEFAULT '',
  verified_packs_json LONGTEXT NULL,
  checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (shop_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

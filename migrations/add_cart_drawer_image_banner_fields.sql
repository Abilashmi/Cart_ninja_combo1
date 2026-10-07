-- Migration: Cart Image Banner fields on cart_drawer_config (BRIX Cart Drawer).
-- Documented here for reference: both app/services/cart-config-writes.server.js
-- (ensureBannerColumns, on save) and php_backend/save_cart_drawer.php
-- (ensureBannerColumns, on the storefront GET) self-heal this schema, so running
-- this by hand is optional. Uses IF NOT EXISTS, so it is safe to re-run.
--
-- banner_desktop_image / banner_mobile_image hold an https image link or an
-- image uploaded in the Cart Editor (a browser-compressed data URL, up to
-- ~700 KB of text). The storefront never downloads that data inside the drawer
-- settings: save_cart_drawer.php sends a cart_banner_image.php link instead.

ALTER TABLE cart_drawer_config
  ADD COLUMN IF NOT EXISTS banner_enabled       TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS banner_desktop_image MEDIUMTEXT   NULL,
  ADD COLUMN IF NOT EXISTS banner_mobile_image  MEDIUMTEXT   NULL,
  ADD COLUMN IF NOT EXISTS banner_placement     VARCHAR(20)  NOT NULL DEFAULT 'above_progress',
  ADD COLUMN IF NOT EXISTS banner_alt           VARCHAR(160) NULL;

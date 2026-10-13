-- Migration: Cart Drawer upsell colours (Add button, product title, price)
-- Documented here for reference — app/services/cart-config-writes.server.js
-- (ensureUpsellColorColumns) self-heals this schema on first write, so running
-- this by hand is optional. The storefront reads the same values from
-- cart_drawer.upsell_data. button_follow_checkout = 1 keeps the Add button in
-- the checkout button's colours (what every drawer did before).

ALTER TABLE upsell_widget_settings
  ADD COLUMN IF NOT EXISTS button_follow_checkout TINYINT(1)  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS product_title_color    VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS price_color            VARCHAR(20) NULL;

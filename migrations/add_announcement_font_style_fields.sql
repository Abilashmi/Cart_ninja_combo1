-- Migration: add bold/italic/alignment style fields to cart_drawer_config's announcement columns
-- Documented here for reference — both save_cart_drawer.php (ensureAnnouncementStyleColumns)
-- and app/routes/api.cart-drawer-config.jsx (ensureAnnouncementStyleColumns) self-heal this
-- schema on first write/read, so running this by hand is optional.
-- Columns use IF NOT EXISTS to be safe to re-run.

ALTER TABLE cart_drawer_config
  ADD COLUMN IF NOT EXISTS announcement_bold       TINYINT(1)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS announcement_italic     TINYINT(1)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS announcement_text_align VARCHAR(10) NOT NULL DEFAULT 'center';

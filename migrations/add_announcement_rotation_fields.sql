-- Migration: rotating announcement bar (several messages, auto-rotate, side arrows)
-- Documented here for reference — both save_cart_drawer.php (ensureAnnouncementStyleColumns)
-- and app/services/cart-config-writes.server.js (ensureAnnouncementRotationColumns) self-heal
-- this schema on first write/read, so running this by hand is optional.
-- announcement_text stays the first message, for older readers.

ALTER TABLE cart_drawer_config
  ADD COLUMN IF NOT EXISTS announcement_messages    TEXT             NULL,
  ADD COLUMN IF NOT EXISTS announcement_auto_rotate TINYINT(1)       NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS announcement_interval    TINYINT UNSIGNED NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS announcement_show_arrows TINYINT(1)       NOT NULL DEFAULT 1;

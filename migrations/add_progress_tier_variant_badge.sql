-- Migration: Progress Bar reward products — chosen variant per product and the
-- gift row's badge text.
-- Documented here for reference — app/services/cart-config-writes.server.js
-- (ensureRewardVariantColumns) self-heals this schema on first write, so
-- running this by hand is optional. The storefront reads the same values from
-- cart_drawer.progress_data (tiers[].rewardVariants / rewardBadgeLabel).
-- reward_variants: JSON { "gid://shopify/Product/1": "gid://shopify/ProductVariant/2" };
-- a product not listed gets its first in-stock variant. reward_badge_label:
-- NULL = the drawer's own FREE / REWARD text.

ALTER TABLE progress_bar_tiers
  ADD COLUMN IF NOT EXISTS reward_variants    TEXT        NULL,
  ADD COLUMN IF NOT EXISTS reward_badge_label VARCHAR(30) NULL;

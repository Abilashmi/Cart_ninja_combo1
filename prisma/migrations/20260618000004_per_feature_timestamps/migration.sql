-- Add individual last-change timestamps per feature to cart_drawer.
-- Previously one shared updated_at made it impossible to tell which
-- feature (progress bar, coupon slider, upsell) was last modified.
--
-- ON DUPLICATE KEY UPDATE uses IF(VALUES(x) IS NOT NULL, NOW(), x)
-- so each column only advances when that feature's data is actually provided.

ALTER TABLE `cart_drawer`
  ADD COLUMN `progress_updated_at` DATETIME(3) NULL DEFAULT NULL AFTER `progress_status`,
  ADD COLUMN `coupon_updated_at`   DATETIME(3) NULL DEFAULT NULL AFTER `coupon_status`,
  ADD COLUMN `upsell_updated_at`   DATETIME(3) NULL DEFAULT NULL AFTER `upsell_status`;

-- Backfill existing rows so no column stays NULL
UPDATE `cart_drawer` SET
  progress_updated_at = updated_at,
  coupon_updated_at   = updated_at,
  upsell_updated_at   = updated_at
WHERE progress_updated_at IS NULL;

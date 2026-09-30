-- Coupon Banner "+ Custom Coupon": codes created outside BRIX (Shopify admin,
-- Shiprocket, other apps) that the merchant wants to show in the banner.
--
-- JSON list: [{"code":"SHIPROCKET10","type":"custom","source":"external","createdAt":"..."}]
-- BRIX only stores and displays these codes; it never creates or changes the
-- discount behind them.
--
-- The app adds this column itself on first use (ensureCustomCouponsColumn in
-- app/services/coupon-banner.server.js), so running this by hand is optional.
-- Nullable with no default, so existing rows and every existing save path are
-- unaffected. Safe to run more than once on MySQL 8 / MariaDB 10.0.2+.

ALTER TABLE coupon_slider_settings
  ADD COLUMN IF NOT EXISTS custom_coupons LONGTEXT NULL;

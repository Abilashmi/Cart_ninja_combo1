// Idempotent DDL for the analytics overhaul. Mirrors the existing
// `ensureStoreOrderEventsTable` convention (webhooks.orders.paid.jsx) rather
// than adding Prisma models, to avoid resurrecting the orphaned-model problem
// documented in prisma/migrations/20260618000003_create_combo_forge_tables.
let ensured = false;

export async function ensureAnalyticsTables(db) {
  if (ensured) return;

  await db.execute(`
    CREATE TABLE IF NOT EXISTS store_orders (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain        VARCHAR(255) NOT NULL,
      order_id           VARCHAR(64)  NOT NULL,
      order_number       VARCHAR(64)  NULL,
      financial_status   VARCHAR(32)  NOT NULL DEFAULT 'pending',
      fulfillment_status VARCHAR(32)  NULL,
      currency           VARCHAR(10)  NOT NULL DEFAULT 'USD',
      subtotal_price     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      total_discounts    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      total_tax          DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      total_price        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      cancelled_at       DATETIME NULL,
      refunded_amount    DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      is_test            TINYINT(1) NOT NULL DEFAULT 0,
      created_at_shopify DATETIME NOT NULL,
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_shop_order (shop_domain, order_id),
      INDEX idx_shop_created (shop_domain, created_at_shopify),
      INDEX idx_shop_status (shop_domain, financial_status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS store_order_line_items (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain        VARCHAR(255) NOT NULL,
      order_id           VARCHAR(64)  NOT NULL,
      line_item_id       VARCHAR(64)  NOT NULL,
      product_id         VARCHAR(64)  NULL,
      variant_id         VARCHAR(64)  NULL,
      product_title      VARCHAR(500) NOT NULL DEFAULT '',
      sku                VARCHAR(255) NULL,
      quantity           INT NOT NULL DEFAULT 0,
      price              DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      total_discount     DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      line_revenue       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at_shopify DATETIME NOT NULL,
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_line_item (shop_domain, order_id, line_item_id),
      INDEX idx_shop_product (shop_domain, product_id),
      INDEX idx_shop_created (shop_domain, created_at_shopify)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS product_collection_cache (
      id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain      VARCHAR(255) NOT NULL,
      product_id       VARCHAR(64) NOT NULL,
      collection_id    VARCHAR(64) NOT NULL,
      collection_title VARCHAR(255) NOT NULL DEFAULT '',
      refreshed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_product_collection (shop_domain, product_id, collection_id),
      INDEX idx_shop_product (shop_domain, product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS store_order_line_item_collections (
      id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain      VARCHAR(255) NOT NULL,
      line_item_id     VARCHAR(64) NOT NULL,
      collection_id    VARCHAR(64) NOT NULL,
      collection_title VARCHAR(255) NOT NULL DEFAULT '',
      created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_line_collection (shop_domain, line_item_id, collection_id),
      INDEX idx_shop_collection (shop_domain, collection_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS cart_activity_events (
      id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain        VARCHAR(255) NOT NULL,
      cart_token         VARCHAR(255) NOT NULL,
      event_type         ENUM('create','update') NOT NULL,
      item_count         INT NOT NULL DEFAULT 0,
      total_price        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      currency           VARCHAR(10) NULL,
      created_at_shopify DATETIME NULL,
      created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_shop_token (shop_domain, cart_token),
      INDEX idx_shop_created (shop_domain, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS analytics_sessions (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain    VARCHAR(255) NOT NULL,
      session_id     VARCHAR(255) NOT NULL,
      page_type      VARCHAR(50)  NULL,
      first_seen_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      pageview_count INT NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_shop_session (shop_domain, session_id),
      INDEX idx_shop_last_seen (shop_domain, last_seen_at),
      INDEX idx_shop_first_seen (shop_domain, first_seen_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS app_usage_events (
      id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain  VARCHAR(255) NOT NULL,
      feature      VARCHAR(100) NOT NULL,
      action       VARCHAR(100) NOT NULL,
      metadata     JSON NULL,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_shop_feature (shop_domain, feature),
      INDEX idx_shop_created (shop_domain, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS analytics_daily_rollup (
      id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain          VARCHAR(255) NOT NULL,
      date                 DATE NOT NULL,
      revenue              DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      order_count          INT NOT NULL DEFAULT 0,
      upsell_revenue       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      coupon_applied_count INT NOT NULL DEFAULT 0,
      checkout_click_count INT NOT NULL DEFAULT 0,
      coupon_click_count   INT NOT NULL DEFAULT 0,
      upsell_click_count   INT NOT NULL DEFAULT 0,
      bundle_revenue       DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      bundle_order_count   INT NOT NULL DEFAULT 0,
      visitor_count        INT NOT NULL DEFAULT 0,
      cart_create_count    INT NOT NULL DEFAULT 0,
      cart_update_count    INT NOT NULL DEFAULT 0,
      updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_shop_date (shop_domain, date),
      INDEX idx_shop_date (shop_domain, date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS analytics_insights_cache (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain   VARCHAR(255) NOT NULL,
      period_key    VARCHAR(50) NOT NULL,
      insights_json LONGTEXT NOT NULL,
      model         VARCHAR(100) NOT NULL DEFAULT '',
      generated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_shop_period (shop_domain, period_key),
      INDEX idx_shop_generated (shop_domain, generated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensureDiscountCodeColumn(db);
  await ensureBillableOrderColumns(db);

  ensured = true;
}

async function ensureDiscountCodeColumn(db) {
  const [rows] = await db.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'combo_analytics' AND COLUMN_NAME = 'discount_code'`
  );
  if (Number(rows?.[0]?.n || 0) === 0) {
    await db.execute(
      `ALTER TABLE combo_analytics ADD COLUMN discount_code VARCHAR(100) NULL AFTER template_id`
    );
  }
}

// Distinguishes orders billed toward the plan's order cap (placed while the
// cart drawer was enabled) from the store's total order count, which stays
// unfiltered for the merchant's own analytics dashboard. `is_billable` is
// set once, at orders/paid time (see webhooks.orders.paid.jsx), from
// cart_drawer.cartStatus at that moment — never recomputed retroactively,
// since there's no history of past cartStatus values to reconstruct it from.
async function ensureBillableOrderColumns(db) {
  const [orderCols] = await db.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'store_orders' AND COLUMN_NAME = 'is_billable'`
  );
  if (Number(orderCols?.[0]?.n || 0) === 0) {
    await db.execute(
      `ALTER TABLE store_orders ADD COLUMN is_billable TINYINT(1) NOT NULL DEFAULT 0 AFTER is_test`
    );
  }

  const [rollupCols] = await db.execute(
    `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'analytics_daily_rollup' AND COLUMN_NAME = 'billable_order_count'`
  );
  if (Number(rollupCols?.[0]?.n || 0) === 0) {
    await db.execute(
      `ALTER TABLE analytics_daily_rollup ADD COLUMN billable_order_count INT NOT NULL DEFAULT 0 AFTER order_count`
    );
  }
}

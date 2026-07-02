// Idempotent DDL for the pricing-plan/feature-gating system. Mirrors the
// `ensureAnalyticsTables` convention (app/services/analytics-schema.server.js)
// rather than adding Prisma models.
let ensured = false;

export async function ensurePlanTables(db) {
  if (ensured) return;

  // shops.plan_key / pending_plan_key — add if missing (shops table is
  // created elsewhere, see php_backend/create_shops_table.php).
  const [cols] = await db.execute('SHOW COLUMNS FROM shops');
  const existing = cols.map((c) => c.Field);
  const alterations = [];
  if (!existing.includes('plan_key')) {
    alterations.push("ADD COLUMN `plan_key` VARCHAR(20) NOT NULL DEFAULT 'free'");
  }
  if (!existing.includes('pending_plan_key')) {
    alterations.push('ADD COLUMN `pending_plan_key` VARCHAR(20) NULL DEFAULT NULL');
  }
  if (alterations.length > 0) {
    await db.execute(`ALTER TABLE shops ${alterations.join(', ')}`);
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS order_overage_charges (
      id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain              VARCHAR(255) NOT NULL,
      date                     DATE NOT NULL,
      plan_key                 VARCHAR(20) NOT NULL,
      order_count              INT NOT NULL DEFAULT 0,
      order_cap                INT NULL,
      overage_orders           INT NOT NULL DEFAULT 0,
      overage_rate             DECIMAL(6,4) NOT NULL DEFAULT 0.0000,
      charge_amount            DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status                   VARCHAR(20) NOT NULL DEFAULT 'pending',
      shopify_usage_record_id  VARCHAR(255) NULL,
      error_message            VARCHAR(500) NULL,
      created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_shop_date (shop_domain, date),
      INDEX idx_shop (shop_domain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_brix_credit_usage (
      id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      shop_domain   VARCHAR(255) NOT NULL,
      period_key    VARCHAR(7) NOT NULL,
      credits_used  INT NOT NULL DEFAULT 0,
      updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_shop_period (shop_domain, period_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  ensured = true;
}

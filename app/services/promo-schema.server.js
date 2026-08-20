// Idempotent DDL for merchant promo-code eligibility. Mirrors the
// `ensurePlanTables` convention (app/services/plan-schema.server.js).
let ensured = false;

export async function ensurePromoTables(db) {
  if (ensured) return;

  const [cols] = await db.execute('SHOW COLUMNS FROM shops');
  const existing = cols.map((c) => c.Field);
  const alterations = [];
  if (!existing.includes('promo_eligible')) {
    alterations.push('ADD COLUMN `promo_eligible` TINYINT(1) NOT NULL DEFAULT 0');
  }
  if (!existing.includes('promo_code_used')) {
    alterations.push('ADD COLUMN `promo_code_used` VARCHAR(64) NULL DEFAULT NULL');
  }
  if (alterations.length > 0) {
    await db.execute(`ALTER TABLE shops ${alterations.join(', ')}`);
  }

  await db.execute(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      code        VARCHAR(64) NOT NULL,
      max_uses    INT NULL DEFAULT NULL,
      uses_count  INT NOT NULL DEFAULT 0,
      expires_at  DATETIME NULL DEFAULT NULL,
      is_active   TINYINT(1) NOT NULL DEFAULT 1,
      created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  ensured = true;
}

import { getDb } from './db.server';

// Per-shop integration switches, managed from the PHP backend's internal
// integrations_admin.php page (table: shop_integrations — see
// php_backend/shop_integrations.php, which is the same lookup the storefront
// cart drawer config uses).
//
// Storefront read path: never throws. A missing table (admin page never
// opened yet) or a DB hiccup reads as "off", so checkout keeps its default
// Shopify behavior.
export async function isShiprocketEnabled(shop) {
  if (!shop) return false;
  try {
    const [rows] = await getDb().execute(
      'SELECT shiprocket_enabled FROM shop_integrations WHERE shop = ? LIMIT 1',
      [String(shop).toLowerCase()],
    );
    return Number(rows?.[0]?.shiprocket_enabled) === 1;
  } catch {
    return false;
  }
}

// The merchant's own choice (Cart Editor → Checkout Button → "Checkout
// opens"): the same switch the internal integrations_admin.php page flips.
// Creates the table like shop_integrations.php does. Throws on a DB error so
// the editor can say the save failed.
export async function setShiprocketEnabled(shop, enabled) {
  const db = getDb();
  await db.execute(`CREATE TABLE IF NOT EXISTS shop_integrations (
    shop VARCHAR(255) NOT NULL,
    shiprocket_enabled TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (shop)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.execute(
    'INSERT INTO shop_integrations (shop, shiprocket_enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE shiprocket_enabled = VALUES(shiprocket_enabled)',
    [String(shop).toLowerCase(), enabled ? 1 : 0],
  );
  return enabled;
}

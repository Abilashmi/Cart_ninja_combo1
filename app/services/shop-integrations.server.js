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

/**
 * Which features are switched on, for the switches on the Home page cards.
 * Each one is read from where that feature keeps its own on/off:
 *   cart   = the drawer switch (legacy cart_drawer.cartStatus, as the Cart Editor reads it)
 *   combo  = at least one active combo template
 *   cod    = COD on, on at least one place (cart drawer, product page, combo page)
 *   packs  = at least one active Pack
 *   fbt    = fbt_widget_settings.is_enabled
 *   coupon = the Coupon Banner's switch (coupon_slider_settings.is_enabled)
 * Never throws: a source that fails or takes too long is null (shown as off).
 */
import { getDb } from './db.server';
import { fetchCartDrawerRecord, truthyFlag } from './cart-drawer-record.server';
import { getCodSettings } from './cod.server';
import { listActivePacks } from './packs.server';

const TIME_LIMIT_MS = 3000;

function settle(promise) {
  let timer;
  return Promise.race([
    Promise.resolve().then(() => promise).catch(() => null),
    new Promise((resolve) => { timer = setTimeout(() => resolve(null), TIME_LIMIT_MS); }),
  ]).finally(() => clearTimeout(timer));
}

async function firstRow(sql, params) {
  const [rows] = await getDb().execute(sql, params);
  return Array.isArray(rows) ? rows[0] || null : null;
}

export async function loadModuleStatus(shop, sources = {}) {
  const {
    cartRecord = fetchCartDrawerRecord,
    codSettings = getCodSettings,
    activePacks = listActivePacks,
    query = firstRow,
  } = sources;
  const [cart, combo, cod, packs, fbt, coupon] = await Promise.all([
    settle((async () => {
      const record = await cartRecord(shop);
      // No saved record = the Cart Editor's own default (on).
      return record ? truthyFlag(record.cartStatus ?? record.cart_status) : true;
    })()),
    settle((async () => {
      const row = await query('SELECT COUNT(*) AS n FROM combo_templates WHERE shop_domain = ? AND is_active = 1', [shop]);
      return Number(row?.n) > 0;
    })()),
    settle((async () => {
      const s = await codSettings(shop);
      const places = s?.surfaces || {};
      return Boolean(s?.enabled) && Boolean(places.drawer || places.product || places.combo);
    })()),
    settle((async () => (await activePacks(shop)).length > 0)()),
    settle((async () => {
      const row = await query('SELECT is_enabled FROM fbt_widget_settings WHERE shop_domain = ? LIMIT 1', [shop]);
      return row ? truthyFlag(row.is_enabled) : false;
    })()),
    settle((async () => {
      const row = await query('SELECT is_enabled FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1', [shop]);
      return row ? truthyFlag(row.is_enabled) : false;
    })()),
  ]);
  return { cart, combo, cod, packs, fbt, coupon };
}

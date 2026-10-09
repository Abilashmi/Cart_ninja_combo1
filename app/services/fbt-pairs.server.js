/**
 * Automatic FBT pairs: for each product, the products to offer with it when
 * the merchant has no rule for it. Stored in config_v2.pairs
 * ({ "<product id>": [{ id, handle, title, image, source }] }) by the FBT
 * page's "Build pairs now"; the storefront filters them by the merchant's
 * chosen sources (config_v2.sources).
 *
 * Sources so far:
 *   orders - products bought in the same order (store_order_line_items,
 *            filled by the orders webhooks), most-bought-together first.
 */
import { getDb } from './db.server';
import { fetchCatalogForAiFbt, fetchCoPurchaseMap } from './cart-config-writes.server';
import { numericId, LIMITS } from '../utils/fbt-core.shared.js';

export async function buildFbtPairs(admin, shop) {
  const per = LIMITS.pairsPerProduct;
  const [catalog, coPurchase] = await Promise.all([fetchCatalogForAiFbt(admin), fetchCoPurchaseMap(getDb(), shop, per)]);
  const byId = new Map(catalog.map((p) => [p.numericId, p]));
  const pairs = {};
  for (const [trigger, list] of coPurchase) {
    const tid = numericId(trigger);
    if (!tid || !byId.has(tid)) continue;
    const items = [];
    for (const { id } of list) {
      const p = byId.get(numericId(id));
      if (!p || p.numericId === tid || items.some((x) => x.id === p.numericId)) continue;
      items.push({ id: p.numericId, handle: p.handle, title: p.title, image: p.image || undefined, source: 'orders' });
    }
    if (items.length) pairs[tid] = items.slice(0, per);
  }
  return {
    pairs,
    productsWithPairs: Object.keys(pairs).length,
    productsChecked: catalog.length,
    truncated: catalog.length >= 300,
  };
}

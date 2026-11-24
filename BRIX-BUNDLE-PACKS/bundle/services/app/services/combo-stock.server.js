// How many of each variant can be bought, so the combo page never lets a
// shopper put more in the box than Shopify will sell (the checkout then
// drops or cuts the extra). Only variants Shopify tracks and that stop
// selling at 0 get a number; everything else stays unlimited. A separate,
// optional query: if Shopify refuses it (scope) or fails, the page loads
// exactly as before, just without the limits.
import { adminGraphql, mapLimit } from './admin-graphql.server';

/** Every variant id on the page (no repeats). */
export function pageVariantIds(productsByHandle) {
  const ids = new Set();
  Object.values(productsByHandle).forEach((list) => list.forEach((p) => (p.variants || []).forEach((v) => { if (v.id) ids.add(v.id); })));
  return [...ids];
}

/**
 * { variantId: stock | null } (null = unlimited) for the given variants, 100
 * per query, a few queries at once. Throws when Shopify refuses or fails.
 */
export async function loadVariantStock(admin, ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
  const stock = {};
  await mapLimit(chunks, 3, async (chunk) => {
    const data = await adminGraphql(admin, `#graphql
      query ComboVariantStock($ids: [ID!]!) {
        nodes(ids: $ids) { ... on ProductVariant { id inventoryQuantity inventoryPolicy inventoryItem { tracked } } }
      }`, { ids: chunk });
    (data.nodes || []).forEach((n) => {
      if (!n?.id) return;
      const limited = n.inventoryItem?.tracked && n.inventoryPolicy === 'DENY' && Number.isFinite(Number(n.inventoryQuantity));
      stock[n.id] = limited ? Math.max(0, Number(n.inventoryQuantity)) : null;
    });
  });
  return stock;
}

/** Puts loadVariantStock's numbers on the page's variants (unknown = unlimited). */
export function applyVariantStock(productsByHandle, stock) {
  Object.values(productsByHandle).forEach((list) => list.forEach((p) => (p.variants || []).forEach((v) => {
    v.stock = typeof stock[v.id] === 'number' ? stock[v.id] : null;
  })));
}

export async function attachVariantStock(admin, productsByHandle) {
  let stock;
  try {
    stock = await loadVariantStock(admin, pageVariantIds(productsByHandle));
  } catch (e) {
    console.warn('[ComboPage] stock limits skipped:', e.message);
    return;
  }
  applyVariantStock(productsByHandle, stock);
}

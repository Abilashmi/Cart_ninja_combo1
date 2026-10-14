// How many of each variant can be bought, so the combo page never lets a
// shopper put more in the box than Shopify will sell (the checkout then
// drops or cuts the extra). Only variants Shopify tracks and that stop
// selling at 0 get a number; everything else stays unlimited. A separate,
// optional query: if Shopify refuses it (scope) or fails, the page loads
// exactly as before, just without the limits.
export async function attachVariantStock(admin, productsByHandle) {
  const variants = [];
  Object.values(productsByHandle).forEach((list) => list.forEach((p) => (p.variants || []).forEach((v) => variants.push(v))));
  const ids = [...new Set(variants.map((v) => v.id).filter(Boolean))];
  const byId = new Map();
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const res = await admin.graphql(`#graphql
        query ComboVariantStock($ids: [ID!]!) {
          nodes(ids: $ids) { ... on ProductVariant { id inventoryQuantity inventoryPolicy inventoryItem { tracked } } }
        }`, { variables: { ids: ids.slice(i, i + 100) } });
      const json = await res.json();
      if (json.errors?.length) throw new Error(JSON.stringify(json.errors).slice(0, 200));
      (json.data?.nodes || []).forEach((n) => { if (n?.id) byId.set(n.id, n); });
    }
  } catch (e) {
    console.warn('[ComboPage] stock limits skipped:', e.message);
    return;
  }
  variants.forEach((v) => {
    const n = byId.get(v.id);
    const limited = n && n.inventoryItem?.tracked && n.inventoryPolicy === 'DENY' && Number.isFinite(Number(n.inventoryQuantity));
    v.stock = limited ? Math.max(0, Number(n.inventoryQuantity)) : null;
  });
}

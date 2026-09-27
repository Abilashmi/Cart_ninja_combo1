// Pure ranking logic behind the FBT admin page's "AI Coverage Run" (Configure
// AI / Regenerate Suggestions) — factored out of
// app/services/cart-config-writes.server.js's generateAiFbtRules so the
// actual decision logic (what pairs with what, and when to give up rather
// than guess) can be unit-tested without a live MySQL pool or Shopify Admin
// GraphQL client. No LLM involved anywhere in this file: rankings come from
// real co-purchase counts (store_order_line_items, via fetchCoPurchaseMap in
// the server file) with a same-productType fallback for products with no
// purchase history yet. A product with neither signal gets no rule at all —
// never an invented, unrelated pairing.

export function toFbtOfferShape(p) {
  return { id: p.gid, title: p.title, handle: p.handle, image: p.image, price: p.price };
}

// catalog: [{ gid, numericId, title, handle, productType, image, price }]
// coPurchaseMap: Map<numericId, Array<{ id: numericId, cnt }>> (already
// sorted/capped to countPerProduct by the caller — see fetchCoPurchaseMap)
// Returns { rules, covered } where rules is one entry per product that got
// at least one offer: { name, trigger_products: [offer-shaped trigger],
// fbt_products: [offer-shaped...] }.
export function buildAiFbtRules(catalog, coPurchaseMap, countPerProduct) {
  const n = Math.max(1, Math.min(10, Number(countPerProduct) || 3));

  const byNumericId = new Map(catalog.map((p) => [p.numericId, p]));
  const byProductType = new Map();
  for (const p of catalog) {
    if (!p.productType) continue;
    const list = byProductType.get(p.productType) || [];
    list.push(p);
    byProductType.set(p.productType, list);
  }

  const rules = [];
  let covered = 0;

  for (const product of catalog) {
    const offers = [];
    const usedIds = new Set([product.numericId]);

    for (const co of (coPurchaseMap.get(product.numericId) || [])) {
      if (offers.length >= n) break;
      const match = byNumericId.get(co.id);
      if (match && !usedIds.has(match.numericId)) {
        offers.push(toFbtOfferShape(match));
        usedIds.add(match.numericId);
      }
    }

    if (offers.length < n && product.productType) {
      const sameType = (byProductType.get(product.productType) || [])
        .filter((p) => !usedIds.has(p.numericId))
        .sort((a, b) => Math.abs(Number(a.price) - Number(product.price)) - Math.abs(Number(b.price) - Number(product.price)));
      for (const p of sameType) {
        if (offers.length >= n) break;
        offers.push(toFbtOfferShape(p));
        usedIds.add(p.numericId);
      }
    }

    if (!offers.length) continue;

    covered++;
    rules.push({
      name: `AI: ${product.title}`,
      trigger_products: [toFbtOfferShape(product)],
      fbt_products: offers,
    });
  }

  return { rules, covered };
}

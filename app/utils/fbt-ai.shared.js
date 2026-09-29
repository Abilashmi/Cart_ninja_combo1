// Pure ranking logic behind both FBT's "AI Coverage Run" (Configure AI /
// Regenerate Suggestions) and the Upsell widget's "AI Recommendations" —
// factored out of app/services/cart-config-writes.server.js's
// computeAiPairingRules so the actual decision logic (what pairs with what,
// and when to give up rather than guess) can be unit-tested without a live
// MySQL pool or Shopify Admin GraphQL client. No LLM involved anywhere in
// this file: rankings come from real co-purchase counts
// (store_order_line_items, via fetchCoPurchaseMap in the server file) with a
// same-productType fallback for products with no purchase history yet. A
// product with neither signal gets no rule at all — never an invented,
// unrelated pairing.

export function toFbtOfferShape(p) {
  return { id: p.gid, title: p.title, handle: p.handle, image: p.image, price: p.price };
}

// catalog: [{ gid, numericId, title, handle, productType, collectionIds,
// image, price }]
// coPurchaseMap: Map<numericId, Array<{ id: numericId, cnt }>> (already
// sorted/capped to countPerProduct by the caller — see fetchCoPurchaseMap)
// Returns { rules, covered } where rules is one entry per product that got
// at least one offer: { name, trigger_products: [offer-shaped trigger],
// fbt_products: [offer-shaped...] }.
//
// Ranking order, each one only filling in whatever slots the previous tier
// left empty:
//   1. Real co-purchase history — the actual gold-standard "frequently
//      bought together" signal.
//   2. Same Product Type.
//   3. Shares at least one Collection, ranked by how many it shares (then
//      price proximity as a tiebreak) — added because Product Type is very
//      commonly left blank (an easy field to skip filling in) while
//      Collections are the grouping merchants actually maintain; without
//      this, a real catalog with blank types but real collections gets 0%
//      coverage from tier 2 alone, and the storefront widget ends up
//      completely empty even though good signal was sitting right there.
// A product with no offers from any tier gets no rule at all — never a
// pairing invented just to fill the slot; see the note in
// ai-product-knowledge.js for why that matters more than covering 100%.
export function buildAiFbtRules(catalog, coPurchaseMap, countPerProduct) {
  const n = Math.max(1, Math.min(10, Number(countPerProduct) || 3));

  const byNumericId = new Map(catalog.map((p) => [p.numericId, p]));
  const byProductType = new Map();
  const byCollectionId = new Map();
  for (const p of catalog) {
    if (p.productType) {
      const list = byProductType.get(p.productType) || [];
      list.push(p);
      byProductType.set(p.productType, list);
    }
    for (const cid of (p.collectionIds || [])) {
      const list = byCollectionId.get(cid) || [];
      list.push(p);
      byCollectionId.set(cid, list);
    }
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

    if (offers.length < n && (product.collectionIds || []).length) {
      const shareCounts = new Map();
      for (const cid of product.collectionIds) {
        for (const p of (byCollectionId.get(cid) || [])) {
          if (usedIds.has(p.numericId)) continue;
          shareCounts.set(p.numericId, (shareCounts.get(p.numericId) || 0) + 1);
        }
      }
      const sameCollection = Array.from(shareCounts.entries())
        .map(([numericId, shared]) => ({ product: byNumericId.get(numericId), shared }))
        .filter((x) => x.product)
        .sort((a, b) => b.shared - a.shared || Math.abs(Number(a.product.price) - Number(product.price)) - Math.abs(Number(b.product.price) - Number(product.price)));
      for (const { product: p } of sameCollection) {
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

// Reshapes buildAiFbtRules' generic {trigger_products, fbt_products} output
// into the Upsell widget's own manual-rule shape (the same one
// UpsellSection.jsx's manual "Add new rule" button builds by hand, and the
// same one cart_drawer_inline.js's renderUpsellSectionAsync already matches
// against cart contents) — one rule per product, aiGenerated:true so a
// later regenerate can replace only these, never a merchant's own rules.
// idPrefix lets the caller make ids deterministic in tests; defaults to a
// timestamp so real runs never collide.
export function shapeAiUpsellRules(rules, idPrefix = `ai-${Date.now()}`) {
  return rules.map((r, i) => ({
    id: `${idPrefix}-${i}`,
    aiGenerated: true,
    triggerType: 'specific',
    triggerProductCount: r.trigger_products.length,
    triggerProductIds: r.trigger_products.map((p) => p.id),
    upsellProductCount: r.fbt_products.length,
    upsellProductIds: r.fbt_products.map((p) => p.id),
    upsellProductDetails: r.fbt_products,
  }));
}

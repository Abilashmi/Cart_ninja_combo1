// Pure helpers for the Cart Editor's live preview cart (no React, so they can
// be unit-tested). The preview cart is the sample product plus whatever the
// merchant "adds" from the upsell / recommended lists; reward products of every
// Progress Bar milestone that cart reaches show up in it, exactly like the
// storefront drawer auto-adds them.

/** Milestone tiers that can actually be placed on the bar, lowest first. */
export function usableTiers(tiers) {
  return (tiers || [])
    .filter((t) => Number(t.minimumSpend) > 0)
    .slice()
    .sort((a, b) => a.minimumSpend - b.minimumSpend);
}

/**
 * The reward products currently unlocked by the preview cart.
 * `total`/`count` are the PAID cart's value and item count (rewards never count
 * toward their own milestone). A product picked for several unlocked
 * milestones is listed once, under the first one that unlocked it.
 */
export function getUnlockedRewards({ tiers, mode, total, count, allProducts = [] }) {
  const value = mode === 'count' ? count : total;
  const seen = new Set();
  const rewards = [];
  for (const tier of usableTiers(tiers)) {
    if (value < tier.minimumSpend) continue;
    const ids = Array.isArray(tier.rewardProducts) ? tier.rewardProducts : [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      rewards.push({
        key: `${tier.id}:${id}`,
        tierId: tier.id,
        productId: id,
        // null when the id isn't in the loaded catalog — the UI shows a generic gift line.
        product: allProducts.find((p) => p.id === id) || null,
        pricing: tier.rewardPricing === 'free' ? 'free' : 'regular',
      });
    }
  }
  return rewards;
}

/** Paid subtotal, item count and the amount regular-price rewards add on top. */
export function getPreviewTotals({ baseTotal, added, rewards }) {
  const paidTotal = baseTotal + added.reduce((sum, item) => sum + (Number(item.product.price) || 0), 0);
  const paidCount = 1 + added.length;
  const regularRewardTotal = rewards
    .filter((r) => r.pricing === 'regular')
    .reduce((sum, r) => sum + (Number(r.product?.price) || 0), 0);
  return { paidTotal, paidCount, regularRewardTotal, subtotal: paidTotal + regularRewardTotal };
}

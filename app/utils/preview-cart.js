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
      // null when the id isn't in the loaded catalog — the UI shows a generic gift line.
      const product = allProducts.find((p) => p.id === id) || null;
      const isFree = tier.rewardPricing === 'free';
      rewards.push({
        key: `${tier.id}:${id}`,
        tierId: tier.id,
        productId: id,
        product,
        pricing: isFree ? 'free' : 'regular',
        variant: rewardVariant(product, tier.rewardVariants?.[id]),
        badge: rewardBadgeText(tier.rewardBadgeLabel, isFree),
      });
    }
  }
  return rewards;
}

/**
 * The variant the drawer adds for a reward product (cart_drawer_inline.js
 * syncRewardProducts): the chosen one while it's in stock, else the first
 * in-stock variant, else the first. null when the product has no variants.
 */
export function rewardVariant(product, chosenId) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.find((v) => v.id === chosenId && v.available !== false)
    || variants.find((v) => v.available !== false)
    || variants[0]
    || null;
}

/**
 * The gift row's badge (cart_drawer_inline.js ccRewardBadgeText): the
 * merchant's text, else FREE GIFT / REWARD. Text saying "free" is only used
 * when the reward really is free.
 */
export function rewardBadgeText(label, isFree) {
  const fallback = isFree ? 'FREE GIFT' : 'REWARD';
  const text = String(label || '').trim().slice(0, 30);
  if (!text) return fallback;
  if (!isFree && /free/i.test(text)) return fallback;
  return text;
}

/** Paid subtotal, item count and the amount regular-price rewards add on top. */
export function getPreviewTotals({ baseTotal, added, rewards }) {
  const paidTotal = baseTotal + added.reduce((sum, item) => sum + (Number(item.product.price) || 0), 0);
  const paidCount = 1 + added.length;
  const regularRewardTotal = rewards
    .filter((r) => r.pricing === 'regular')
    .reduce((sum, r) => sum + (Number(r.variant?.price ?? r.product?.price) || 0), 0);
  return { paidTotal, paidCount, regularRewardTotal, subtotal: paidTotal + regularRewardTotal };
}

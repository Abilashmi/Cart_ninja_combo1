// BRIX free gift — checkout discount (Shopify Discount Function API,
// target cart.lines.discounts.generate.run).
//
// The cart drawer auto-adds a Progress Bar milestone's reward product with the
// line-item property `_brixReward=true`. This function makes that line free —
// but only when the cart REALLY qualifies, so a gift is never free below its
// milestone.
//
// Trust model (same as BRIX Packs): a shopper can forge the line property, so
// the property never decides WHAT is free or WHEN. Which products may be free,
// and the milestone each needs, come only from the app-owned shop metafield
// `$app:reward_gift_config`, written by the BRIX server from the merchant's
// saved Progress Bar. A forged property can at most claim a gift the merchant
// genuinely offers, and only if the cart already meets that milestone.
//
// The milestone is measured on the cart WITHOUT the gift lines, so a gift can't
// help pay for its own unlock.
//
// Config shape (see app/services/reward-gift-shopify.server.js):
//   { version: 1, currency: "USD",
//     tiers: [{ id, mode: "amount"|"count", min, productIds: ["123", ...] }] }

const NONE = { operations: [] };

function numericId(gid) {
  const match = /(\d+)$/.exec(String(gid ?? ''));
  return match ? match[1] : null;
}

/**
 * @param {object} input Function run input (see the .graphql query)
 * @returns {{ operations: object[] }}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const config = input?.shop?.metafield?.jsonValue;
  const tiers = config && typeof config === 'object' && Array.isArray(config.tiers) ? config.tiers : null;
  const lines = input?.cart?.lines;
  if (!tiers || tiers.length === 0 || !Array.isArray(lines) || lines.length === 0) return NONE;
  const classes = input?.discount?.discountClasses;
  if (Array.isArray(classes) && !classes.includes('PRODUCT')) return NONE;

  const isGift = (line) => String(line.reward?.value ?? '') === 'true';
  const paidLines = lines.filter((line) => !isGift(line));

  // Milestone value of the cart without gifts, per mode.
  let amount = 0;
  let amountCurrency = null;
  let count = 0;
  for (const line of paidLines) {
    count += Number(line.quantity) || 0;
    const subtotal = Number(line.cost?.subtotalAmount?.amount);
    if (Number.isFinite(subtotal)) {
      amount += subtotal;
      amountCurrency = amountCurrency || line.cost.subtotalAmount.currencyCode;
    }
  }

  // Product ids that are allowed to be free right now.
  const freeProductIds = new Set();
  for (const tier of tiers) {
    const min = Number(tier?.min);
    if (!Number.isFinite(min) || min <= 0 || !Array.isArray(tier.productIds)) continue;
    let reached;
    if (tier.mode === 'count') {
      reached = count >= min;
    } else {
      // The milestone is in the shop currency; without a conversion rate here,
      // only compare when the cart is in that same currency (never guess).
      if (!config.currency || amountCurrency !== config.currency) continue;
      reached = amount >= min;
    }
    if (reached) for (const id of tier.productIds) freeProductIds.add(String(id));
  }
  if (freeProductIds.size === 0) return NONE;

  const candidates = [];
  for (const line of lines) {
    if (!isGift(line)) continue;
    const merchandise = line.merchandise;
    if (!merchandise || merchandise.__typename !== 'ProductVariant') continue;
    if (!freeProductIds.has(numericId(merchandise.product?.id))) continue;
    // One unit per gift line: bumping the quantity never makes more free.
    candidates.push({
      message: 'Free gift',
      targets: [{ cartLine: { id: line.id, quantity: 1 } }],
      value: { percentage: { value: '100' } },
    });
  }

  if (candidates.length === 0) return NONE;
  return { operations: [{ productDiscountsAdd: { candidates, selectionStrategy: 'ALL' } }] };
}

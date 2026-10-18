/**
 * One-time Shopify discount codes for the product page's "Pay online and save
 * X%" offer on shops that check out through Shiprocket.
 *
 * The prepaid saving normally comes from the BRIX prepaid discount Function
 * (prepaid-discount-shopify.server.js), which only runs in Shopify's own
 * checkout. Shiprocket prices the cart itself but accepts Shopify discount
 * codes (the same route box combos take, combo-box-code.server.js), so Pay
 * Online on a Shiprocket shop asks for a code here and hands it to Shiprocket
 * with the item.
 *
 * Nothing comes from the browser but the items: the percentage and minimum
 * are the ones the merchant saved AND the server verified live in Shopify
 * (`_runtime.prepaid`). The code is built exactly like the box codes
 * Shiprocket accepts (combo-box-code.server.js): single use, short lived, a
 * fixed amount off just the items' variants, with their subtotal as the
 * minimum.
 *
 * Shiprocket checks a code by having Shopify price the order, and Shopify
 * runs the automatic prepaid Function there too. So the code never combines
 * with order discounts (else both apply: seen as 10% + 10% in Shiprocket),
 * and it is worth X% of the Shopify prices plus one paisa: when two
 * discounts can't combine Shopify keeps the better one, and on a tie it kept
 * the Function and Shiprocket called the code "not a valid coupon code".
 * The same holds at Shopify checkout: the shopper gets one of the two.
 */
import crypto from 'node:crypto';
import { newBoxCode } from './combo-box-code.server';
import { prepaidDiscountLive } from '../utils/product-payment.shared.js';

export const PREPAID_CODE_TITLE_PREFIX = 'BRIX-PREPAID-CODE';
export const PREPAID_CODE_TTL_MS = 2 * 60 * 60 * 1000;

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  const json = await res.json();
  if (json?.errors && (Array.isArray(json.errors) ? json.errors.length : true)) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

/**
 * The offer a code may carry: { percent, minSubtotal, maxDiscount, excludedCollections }
 * only when saved, on the plan and verified in Shopify; else null.
 * excludedCollections: numeric ids of the collections left out (verified).
 */
export function prepaidOffer(settings, runtime, planLive) {
  const verified = runtime?.prepaid;
  if (!prepaidDiscountLive(settings?.productPayment, planLive) || verified?.verified !== true) return null;
  const percent = Number(verified.percent);
  if (!Number.isFinite(percent) || percent < 1 || percent > 50) return null;
  const excludedCollections = (Array.isArray(verified.excludedCollections) ? verified.excludedCollections : [])
    .map(String).filter((id) => /^\d+$/.test(id));
  return { percent, minSubtotal: Math.max(0, Number(verified.minSubtotal) || 0), maxDiscount: Math.max(0, Number(verified.maxDiscount) || 0), excludedCollections };
}

const toVariantGid = (id) => `gid://shopify/ProductVariant/${id}`;

/**
 * Which gift lines a code may also make free: a gift product of a milestone
 * the merchant gives away free (rewardTiers = reward-gift-shopify.server.js
 * buildRewardConfig().tiers, from the saved Progress Bar, never the browser)
 * that the paid items reach, measured like the reward Function: the cart
 * without gifts, by amount (shop currency) or item count. One unit per gift.
 */
export function coveredGifts(gifts, rewardTiers, { paidMinor, paidCount }) {
  const out = [];
  for (const gift of gifts) {
    const reached = (rewardTiers || []).some((tier) => {
      const min = Number(tier?.min);
      if (!(min > 0) || !(tier.productIds || []).map(String).includes(String(gift.productId))) return false;
      return tier.mode === 'count' ? paidCount >= min : paidMinor >= Math.round(min * 100);
    });
    if (reached) out.push(gift);
  }
  return out;
}

/**
 * Creates the code, or returns { code: null } when there is nothing to give
 * (no live prepaid offer or below its minimum, and no free gift covered).
 * items: [{ variantId, quantity }] the cart's paid lines (numeric variant ids).
 * gifts: [{ variantId, quantity }] its free reward lines (_brixReward, at ₹0
 *   in the cart), rewardTiers: who may have them free (see coveredGifts).
 *   Shiprocket can't run the reward Function either, so the same code also
 *   takes each covered gift's price off.
 * prepaid: false = Shopify showed no prepaid saving in the cart (then only gifts).
 * Returns { code, percent, amount, endsAt, gifts } (amount in the shop currency,
 * gifts = how many gift lines the code covers).
 */
export async function createPrepaidCode(admin, { offer, items, gifts = [], rewardTiers = null, prepaid = true, now = Date.now(), random = crypto.randomBytes }) {
  const wantGifts = gifts.length > 0 && Array.isArray(rewardTiers) && rewardTiers.length > 0;
  if (!offer && !wantGifts) return { code: null };
  const quantities = new Map();
  for (const item of items) {
    const id = String(item.variantId);
    quantities.set(id, (quantities.get(id) || 0) + (Number(item.quantity) || 0));
  }
  const giftIds = wantGifts ? [...new Set(gifts.map((g) => String(g.variantId)))] : [];
  // Prices from Shopify, never the browser (2 decimals: COD is INR-only).
  const priced = await gql(admin, `#graphql
    query BrixPrepaidPrices($ids: [ID!]!) {
      nodes(ids: $ids) { ... on ProductVariant { id price product { id collections(first: 250) { nodes { id } } } } }
    }`, { ids: [...new Set([...quantities.keys(), ...giftIds])].map(toVariantGid) });
  // Like the Function: products in an excluded collection get nothing.
  const excluded = new Set(((offer && offer.excludedCollections) || []).map(String));
  const isExcluded = (node) => (node?.product?.collections?.nodes || [])
    .some((c) => excluded.has(String(c?.id || '').split('/').pop()));
  let subtotalMinor = 0; // the prepaid saving's base (excluded collections left out)
  let paidMinor = 0; // every paid line, for gift milestones and the code's minimum
  let paidCount = 0;
  const variantIds = [];
  const paidVariantIds = [];
  const byId = new Map();
  for (const node of priced?.nodes || []) {
    const id = String(node?.id || '').split('/').pop();
    if (id) byId.set(id, node);
    const price = Number(node?.price);
    if (!quantities.has(id) || !Number.isFinite(price) || price <= 0) continue;
    paidMinor += Math.round(price * 100) * quantities.get(id);
    paidCount += quantities.get(id);
    paidVariantIds.push(id);
    if (isExcluded(node)) continue;
    subtotalMinor += Math.round(price * 100) * quantities.get(id);
    variantIds.push(id);
  }

  // Same as the Function: X%, but never more than the cap.
  let savingMinor = 0;
  if (offer && prepaid !== false && subtotalMinor > 0 && !(offer.minSubtotal > 0 && subtotalMinor < Math.round(offer.minSubtotal * 100))) {
    const capMinor = offer.maxDiscount > 0 ? Math.round(offer.maxDiscount * 100) : Infinity;
    savingMinor = Math.min(Math.round((subtotalMinor * offer.percent) / 100), capMinor);
  }

  const giftLines = wantGifts ? gifts.map((g) => {
    const node = byId.get(String(g.variantId));
    return { variantId: String(g.variantId), productId: String(node?.product?.id || '').split('/').pop(), price: Number(node?.price) };
  }).filter((g) => g.productId && Number.isFinite(g.price) && g.price > 0) : [];
  const covered = paidMinor > 0 ? coveredGifts(giftLines, rewardTiers, { paidMinor, paidCount }) : [];
  const giftMinor = covered.reduce((sum, g) => sum + Math.round(g.price * 100), 0);

  if (savingMinor + giftMinor <= 0) return { code: null };
  // One paisa more than BRIX's own discounts give together (see above).
  const amountMinor = savingMinor + giftMinor + 1;
  const amount = (amountMinor / 100).toFixed(2);
  // Without gifts: exactly the prepaid code as before. With gifts: on every
  // paid line + the gifts, and the cart's paid lines as the minimum, so the
  // code can't be used for the gift alone.
  const entitled = covered.length ? [...new Set([...paidVariantIds, ...covered.map((g) => g.variantId)])] : variantIds;
  const minimumMinor = covered.length ? paidMinor : subtotalMinor;

  const code = newBoxCode(random, 'PP');
  const endsAt = new Date(now + PREPAID_CODE_TTL_MS).toISOString();
  const data = await gql(admin, `#graphql
    mutation BrixPrepaidCode($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) {
        codeDiscountNode { id }
        userErrors { field code message }
      }
    }`, {
    input: {
      title: `${PREPAID_CODE_TITLE_PREFIX} ${code}`,
      code,
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt,
      usageLimit: 1,
      appliesOncePerCustomer: false,
      context: { all: 'ALL' },
      customerGets: {
        value: { discountAmount: { amount, appliesOnEachItem: false } },
        items: { products: { productVariantsToAdd: entitled.map(toVariantGid) } },
      },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: (minimumMinor / 100).toFixed(2) } },
      // Never with the prepaid Function (an order discount) or the free gift
      // Function (a product discount), see above.
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    },
  });
  const errors = data?.discountCodeBasicCreate?.userErrors || [];
  if (errors.length || !data?.discountCodeBasicCreate?.codeDiscountNode?.id) {
    throw new Error(`discountCodeBasicCreate failed: ${JSON.stringify(errors).slice(0, 300)}`);
  }
  return { code, percent: savingMinor > 0 ? offer.percent : null, amount, endsAt, gifts: covered.length };
}

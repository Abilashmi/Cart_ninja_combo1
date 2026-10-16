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
 * Creates the code, or returns { code: null } when there is no live offer
 * (or nothing to discount, or below the offer's minimum).
 * items: [{ variantId, quantity }] (numeric variant ids).
 * Returns { code, percent, amount, endsAt } (amount in the shop currency).
 */
export async function createPrepaidCode(admin, { offer, items, now = Date.now(), random = crypto.randomBytes }) {
  if (!offer) return { code: null };
  const quantities = new Map();
  for (const item of items) {
    const id = String(item.variantId);
    quantities.set(id, (quantities.get(id) || 0) + (Number(item.quantity) || 0));
  }
  // Prices from Shopify, never the browser (2 decimals: COD is INR-only).
  const priced = await gql(admin, `#graphql
    query BrixPrepaidPrices($ids: [ID!]!) {
      nodes(ids: $ids) { ... on ProductVariant { id price product { collections(first: 250) { nodes { id } } } } }
    }`, { ids: [...quantities.keys()].map(toVariantGid) });
  // Like the Function: products in an excluded collection get nothing.
  const excluded = new Set((offer.excludedCollections || []).map(String));
  const isExcluded = (node) => (node?.product?.collections?.nodes || [])
    .some((c) => excluded.has(String(c?.id || '').split('/').pop()));
  let subtotalMinor = 0;
  const variantIds = [];
  for (const node of priced?.nodes || []) {
    const id = String(node?.id || '').split('/').pop();
    const price = Number(node?.price);
    if (!quantities.has(id) || !Number.isFinite(price) || price <= 0 || isExcluded(node)) continue;
    subtotalMinor += Math.round(price * 100) * quantities.get(id);
    variantIds.push(id);
  }
  if (subtotalMinor <= 0) return { code: null };
  if (offer.minSubtotal > 0 && subtotalMinor < Math.round(offer.minSubtotal * 100)) return { code: null };
  // Same as the Function: X%, but never more than the cap.
  const capMinor = offer.maxDiscount > 0 ? Math.round(offer.maxDiscount * 100) : Infinity;
  const savingMinor = Math.min(Math.round((subtotalMinor * offer.percent) / 100), capMinor);
  if (savingMinor <= 0) return { code: null };
  const amountMinor = savingMinor + 1; // one paisa more than the Function (see above)
  const amount = (amountMinor / 100).toFixed(2);

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
        items: { products: { productVariantsToAdd: variantIds.map(toVariantGid) } },
      },
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: (subtotalMinor / 100).toFixed(2) } },
      // Never with the prepaid Function (an order discount), see above.
      combinesWith: { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true },
    },
  });
  const errors = data?.discountCodeBasicCreate?.userErrors || [];
  if (errors.length || !data?.discountCodeBasicCreate?.codeDiscountNode?.id) {
    throw new Error(`discountCodeBasicCreate failed: ${JSON.stringify(errors).slice(0, 300)}`);
  }
  return { code, percent: offer.percent, amount, endsAt };
}

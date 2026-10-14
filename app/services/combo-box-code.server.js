/**
 * One-time Shopify discount codes for box-priced combos checked out through
 * Shiprocket (see CLAUDE.md, "Box pricing", Shiprocket).
 *
 * A box's price normally comes from the BRIX combo weight Function, which
 * only runs in Shopify's own checkout. Shiprocket prices the cart itself but
 * does accept Shopify discount codes (checked on a real store: a code made in
 * Shopify, never imported into Shiprocket, applied). So when the merchant
 * picks Shiprocket for a box combo, the storefront asks for a code here and
 * hands it to Shiprocket with the items.
 *
 * The amount is never taken from the browser: comboWeightAdjustments (the
 * same pricing BRIX COD uses) works it out from the trusted Function config
 * and Shopify's own prices, weights and collections. The code is single use,
 * short lived, limited to the box's variants and their subtotal, and does not
 * combine with other product discounts, so at Shopify checkout it can never
 * stack with the Function's own box price.
 */
import crypto from 'node:crypto';
import { comboWeightAdjustments } from './cod.server';
import { fromMinor } from '../utils/combo-weight.shared.js';

export const BOX_CODE_TITLE_PREFIX = 'BRIX-BOX-CODE';
export const BOX_CODE_TTL_MS = 2 * 60 * 60 * 1000;
export const BOX_CHECKOUT_VALUES = ['shopify', 'shiprocket', 'shiprocket_own'];

// No 0/O/1/I so a shopper reading it aloud can't mix them up.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newBoxCode(random = crypto.randomBytes) {
  const bytes = random(10);
  let out = 'BX';
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** The template's "Checkout with" choice (Quick Shop bottom bar); missing = Shopify. */
export function boxCheckoutOf(config) {
  const value = config?.qs_checkout_with;
  return BOX_CHECKOUT_VALUES.includes(value) ? value : 'shopify';
}

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, { variables });
  const json = await res.json();
  if (json?.errors && (Array.isArray(json.errors) ? json.errors.length : true)) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

const toVariantGid = (id) => `gid://shopify/ProductVariant/${id}`;

/**
 * Creates the one-time code for a box, or returns { code: null } when the box
 * has no discount (no tier reached, box discount not live, plan off).
 * items: [{ variantId, quantity }] (numeric variant ids).
 * Returns { code, amount, endsAt } (amount in the shop currency, as a string).
 */
export async function createBoxCode(admin, { templateId, items, comboWeightLive, currencyCode = 'INR', now = Date.now(), random }) {
  const lines = items.map((item) => ({
    variantId: String(item.variantId),
    quantity: item.quantity,
    properties: { _brix_combo_id: String(templateId), _brix_combo_group: 'shiprocket' },
  }));
  const combo = await comboWeightAdjustments(admin, { lines, comboWeightLive, currencyCode });
  const box = combo.boxes[0];
  if (!box || box.amountMinor <= 0) return { code: null };

  // Only the lines that count toward the box: their variants, and their
  // subtotal as the minimum, so the code can't be spent on a smaller box.
  const counted = box.lineKeys.map((index) => lines[index]);
  const variantIds = [...new Set(counted.map((line) => line.variantId))];
  const amount = fromMinor(box.amountMinor, combo.decimals);
  const minimum = fromMinor(box.subtotalMinor, combo.decimals);

  const code = newBoxCode(random);
  const endsAt = new Date(now + BOX_CODE_TTL_MS).toISOString();
  const data = await gql(admin, `#graphql
    mutation BrixBoxCode($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) {
        codeDiscountNode { id }
        userErrors { field code message }
      }
    }`, {
    input: {
      title: `${BOX_CODE_TITLE_PREFIX} ${templateId} ${code}`,
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
      minimumRequirement: { subtotal: { greaterThanOrEqualToSubtotal: minimum } },
      // Same as the box Function: never with another product discount.
      combinesWith: { productDiscounts: false, orderDiscounts: true, shippingDiscounts: true },
    },
  });
  const errors = data?.discountCodeBasicCreate?.userErrors || [];
  if (errors.length || !data?.discountCodeBasicCreate?.codeDiscountNode?.id) {
    throw new Error(`discountCodeBasicCreate failed: ${JSON.stringify(errors).slice(0, 300)}`);
  }
  return { code, amount, endsAt, title: box.title };
}

// Expired box codes would pile up in the merchant's Discounts list; clear
// them now and then (at most once an hour per shop, never awaited).
const lastCleanup = new Map();

export async function cleanupExpiredBoxCodes(admin, shop, now = Date.now()) {
  if (now - (lastCleanup.get(shop) || 0) < 60 * 60 * 1000) return { skipped: true };
  lastCleanup.set(shop, now);
  try {
    const data = await gql(admin, `#graphql
      query BrixOldBoxCodes($query: String!) {
        codeDiscountNodes(first: 100, query: $query) {
          nodes { id codeDiscount { __typename ... on DiscountCodeBasic { title status } } }
        }
      }`, { query: `status:expired title:${BOX_CODE_TITLE_PREFIX}*` });
    // Re-checked here: only our own expired codes, whatever the search matched.
    const ids = (data?.codeDiscountNodes?.nodes || [])
      .filter((n) => n.codeDiscount?.__typename === 'DiscountCodeBasic'
        && n.codeDiscount.status === 'EXPIRED'
        && String(n.codeDiscount.title || '').startsWith(`${BOX_CODE_TITLE_PREFIX} `))
      .map((n) => n.id);
    if (!ids.length) return { deleted: 0 };
    await gql(admin, `#graphql
      mutation BrixDeleteBoxCodes($ids: [ID!]) {
        discountCodeBulkDelete(ids: $ids) { job { id } userErrors { field message } }
      }`, { ids });
    return { deleted: ids.length };
  } catch (error) {
    console.error('[combo-box-code] cleanup failed:', error.message);
    return { error: error.message };
  }
}

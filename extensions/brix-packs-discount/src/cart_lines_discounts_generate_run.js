// BRIX Packs — checkout discount (Shopify Discount Function API,
// target cart.lines.discounts.generate.run).
//
// Trust model: the storefront only *marks* cart lines with line-item
// properties (_brix_pack_id / _brix_pack_quantity / _brix_pack_group). A
// shopper can forge those, so they never decide WHAT discount is given — the
// tiers, discount type and value come exclusively from the app-owned shop
// metafield `$app:packs_config`, which only the BRIX server writes (from Packs
// it verified against Shopify and the shop's plan). A forged property can at
// most claim a discount the merchant genuinely offers for that exact quantity.
//
// A "pack" is one add-to-cart: all lines sharing a _brix_pack_group token.
// The discount applies only when the group's total quantity is a whole
// multiple (k) of a configured tier quantity — e.g. tier "3 for 10% off" with
// 6 units in the group -> two packs -> 10% off all 6. If a shopper edits the
// cart quantity so it no longer matches a tier, no discount is given (never a
// wrong one). Config shape (see app/services/packs-shopify.server.js):
//   { version: 1, currency: "USD", packs: { "<packId>": { id, productId, variantId, template,
//       variantScope: "all"|"selected", allowedVariantIds: [...],
//       tiers: [{ quantity, discountType: "percentage"|"fixed"|"none", discountValue }] } } }
//
// A Pack now belongs to a PRODUCT, not one fixed variant: `variantId` is only
// the anchor/display variant. Which variant(s) a cart line may legitimately
// claim this pack for is variantScope/allowedVariantIds — "all" accepts any
// variant of `productId`, "selected" accepts only a variant in
// `allowedVariantIds`. `choose_each_item` (Mix & Match) already worked this
// way for its own reason (shoppers pick a different variant per item); the
// same trust check now also covers Same Variant packs with scope='all' or
// multiple selected variants, so a shopper can be on any allowed variant's
// product page and still get the discount for that exact variant.

import { packDiscountsFor, packNumericId } from '../../../app/utils/packs-discount.shared.js';

const NONE = { operations: [] };

function percentString(value) {
  return String(Math.round(value * 10000) / 10000);
}

/**
 * The pack rule itself lives in app/utils/packs-discount.shared.js, shared
 * with Cash on Delivery (draft orders never run this Function).
 * @param {object} input Function run input (see the .graphql query)
 * @returns {{ operations: object[] }}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const config = input?.shop?.metafield?.jsonValue;
  const packs = config && typeof config === 'object' ? config.packs : null;
  const lines = input?.cart?.lines;
  if (!packs || !Array.isArray(lines) || lines.length === 0) return NONE;
  const classes = input?.discount?.discountClasses;
  if (Array.isArray(classes) && !classes.includes('PRODUCT')) return NONE;

  const plain = lines
    .filter((line) => line.merchandise && line.merchandise.__typename === 'ProductVariant')
    .map((line) => ({
      id: line.id,
      quantity: line.quantity,
      packId: line.packId?.value,
      packQuantity: line.packQuantity?.value,
      packGroup: line.packGroup?.value,
      productId: packNumericId(line.merchandise.product?.id),
      variantId: packNumericId(line.merchandise.id),
      subtotalAmount: line.cost?.subtotalAmount?.amount,
      currencyCode: line.cost?.subtotalAmount?.currencyCode,
    }));
  const byId = new Map(lines.map((line) => [line.id, line]));
  const candidates = packDiscountsFor(config, plain).map((d) => ({
    message: d.message,
    targets: [{ cartLine: { id: d.id, quantity: byId.get(d.id).quantity } }],
    value: d.percent != null
      ? { percentage: { value: percentString(d.percent) } }
      : { fixedAmount: { amount: (d.amount / 10 ** d.decimals).toFixed(d.decimals), appliesToEachItem: false } },
  }));

  if (candidates.length === 0) return NONE;
  return { operations: [{ productDiscountsAdd: { candidates, selectionStrategy: 'ALL' } }] };
}

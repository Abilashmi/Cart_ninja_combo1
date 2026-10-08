// BRIX prepaid discount — checkout discount (Shopify Discount Function API,
// target cart.lines.discounts.generate.run).
//
// The merchant's "pay online and save X%" offer, advertised on product pages
// by the BRIX payment selector (brix_cod.js). Shopify checkout is where
// shoppers pay online, so this takes X% off the order subtotal there.
//
// Trust model: the shopper's browser never decides anything here. The
// percentage, the minimum and the on/off switch come only from the app-owned
// shop metafield `$app:prepaid_discount_config`, written by the BRIX server
// from the merchant's saved settings (app/services/prepaid-discount-shopify.server.js).
//
// Cash on Delivery never gets it: BRIX COD orders are draft orders that the
// BRIX server marks with `_brixCod` (an order attribute and an attribute on
// every line — app/services/cod.server.js). Any cart or line carrying that
// key gets no discount. A shopper can't remove the marker: COD orders are
// built on the server, not in the browser.
//
// Config shape:
//   { version: 1, enabled: true, percent: 10, minSubtotal: 0, currency: "INR", title: "Prepaid discount" }

const NONE = { operations: [] };

const marked = (attr) => attr != null && attr.value != null && String(attr.value).trim() !== '';

/**
 * @param {object} input Function run input (see the .graphql query)
 * @returns {{ operations: object[] }}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const config = input?.shop?.metafield?.jsonValue;
  if (!config || typeof config !== 'object' || config.enabled !== true) return NONE;
  const percent = Number(config.percent);
  if (!Number.isFinite(percent) || percent < 1 || percent > 50) return NONE;
  const classes = input?.discount?.discountClasses;
  if (Array.isArray(classes) && !classes.includes('ORDER')) return NONE;

  const cart = input?.cart;
  const lines = cart?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return NONE;

  // Cash on Delivery: never discounted.
  if (marked(cart.cod) || lines.some((line) => marked(line.cod))) return NONE;

  // Free reward gifts (BRIX Progress Bar) are already free; leave them out.
  const gifts = lines.filter((line) => String(line.reward?.value ?? '') === 'true').map((line) => line.id);
  const paid = lines.filter((line) => !gifts.includes(line.id));
  if (paid.length === 0) return NONE;

  const min = Number(config.minSubtotal) || 0;
  if (min > 0) {
    let subtotal = 0;
    let currency = null;
    for (const line of paid) {
      const amount = Number(line.cost?.subtotalAmount?.amount);
      if (!Number.isFinite(amount)) continue;
      subtotal += amount;
      currency = currency || line.cost.subtotalAmount.currencyCode;
    }
    // The minimum is in the shop currency; without a conversion rate here,
    // only compare when the cart is in that same currency (never guess).
    if (!config.currency || currency !== config.currency) return NONE;
    if (subtotal < min) return NONE;
  }

  const title = typeof config.title === 'string' && config.title.trim() ? config.title.trim().slice(0, 40) : 'Prepaid discount';
  return {
    operations: [{
      orderDiscountsAdd: {
        candidates: [{
          message: title,
          targets: [{ orderSubtotal: { excludedCartLineIds: gifts } }],
          value: { percentage: { value: String(percent) } },
        }],
        selectionStrategy: 'FIRST',
      },
    }],
  };
}

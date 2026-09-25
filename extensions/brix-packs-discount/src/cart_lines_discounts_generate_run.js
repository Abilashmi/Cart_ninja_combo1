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
//       tiers: [{ quantity, discountType: "percentage"|"fixed"|"none", discountValue }] } } }

const NONE = { operations: [] };
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'XPF', 'PYG', 'RWF', 'KMF', 'DJF', 'GNF', 'VUV', 'BIF']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND']);

function decimalsFor(currencyCode) {
  if (ZERO_DECIMAL.has(currencyCode)) return 0;
  if (THREE_DECIMAL.has(currencyCode)) return 3;
  return 2;
}

function numericId(gid) {
  const match = /(\d+)$/.exec(String(gid ?? ''));
  return match ? match[1] : null;
}

function positiveInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function percentString(value) {
  return String(Math.round(value * 10000) / 10000);
}

/**
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

  // 1. Group marked lines into packs.
  const groups = new Map();
  for (const line of lines) {
    const merchandise = line.merchandise;
    if (!merchandise || merchandise.__typename !== 'ProductVariant') continue;
    const packId = line.packId?.value;
    const packQuantity = positiveInt(line.packQuantity?.value);
    if (!packId || !packQuantity) continue;
    const pack = Object.values(packs).find((entry) => String(entry?.id) === String(packId));
    if (!pack || !Array.isArray(pack.tiers)) continue;
    // The line must really be this pack's product (and, unless the template lets
    // shoppers mix variants, this pack's variant) — properties alone prove nothing.
    if (numericId(merchandise.product?.id) !== String(pack.productId)) continue;
    if (pack.template !== 'choose_each_item' && numericId(merchandise.id) !== String(pack.variantId)) continue;
    const key = `${packId}:${packQuantity}:${line.packGroup?.value || line.id}`;
    if (!groups.has(key)) groups.set(key, { pack, packQuantity, lines: [] });
    groups.get(key).lines.push(line);
  }

  // 2. One discount per group whose quantity is a whole multiple of a tier.
  const candidates = [];
  for (const { pack, packQuantity, lines: groupLines } of groups.values()) {
    const tier = pack.tiers.find((item) => Number(item.quantity) === packQuantity);
    if (!tier || tier.discountType === 'none') continue;
    const total = groupLines.reduce((sum, line) => sum + line.quantity, 0);
    if (total <= 0 || total % packQuantity !== 0) continue;
    const packCount = total / packQuantity;
    const value = Number(tier.discountValue);
    if (!Number.isFinite(value) || value <= 0) continue;
    const message = `Pack: Buy ${packQuantity}`;

    if (tier.discountType === 'percentage') {
      if (value > 100) continue;
      for (const line of groupLines) {
        candidates.push({ message, targets: [{ cartLine: { id: line.id, quantity: line.quantity } }], value: { percentage: { value: percentString(value) } } });
      }
    } else if (tier.discountType === 'fixed') {
      // Fixed amounts are stored in the shop currency; only apply them when the
      // cart is in that same currency (no conversion rate is available here).
      const currency = groupLines[0].cost?.subtotalAmount?.currencyCode;
      if (!config.currency || currency !== config.currency) continue;
      const decimals = decimalsFor(currency);
      const factor = 10 ** decimals;
      const subtotals = groupLines.map((line) => Math.round(Number(line.cost?.subtotalAmount?.amount) * factor));
      const groupSubtotal = subtotals.reduce((sum, amount) => sum + amount, 0);
      if (!(groupSubtotal > 0)) continue;
      const totalDiscount = Math.min(Math.round(value * factor) * packCount, groupSubtotal);
      let remaining = totalDiscount;
      groupLines.forEach((line, index) => {
        const isLast = index === groupLines.length - 1;
        const share = isLast ? remaining : Math.min(remaining, Math.floor((totalDiscount * subtotals[index]) / groupSubtotal));
        remaining -= share;
        if (share <= 0) return;
        candidates.push({ message, targets: [{ cartLine: { id: line.id, quantity: line.quantity } }], value: { fixedAmount: { amount: (share / factor).toFixed(decimals), appliesToEachItem: false } } });
      });
    }
  }

  if (candidates.length === 0) return NONE;
  return { operations: [{ productDiscountsAdd: { candidates, selectionStrategy: 'ALL' } }] };
}

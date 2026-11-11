// BRIX Packs: which cart lines get which pack discount. One rule for the
// checkout Function (extensions/brix-packs-discount) and for Cash on Delivery
// (app/services/cod.server.js), which places draft orders that Shopify's
// Functions never price, so COD gives a Pack the same price checkout does.
//
// `config` is the app-owned `$app:packs_config` (packs-shopify.server.js
// buildFunctionConfig): { currency, packs: { "<id>": { id, productId,
// variantId, variantScope, allowedVariantIds, tiers: [{ quantity,
// discountType, discountValue }] } } }. Line properties only say which pack a
// line claims; what it gets comes only from the config (see the Function).
//
// `lines`: [{ id, quantity, packId, packQuantity, packGroup, productId,
// variantId, subtotalAmount, currencyCode }] (ids numeric strings, amount a
// decimal string or number in the line's currency).
// Returns [{ id, message, percent }] or [{ id, message, amount, decimals }]
// (amount = minor units, for the whole line).

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'XPF', 'PYG', 'RWF', 'KMF', 'DJF', 'GNF', 'VUV', 'BIF']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND']);

export function packDecimalsFor(currencyCode) {
  if (ZERO_DECIMAL.has(currencyCode)) return 0;
  if (THREE_DECIMAL.has(currencyCode)) return 3;
  return 2;
}

export function packNumericId(gid) {
  const match = /(\d+)$/.exec(String(gid ?? ''));
  return match ? match[1] : null;
}

function positiveInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function packDiscountsFor(config, lines) {
  const packs = config && typeof config === 'object' ? config.packs : null;
  if (!packs || !Array.isArray(lines) || lines.length === 0) return [];

  // 1. Group marked lines into packs (one add to cart = one _brix_pack_group).
  const groups = new Map();
  for (const line of lines) {
    const packId = line.packId;
    const packQuantity = positiveInt(line.packQuantity);
    if (!packId || !packQuantity) continue;
    const pack = Object.values(packs).find((entry) => String(entry?.id) === String(packId));
    if (!pack || !Array.isArray(pack.tiers)) continue;
    // The line must really be this pack's product, and (unless the pack
    // covers every variant) one of its configured variants.
    if (String(line.productId) !== String(pack.productId)) continue;
    if (pack.variantScope !== 'all') {
      const allowed = Array.isArray(pack.allowedVariantIds) ? pack.allowedVariantIds : [String(pack.variantId)];
      if (!allowed.some((id) => String(id) === String(line.variantId))) continue;
    }
    const key = `${packId}:${packQuantity}:${line.packGroup || line.id}`;
    if (!groups.has(key)) groups.set(key, { pack, packQuantity, lines: [] });
    groups.get(key).lines.push(line);
  }

  // 2. One discount per group whose quantity is a whole multiple of a tier.
  const out = [];
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
      for (const line of groupLines) out.push({ id: line.id, message, percent: value });
    } else if (tier.discountType === 'fixed') {
      // Fixed amounts are in the shop currency: only for a cart in that currency.
      const currency = groupLines[0].currencyCode;
      if (!config.currency || currency !== config.currency) continue;
      const decimals = packDecimalsFor(currency);
      const factor = 10 ** decimals;
      const subtotals = groupLines.map((line) => Math.round(Number(line.subtotalAmount) * factor));
      const groupSubtotal = subtotals.reduce((sum, amount) => sum + amount, 0);
      if (!(groupSubtotal > 0)) continue;
      const totalDiscount = Math.min(Math.round(value * factor) * packCount, groupSubtotal);
      let remaining = totalDiscount;
      groupLines.forEach((line, index) => {
        const isLast = index === groupLines.length - 1;
        const share = isLast ? remaining : Math.min(remaining, Math.floor((totalDiscount * subtotals[index]) / groupSubtotal));
        remaining -= share;
        if (share > 0) out.push({ id: line.id, message, amount: share, decimals });
      });
    }
  }
  return out;
}

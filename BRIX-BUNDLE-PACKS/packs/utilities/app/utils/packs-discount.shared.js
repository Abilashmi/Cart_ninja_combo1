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
// variantId, subtotalAmount, currencyCode, collectionIds? }] (ids numeric
// strings, amount a decimal string or number in the line's currency;
// collectionIds = the collections of a Pack's `applies.c` the line's product
// is in, from the Function's inCollections / COD's inCollection).
//
// A Pack used on many products carries `applies: { p: [productIds], c:
// [collectionIds], x: [left-out productIds] }`: any variant of such a product
// counts as the pack's own product. One pack group still holds one product
// (two different kurtas never make one "Buy 2").
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

// Is this line part of the pack? The main product follows the pack's own variant scope; a pack may also list
// extra products (config.packs[id].extraProducts = { "<productId>": { scope: 'all'|'selected', allowedVariantIds } }),
// each with its own scope. Anything else is not the pack's, whatever its line properties say.
// The pack's own product: its main product (with the pack's variant scope), or, for a Pack used on
// many products, any variant of a listed product or of a product in a listed collection (not left out).
export function packCoversMain(pack, line) {
  const productId = String(line.productId);
  const variantId = String(line.variantId);
  if (productId === String(pack.productId)) {
    if (pack.variantScope === 'all') return true;
    const allowed = Array.isArray(pack.allowedVariantIds) ? pack.allowedVariantIds : [String(pack.variantId)];
    return allowed.some((id) => String(id) === variantId);
  }
  const applies = pack.applies && typeof pack.applies === 'object' ? pack.applies : null;
  if (!applies) return false;
  if (Array.isArray(applies.x) && applies.x.some((id) => String(id) === productId)) return false;
  if (Array.isArray(applies.p) && applies.p.some((id) => String(id) === productId)) return true;
  const lineCollections = Array.isArray(line.collectionIds) ? line.collectionIds.map(String) : [];
  return Array.isArray(applies.c) && applies.c.some((id) => lineCollections.includes(String(id)));
}

// A Fixed Combo item (tiers[].items = [{ p, v, q, a? }]): its exact variant, or with `a`
// (the shopper chooses, e.g. a blouse's size) any variant of that product.
function itemMatches(item, line) {
  if (String(item.p) !== String(line.productId)) return false;
  return item.a ? true : String(item.v) === String(line.variantId);
}
function isComboItem(pack, line) {
  return (pack.tiers || []).some((tier) => (tier.items || []).some((item) => itemMatches(item, line)));
}

export function packCoversLine(pack, line) {
  const productId = String(line.productId);
  const variantId = String(line.variantId);
  if (pack.packType === 'combo' && isComboItem(pack, line)) return true;
  if (packCoversMain(pack, line)) return true;
  if (pack.packType === 'combo') return false;
  const extra = pack.extraProducts && typeof pack.extraProducts === 'object' ? pack.extraProducts[productId] : null;
  if (!extra) return false;
  if (extra.scope === 'all') return true;
  return Array.isArray(extra.allowedVariantIds) && extra.allowedVariantIds.some((id) => String(id) === variantId);
}

// Fixed Combo: the tier whose exact contents the group holds, N times over: N units of this
// product (any covered variant) and N x each item's quantity of each item's variant, nothing
// else. Several tiers can hold the same number of items, so the contents decide; no match =
// no discount (the cart doesn't hold a pack the merchant made).
function isMainLine(pack, line) {
  return !(pack.packType === 'combo' && isComboItem(pack, line)) && packCoversMain(pack, line);
}

function comboTierFor(pack, packQuantity, groupLines) {
  const mainUnits = groupLines.filter((line) => isMainLine(pack, line)).reduce((sum, line) => sum + line.quantity, 0);
  if (mainUnits <= 0) return null;
  const others = groupLines.filter((line) => !isMainLine(pack, line));
  return (pack.tiers || []).find((tier) => {
    if (Number(tier.quantity) !== packQuantity) return false;
    const items = Array.isArray(tier.items) ? tier.items : [];
    // Count the group's other lines per item of this tier (a "shopper chooses" item takes any of
    // its product's variants, mixed sizes too); a line no item of this tier takes = not this tier.
    const counts = items.map(() => 0);
    for (const line of others) {
      const at = items.findIndex((item) => itemMatches(item, line));
      if (at < 0) return false;
      counts[at] += line.quantity;
    }
    return items.every((item, at) => counts[at] === Number(item.q) * mainUnits);
  }) || null;
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
    // The line must really be one of this pack's products and variants (main product, or a listed extra product).
    if (!packCoversLine(pack, line)) continue;
    const key = `${packId}:${packQuantity}:${line.packGroup || line.id}`;
    if (!groups.has(key)) groups.set(key, { pack, packQuantity, lines: [] });
    groups.get(key).lines.push(line);
  }

  // 2. One discount per group whose quantity is a whole multiple of a tier.
  const out = [];
  for (const { pack, packQuantity, lines: groupLines } of groups.values()) {
    // A Pack used on many products: one group = one of its products (never two different ones).
    if (pack.applies && new Set(groupLines.filter((line) => isMainLine(pack, line)).map((line) => String(line.productId))).size > 1) continue;
    const tier = pack.packType === 'combo'
      ? comboTierFor(pack, packQuantity, groupLines)
      : pack.tiers.find((item) => Number(item.quantity) === packQuantity);
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
    } else if (tier.discountType === 'fixed' || tier.discountType === 'set') {
      // Fixed amounts and set prices are in the shop currency: only for a cart in that currency.
      const currency = groupLines[0].currencyCode;
      if (!config.currency || currency !== config.currency) continue;
      const decimals = packDecimalsFor(currency);
      const factor = 10 ** decimals;
      const subtotals = groupLines.map((line) => Math.round(Number(line.subtotalAmount) * factor));
      const groupSubtotal = subtotals.reduce((sum, amount) => sum + amount, 0);
      if (!(groupSubtotal > 0)) continue;
      // Set price: whatever brings each pack down to that price; a pack that already costs less gets nothing.
      const wanted = tier.discountType === 'set' ? groupSubtotal - Math.round(value * factor) * packCount : Math.round(value * factor) * packCount;
      if (!(wanted > 0)) continue;
      const totalDiscount = Math.min(wanted, groupSubtotal);
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

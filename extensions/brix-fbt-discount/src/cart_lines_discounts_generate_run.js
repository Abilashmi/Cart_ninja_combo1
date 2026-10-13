// BRIX bundle offer — checkout discount for the FBT "buy all together" offer
// (Shopify Discount Function API, target cart.lines.discounts.generate.run).
//
// A set = one FBT rule with an offer. It applies when the cart holds one of
// the rule's trigger products (the product the shopper viewed) and every one
// of its recommended products; then ONE unit of each of those products gets
// the discount. A rule shown on every product page has no trigger products:
// it needs its recommended products plus any other product.
//
// Trust model (same as the free gift / Packs): nothing comes from the
// browser. Which products form a set and the discount come only from the
// app-owned shop metafield `$app:fbt_offer_config`, written by the BRIX
// server from the merchant's saved FBT rules
// (app/services/fbt-offer-shopify.server.js). Lines BRIX prices elsewhere
// (free gifts, Packs, combo boxes) never count or get this discount.
//
// Config: { version: 1, currency: "INR",
//   sets: [{ id, t: [productId], o: [productId], k: "p" | "f", v }] }
//   k = p: v percent off each unit; k = f: v (shop currency) off the whole set.

const NONE = { operations: [] };

function numericId(gid) {
  const match = /(\d+)$/.exec(String(gid ?? ''));
  return match ? match[1] : null;
}

function marked(line, key) {
  const v = line?.[key]?.value;
  return v !== undefined && v !== null && String(v) !== '' && String(v) !== 'false';
}

/**
 * @param {object} input Function run input (see the .graphql query)
 * @returns {{ operations: object[] }}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const config = input?.shop?.metafield?.jsonValue;
  const sets = config && typeof config === 'object' && Array.isArray(config.sets) ? config.sets : null;
  const lines = input?.cart?.lines;
  if (!sets || sets.length === 0 || !Array.isArray(lines) || lines.length === 0) return NONE;
  const classes = input?.discount?.discountClasses;
  if (Array.isArray(classes) && !classes.includes('PRODUCT')) return NONE;

  // Eligible lines by product id, with the price of one unit.
  const byProduct = new Map();
  let cartCurrency = null;
  for (const line of lines) {
    if (marked(line, 'reward') || marked(line, 'pack') || marked(line, 'combo')) continue;
    const m = line?.merchandise;
    if (!m || m.__typename !== 'ProductVariant') continue;
    const qty = Number(line.quantity) || 0;
    const subtotal = Number(line.cost?.subtotalAmount?.amount);
    if (qty < 1 || !Number.isFinite(subtotal) || subtotal <= 0) continue;
    cartCurrency = cartCurrency || line.cost.subtotalAmount.currencyCode;
    const pid = numericId(m.product?.id);
    if (!pid) continue;
    const entry = { id: line.id, unit: subtotal / qty };
    const list = byProduct.get(pid) || [];
    list.push(entry);
    byProduct.set(pid, list);
  }
  if (byProduct.size < 2) return NONE;
  // The dearest unit of a product (a set discounts one unit of each).
  const best = (pid) => (byProduct.get(pid) || []).reduce((a, b) => (!a || b.unit > a.unit ? b : a), null);

  const offers = [];
  for (const set of sets) {
    const o = Array.isArray(set?.o) ? set.o.map(String) : [];
    const t = Array.isArray(set?.t) ? set.t.map(String) : [];
    const v = Number(set?.v);
    if (!o.length || !Number.isFinite(v) || v <= 0 || (set.k !== 'p' && set.k !== 'f')) continue;
    // Fixed amounts are in the shop currency: never guess a conversion.
    if (set.k === 'f' && (!config.currency || cartCurrency !== config.currency)) continue;
    if (set.k === 'p' && v > 100) continue;
    if (!o.every((pid) => byProduct.has(pid))) continue;
    const units = o.map((pid) => best(pid));
    if (t.length) {
      const trigger = t.find((pid) => !o.includes(pid) && byProduct.has(pid));
      if (!trigger) continue;
      units.push(best(trigger));
    } else {
      // Shown on every product page: any other product is "the one viewed".
      const others = [...byProduct.keys()].filter((pid) => !o.includes(pid));
      if (!others.length) continue;
    }
    const sum = units.reduce((s, u) => s + u.unit, 0);
    const value = set.k === 'p' ? (sum * v) / 100 : Math.min(v, sum);
    if (value > 0) offers.push({ set, units, sum, value });
  }
  if (!offers.length) return NONE;

  // Best value first; a cart line takes part in one set only.
  offers.sort((a, b) => b.value - a.value);
  const used = new Set();
  const candidates = [];
  for (const offer of offers) {
    if (offer.units.some((u) => used.has(u.id))) continue;
    offer.units.forEach((u) => used.add(u.id));
    if (offer.set.k === 'p') {
      candidates.push({
        message: 'Bundle offer',
        targets: offer.units.map((u) => ({ cartLine: { id: u.id, quantity: 1 } })),
        value: { percentage: { value: String(Number(offer.set.v)) } },
      });
      continue;
    }
    // Fixed amount: split across the units by price, in cents, no unit below 0.
    const total = Math.round(offer.value * 100);
    let left = total;
    const shares = offer.units.map((u, i) => {
      const share = i === offer.units.length - 1 ? left : Math.min(Math.floor((total * u.unit) / offer.sum), Math.round(u.unit * 100));
      left -= share;
      return share;
    });
    offer.units.forEach((u, i) => {
      const cents = Math.min(shares[i], Math.round(u.unit * 100));
      if (cents <= 0) return;
      candidates.push({
        message: 'Bundle offer',
        targets: [{ cartLine: { id: u.id, quantity: 1 } }],
        value: { fixedAmount: { amount: (cents / 100).toFixed(2), appliesToEachItem: false } },
      });
    });
  }
  if (!candidates.length) return NONE;
  return { operations: [{ productDiscountsAdd: { candidates, selectionStrategy: 'ALL' } }] };
}

// Pure logic behind the Pairing Assistant (FBT page + Cart Editor upsells):
// "From past orders" basket analysis and turning a merchant's own words
// ("pair the joggers with socks") into real rules. No LLM, DB or Shopify
// calls here, so all of it is unit-tested (tests/pairing/pairing.shared.test.mjs).
// The server (services/pairing-assistant.server.js) only fetches orders and
// the catalog and asks the model for a structured plan; every product name
// the model returns is matched against the real catalog here, so a rule can
// only ever contain products that exist.

export const MAX_TRIGGERS_PER_RULE = 100;
export const MAX_OFFERS_PER_RULE = 10;

export function numericId(id) {
  const m = String(id ?? '').match(/(\d+)$/);
  return m ? m[1] : '';
}

export function productGid(id) {
  const n = numericId(id);
  return n ? `gid://shopify/Product/${n}` : '';
}

// The {id,title,handle,image,price} object FBT rules and upsell details store.
export function toRuleProduct(p) {
  return { id: productGid(p.id), title: p.title || '', handle: p.handle || '', image: p.image || '', price: String(p.price ?? '0') };
}

// ── From past orders ────────────────────────────────────────────────────────
// orders: [{ id, products: [{ id, title }] }] — one entry per order, any id
// format. A product appearing on several lines of one order counts once.
// Returns { totalOrders, multiItemOrders, productOrders, pairs } where each
// pair is { a, b, together, aOrders, bOrders, aToB, bToA, lift } (aToB = %
// of orders with A that also had B). Pairs seen in fewer than minTogether
// orders are dropped; sorted by orders together, then lift.
export function computeOrderPairs(orders, { minTogether = 1, limit = 100 } = {}) {
  const productOrders = new Map();
  const titles = new Map();
  const pairCounts = new Map();
  let totalOrders = 0;
  let multiItemOrders = 0;

  for (const order of orders || []) {
    const ids = [];
    const seen = new Set();
    for (const p of order?.products || []) {
      const id = numericId(p?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (p.title && !titles.has(id)) titles.set(id, p.title);
    }
    if (!ids.length) continue;
    totalOrders++;
    for (const id of ids) productOrders.set(id, (productOrders.get(id) || 0) + 1);
    if (ids.length < 2) continue;
    multiItemOrders++;
    ids.sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  const pairs = [];
  for (const [key, together] of pairCounts) {
    if (together < minTogether) continue;
    const [a, b] = key.split('|');
    const aOrders = productOrders.get(a) || together;
    const bOrders = productOrders.get(b) || together;
    pairs.push({
      a: { id: a, title: titles.get(a) || '' },
      b: { id: b, title: titles.get(b) || '' },
      together,
      aOrders,
      bOrders,
      aToB: Math.round((together / aOrders) * 100),
      bToA: Math.round((together / bOrders) * 100),
      lift: totalOrders ? Math.round(((together * totalOrders) / (aOrders * bOrders)) * 100) / 100 : 0,
    });
  }
  pairs.sort((x, y) => y.together - x.together || y.lift - x.lift || (x.a.id + x.b.id).localeCompare(y.a.id + y.b.id));

  return {
    totalOrders,
    multiItemOrders,
    productOrders: Object.fromEntries(productOrders),
    pairs: pairs.slice(0, Math.max(1, limit)),
  };
}

// The products most often bought with productId, best first: [{ id, together, share }]
// (share = % of productId's orders that also had it).
export function partnersOf(pairs, productId, n = 3) {
  const id = numericId(productId);
  const out = [];
  for (const p of pairs || []) {
    if (p.a.id === id) out.push({ id: p.b.id, together: p.together, share: p.aToB });
    else if (p.b.id === id) out.push({ id: p.a.id, together: p.together, share: p.bToA });
  }
  out.sort((x, y) => y.together - x.together || y.share - x.share);
  return out.slice(0, Math.max(0, n));
}

// ── Matching the merchant's words to the catalog ────────────────────────────

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Plural-tolerant tokens: "socks" and "sock" match each other.
function tokens(s) {
  return norm(s).split(' ').filter(Boolean).map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

// catalog: [{ id, title, ... }]. Returns { status: 'found'|'many'|'not_found', products }.
// Exact title first; then products whose title holds every word of the name
// ("joggers" → every jogger); then the name holding every word of a title
// ("the red mug please" → "Red Mug").
export function matchProducts(name, catalog) {
  const n = norm(name);
  if (!n) return { status: 'not_found', products: [] };
  const exact = (catalog || []).filter((p) => norm(p.title) === n);
  if (exact.length) return { status: 'found', products: [exact[0]] };

  const want = tokens(name);
  const byWords = (catalog || []).filter((p) => {
    const have = new Set(tokens(p.title));
    return want.every((t) => have.has(t));
  });
  if (byWords.length === 1) return { status: 'found', products: byWords };
  if (byWords.length > 1) return { status: 'many', products: byWords };

  const nameWords = new Set(want);
  const inName = (catalog || []).filter((p) => {
    const t = tokens(p.title);
    return t.length > 0 && t.every((w) => nameWords.has(w));
  });
  if (inName.length === 1) return { status: 'found', products: inName };
  if (inName.length > 1) return { status: 'many', products: inName };
  return { status: 'not_found', products: [] };
}

function matchByField(names, catalog, field) {
  const want = (names || []).map(norm).filter(Boolean);
  if (!want.length) return { products: [], missing: [] };
  const products = [];
  const missing = [];
  for (const w of want) {
    const hits = (catalog || []).filter((p) => {
      const v = p[field];
      return Array.isArray(v) ? v.some((x) => norm(x) === w) : norm(v) === w;
    });
    if (hits.length) products.push(...hits); else missing.push(w);
  }
  return { products, missing };
}

function uniqueById(list) {
  const seen = new Set();
  return list.filter((p) => {
    const id = numericId(p?.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// side: { products: [names], collections: [names], productTypes: [names], tags: [names] }
// collections: [{ id, title }] with catalog products carrying collectionIds.
// Shopping words a merchant uses for a kind of product that its titles
// rarely contain ("tops", "bottoms"): each maps to words that do show up in
// titles, types or tags. Only used when nothing matches the word itself.
export const CATEGORY_WORDS = {
  top: ['top', 't-shirt', 'tshirt', 'tee', 'shirt', 'polo', 'hoodie', 'sweatshirt', 'sweater', 'jumper', 'cardigan', 'blouse', 'tank', 'camisole', 'crop', 'kurta', 'kurti', 'tunic', 'jacket', 'blazer', 'vest', 'bodysuit', 'henley', 'jersey'],
  bottom: ['bottom', 'jogger', 'pant', 'trouser', 'jean', 'denim', 'short', 'legging', 'jegging', 'skirt', 'chino', 'cargo', 'pyjama', 'pajama', 'trackpant', 'track pant', 'palazzo', 'culotte', 'salwar', 'dhoti', 'capri', 'sweatpant', 'lower'],
  footwear: ['shoe', 'sneaker', 'sandal', 'slipper', 'boot', 'heel', 'flat', 'loafer', 'flip flop', 'footwear'],
  accessory: ['cap', 'hat', 'belt', 'bag', 'wallet', 'sock', 'scarf', 'watch', 'sunglass', 'jewellery', 'jewelry', 'earring', 'necklace', 'bracelet', 'ring', 'accessory', 'accessories'],
  innerwear: ['brief', 'boxer', 'trunk', 'bra', 'panty', 'vest', 'innerwear', 'underwear', 'lingerie'],
};

function hasWords(text, words) {
  const have = new Set(tokens(text));
  return words.every((w) => have.has(w));
}

// A group word ("tops", "bottom wear", "socks") that is not a product title:
// a collection, product type or tag with that word, else the category's
// usual title words (CATEGORY_WORDS). Returns { products, via } or null.
export function matchGroup(name, catalog, collections = []) {
  const want = tokens(name).filter((w) => !['all', 'every', 'the', 'my', 'our', 'any', 'wear', 'item', 'product'].includes(w));
  if (!want.length) return null;
  const cols = (collections || []).filter((c) => hasWords(c.title, want));
  if (cols.length) {
    const ids = new Set(cols.map((c) => c.id));
    const products = (catalog || []).filter((p) => (p.collectionIds || []).some((id) => ids.has(id)));
    if (products.length) return { products, via: `collection ${cols.map((c) => `"${c.title}"`).join(', ')}` };
  }
  const byType = (catalog || []).filter((p) => p.productType && hasWords(p.productType, want));
  if (byType.length) return { products: byType, via: 'product type' };
  const byTag = (catalog || []).filter((p) => (p.tags || []).some((t) => hasWords(t, want)));
  if (byTag.length) return { products: byTag, via: 'tag' };
  const words = want.length === 1 ? CATEGORY_WORDS[want[0]] : null;
  if (words) {
    const lists = words.map((w) => tokens(w));
    const fits = (text) => lists.some((l) => hasWords(text, l));
    const products = (catalog || []).filter((p) => fits(p.title) || (p.productType && fits(p.productType)) || (p.tags || []).some(fits));
    if (products.length) return { products, via: 'product names' };
  }
  return null;
}

function resolveSide(side, catalog, collections, warnings, label) {
  const found = [];
  for (const name of side?.products || []) {
    const m = matchProducts(name, catalog);
    if (m.status !== 'not_found') { found.push(...m.products); continue; }
    const group = matchGroup(name, catalog, collections);
    if (group) found.push(...group.products);
    else warnings.push(`No product, collection, type or tag matches "${name}" in your store (${label}).`);
  }
  for (const name of side?.collections || []) {
    const n = norm(name);
    const col = (collections || []).find((c) => norm(c.title) === n)
      || (collections || []).find((c) => norm(c.title).includes(n) || n.includes(norm(c.title)));
    if (!col) { warnings.push(`No collection called "${name}" (${label}).`); continue; }
    const members = (catalog || []).filter((p) => (p.collectionIds || []).includes(col.id));
    if (!members.length) warnings.push(`Collection "${col.title}" has no active products (${label}).`);
    found.push(...members);
  }
  const types = matchByField(side?.productTypes, catalog, 'productType');
  types.missing.forEach((t) => warnings.push(`No products of type "${t}" (${label}).`));
  found.push(...types.products);
  const tags = matchByField(side?.tags, catalog, 'tags');
  tags.missing.forEach((t) => warnings.push(`No products tagged "${t}" (${label}).`));
  found.push(...tags.products);
  return uniqueById(found);
}

function sideIsEmpty(side) {
  return !['products', 'collections', 'productTypes', 'tags'].some((k) => (side?.[k] || []).length);
}

function ruleName(triggers, allProducts) {
  if (allProducts) return 'All products';
  if (triggers.length === 1) return triggers[0].title;
  return `${triggers[0].title} + ${triggers.length - 1} more`;
}

// plan: { rules: [{ trigger: { allProducts, products, collections, productTypes, tags },
//                   offer:   { products, collections, productTypes, tags, fromOrderHistory, count } }] }
// (what the model is asked to return — any field may be missing).
// pairs: computeOrderPairs(...).pairs, used by fromOrderHistory.
// Returns { rules: [{ name, allProducts, triggerProducts, offerProducts, basis }], warnings }.
// A rule with no real offer product is dropped (with a warning), never
// padded with something unrelated.
export function buildRulesFromPlan(plan, { catalog = [], collections = [], pairs = [], maxOffers = 3 } = {}) {
  const warnings = [];
  const rules = [];
  const cap = Math.max(1, Math.min(MAX_OFFERS_PER_RULE, Number(maxOffers) || 3));
  const byId = new Map(catalog.map((p) => [numericId(p.id), p]));

  for (const raw of plan?.rules || []) {
    const allProducts = Boolean(raw?.trigger?.allProducts) && sideIsEmpty(raw?.trigger);
    let triggers = allProducts ? [] : resolveSide(raw?.trigger, catalog, collections, warnings, 'trigger');
    if (!allProducts && !triggers.length) {
      if (!sideIsEmpty(raw?.trigger)) warnings.push('Skipped a rule: none of its trigger products were found.');
      continue;
    }
    if (triggers.length > MAX_TRIGGERS_PER_RULE) {
      warnings.push(`"${ruleName(triggers, false)}" matched ${triggers.length} products; only the first ${MAX_TRIGGERS_PER_RULE} are used.`);
      triggers = triggers.slice(0, MAX_TRIGGERS_PER_RULE);
    }
    const count = Math.max(1, Math.min(MAX_OFFERS_PER_RULE, Number(raw?.offer?.count) || cap));

    if (raw?.offer?.fromOrderHistory && sideIsEmpty(raw?.offer)) {
      if (allProducts) {
        warnings.push('"What customers buy together" needs specific trigger products, not all products.');
        continue;
      }
      // One rule per trigger, each with its own best partners.
      for (const t of triggers) {
        const offers = partnersOf(pairs, t.id, count + 1)
          .map((x) => byId.get(x.id))
          .filter((p) => p && numericId(p.id) !== numericId(t.id))
          .slice(0, count);
        if (!offers.length) { warnings.push(`No past orders pair "${t.title}" with another active product yet.`); continue; }
        rules.push({ name: t.title, allProducts: false, triggerProducts: [toRuleProduct(t)], offerProducts: offers.map(toRuleProduct), basis: 'orders' });
      }
      continue;
    }

    const triggerIds = new Set(triggers.map((p) => numericId(p.id)));
    let offers = resolveSide(raw?.offer, catalog, collections, warnings, 'recommend').filter((p) => !triggerIds.has(numericId(p.id)));
    if (!offers.length) {
      warnings.push(`Skipped "${ruleName(triggers, allProducts)}": nothing to recommend was found.`);
      continue;
    }
    if (offers.length > count) {
      // Several matches ("socks" → 6 socks): keep the ones bought most often
      // with these triggers, then catalog order.
      const score = new Map();
      for (const t of triggers) for (const x of partnersOf(pairs, t.id, 50)) score.set(x.id, (score.get(x.id) || 0) + x.together);
      offers = offers
        .map((p, i) => ({ p, i, s: score.get(numericId(p.id)) || 0 }))
        .sort((x, y) => y.s - x.s || x.i - y.i)
        .map((x) => x.p);
      warnings.push(`"${ruleName(triggers, allProducts)}": ${offers.length} products matched what to recommend; kept the top ${count}.`);
      offers = offers.slice(0, count);
    }
    rules.push({
      name: ruleName(triggers, allProducts),
      allProducts,
      triggerProducts: triggers.map(toRuleProduct),
      offerProducts: offers.map(toRuleProduct),
      basis: 'prompt',
    });
  }

  return { rules: mergeDuplicateRules(rules), warnings };
}

// ── Plain-text fallback when no AI is available ─────────────────────────────
// One pairing per line (or per ";"): "A with B, C", "A -> B", "A => B",
// "A: B", "pair A with B", "if A then B", "A goes with B".
// "with what customers buy" / "with best sellers" style right sides become
// fromOrderHistory. "all products"/"everything" on the left = allProducts.
export function parsePromptHeuristically(text) {
  const rules = [];
  const parts = String(text || '').split(/\n|;/).map((s) => s.trim()).filter(Boolean);
  const names = (s) => s.split(/,|\band\b|&|\+/i).map((x) => x.trim()).filter(Boolean);
  for (const part of parts) {
    // "match the tops and bottoms", "pair A & B", "A and B together": both ways.
    const both = part.replace(/[.!]+$/, '').match(/^(?:please\s+)?(?:match|pair|combine|link|club|bundle)\s+(?:up\s+)?(?:the\s+)?(.+?)\s+(?:and|&|\+)\s+(?:the\s+)?(.+?)(?:\s+together)?$/i)
      || part.replace(/[.!]+$/, '').match(/^(?:the\s+)?(.+?)\s+(?:and|&|\+)\s+(?:the\s+)?(.+?)\s+(?:together|as a set|as a combo)$/i);
    if (both && !/\bwith\b/i.test(part)) {
      const a = both[1].trim();
      const b = both[2].trim();
      rules.push({ trigger: { products: [a] }, offer: { products: [b] } });
      rules.push({ trigger: { products: [b] }, offer: { products: [a] } });
      continue;
    }
    const cleaned = part.replace(/^(please\s+)?(pair|show|recommend|suggest|offer)\s+/i, '').replace(/^if\s+/i, '');
    const m = cleaned.match(/^(.+?)\s*(?:->|=>|→|:|\bthen\b|\bgoes with\b|\bgo with\b|\bwith\b|\balongside\b)\s*(.+)$/i);
    if (!m) continue;
    const left = m[1].trim();
    const right = m[2].trim().replace(/[.!]+$/, '');
    const all = /^(all|every|any)\s*(products?|items?)?$|^everything$/i.test(left);
    const history = /(usually|often|frequently|customers|people)\s.*\b(buy|bought|order)|order history|past orders|bought together/i.test(right);
    rules.push({
      trigger: all ? { allProducts: true } : { products: names(left) },
      offer: history ? { fromOrderHistory: true } : { products: names(right) },
    });
  }
  return { rules };
}

// ── Dedupe ──────────────────────────────────────────────────────────────────

export function ruleKey(triggerIds, offerIds) {
  const set = (ids) => Array.from(new Set((ids || []).map(numericId).filter(Boolean))).sort().join(',');
  return `${set(triggerIds)}=>${set(offerIds)}`;
}

function mergeDuplicateRules(rules) {
  const seen = new Set();
  return rules.filter((r) => {
    const k = ruleKey(r.triggerProducts.map((p) => p.id), r.offerProducts.map((p) => p.id));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── Shapes each surface stores ──────────────────────────────────────────────
// rule: { name, allProducts, triggerProducts, offerProducts } from above.

export function toFbtRule(rule, id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`) {
  return {
    id,
    name: rule.name,
    displayScope: rule.allProducts ? 'all' : 'per_product',
    triggerProducts: rule.allProducts ? [] : rule.triggerProducts,
    fbtProducts: rule.offerProducts,
    aiGenerated: false,
  };
}

export function toUpsellRule(rule, id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`) {
  const triggers = rule.allProducts ? [] : rule.triggerProducts;
  return {
    id,
    triggerType: triggers.length ? 'specific' : 'all',
    triggerProductCount: Math.max(1, triggers.length),
    triggerProductIds: triggers.map((p) => p.id),
    upsellProductCount: rule.offerProducts.length,
    upsellProductIds: rule.offerProducts.map((p) => p.id),
    upsellProductDetails: rule.offerProducts,
  };
}

export function fbtRuleKey(r) {
  return ruleKey((r.triggerProducts || []).map((p) => p.id), (r.fbtProducts || []).map((p) => p.id));
}

export function upsellRuleKey(r) {
  return ruleKey(r.triggerProductIds || [], r.upsellProductIds || []);
}

// ── FBT AI-Powered mode: the merchant's instructions first ──────────────────
// autoRules: buildAiFbtRules(...).rules — [{ name, trigger_products: [one product], fbt_products }].
// pinned: rules from the merchant's instructions (buildRulesFromPlan shape).
// catalog: the AI run's catalog ({ gid, title, handle, image, price }), so an
// "every product" instruction reaches products the automatic run skipped.
// Each product's offers = its instruction offers, then "every product"
// offers, then the automatic picks, up to countPerProduct (instruction offers
// are all kept, up to MAX_OFFERS_PER_RULE, even past that count). A product
// named only in the instructions gets a rule too.
// Returns { rules, pinnedProducts } in the autoRules shape.
export function mergeInstructionRules(autoRules, pinned, countPerProduct, catalog = []) {
  const n = Math.max(1, Math.min(MAX_OFFERS_PER_RULE, Number(countPerProduct) || 3));
  const global = uniqueById((pinned || []).filter((r) => r.allProducts).flatMap((r) => r.offerProducts || []));
  const perProduct = new Map();
  for (const r of pinned || []) {
    if (r.allProducts) continue;
    for (const t of r.triggerProducts || []) {
      const id = numericId(t.id);
      if (!id) continue;
      if (!perProduct.has(id)) perProduct.set(id, { product: t, offers: [] });
      perProduct.get(id).offers.push(...(r.offerProducts || []));
    }
  }

  let pinnedProducts = 0;
  const offersFor = (product, auto) => {
    const id = numericId(product.id);
    const notSelf = (p) => numericId(p.id) !== id;
    const mine = uniqueById([...(perProduct.get(id)?.offers || []), ...global]).filter(notSelf).slice(0, MAX_OFFERS_PER_RULE);
    if (mine.length) pinnedProducts++;
    return uniqueById([...mine, ...(auto || [])]).filter(notSelf).slice(0, Math.max(n, mine.length)).map(toRuleProduct);
  };
  const ruleFor = (product, auto, fallbackName) => {
    const fbt = offersFor(product, auto);
    if (!fbt.length) return null;
    const pinnedHere = perProduct.has(numericId(product.id)) || global.length > 0;
    return { name: pinnedHere ? `Your rule: ${product.title}` : fallbackName, trigger_products: [toRuleProduct(product)], fbt_products: fbt };
  };

  const rules = [];
  const done = new Set();
  for (const r of autoRules || []) {
    const product = r.trigger_products?.[0];
    if (!product) continue;
    done.add(numericId(product.id));
    const merged = ruleFor(product, r.fbt_products, r.name);
    if (merged) rules.push(merged);
  }
  for (const [id, entry] of perProduct) {
    if (done.has(id)) continue;
    done.add(id);
    const merged = ruleFor(entry.product, [], `Your rule: ${entry.product.title}`);
    if (merged) rules.push(merged);
  }
  if (global.length) {
    for (const p of catalog || []) {
      const product = { id: p.gid || p.id, title: p.title, handle: p.handle, image: p.image, price: p.price };
      const id = numericId(product.id);
      if (!id || done.has(id)) continue;
      done.add(id);
      const merged = ruleFor(product, [], `Your rule: ${product.title}`);
      if (merged) rules.push(merged);
    }
  }
  return { rules, pinnedProducts };
}

// Changes when the instructions or the per-product count change, so the
// model is only asked again then (saved with the resolved rules).
export function instructionsHash(text, countPerProduct) {
  const s = `${Number(countPerProduct) || 3}|${String(text || '').trim().replace(/\s+/g, ' ')}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

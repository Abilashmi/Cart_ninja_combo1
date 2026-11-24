// Server half of the Pairing Assistant (FBT page + Cart Editor upsells):
//   - loadOrderPairs: which products customers actually buy together, from
//     recent Shopify orders plus the older orders BRIX recorded through the
//     orders webhooks (store_order_line_items). Nothing is written.
//   - suggestRulesFromPrompt: the merchant describes pairings in words, the
//     model turns that into a structured plan, and buildRulesFromPlan matches
//     every name to the real catalog (a rule can never hold an invented
//     product). Falls back to a plain "A with B" parser without a model.
// Results are previews only: the page adds the chosen rules to its own
// manual rules and the merchant's Save publishes them as before.
import { getDb } from './db.server';
import { ensureAnalyticsTables } from './analytics-schema.server';
import { callLlmWithMeta, parseJsonReply } from './ai-llm.server';
import { withTimeout } from '../utils/with-timeout';
import {
  computeOrderPairs, buildRulesFromPlan, parsePromptHeuristically, numericId, productGid, instructionsHash, typesByKind, fillEveryType,
} from '../utils/pairing.shared';

const SHOPIFY_CALL_TIMEOUT_MS = 20_000;
// Whole-run budget for paging through orders, so the request always returns.
const ORDER_SCAN_BUDGET_MS = 25_000;
const ORDER_PAGE_SIZE = 40;
const ORDER_PAGE_LIMIT = 15;
const DB_LINE_LIMIT = 20_000;
const CATALOG_CAP = 500;
const PAIR_LIMIT = 60;
const CACHE_MS = 5 * 60_000;

const pairCache = new Map();

function sinceDate(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function gql(admin, query, variables) {
  const res = await withTimeout(admin.graphql(query, { variables }), SHOPIFY_CALL_TIMEOUT_MS, null);
  if (!res) return { data: null, error: 'timeout' };
  const json = await res.json();
  if (json.errors?.length) {
    const throttled = json.errors.some((e) => e?.extensions?.code === 'THROTTLED');
    return { data: json.data || null, error: throttled ? 'throttled' : (json.errors[0]?.message || 'error') };
  }
  return { data: json.data, error: null };
}

// Newest first. Shopify only returns the last 60 days without the
// read_all_orders scope, which is why the webhook-recorded orders are merged in.
async function fetchShopifyOrders(admin, days) {
  const orders = [];
  const started = Date.now();
  let cursor = null;
  let stoppedEarly = false;
  for (let page = 0; page < ORDER_PAGE_LIMIT; page++) {
    if (Date.now() - started > ORDER_SCAN_BUDGET_MS) { stoppedEarly = true; break; }
    const { data, error } = await gql(admin, `
      query PairingOrders($cursor: String, $query: String!) {
        orders(first: ${ORDER_PAGE_SIZE}, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $query) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            test
            cancelledAt
            lineItems(first: 10) { nodes { title product { id } } }
          }
        }
      }`, { cursor, query: `created_at:>=${sinceDate(days)}` });
    const conn = data?.orders;
    if (!conn) { stoppedEarly = page > 0 || Boolean(error); break; }
    for (const o of conn.nodes || []) {
      if (o.test || o.cancelledAt) continue;
      orders.push({
        id: numericId(o.id),
        products: (o.lineItems?.nodes || []).filter((li) => li.product?.id).map((li) => ({ id: li.product.id, title: li.title })),
      });
    }
    if (error) { stoppedEarly = true; break; }
    if (!conn.pageInfo?.hasNextPage) break;
    if (page === ORDER_PAGE_LIMIT - 1) stoppedEarly = true;
    cursor = conn.pageInfo.endCursor;
  }
  return { orders, stoppedEarly };
}

async function fetchRecordedOrders(shop, days) {
  try {
    const db = getDb();
    await ensureAnalyticsTables(db);
    const [rows] = await db.execute(
      `SELECT li.order_id, li.product_id, li.product_title
       FROM store_order_line_items li
       JOIN store_orders o ON o.shop_domain = li.shop_domain AND o.order_id = li.order_id
       WHERE li.shop_domain = ? AND o.cancelled_at IS NULL AND o.is_test = 0
         AND li.product_id IS NOT NULL AND li.created_at_shopify >= ?
       ORDER BY li.created_at_shopify DESC
       LIMIT ${DB_LINE_LIMIT}`,
      [shop, `${sinceDate(days)} 00:00:00`]
    );
    const byOrder = new Map();
    for (const r of rows) {
      const id = String(r.order_id);
      if (!byOrder.has(id)) byOrder.set(id, { id, products: [] });
      byOrder.get(id).products.push({ id: r.product_id, title: r.product_title });
    }
    return Array.from(byOrder.values());
  } catch (e) {
    console.error('[pairing-assistant] recorded orders:', e.message);
    return [];
  }
}

async function fetchProductDetails(admin, ids) {
  const out = new Map();
  const gids = Array.from(new Set(ids.map(productGid).filter(Boolean)));
  for (let i = 0; i < gids.length; i += 100) {
    const { data } = await gql(admin, `
      query PairingProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product { id title handle status featuredImage { url } priceRangeV2 { minVariantPrice { amount } } }
        }
      }`, { ids: gids.slice(i, i + 100) });
    for (const n of data?.nodes || []) {
      if (!n?.id) continue;
      out.set(numericId(n.id), {
        id: n.id,
        title: n.title,
        handle: n.handle,
        image: n.featuredImage?.url || '',
        price: n.priceRangeV2?.minVariantPrice?.amount || '0',
        active: n.status === 'ACTIVE',
      });
    }
  }
  return out;
}

// The expensive part (paging Shopify + reading recorded orders), cached per
// shop and window. Returns { orders, shopifyOrders, recordedOrders, stoppedEarly }.
async function loadOrders(admin, shop, days, fresh) {
  const key = `${shop}|${days}`;
  const hit = pairCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const [shopify, recorded] = await Promise.all([fetchShopifyOrders(admin, days), fetchRecordedOrders(shop, days)]);
  const merged = new Map(recorded.map((o) => [o.id, o]));
  for (const o of shopify.orders) merged.set(o.id, o);
  const value = {
    orders: Array.from(merged.values()),
    shopifyOrders: shopify.orders.length,
    recordedOrders: recorded.length,
    stoppedEarly: shopify.stoppedEarly,
  };
  pairCache.set(key, { at: Date.now(), value });
  return value;
}

function clampDays(days) {
  return Math.max(7, Math.min(730, Number(days) || 90));
}

// Every pair (no product details) — for "what customers buy with X" rules.
export async function loadAllPairs(admin, shop, { days = 365 } = {}) {
  const { orders } = await loadOrders(admin, shop, clampDays(days), false);
  return computeOrderPairs(orders, { limit: 5000 }).pairs;
}

// Returns { pairs, totalOrders, multiItemOrders, shopifyOrders, recordedOrders,
// days, stoppedEarly }. Each pair's a/b carry full product details plus
// `active` (false = archived/draft/deleted, so it can't go into a rule).
export async function loadOrderPairs(admin, shop, { days = 90, fresh = false } = {}) {
  const windowDays = clampDays(days);
  const loaded = await loadOrders(admin, shop, windowDays, fresh);
  const stats = computeOrderPairs(loaded.orders, { limit: PAIR_LIMIT });
  const details = await fetchProductDetails(admin, stats.pairs.flatMap((p) => [p.a.id, p.b.id]));
  const withDetails = (side) => {
    const d = details.get(side.id);
    return d ? { ...d } : { id: productGid(side.id), title: side.title || `Product #${side.id}`, handle: '', image: '', price: '0', active: false };
  };
  return {
    days: windowDays,
    totalOrders: stats.totalOrders,
    multiItemOrders: stats.multiItemOrders,
    shopifyOrders: loaded.shopifyOrders,
    recordedOrders: loaded.recordedOrders,
    stoppedEarly: loaded.stoppedEarly,
    pairs: stats.pairs.map((p) => ({ ...p, a: withDetails(p.a), b: withDetails(p.b) })),
  };
}

// Active products with what the prompt can refer to: title, type, tags,
// collections. Returns { catalog, collections, truncated }.
export async function loadPairingCatalog(admin) {
  const catalog = [];
  const collections = new Map();
  let cursor = null;
  let truncated = false;
  for (let page = 0; page < Math.ceil(CATALOG_CAP / 100); page++) {
    const { data } = await gql(admin, `
      query PairingCatalog($cursor: String) {
        products(first: 100, after: $cursor, query: "status:active", sortKey: TITLE) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id title handle productType tags
            featuredImage { url }
            priceRangeV2 { minVariantPrice { amount } }
            collections(first: 5) { nodes { id title } }
          }
        }
      }`, { cursor });
    const conn = data?.products;
    if (!conn) break;
    for (const n of conn.nodes || []) {
      const cols = n.collections?.nodes || [];
      cols.forEach((c) => collections.set(c.id, { id: c.id, title: c.title }));
      catalog.push({
        id: n.id,
        title: n.title,
        handle: n.handle,
        productType: n.productType || '',
        tags: n.tags || [],
        image: n.featuredImage?.url || '',
        price: n.priceRangeV2?.minVariantPrice?.amount || '0',
        collectionIds: cols.map((c) => c.id),
      });
    }
    if (!conn.pageInfo?.hasNextPage) break;
    if (catalog.length >= CATALOG_CAP) { truncated = true; break; }
    cursor = conn.pageInfo.endCursor;
  }
  return { catalog: catalog.slice(0, CATALOG_CAP), collections: Array.from(collections.values()), truncated };
}

const PLAN_SHAPE = '{"everyKind":false,"rules":[{"trigger":{"allProducts":false,"products":[],"collections":[],"productTypes":[],"tags":[]},"offer":{"products":[],"collections":[],"productTypes":[],"tags":[],"fromOrderHistory":false,"count":null}}],"question":null}';

// A title cut at a word, never mid-word (the model copies what it sees).
function shortTitle(title, max = 110) {
  const t = String(title || '');
  return t.length <= max ? t : t.slice(0, max).replace(/\s+\S*$/, '');
}

export function buildPlanMessages(prompt, { catalog, collections }) {
  const productLines = catalog.slice(0, 300).map((p) => {
    const extra = [p.productType, ...(p.tags || []).slice(0, 4)].filter(Boolean).join(', ');
    return `- ${shortTitle(p.title)}${extra ? ` (${extra})` : ''}`;
  });
  const typeCounts = new Map();
  catalog.forEach((p) => { if (p.productType) typeCounts.set(p.productType, (typeCounts.get(p.productType) || 0) + 1); });
  const types = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([t, n]) => `${t} (${n})`);
  const system = [
    'You turn a Shopify merchant\'s instructions about which products should be recommended together into JSON.',
    `Reply with ONLY this JSON shape, nothing else: ${PLAN_SHAPE}`,
    'One entry in "rules" per pairing the merchant describes — NOT one per product: the server expands groups into per-product rules itself.',
    'Prefer groups: product types (copy them exactly from the list, without the count), collections, tags, or a group word ("tops", "jeans"). Never list a group\'s products one by one.',
    'Keep it short: at most 30 rules and at most 12 names in any list. A trigger may list several product types of the same kind and gender at once (e.g. all girls\' bottomwear types) to save rules.',
    'Ignore anything about layout, display, design or wording — only pairings matter.',
    'The merchant may write steps ("first identify the category, if it is a top recommend bottoms"): turn each "if X recommend Y" into a rule X → Y.',
    'A mix for one product ("2 tops, 2 bottoms and 1 dress") = one rule per part, same trigger, each with its own count (2, 2, 1), in that order.',
    'When the merchant talks about kinds of products, write the kind names from "Product types by kind" (e.g. "topwear", "bottomwear", "dresses", "co-ord sets") in "products"; the server turns each into its product types. Each list holds only its own kind: dresses and co-ord sets never go in a topwear or bottomwear list.',
    'Set "everyKind": true when the merchant states a general idea that should apply to every kind of product (e.g. "recommend complementary products, not the same category"); then write rules with every kind in "Product types by kind" as a trigger.',
    'If the merchant states a general idea (e.g. "recommend complementary products, not the same category", "at least 2 from other categories") and gives an example for only one category, write rules in the same spirit for EVERY main product type in the store (tops, bottoms, dresses, co-ord sets, ...), recommending other kinds that are worn or used with it.',
    'Boys\' and girls\' products are kept apart by the server, so kind names are enough.',
    '"trigger" = the product the shopper is looking at or has in the cart. "offer" = what to recommend with it.',
    'Copy product titles exactly from the catalog when the merchant clearly means one product.',
    'When they mean a group (e.g. "all joggers", "socks"), put that word in "products" as written (every product whose title contains it is used), or use a matching collection / product type / tag.',
    'If a group word (e.g. "tops", "bottoms", "snacks") is not in any title, collection, type or tag above, list the exact titles of the catalog products that belong to that group instead.',
    'If they ask to match / pair / combine two groups without saying which way (e.g. "match tops and bottoms"), return two rules: tops → bottoms and bottoms → tops.',
    'If they say "every product" / "all products" as the trigger, set "allProducts": true and leave the trigger lists empty.',
    'If they ask for what customers usually buy with something / past orders / bought together, set offer.fromOrderHistory true and leave the offer lists empty.',
    'Set offer.count only if they give a number of recommendations.',
    'Never invent products, collections or types that are not in the lists.',
    'If the message does not describe any pairing, return {"rules":[],"question":"<one short question asking what should be paired>"}.',
  ].join('\n');
  const user = [
    `Products (${catalog.length}${catalog.length > 300 ? ', first 300 shown' : ''}):`,
    ...productLines,
    '',
    `Collections: ${collections.map((c) => c.title).slice(0, 80).join(' | ') || 'none'}`,
    `Product types (with how many products): ${types.join(' | ') || 'none'}`,
    `Product types by kind (use these for topwear / bottomwear / dresses / co-ord sets …): ${Object.entries(typesByKind(catalog)).map(([k, list]) => `${k}: ${list.join(', ')}`).join(' | ') || 'none'}`,
    '',
    `Merchant: ${prompt}`,
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function cleanPlan(plan) {
  const list = (v) => (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 50) : []);
  const side = (s, offer) => ({
    // "All products" only when nothing is named (a named type always wins).
    allProducts: !offer && Boolean(s?.allProducts) && !['products', 'collections', 'productTypes', 'tags'].some((k) => list(s?.[k]).length),
    products: list(s?.products),
    collections: list(s?.collections),
    productTypes: list(s?.productTypes),
    tags: list(s?.tags),
    ...(offer ? { fromOrderHistory: Boolean(s?.fromOrderHistory), count: Number(s?.count) || null } : {}),
  });
  return {
    everyKind: Boolean(plan?.everyKind),
    rules: (Array.isArray(plan?.rules) ? plan.rules : []).slice(0, 40).map((r) => ({ trigger: side(r?.trigger, false), offer: side(r?.offer, true) })),
    question: typeof plan?.question === 'string' && plan.question.trim() ? plan.question.trim() : null,
  };
}

// The model's reply as a plan: plain JSON, JSON inside text, or — when the
// reply was cut off — every complete rule before the cut.
export function readPlanReply(text) {
  const plain = parseJsonReply(text, null);
  if (plain && typeof plain === 'object') return plain;
  const t = String(text || '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch { /* cut off, below */ }
  }
  const at = t.indexOf('"rules"');
  const open = at === -1 ? -1 : t.indexOf('[', at);
  if (open === -1) return null;
  const rules = [];
  let depth = 0;
  let from = -1;
  let inString = false;
  for (let i = open + 1; i < t.length; i++) {
    const c = t[i];
    if (inString) { if (c === '\\') i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === '{') { if (depth === 0) from = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && from !== -1) {
        try { rules.push(JSON.parse(t.slice(from, i + 1))); } catch { /* skip */ }
        from = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  return rules.length ? { rules } : null;
}

function planWantsHistory(plan) {
  return plan.rules.some((r) => r.offer?.fromOrderHistory);
}

// Wording that means "do this for every product", not one pairing.
const GENERAL_IDEA = /\b(complementary|complement|ideally|in general|generally|always|every (?:product|item|category|page)|all (?:products|items|categories|product pages)|any product|should (?:show|recommend|suggest|display)|at least \d)/i;

// consumeCredit: async () => boolean, called only when the model would be used;
// false = no AI credit left (yearly plans stop at the monthly credits), words only.
// Returns { rules, warnings, question, usedAi, catalogTruncated }.
export async function suggestRulesFromPrompt(admin, shop, prompt, { maxOffers = 3, consumeCredit } = {}) {
  const text = String(prompt || '').trim().slice(0, 2000);
  if (!text) return { rules: [], warnings: [], question: 'Describe which products should be recommended with which.', usedAi: false };

  const { catalog, collections, truncated } = await loadPairingCatalog(admin);
  if (!catalog.length) return { rules: [], warnings: ['Could not load your products from Shopify. Please try again.'], question: null, usedAi: false };

  let plan = null;
  let usedAi = false;
  // consumeCredit() === false: no AI credit left this month, words only.
  const creditOk = process.env.OPENAI_API_KEY && (!consumeCredit || (await consumeCredit()) !== false);
  if (creditOk) {
    const messages = buildPlanMessages(text, { catalog, collections });
    const reply = await callLlmWithMeta(messages, { maxTokens: 2500, temperature: 0, json: true, timeoutMs: 45_000 });
    if (reply.content) {
      const read = readPlanReply(reply.content);
      if (!read) console.warn('[pairing-assistant] model reply not usable', reply.finishReason, String(reply.content).slice(0, 200));
      if (read) {
        usedAi = true;
        plan = cleanPlan(read);
        // A general idea must reach every kind: ask once more for any kind the
        // model left out as a trigger (same idea, only the new rules).
        // A general idea, flagged by the model or plain in the wording.
        const general = plan.everyKind || GENERAL_IDEA.test(text);
        const filled = general ? fillEveryType(plan, catalog, collections) : { rules: plan.rules, missingKinds: [] };
        plan.rules = filled.rules;
        const missing = filled.missingKinds;
        if (missing.length) {
          const more = await callLlmWithMeta([
            ...messages,
            { role: 'assistant', content: reply.content },
            { role: 'user', content: `Now write rules in the same spirit with these kinds as the trigger: ${missing.join(', ')}. Reply with the same JSON shape holding only the new rules.` },
          ], { maxTokens: 2000, temperature: 0, json: true, timeoutMs: 30_000 });
          const extra = more.content ? readPlanReply(more.content) : null;
          if (extra) plan.rules = fillEveryType({ rules: [...plan.rules, ...cleanPlan(extra).rules] }, catalog, collections).rules;
        }
      }
    } else if (reply.errorStatus || reply.errorMessage) {
      console.warn('[pairing-assistant] model call failed', reply.errorStatus, reply.errorMessage);
    }
  }
  if (!plan || (!plan.rules.length && !plan.question)) {
    const fallback = cleanPlan(parsePromptHeuristically(text));
    if (fallback.rules.length || !plan) plan = fallback;
  }
  if (!plan.rules.length) {
    return {
      rules: [], warnings: [], usedAi, catalogTruncated: truncated,
      question: plan.question || 'I could not find a pairing in that. Try e.g. "Show socks with every jogger" or "Coffee Mug with Coffee Beans, Milk Frother".',
    };
  }

  const pairs = planWantsHistory(plan) ? await loadAllPairs(admin, shop, { days: 365 }) : [];
  const { rules, warnings } = buildRulesFromPlan(plan, { catalog, collections, pairs, maxOffers });
  if (!rules.length && !usedAi) {
    return {
      rules: [], warnings: [], usedAi, catalogTruncated: truncated,
      question: 'I couldn\'t turn that into pairings. Write one per line, e.g. "Tops with Jeans, Shorts, Skirts" or "If it\'s a top, recommend bottoms".',
    };
  }
  if (truncated) warnings.push(`Only your first ${CATALOG_CAP} products (A–Z) were searched.`);
  return { rules, warnings, question: rules.length ? null : plan.question, usedAi, catalogTruncated: truncated };
}

// FBT AI-Powered mode's instructions box. cached = { hash, rules, warnings }
// saved from the last run (fbt_widget_settings.ai_instruction_rules): the
// model is asked again only when the text or the count changed.
// Returns { rules, warnings, hash, fromCache, cacheable }.
export async function resolveFbtInstructions(admin, shop, text, { maxOffers = 3, cached = null, consumeCredit } = {}) {
  const clean = String(text || '').trim().slice(0, 2000);
  if (!clean) return { rules: [], warnings: [], hash: null, fromCache: false, cacheable: false };
  const hash = instructionsHash(clean, maxOffers);
  if (cached && cached.hash === hash && Array.isArray(cached.rules)) {
    return { rules: cached.rules, warnings: cached.warnings || [], hash, fromCache: true, cacheable: false };
  }
  const r = await suggestRulesFromPrompt(admin, shop, clean, { maxOffers, consumeCredit });
  const warnings = [...(r.warnings || [])];
  if (!r.rules.length && r.question) warnings.push(r.question);
  // Only worth keeping when something was understood; a model outage should
  // be retried on the next run, not remembered.
  return { rules: r.rules, warnings, hash, fromCache: false, cacheable: r.rules.length > 0 };
}

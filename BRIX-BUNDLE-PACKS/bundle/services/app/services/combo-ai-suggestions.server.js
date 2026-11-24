// "Enable AI Suggestions for Customers" (combo builder → Advanced → AI
// Settings, config.ai_mode). Once per template, the AI looks at the combo's
// own products and picks, for each product, up to 3 others from the same
// combo that a shopper who chose it is most likely to add next. The
// storefront combo page (combo-page[.]js.jsx) then shows those picks as a
// "Pairs well with your picks" row while the shopper builds their combo.
//
// The AI is never called per shopper: results are cached per template
// version (shop + template id + updated_at), so a combo page costs one AI
// call per edit per server instance, however many shoppers view it. Only
// products already in the combo are ever suggested, so a suggestion can
// never put an item in the cart that the merchant didn't choose for it.
//
// No Shopify/database imports here (the route does the loading), so this
// stays unit-testable: tests/combo-ai/combo-ai-suggestions.test.mjs.
import { callLlmWithMeta, parseJsonReply } from './ai-llm.server';

export const MAX_PRODUCTS_FOR_AI = 60;
export const MAX_PICKS_PER_PRODUCT = 3;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
// A failed AI call is remembered briefly so a busy page can't retry it on
// every shopper's visit, but recovers soon once the provider is back.
const FAILURE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;

const cache = new Map(); // key -> { pairs, ok, expiresAt }
const inflight = new Map(); // key -> Promise<{ pairs, ok }>

function plainText(html, max) {
  const text = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Every product the combo shows, once each, in the order the page shows them.
export function collectComboProducts(productsByHandle, collectionNameMap = {}) {
  const seen = new Set();
  const out = [];
  for (const [handle, products] of Object.entries(productsByHandle || {})) {
    for (const p of products || []) {
      if (!p?.id || seen.has(p.id)) continue;
      seen.add(p.id);
      out.push({
        id: p.id,
        title: String(p.title || '').trim(),
        collection: collectionNameMap[handle] || handle,
        price: p.price,
        currency: p.currency,
        description: plainText(p.descriptionHtml, 90),
      });
      if (out.length >= MAX_PRODUCTS_FOR_AI) return out;
    }
  }
  return out;
}

export function buildPairsPrompt(products, templateName) {
  const lines = products.map((p, i) => {
    const price = p.price != null && p.price !== '' ? ` — ${p.price}${p.currency ? ` ${p.currency}` : ''}` : '';
    const desc = p.description ? ` — ${p.description}` : '';
    return `${i}. ${p.title} [${p.collection}]${price}${desc}`;
  });
  return [
    {
      role: 'system',
      content: 'You are a merchandising assistant for an online store\'s build-your-own combo page. You reply with ONE raw JSON object only — no markdown, no explanation.',
    },
    {
      role: 'user',
      content: `Combo${templateName ? ` "${templateName}"` : ''} — products the shopper can choose from (index. title [collection] — price — description):
${lines.join('\n')}

For EVERY product above, pick up to ${MAX_PICKS_PER_PRODUCT} OTHER products from this same list that a shopper who just chose it is most likely to add to the same combo: items that complement it and complete the set. Pick from a DIFFERENT [collection] than the chosen product whenever the list has one; only use the same collection when no other collection fits. Never pick another version of the same kind of item (e.g. a second face wash for a face wash). Use only index numbers from the list, best match first.

Reply exactly in this shape, with one entry per product index:
{"pairs":{"0":[3,5,7],"1":[0,4,2]}}`,
    },
  ];
}

// Turns the model's reply into { [productId]: [productId, ...] }, dropping
// anything that isn't a real other product in this combo. Returns null when
// the reply has no usable picks at all.
export function parsePairsReply(products, replyText) {
  const parsed = parseJsonReply(replyText, null);
  const raw = parsed && typeof parsed === 'object' ? (parsed.pairs && typeof parsed.pairs === 'object' ? parsed.pairs : parsed) : null;
  if (!raw || Array.isArray(raw)) return null;

  const pairs = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    const from = Number(key);
    if (!Number.isInteger(from) || from < 0 || from >= products.length || !Array.isArray(value)) continue;
    const valid = [];
    for (const v of value) {
      const to = Number(v);
      if (!Number.isInteger(to) || to < 0 || to >= products.length || to === from || valid.includes(to)) continue;
      valid.push(to);
    }
    // The model doesn't reliably follow "prefer another collection", so
    // picks that complete the set (other collections) go first, keeping the
    // AI's order within each group; same-collection picks only fill gaps.
    const sameCollection = (to) => products[to].collection === products[from].collection;
    const picks = [...valid.filter((to) => !sameCollection(to)), ...valid.filter(sameCollection)]
      .slice(0, MAX_PICKS_PER_PRODUCT)
      .map((to) => products[to].id);
    if (picks.length > 0) {
      pairs[products[from].id] = picks;
      count += 1;
    }
  }
  return count > 0 ? pairs : null;
}

// llm may return the reply text, or callLlmWithMeta's { content,
// errorMessage } (the default) so a failure can say why. `reason` is only
// ever sent to the merchant's admin, never to the public storefront.
export async function generateComboPairs(products, templateName, { llm = callLlmWithMeta } = {}) {
  if (!Array.isArray(products) || products.length < 2) return { pairs: {}, ok: true };
  const res = await llm(buildPairsPrompt(products, templateName), {
    // ~3 small ints per product plus JSON punctuation.
    maxTokens: Math.min(2000, 200 + products.length * 22),
    temperature: 0.2,
  });
  const reply = res == null || typeof res === 'string' ? res : res.content;
  if (reply == null) {
    const why = res && typeof res === 'object' && res.errorMessage ? `: ${res.errorMessage}` : '';
    return { pairs: {}, ok: false, reason: `The AI service did not answer${why}` };
  }
  const pairs = parsePairsReply(products, reply);
  if (!pairs) {
    console.error('[combo-ai-suggestions] unusable AI reply:', String(reply).slice(0, 200));
    return { pairs: {}, ok: false, reason: 'The AI reply could not be read' };
  }
  return { pairs, ok: true };
}

export function comboAiCacheKey(shop, templateId, updatedAt) {
  const version = updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt || '');
  return `${shop}:${templateId}:${version}`;
}

function remember(key, result, failureTtlMs) {
  cache.delete(key);
  cache.set(key, { ...result, expiresAt: Date.now() + (result.ok ? SUCCESS_TTL_MS : failureTtlMs) });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

// loadProducts: async () => { products, templateName } — only called on a
// cache miss, since it costs several Admin API calls. Concurrent misses for
// the same key share one AI call. failureTtlMs: how long a failure is
// remembered (the builder uses a short one so the merchant can retry).
export async function getComboAiPairs(key, loadProducts, deps = {}, { failureTtlMs = FAILURE_TTL_MS } = {}) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return { pairs: hit.pairs, ok: hit.ok, reason: hit.reason, cached: true };
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    try {
      const { products, templateName } = await loadProducts();
      const result = await generateComboPairs(products, templateName, deps);
      remember(key, result, failureTtlMs);
      return { ...result, cached: false };
    } catch (err) {
      console.error('[combo-ai-suggestions] failed:', err?.message || err);
      const result = { pairs: {}, ok: false, reason: `Could not load the combo's products: ${err?.message || err}` };
      remember(key, result, failureTtlMs);
      return { ...result, cached: false };
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

export function clearComboAiCache() {
  cache.clear();
  inflight.clear();
}

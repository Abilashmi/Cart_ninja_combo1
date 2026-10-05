// Run with: node --import ./tests/packs/register.mjs --test tests/combo-ai
// Exercises app/services/combo-ai-suggestions.server.js with a fake LLM —
// no AI provider, database or Shopify store is touched.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectComboProducts, parsePairsReply, generateComboPairs, getComboAiPairs,
  comboAiCacheKey, clearComboAiCache, MAX_PRODUCTS_FOR_AI,
} from '../../app/services/combo-ai-suggestions.server.js';

const P = (n) => `gid://shopify/Product/${n}`;
const productsByHandle = {
  cleansers: [
    { id: P(1), title: 'Gel Cleanser', price: '499.00', currency: 'INR', descriptionHtml: '<p>Gentle <b>daily</b> wash</p>' },
    { id: P(2), title: 'Foam Cleanser', price: '450.00', currency: 'INR' },
  ],
  serums: [
    { id: P(3), title: 'Vitamin C Serum', price: '899.00', currency: 'INR' },
    { id: P(1), title: 'Gel Cleanser', price: '499.00', currency: 'INR' }, // in two collections
  ],
  spf: [{ id: P(4), title: 'SPF 50', price: '650.00', currency: 'INR' }],
};
const names = { cleansers: 'Cleansers', serums: 'Serums', spf: 'Sunscreen' };

beforeEach(() => clearComboAiCache());

test('collects each product once, with collection names and plain-text descriptions', () => {
  const products = collectComboProducts(productsByHandle, names);
  assert.deepEqual(products.map((p) => p.id), [P(1), P(2), P(3), P(4)]);
  assert.equal(products[0].collection, 'Cleansers');
  assert.equal(products[0].description, 'Gentle daily wash');
  assert.equal(products[3].collection, 'Sunscreen');
});

test('caps the product list sent to the AI', () => {
  const many = { big: Array.from({ length: 90 }, (_, i) => ({ id: P(i + 1), title: `Item ${i}` })) };
  assert.equal(collectComboProducts(many).length, MAX_PRODUCTS_FOR_AI);
});

test('parses fenced replies and drops self, out-of-range, duplicate and non-numeric picks', () => {
  const products = collectComboProducts(productsByHandle, names);
  const reply = '```json\n{"pairs":{"0":[0,2,2,9,"x",3,1],"1":[2],"7":[1],"2":[]}}\n```';
  assert.deepEqual(parsePairsReply(products, reply), {
    [P(1)]: [P(3), P(4), P(2)],
    [P(2)]: [P(3)],
  });
});

test('puts picks from other collections ahead of same-collection picks', () => {
  const products = collectComboProducts(productsByHandle, names);
  // 0 = Gel Cleanser; the AI listed the other cleanser first.
  assert.deepEqual(parsePairsReply(products, '{"pairs":{"0":[1,2]}}'), { [P(1)]: [P(3), P(2)] });
  // Only a same-collection pick available: still used.
  assert.deepEqual(parsePairsReply(products, '{"pairs":{"1":[0]}}'), { [P(2)]: [P(1)] });
});

test('accepts a reply without the "pairs" wrapper', () => {
  const products = collectComboProducts(productsByHandle, names);
  assert.deepEqual(parsePairsReply(products, '{"3":[0]}'), { [P(4)]: [P(1)] });
});

test('returns null for unusable replies', () => {
  const products = collectComboProducts(productsByHandle, names);
  assert.equal(parsePairsReply(products, 'Sure! Here are some ideas...'), null);
  assert.equal(parsePairsReply(products, '{"pairs":{}}'), null);
  assert.equal(parsePairsReply(products, '[1,2,3]'), null);
});

test('the prompt lists every product by index and asks for raw JSON', async () => {
  const products = collectComboProducts(productsByHandle, names);
  let seen;
  await generateComboPairs(products, 'Skin Kit', { llm: async (messages, opts) => { seen = { messages, opts }; return '{"pairs":{"0":[1]}}'; } });
  const user = seen.messages[1].content;
  assert.match(user, /0\. Gel Cleanser \[Cleansers\] — 499\.00 INR — Gentle daily wash/);
  assert.match(user, /3\. SPF 50 \[Sunscreen\]/);
  assert.match(user, /"Skin Kit"/);
  assert.ok(seen.opts.maxTokens >= 200);
});

test('a single-product combo never calls the AI', async () => {
  let called = false;
  const result = await generateComboPairs([{ id: P(1), title: 'Solo' }], '', { llm: async () => { called = true; return '{}'; } });
  assert.equal(called, false);
  assert.deepEqual(result, { pairs: {}, ok: true });
});

test('caches per template version and shares one AI call between concurrent requests', async () => {
  let llmCalls = 0;
  let loads = 0;
  const llm = async () => { llmCalls += 1; await new Promise((r) => setTimeout(r, 20)); return '{"pairs":{"0":[2]}}'; };
  const load = async () => { loads += 1; return { products: collectComboProducts(productsByHandle, names), templateName: 'Kit' }; };
  const key = comboAiCacheKey('shop.myshopify.com', 7, new Date('2026-10-01T00:00:00Z'));

  const [a, b] = await Promise.all([getComboAiPairs(key, load, { llm }), getComboAiPairs(key, load, { llm })]);
  assert.deepEqual(a.pairs, { [P(1)]: [P(3)] });
  assert.deepEqual(b.pairs, a.pairs);
  const c = await getComboAiPairs(key, load, { llm });
  assert.equal(c.cached, true);
  assert.equal(llmCalls, 1);
  assert.equal(loads, 1);

  // Saving the template bumps updated_at, which is a new key -> fresh picks.
  const newKey = comboAiCacheKey('shop.myshopify.com', 7, new Date('2026-10-02T00:00:00Z'));
  await getComboAiPairs(newKey, load, { llm });
  assert.equal(llmCalls, 2);
});

test('an AI failure returns no picks and is not retried on every request', async () => {
  let llmCalls = 0;
  const llm = async () => { llmCalls += 1; return null; };
  const load = async () => ({ products: collectComboProducts(productsByHandle, names), templateName: '' });
  const key = comboAiCacheKey('s', 1, 'v1');
  assert.deepEqual((await getComboAiPairs(key, load, { llm })).pairs, {});
  assert.deepEqual((await getComboAiPairs(key, load, { llm })).pairs, {});
  assert.equal(llmCalls, 1);
});

test('a failure says why (for the builder) and the builder can retry sooner', async () => {
  const products = collectComboProducts(productsByHandle, names);
  const quota = await generateComboPairs(products, '', { llm: async () => ({ content: null, errorMessage: 'You exceeded your current quota' }) });
  assert.equal(quota.ok, false);
  assert.match(quota.reason, /exceeded your current quota/);
  const garbled = await generateComboPairs(products, '', { llm: async () => 'no idea' });
  assert.equal(garbled.reason, 'The AI reply could not be read');
  const fromMeta = await generateComboPairs(products, '', { llm: async () => ({ content: '{"pairs":{"0":[2]}}' }) });
  assert.deepEqual(fromMeta.pairs, { [P(1)]: [P(3)] });

  let calls = 0;
  const load = async () => ({ products, templateName: '' });
  const failing = async () => { calls += 1; return null; };
  await getComboAiPairs('retry', load, { llm: failing }, { failureTtlMs: 0 });
  const again = await getComboAiPairs('retry', load, { llm: failing }, { failureTtlMs: 0 });
  assert.equal(calls, 2);
  assert.match(again.reason, /did not answer/);
});

test('a loader error returns no picks instead of throwing', async () => {
  const result = await getComboAiPairs('k', async () => { throw new Error('Admin API down'); }, { llm: async () => '{}' });
  assert.deepEqual(result.pairs, {});
  assert.equal(result.ok, false);
});

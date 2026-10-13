/* eslint-env node */
/* global globalThis */
// Run with: node --import ./tests/packs/register.mjs --test tests/pairing/*.test.mjs
// The Pairing Assistant's server side against a fake Shopify Admin API, an
// in-memory db_proxy.php (store_order_line_items only) and a fake LLM —
// no database, store or model is touched.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SHOPIFY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let recordedLines = [];
let llmReply = null;
let llmCalls = 0;
let llmPrompts = [];

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.openai.com')) {
    llmCalls++;
    llmPrompts.push(JSON.parse(init.body).messages);
    if (llmReply === null) return json({ error: { message: 'down' } }, 500);
    return json({ choices: [{ message: { content: llmReply }, finish_reason: 'stop' }] });
  }
  if (!u.endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT li.order_id')) return json({ success: true, rows: recordedLines });
  if (/^SELECT/i.test(q)) return json({ success: true, rows: [{ n: 1 }] }); // schema checks: already there
  return json({ success: true, affectedRows: 0 });
};

const { loadOrderPairs, suggestRulesFromPrompt, loadAllPairs, resolveFbtInstructions } = await import('../../app/services/pairing-assistant.server.js');

const gid = (n) => `gid://shopify/Product/${n}`;
const PRODUCTS = {
  1: { title: 'Boys Joggers', status: 'ACTIVE', productType: 'Bottoms' },
  2: { title: 'Ankle Socks', status: 'ACTIVE', productType: 'Socks' },
  3: { title: 'Old Cap', status: 'ARCHIVED', productType: '' },
  4: { title: 'Coffee Mug', status: 'ACTIVE', productType: '' },
  5: { title: 'Coffee Beans', status: 'ACTIVE', productType: '' },
};

function fakeAdmin(shopifyOrders) {
  const calls = [];
  return {
    calls,
    graphql: async (query, { variables } = {}) => {
      calls.push(query);
      if (query.includes('PairingOrders')) {
        return json({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: shopifyOrders } } });
      }
      if (query.includes('PairingProducts')) {
        return json({ data: { nodes: variables.ids.map((id) => {
          const n = id.match(/(\d+)$/)[1];
          const p = PRODUCTS[n];
          return p ? { id, title: p.title, handle: p.title.toLowerCase(), status: p.status, featuredImage: null, priceRangeV2: { minVariantPrice: { amount: '9.00' } } } : null;
        }) } });
      }
      if (query.includes('PairingCatalog')) {
        const nodes = Object.entries(PRODUCTS).filter(([, p]) => p.status === 'ACTIVE').map(([n, p]) => ({
          id: gid(n), title: p.title, handle: p.title.toLowerCase(), productType: p.productType, tags: [],
          featuredImage: null, priceRangeV2: { minVariantPrice: { amount: '9.00' } },
          collections: { nodes: n === '4' || n === '5' ? [{ id: 'c-k', title: 'Kitchen' }] : [] },
        }));
        return json({ data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } });
      }
      throw new Error(`unexpected query ${query.slice(0, 60)}`);
    },
  };
}

const shopOrder = (id, productIds, extra = {}) => ({
  id: `gid://shopify/Order/${id}`, test: false, cancelledAt: null,
  lineItems: { nodes: productIds.map((p) => ({ title: PRODUCTS[p]?.title || `P${p}`, product: p ? { id: gid(p) } : null })) },
  ...extra,
});

beforeEach(() => {
  recordedLines = [];
  llmReply = null;
  llmCalls = 0;
  llmPrompts = [];
  delete process.env.OPENAI_API_KEY;
});

test('order pairs merge Shopify orders with older recorded ones, skip test/cancelled, flag inactive products', async () => {
  recordedLines = [
    // order 10 is also returned by Shopify — must count once
    { order_id: '10', product_id: '1', product_title: 'Boys Joggers' },
    { order_id: '10', product_id: '2', product_title: 'Ankle Socks' },
    // older order only BRIX recorded
    { order_id: '5', product_id: '1', product_title: 'Boys Joggers' },
    { order_id: '5', product_id: '2', product_title: 'Ankle Socks' },
  ];
  const admin = fakeAdmin([
    shopOrder(10, [1, 2]),
    shopOrder(11, [1, 3]),
    shopOrder(12, [1, 2], { test: true }),
    shopOrder(13, [1, 2], { cancelledAt: '2026-10-01T00:00:00Z' }),
    shopOrder(14, [2, null]),
  ]);
  const r = await loadOrderPairs(admin, 'merge.myshopify.com', { days: 90 });
  assert.equal(r.totalOrders, 4, 'orders 5, 10, 11, 14 — 12 is a test, 13 cancelled, 10 counted once');
  assert.equal(r.multiItemOrders, 3);
  assert.equal(r.shopifyOrders, 3);
  assert.equal(r.recordedOrders, 2);
  const top = r.pairs[0];
  assert.deepEqual([top.a.title, top.b.title], ['Boys Joggers', 'Ankle Socks']);
  assert.equal(top.together, 2);
  assert.equal(top.a.active, true);
  const capPair = r.pairs.find((p) => p.b.title === 'Old Cap' || p.a.title === 'Old Cap');
  assert.equal((capPair.a.title === 'Old Cap' ? capPair.a : capPair.b).active, false, 'archived product cannot be offered');
});

test('order scan is cached per shop and window; fresh re-reads', async () => {
  const admin = fakeAdmin([shopOrder(1, [1, 2])]);
  await loadOrderPairs(admin, 'cache.myshopify.com', { days: 30 });
  await loadOrderPairs(admin, 'cache.myshopify.com', { days: 30 });
  assert.equal(admin.calls.filter((q) => q.includes('PairingOrders')).length, 1);
  await loadOrderPairs(admin, 'cache.myshopify.com', { days: 30, fresh: true });
  assert.equal(admin.calls.filter((q) => q.includes('PairingOrders')).length, 2);
});

test('prompt → model plan → rules with only real products; one credit used', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  llmReply = '```json\n' + JSON.stringify({ rules: [
    { trigger: { products: ['joggers'] }, offer: { products: ['Ankle Socks', 'Snowboard'] } },
  ] }) + '\n```';
  let credits = 0;
  const r = await suggestRulesFromPrompt(fakeAdmin([]), 'p.myshopify.com', 'show socks with joggers', { consumeCredit: async () => { credits++; } });
  assert.equal(credits, 1);
  assert.equal(llmCalls, 1);
  assert.equal(r.usedAi, true);
  assert.equal(r.rules.length, 1);
  assert.deepEqual(r.rules[0].triggerProducts.map((p) => p.title), ['Boys Joggers']);
  assert.deepEqual(r.rules[0].offerProducts.map((p) => p.title), ['Ankle Socks']);
  assert.ok(r.warnings.some((w) => w.includes('Snowboard')), 'the invented product is reported, not added');
  const userMsg = llmPrompts[0][1].content;
  assert.ok(userMsg.includes('Boys Joggers') && !userMsg.includes('Old Cap'), 'only active catalog products are offered to the model');
});

test('model down → plain-text parser still builds the rule', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  llmReply = null;
  const r = await suggestRulesFromPrompt(fakeAdmin([]), 'p.myshopify.com', 'Coffee Mug -> Coffee Beans', { consumeCredit: async () => {} });
  assert.equal(r.usedAi, false);
  assert.deepEqual(r.rules.map((x) => [x.triggerProducts[0].title, x.offerProducts[0].title]), [['Coffee Mug', 'Coffee Beans']]);
});

test('no AI key → no credit used, parser used', async () => {
  let credits = 0;
  const r = await suggestRulesFromPrompt(fakeAdmin([]), 'p.myshopify.com', 'Boys Joggers with Ankle Socks', { consumeCredit: async () => { credits++; } });
  assert.equal(credits, 0);
  assert.equal(llmCalls, 0);
  assert.equal(r.rules.length, 1);
});

test('model asks a question when the prompt has no pairing', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  llmReply = JSON.stringify({ rules: [], question: 'Which products should go together?' });
  const r = await suggestRulesFromPrompt(fakeAdmin([]), 'p.myshopify.com', 'make my store better', { consumeCredit: async () => {} });
  assert.equal(r.rules.length, 0);
  assert.equal(r.question, 'Which products should go together?');
});

test('"what customers buy with it" uses past orders for every product in the group', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  llmReply = JSON.stringify({ rules: [{ trigger: { collections: ['Kitchen'] }, offer: { fromOrderHistory: true } }] });
  const admin = fakeAdmin([shopOrder(1, [4, 5]), shopOrder(2, [4, 5])]);
  const r = await suggestRulesFromPrompt(admin, 'hist.myshopify.com', 'kitchen: what customers usually buy with each', { consumeCredit: async () => {} });
  const map = Object.fromEntries(r.rules.map((x) => [x.triggerProducts[0].title, x.offerProducts.map((p) => p.title)]));
  assert.deepEqual(map, { 'Coffee Mug': ['Coffee Beans'], 'Coffee Beans': ['Coffee Mug'] });
  assert.equal((await loadAllPairs(admin, 'hist.myshopify.com')).length, 1);
});

test('FBT instructions: resolved once, then reused from the saved result while the text is unchanged', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  llmReply = JSON.stringify({ rules: [{ trigger: { products: ['Boys Joggers'] }, offer: { products: ['Ankle Socks'] } }] });
  let credits = 0;
  const consumeCredit = async () => { credits++; };
  const first = await resolveFbtInstructions(fakeAdmin([]), 'i.myshopify.com', 'socks with joggers', { maxOffers: 3, consumeCredit });
  assert.equal(first.fromCache, false);
  assert.equal(first.cacheable, true);
  assert.equal(first.rules.length, 1);
  const saved = { hash: first.hash, rules: first.rules, warnings: first.warnings };
  const again = await resolveFbtInstructions(fakeAdmin([]), 'i.myshopify.com', ' socks  with joggers ', { maxOffers: 3, cached: saved, consumeCredit });
  assert.equal(again.fromCache, true);
  assert.equal(credits, 1, 'unchanged instructions use no second credit');
  assert.equal(llmCalls, 1);
  const changed = await resolveFbtInstructions(fakeAdmin([]), 'i.myshopify.com', 'socks with joggers', { maxOffers: 4, cached: saved, consumeCredit });
  assert.equal(changed.fromCache, false);
  assert.equal(credits, 2);
});

test('FBT instructions: nothing understood → warning, not cached; empty text → nothing at all', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  llmReply = JSON.stringify({ rules: [], question: 'Which products go together?' });
  const r = await resolveFbtInstructions(fakeAdmin([]), 'i.myshopify.com', 'be nice', { consumeCredit: async () => {} });
  assert.equal(r.rules.length, 0);
  assert.equal(r.cacheable, false);
  assert.ok(r.warnings.includes('Which products go together?'));
  const empty = await resolveFbtInstructions(fakeAdmin([]), 'i.myshopify.com', '   ', { consumeCredit: async () => { throw new Error('no credit for empty'); } });
  assert.deepEqual(empty.rules, []);
});

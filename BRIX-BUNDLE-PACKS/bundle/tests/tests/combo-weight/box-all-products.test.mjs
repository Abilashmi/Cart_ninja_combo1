// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight/box-all-products.test.mjs
// Box templates with big collections (1349 pre-owned books): the server loads
// every product of a collection, not the first 50 (combo-page-products.server.js),
// through THROTTLED retries and cost splits (admin-graphql.server.js), kept in
// a stale-while-revalidate cache (swr-cache.server.js); the page draws a page
// of cards at a time with "Show more" while filters search every product.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createComboWeightCore } from '../../app/utils/combo-weight.shared.js';
import { createQuickShopKit } from '../../app/utils/combo-quickshop.shared.js';
import { loadBoxCollection, loadClassicCollection } from '../../app/services/combo-page-products.server.js';
import { createSwrCache } from '../../app/services/swr-cache.server.js';
import { loadVariantStock } from '../../app/services/combo-stock.server.js';

const kit = createQuickShopKit(createComboWeightCore());
const PID = (n) => `gid://shopify/Product/${n}`;
const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const node = (n, status = 'ACTIVE') => ({
  id: PID(n), status, title: `Book ${n}`, handle: `book-${n}`, description: '', vendor: '', productType: '', tags: [],
  featuredImage: null, images: { nodes: [] },
  variants: { nodes: [{ id: `gid://shopify/ProductVariant/${n}`, title: 'Default Title', price: '99.00', compareAtPrice: null, availableForSale: true, image: null, inventoryItem: { measurement: { weight: { value: 300, unit: 'GRAMS' } } } }] },
  priceRangeV2: { minVariantPrice: { amount: '99.00', currencyCode: 'INR' } },
});

// A collection of `total` products behind a fake Admin API.
function fakeShop(total, { drafts = [], onDetails } = {}) {
  const calls = [];
  const ids = Array.from({ length: total }, (_, i) => PID(i + 1));
  return {
    calls,
    graphql: async (query, { variables } = {}) => {
      calls.push({ query, variables });
      if (/BrixBoxCollectionIds/.test(query)) {
        const start = variables.after ? Number(variables.after) : 0;
        const nodes = ids.slice(start, start + 250).map((id) => ({ id }));
        const end = start + nodes.length;
        return json({ data: { collectionByHandle: { products: { nodes, pageInfo: { hasNextPage: end < total, endCursor: String(end) } } } } });
      }
      if (/BrixBoxProducts/.test(query)) {
        if (onDetails) { const r = onDetails(variables.ids, calls); if (r) return r; }
        // Shopify answers nodes in any order.
        const nodes = [...variables.ids].reverse().map((id) => {
          const n = Number(id.split('/').pop());
          return node(n, drafts.includes(n) ? 'DRAFT' : 'ACTIVE');
        });
        return json({ data: { nodes } });
      }
      if (/GetCollectionByHandle/.test(query)) {
        return json({ data: { collectionByHandle: { products: { edges: ids.slice(0, 50).map((id) => ({ node: node(Number(id.split('/').pop())) })) } } } });
      }
      throw new Error(`unexpected query ${query.slice(0, 60)}`);
    },
  };
}

test('a box collection loads every product (1349), in the collection order, drafts left out', async () => {
  const admin = fakeShop(1349, { drafts: [7, 1200] });
  const products = await loadBoxCollection(admin, 'pre-owned-books');
  assert.equal(products.length, 1347);
  assert.equal(products[0].id, PID(1));
  assert.equal(products[1345].id, PID(1348));
  assert.ok(!products.some((p) => p.id === PID(7) || p.id === PID(1200)), 'drafts / archived stay off the page');
  assert.equal(products[0].variants[0].grams, 300);
  assert.equal(products[0].descriptionHtml, '', 'box pages never load descriptionHtml');

  const idPages = admin.calls.filter((c) => /BrixBoxCollectionIds/.test(c.query));
  const details = admin.calls.filter((c) => /BrixBoxProducts/.test(c.query));
  assert.equal(idPages.length, 6, '250 ids per page');
  assert.equal(details.length, 27, '50 products per detail query');
  assert.ok(details.every((c) => c.variables.ids.length <= 50));
  assert.ok(!/descriptionHtml/.test(details[0].query));
});

test('the older designs keep their first 50 in one query', async () => {
  const admin = fakeShop(1349);
  const products = await loadClassicCollection(admin, 'books');
  assert.equal(products.length, 50);
  assert.equal(admin.calls.length, 1);
});

test('THROTTLED waits and tries again; a query Shopify finds too costly is split', async () => {
  let throttled = 0;
  const admin = fakeShop(120, {
    onDetails(ids) {
      if (ids.length > 25) throw new Error('Query cost is 1500, which exceeds the single query max cost limit (1000).');
      if (throttled < 1) {
        throttled += 1;
        return json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 50, restoreRate: 50 } } } });
      }
      return null;
    },
  });
  const products = await loadBoxCollection(admin, 'books');
  assert.equal(products.length, 120);
  assert.deepEqual(products.map((p) => p.id), Array.from({ length: 120 }, (_, i) => PID(i + 1)));
  assert.equal(throttled, 1);
});

test('any other Shopify error fails the load (so nothing wrong is cached)', async () => {
  const admin = fakeShop(60, { onDetails: () => json({ errors: [{ message: 'Access denied' }] }) });
  await assert.rejects(loadBoxCollection(admin, 'books'), /Access denied/);
});

test('stock for 1349 variants: 100 per query, a few at once', async () => {
  let open = 0;
  let most = 0;
  const admin = {
    graphql: async (query, { variables }) => {
      open += 1; most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 5));
      open -= 1;
      return json({ data: { nodes: variables.ids.map((id) => ({ id, inventoryQuantity: 1, inventoryPolicy: 'DENY', inventoryItem: { tracked: true } })) } });
    },
  };
  const ids = Array.from({ length: 1349 }, (_, i) => `gid://shopify/ProductVariant/${i + 1}`);
  const stock = await loadVariantStock(admin, ids);
  assert.equal(Object.keys(stock).length, 1349);
  assert.equal(stock[ids[1348]], 1);
  assert.ok(most > 1 && most <= 3, `ran ${most} at once`);
});

/* ── stale-while-revalidate cache ───────────────────────────────────── */

test('cache: fresh = no load; stale = old value at once + one background load; failures not kept', async () => {
  let t = 0;
  const cache = createSwrCache({ freshMs: 100, staleMs: 1000, now: () => t });
  let loads = 0;
  const loader = async () => { loads += 1; return `v${loads}`; };

  const [a, b] = await Promise.all([cache.get('k', loader), cache.get('k', loader)]);
  assert.deepEqual([a, b, loads], ['v1', 'v1', 1], 'callers share one load');
  t = 50;
  assert.equal(await cache.get('k', loader), 'v1');
  assert.equal(loads, 1);

  t = 500; // stale
  assert.equal(await cache.get('k', loader), 'v1', 'answered at once with the old value');
  await new Promise((r) => setImmediate(r));
  assert.equal(loads, 2);
  assert.equal(await cache.get('k', loader), 'v2');

  t = 5000; // too old: wait for a new load
  assert.equal(await cache.get('k', loader), 'v3');

  await assert.rejects(cache.get('bad', async () => { throw new Error('shopify down'); }));
  assert.equal(await cache.get('bad', async () => 'ok'), 'ok', 'a failed load was not cached');
});

/* ── the page: a page of cards at a time ───────────────────────────── */

const book = (n) => ({
  id: PID(n), title: `Book ${n}`, tags: [],
  variants: [{ id: `gid://shopify/ProductVariant/${n}`, title: 'Default Title', price: '99.00', grams: 300, available: n % 10 !== 0 }],
});
const BOOKS = Array.from({ length: 1349 }, (_, i) => book(i + 1));
// "2-4 years": 333 books spread over the whole collection, most past the first 50.
const AGE = BOOKS.filter((_, i) => i % 4 === 1).slice(0, 333).map((p) => p.id);
const GROUPS = [{ id: 'years', label: 'Years', style: 'chips', options: [{ handle: 'age-2-4', label: '2-4 Y' }] }];

function model(config = {}, ui = {}) {
  return kit.buildModel({
    config: { layout: 'layout5', tab_count: 1, col_1: 'pre-owned-books', qs_filter_groups: GROUPS, ...config },
    productsByHandle: { 'pre-owned-books': BOOKS },
    handles: ['pre-owned-books'],
    collectionMembers: { 'age-2-4': AGE },
    ui: { chip: 'all', dd: {}, ...ui },
    pricing: { tiers: [], enabled: false },
    symbol: '₹',
  });
}

test('40 cards at first, "Show more" adds the next 40; the button says how many are left', () => {
  const ui = { chip: 'all', dd: {} };
  let m = model({}, ui);
  assert.equal(m.cards.length, 40);
  assert.equal(m.more, 1309);
  const html = kit.render(m);
  assert.match(html, /data-combo-action="qs-more"[^>]*>Show more <span class="bxq-more-n">\(1309\)/);

  assert.equal(kit.applyUiAction(ui, 'qs-more', null), true);
  m = model({}, ui);
  assert.equal(m.cards.length, 80);
  assert.equal(m.more, 1269);
});

test('filters search every product: "2-4 years" finds all 333, not the 6 in the first 50', () => {
  const ui = { chip: 'all', dd: { 'g:years': 'age-2-4' } };
  let m = model({ qs_page_size: 100 }, ui);
  assert.equal(m.cards.length + m.more, 333);
  assert.equal(m.cards.length, 100);
  for (let i = 0; i < 3; i++) kit.applyUiAction(ui, 'qs-more', null);
  m = model({ qs_page_size: 100 }, ui);
  assert.equal(m.cards.length, 333);
  assert.equal(m.more, 0);
  assert.doesNotMatch(kit.render(m), /qs-more/, 'no button once everything is drawn');
});

test('a new filter starts again from the first cards', () => {
  const ui = { chip: 'all', dd: {} };
  kit.applyUiAction(ui, 'qs-more', null);
  kit.applyUiAction(ui, 'qs-more', null);
  assert.equal(model({}, ui).cards.length, 120);
  kit.applyUiAction(ui, 'qs-instock', null);
  assert.equal(model({}, ui).cards.length, 40);
  kit.applyUiAction(ui, 'qs-instock', null);
  assert.equal(model({}, ui).cards.length, 120, 'back to the same filter = the cards shown before');
  kit.applyUiAction(ui, 'qs-more', null);
  kit.applyUiAction(ui, 'qs-instock', null);
  kit.applyUiAction(ui, 'qs-more', null);
  assert.equal(model({}, ui).cards.length, 80, 'Show more under a new filter counts from its first cards');
});

test('page size: 12-200, empty / junk = 40, own button text', () => {
  assert.equal(kit.pageSize({}), 40);
  assert.equal(kit.pageSize({ qs_page_size: 4 }), 12);
  assert.equal(kit.pageSize({ qs_page_size: 900 }), 200);
  assert.equal(kit.pageSize({ qs_page_size: 'x' }), 40);
  assert.match(kit.render(model({ qs_more_text: 'Load more books' })), />Load more books <span/);
});

test('small pages draw as before: no button', () => {
  const m = kit.buildModel({
    config: { layout: 'layout6', tab_count: 1, col_1: 'c' },
    productsByHandle: { c: BOOKS.slice(0, 12) },
    handles: ['c'], ui: { chip: 'all', dd: {} }, pricing: { tiers: [], enabled: false }, symbol: '₹',
  });
  assert.equal(m.cards.length, 12);
  assert.equal(m.more, 0);
  assert.doesNotMatch(kit.render(m), /bxq-more/);
});

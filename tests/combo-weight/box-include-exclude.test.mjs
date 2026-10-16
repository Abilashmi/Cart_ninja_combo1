// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight/box-include-exclude.test.mjs
// Box templates: products added beyond the collections (they count), products
// "not part of the box offer" (shown, never counted), hidden products and
// hidden collections (page only). Pricing hash stays the same for every box
// that uses none of them; the Function, its synced config and COD agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createComboWeightCore, normalizeWeightPricing } from '../../app/utils/combo-weight.shared.js';
import { createQuickShopKit } from '../../app/utils/combo-quickshop.shared.js';
import { buildComboWeightFunctionConfig } from '../../app/services/combo-weight-shopify.server.js';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/brix-combo-weight-discount/src/cart_lines_discounts_generate_run.js';

const kit = createQuickShopKit(createComboWeightCore());
const P = (n) => `gid://shopify/Product/${n}`;
const BASE = { measure: 'quantity', max_grams: 10, tiers: [{ min_grams: 2, type: 'percentage', value: 10 }] };

test('pricing: extra / no-offer products only change the hash when set', () => {
  const plain = normalizeWeightPricing(BASE).value;
  const same = normalizeWeightPricing({ ...BASE, qualify: { mode: 'layout_collections', extra_product_ids: [], exclude_product_ids: [] } }).value;
  assert.equal(same.hash, plain.hash);
  assert.equal('extra_product_ids' in same.qualify, false);
  const withExtra = normalizeWeightPricing({ ...BASE, qualify: { extra_product_ids: [P(5), '5', 'junk'], exclude_product_ids: [P(7)] } }).value;
  assert.deepEqual(withExtra.qualify.extra_product_ids, [P(5)]);
  assert.deepEqual(withExtra.qualify.exclude_product_ids, [P(7)]);
  assert.notEqual(withExtra.hash, plain.hash);
  const tooMany = normalizeWeightPricing({ ...BASE, qualify: { extra_product_ids: Array.from({ length: 51 }, (_, i) => P(i + 1)) } });
  assert.ok(tooMany.errors.some((e) => e.field === 'qualify.extra_product_ids'));
});

test('synced Function config: extras count, no-offer products are listed', () => {
  const pricing = normalizeWeightPricing({ ...BASE, qualify: { extra_product_ids: [P(5)], exclude_product_ids: [P(7)] } }).value;
  const built = buildComboWeightFunctionConfig({
    templates: [{ id: 3, active: true, config: { layout: 'layout7', tab_count: 1, col_1: 'books' }, pricing, errors: [] }],
    planLive: true, collectionIdsByHandle: { books: 'gid://shopify/Collection/900' },
  });
  const entry = built.config.templates['3'];
  assert.deepEqual(entry.product_ids, ['5']);
  assert.deepEqual(entry.collection_ids, ['900']);
  assert.deepEqual(entry.exclude_ids, ['7']);
  const plain = buildComboWeightFunctionConfig({
    templates: [{ id: 3, active: true, config: { layout: 'layout7', tab_count: 1, col_1: 'books' }, pricing: normalizeWeightPricing(BASE).value, errors: [] }],
    planLive: true, collectionIdsByHandle: { books: 'gid://shopify/Collection/900' },
  });
  assert.equal('exclude_ids' in plain.config.templates['3'], false, 'unchanged config without them');
});

test('checkout Function: a no-offer product never counts, an extra one does', () => {
  const template = { id: 3, hash: 'h', measure: 'quantity', max_grams: 10, product_ids: ['5'], collection_ids: ['900'], exclude_ids: ['7'], tiers: [{ min_grams: 2, type: 'percentage', value: 10, label: '10% off' }] };
  let n = 0;
  const line = (product, inCollection) => {
    n += 1;
    return {
      id: `gid://shopify/CartLine/${n}`, quantity: 1, comboId: { value: '3' }, comboGroup: { value: 'g' },
      cost: { subtotalAmount: { amount: '100.00', currencyCode: 'INR' } },
      merchandise: { __typename: 'ProductVariant', id: `gid://shopify/ProductVariant/${n}`, weight: 0, weightUnit: 'GRAMS', product: { id: P(product), inCollections: [{ collectionId: 'gid://shopify/Collection/900', isMember: inCollection }] } },
    };
  };
  const input = (lines) => ({ cart: { lines }, discount: { discountClasses: ['PRODUCT'] }, presentmentCurrencyRate: '1.0', shop: { metafield: { jsonValue: { version: 1, currency: 'INR', templates: { 3: template } } } } });
  // In-collection 7 is excluded: one counted item = locked.
  assert.deepEqual(run(input([line(1, true), line(7, true)])), { operations: [] });
  // Extra product 5 (not in the collection) counts: two items = 10% off both.
  const ok = run(input([line(1, true), line(5, false)]));
  assert.equal(ok.operations[0].productDiscountsAdd.candidates[0].targets.length, 2);
});

const prod = (n) => ({ id: P(n), title: `P${n}`, variants: [{ id: `v${n}`, title: 'Default Title', price: '100.00', grams: 100, available: true }] });

test('page: extra products shown, hidden products and hidden collections left off', () => {
  const productsByHandle = { books: [prod(1), prod(2), prod(3)], [kit.EXTRA_HANDLE]: [prod(5), prod(2)] };
  const m = kit.buildModel({
    config: { box_hide_product_ids: [P(1)], box_hide_collections: [{ id: 'gid://shopify/Collection/4', handle: 'damaged', title: 'Damaged' }] },
    productsByHandle, handles: ['books'], collectionMembers: { damaged: [P(3)] }, ui: {}, pricing: { tiers: [] },
  });
  assert.deepEqual(m.cards.map((c) => c.id), [P(2), P(5)], 'extras after the collections, no repeats');
  assert.deepEqual(kit.memberHandles({ box_hide_collections: [{ handle: 'damaged' }], qs_filter_groups: [{ id: 'a', label: 'A', options: [{ handle: 'x' }] }] }), ['x', 'damaged']);
  const unknown = kit.buildModel({ config: { box_hide_collections: [{ handle: 'damaged' }] }, productsByHandle, handles: ['books'], ui: {}, pricing: { tiers: [] } });
  assert.equal(unknown.cards.length, 4, 'members not known yet: nothing hidden');
  const allHidden = kit.buildModel({ config: { box_hide_product_ids: [P(1)] }, productsByHandle: { books: [prod(1)] }, handles: ['books'], ui: {}, pricing: { tiers: [] }, fallbackProducts: [prod(9)] });
  assert.equal(allHidden.cards.length, 0, 'hiding everything never brings back the builder samples');
});

test('page: a no-offer product says so on its card', () => {
  const html = kit.render(kit.buildModel({
    config: {}, productsByHandle: { books: [prod(1), prod(7)] }, handles: ['books'], ui: {},
    pricing: { measure: 'quantity', tiers: [{ id: 't', min_grams: 2, type: 'percentage', value: 10, label: '' }], enabled: true },
    qualifies: (id) => id !== P(7),
  }));
  assert.match(html, /data-product-id="gid:\/\/shopify\/Product\/7"[\s\S]*?Not part of the box offer/);
});

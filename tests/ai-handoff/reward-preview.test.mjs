// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
import test from 'node:test';
import assert from 'node:assert/strict';
import { getUnlockedRewards, getPreviewTotals, usableTiers } from '../../app/utils/preview-cart.js';
import { buildRewardConfig } from '../../app/services/reward-gift-shopify.server.js';

const products = [
  { id: 'gid://shopify/Product/1', title: 'Yoga Mat', price: '250' },
  { id: 'gid://shopify/Product/2', title: 'Towel', price: '40' },
];
const tiers = [
  { id: 'a', minimumSpend: 600, rewardProducts: ['gid://shopify/Product/2'], rewardPricing: 'free' },
  { id: 'b', minimumSpend: 1000, rewardProducts: ['gid://shopify/Product/1'], rewardPricing: 'regular' },
  { id: 'z', minimumSpend: 0, rewardProducts: ['gid://shopify/Product/1'] },
];

test('a milestone the paid cart has not reached shows no reward', () => {
  assert.deepEqual(getUnlockedRewards({ tiers, mode: 'amount', total: 489, count: 1, allProducts: products }), []);
});

test('reaching a milestone unlocks its reward products, free or regular as configured', () => {
  const r = getUnlockedRewards({ tiers, mode: 'amount', total: 739, count: 2, allProducts: products });
  assert.equal(r.length, 1);
  assert.equal(r[0].product.title, 'Towel');
  assert.equal(r[0].pricing, 'free');
  const both = getUnlockedRewards({ tiers, mode: 'amount', total: 1200, count: 3, allProducts: products });
  assert.deepEqual(both.map((x) => x.pricing), ['free', 'regular']);
});

test('item-count mode compares the item count, and unknown products still show a generic line', () => {
  const t = [{ id: 'c', minimumSpend: 3, rewardProducts: ['gid://shopify/Product/9'], rewardPricing: 'free' }];
  assert.equal(getUnlockedRewards({ tiers: t, mode: 'count', total: 10, count: 2, allProducts: products }).length, 0);
  const r = getUnlockedRewards({ tiers: t, mode: 'count', total: 10, count: 3, allProducts: products });
  assert.equal(r.length, 1);
  assert.equal(r[0].product, null);
});

test('tiers without a real threshold are ignored, and a product is listed once', () => {
  assert.equal(usableTiers(tiers).length, 2);
  const dup = [
    { id: 'a', minimumSpend: 100, rewardProducts: ['p'], rewardPricing: 'free' },
    { id: 'b', minimumSpend: 200, rewardProducts: ['p'], rewardPricing: 'free' },
  ];
  assert.equal(getUnlockedRewards({ tiers: dup, mode: 'amount', total: 500, count: 1, allProducts: [] }).length, 1);
});

test('totals: free rewards cost nothing, regular-price rewards add their price', () => {
  const added = [{ uid: 'u', product: products[0] }];
  const free = getUnlockedRewards({ tiers, mode: 'amount', total: 739, count: 2, allProducts: products });
  assert.deepEqual(getPreviewTotals({ baseTotal: 489, added, rewards: free }), { paidTotal: 739, paidCount: 2, regularRewardTotal: 0, subtotal: 739 });
  const regular = [{ pricing: 'regular', product: products[1] }];
  assert.equal(getPreviewTotals({ baseTotal: 489, added, rewards: regular }).subtotal, 779);
});

test('free-gift function config: only free-priced tiers with products, numeric ids, only when the bar is on', () => {
  const bar = {
    is_enabled: 1, mode: 'amount',
    tiers: [
      { id: 1, min_value: 600, reward_type: 'free_shipping', reward_pricing: 'free', reward_products: ['gid://shopify/Product/2'] },
      { id: 2, min_value: 900, reward_type: 'product', reward_pricing: 'regular', reward_products: ['gid://shopify/Product/3'] },
      { id: 3, min_value: 1200, reward_type: 'product', reward_products: ['gid://shopify/Product/4'] },
      { id: 4, min_value: 0, reward_type: 'product', reward_pricing: 'free', reward_products: ['gid://shopify/Product/5'] },
      { id: 5, min_value: 1500, reward_type: 'free_shipping', reward_pricing: 'free', reward_products: [] },
    ],
  };
  assert.deepEqual(buildRewardConfig(bar, 'USD'), { version: 1, currency: 'USD', tiers: [{ id: '1', mode: 'amount', min: 600, productIds: ['2'] }] });
  assert.deepEqual(buildRewardConfig({ ...bar, is_enabled: 0 }, 'USD').tiers, []);
  assert.deepEqual(buildRewardConfig(null).tiers, []);
  const count = buildRewardConfig({ ...bar, mode: 'count', tiers: [{ id: 9, min_value: 0, min_quantity: 3, reward_pricing: 'free', reward_products: ['7'] }] }, 'USD');
  assert.deepEqual(count.tiers, [{ id: '9', mode: 'count', min: 3, productIds: ['7'] }]);
});

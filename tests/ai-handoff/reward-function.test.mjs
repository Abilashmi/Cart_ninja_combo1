// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
// Logic-only test of the free-gift checkout function. It does NOT prove Shopify
// applies it — that needs the function deployed to a store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/brix-reward-discount/src/cart_lines_discounts_generate_run.js';

const config = (tiers, currency = 'USD') => ({ version: 1, currency, tiers });
const paid = (id, amount, quantity = 1, currency = 'USD') => ({
  id, quantity, reward: null, cost: { subtotalAmount: { amount: String(amount), currencyCode: currency } },
  merchandise: { __typename: 'ProductVariant', id: 'gid://shopify/ProductVariant/1', product: { id: 'gid://shopify/Product/10' } },
});
const gift = (id, product = '500', { marked = true, quantity = 1, amount = 20 } = {}) => ({
  id, quantity, reward: marked ? { value: 'true' } : null, cost: { subtotalAmount: { amount: String(amount), currencyCode: 'USD' } },
  merchandise: { __typename: 'ProductVariant', id: 'gid://shopify/ProductVariant/9', product: { id: `gid://shopify/Product/${product}` } },
});
const input = (lines, cfg, classes = ['PRODUCT']) => ({ cart: { lines }, discount: { discountClasses: classes }, shop: { metafield: cfg ? { jsonValue: cfg } : null } });
const cands = (out) => out.operations[0]?.productDiscountsAdd.candidates ?? [];

const TIER = { id: 't1', mode: 'amount', min: 50, productIds: ['500'] };

test('gift line is 100% off once the paid cart reaches the milestone', () => {
  const out = run(input([paid('L1', 60), gift('L2')], config([TIER])));
  assert.equal(cands(out).length, 1);
  assert.deepEqual(cands(out)[0].targets, [{ cartLine: { id: 'L2', quantity: 1 } }]);
  assert.deepEqual(cands(out)[0].value, { percentage: { value: '100' } });
});

test('below the milestone nothing is free (gift never helps pay for its own unlock)', () => {
  assert.deepEqual(run(input([paid('L1', 40), gift('L2', '500', { amount: 20 })], config([TIER]))), { operations: [] });
});

test('only one unit of a gift line is free', () => {
  const out = run(input([paid('L1', 60), gift('L2', '500', { quantity: 3 })], config([TIER])));
  assert.equal(cands(out)[0].targets[0].cartLine.quantity, 1);
});

test('a line without the marker, or for a product that is not a reward, is never free', () => {
  assert.deepEqual(run(input([paid('L1', 60), gift('L2', '500', { marked: false })], config([TIER]))), { operations: [] });
  assert.deepEqual(run(input([paid('L1', 60), gift('L2', '999')], config([TIER]))), { operations: [] });
});

test('item-count milestones use the number of non-gift items', () => {
  const t = { id: 't2', mode: 'count', min: 3, productIds: ['500'] };
  assert.equal(cands(run(input([paid('L1', 10, 3), gift('L2')], config([t])))).length, 1);
  assert.deepEqual(run(input([paid('L1', 10, 2), gift('L2')], config([t]))), { operations: [] });
});

test('a cart in a different currency than the milestone gets no discount (never guess)', () => {
  assert.deepEqual(run(input([paid('L1', 500, 1, 'EUR'), gift('L2')], config([TIER], 'USD'))), { operations: [] });
});

test('no config, wrong discount class, or empty cart -> no discount', () => {
  assert.deepEqual(run(input([paid('L1', 60), gift('L2')], null)), { operations: [] });
  assert.deepEqual(run(input([paid('L1', 60), gift('L2')], config([TIER]), ['ORDER'])), { operations: [] });
  assert.deepEqual(run(input([], config([TIER]))), { operations: [] });
});

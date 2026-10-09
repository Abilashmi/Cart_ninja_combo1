// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight
// Exercises the BRIX Combo Weight checkout Function logic directly (pure
// function). This proves the *logic*; it does NOT prove Shopify applies it —
// that needs the Function deployed to a store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/brix-combo-weight-discount/src/cart_lines_discounts_generate_run.js';

const template = {
  id: 12, hash: 'abc', unit: 'kg', max_grams: 2200,
  product_ids: ['500'], collection_ids: ['900'],
  tiers: [
    { min_grams: 1000, type: 'percentage', value: 10, label: '1 kg box: 10% off' },
    { min_grams: 2000, type: 'fixed_price', value: 1700, label: '2 kg box for ₹1700' },
  ],
};
const config = { version: 1, currency: 'INR', templates: { 12: template } };

let lineNo = 0;
function line({ quantity = 1, grams = 250, unit = 'GRAMS', price = 100, product = '100', inCollection = true, combo = '12', group = 'g1', currency = 'INR' } = {}) {
  lineNo += 1;
  return {
    id: `gid://shopify/CartLine/${lineNo}`,
    quantity,
    comboId: combo === null ? null : { value: String(combo) },
    comboGroup: group === null ? null : { value: group },
    cost: { subtotalAmount: { amount: (price * quantity).toFixed(2), currencyCode: currency } },
    merchandise: {
      __typename: 'ProductVariant', id: `gid://shopify/ProductVariant/${lineNo}`, weight: grams, weightUnit: unit,
      product: { id: `gid://shopify/Product/${product}`, inCollections: [{ collectionId: 'gid://shopify/Collection/900', isMember: inCollection }] },
    },
  };
}
const input = (lines, { cfg = config, classes = ['PRODUCT'], rate = '1.0' } = {}) => ({
  cart: { lines }, discount: { discountClasses: classes }, presentmentCurrencyRate: rate,
  shop: { metafield: cfg ? { jsonValue: cfg } : null },
});
const candidates = (result) => result.operations[0]?.productDiscountsAdd.candidates ?? [];
const NONE = { operations: [] };

test('a 1.05 kg box gets the 10% tier on every box line, with the tier label', () => {
  const lines = [line({ quantity: 3, grams: 250 }), line({ quantity: 1, grams: 300 })];
  const result = run(input(lines));
  assert.equal(result.operations[0].productDiscountsAdd.selectionStrategy, 'ALL');
  const [candidate] = candidates(result);
  assert.equal(candidate.message, '1 kg box: 10% off');
  assert.equal(candidate.value.percentage.value, '10');
  assert.deepEqual(candidate.targets.map((t) => t.cartLine.quantity), [3, 1]);
});

test('a 0.9 kg box is locked; over the max weight gets nothing', () => {
  assert.deepEqual(run(input([line({ quantity: 3, grams: 300 })])), NONE);
  assert.deepEqual(run(input([line({ quantity: 3, grams: 750 })])), NONE, '2.25 kg > 2.2 kg max');
});

test('fixed box price: the discount is split across lines and adds up exactly', () => {
  // 2.1 kg: 7 books × 300 g at ₹110 / ₹120 = ₹790 + ₹... → sold for ₹1700
  const lines = [line({ quantity: 4, grams: 300, price: 333.33 }), line({ quantity: 3, grams: 300, price: 333.34 })];
  const all = candidates(run(input(lines)));
  assert.equal(all.length, 2);
  const total = all.reduce((sum, c) => sum + Math.round(Number(c.value.fixedAmount.amount) * 100), 0);
  assert.equal(total, Math.round((4 * 333.33 + 3 * 333.34) * 100) - 170000);
  assert.ok(all.every((c) => c.value.fixedAmount.appliesToEachItem === false));
  assert.equal(all[0].message, '2 kg box for ₹1700');
});

test('kilogram / ounce weights are converted', () => {
  assert.equal(candidates(run(input([line({ quantity: 2, grams: 0.5, unit: 'KILOGRAMS' })]))).length, 1);
  assert.deepEqual(run(input([line({ quantity: 2, grams: 10, unit: 'OUNCES' })])), NONE, '20 oz = 567 g');
});

test('a forged id on a product that does not qualify gets nothing, and adds no weight', () => {
  const forged = line({ quantity: 10, grams: 500, product: '777', inCollection: false });
  assert.deepEqual(run(input([forged])), NONE);
  const mixed = [line({ quantity: 2, grams: 300 }), forged];
  assert.deepEqual(run(input(mixed)), NONE, 'the forged line does not push a real 600 g box over 1 kg');
  // product listed by id qualifies even outside the collections
  assert.equal(candidates(run(input([line({ quantity: 4, grams: 300, product: '500', inCollection: false })]))).length, 1);
});

test('unknown template, missing markers, no config, wrong discount class → nothing', () => {
  const heavy = () => line({ quantity: 5, grams: 300 });
  assert.deepEqual(run(input([line({ quantity: 5, grams: 300, combo: '99' })])), NONE, 'unknown template');
  assert.deepEqual(run(input([line({ quantity: 5, grams: 300, combo: 'toString' })])), NONE, 'prototype keys are not templates');
  assert.deepEqual(run(input([line({ quantity: 5, grams: 300, group: null })])), NONE, 'no box token');
  assert.deepEqual(run(input([line({ quantity: 5, grams: 300, combo: null })])), NONE, 'unmarked');
  assert.deepEqual(run(input([heavy()], { cfg: null })), NONE, 'no config');
  assert.deepEqual(run(input([heavy()], { cfg: { version: 1, templates: {} } })), NONE, 'template removed (inactive / not Pro)');
  assert.deepEqual(run(input([heavy()], { classes: ['ORDER'] })), NONE, 'no PRODUCT class');
});

test('lines without a weight do not count', () => {
  const lines = [line({ quantity: 2, grams: 300 }), line({ quantity: 10, grams: null })];
  assert.deepEqual(run(input(lines)), NONE);
  const unlocked = candidates(run(input([line({ quantity: 4, grams: 300 }), line({ quantity: 10, grams: 0 })])));
  assert.equal(unlocked[0].targets.length, 1, 'only the weighed line is discounted');
});

test('two boxes in one cart are priced separately', () => {
  const lines = [line({ quantity: 4, grams: 300, group: 'a' }), line({ quantity: 2, grams: 300, group: 'b' })];
  const all = candidates(run(input(lines)));
  assert.equal(all.length, 1);
  assert.equal(all[0].targets[0].cartLine.id, lines[0].id);
});

test('presentment rate other than 1 converts the fixed box price', () => {
  // ₹1700 box at rate 0.012 (USD) = $20.40; a $30 box → $9.60 off
  const lines = [line({ quantity: 7, grams: 300, price: 30 / 7, currency: 'USD' })];
  const [only] = candidates(run(input(lines, { rate: '0.012' })));
  assert.equal(only.value.fixedAmount.amount, '9.60');
});

test('an oversized or malformed config never throws', () => {
  const weird = { version: 1, templates: { 12: { tiers: 'nope' }, 13: null } };
  assert.deepEqual(run(input([line({ quantity: 5, grams: 300 })], { cfg: weird })), NONE);
  assert.deepEqual(run(input([line({ quantity: 5, grams: 300, combo: '13' })], { cfg: weird })), NONE);
  assert.deepEqual(run({}), NONE);
});

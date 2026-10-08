// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight
// The shared weight-pricing rules (app/utils/combo-weight.shared.js) used by
// the checkout Function, BRIX COD, the storefront and the builder.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createComboWeightCore, toGrams, allocateMinor, computeBox, normalizeWeightPricing, pricingHash,
  formatWeight, decimalsFor, comboCollectionHandles, defaultWeightPricing, fillMessage, tierLabel,
  WEIGHT_BOX_LAYOUT, isWeightCombo,
} from '../../app/utils/combo-weight.shared.js';

const tiers = (...list) => list.map(([min, type, value, label = ''], i) => ({ id: `t${i + 1}`, min_grams: min, type, value, label }));
const box = (pricing, lines, extra = {}) => computeBox({ pricing, lines, decimals: 2, rate: 1, ...extra });
const book = (key, grams, qty, price, extra = {}) => ({ key, unitGrams: grams, quantity: qty, subtotalMinor: price * qty * 100, ...extra });

test('unit conversion: grams, kilograms, ounces, pounds; no weight → null', () => {
  assert.equal(toGrams(250, 'GRAMS'), 250);
  assert.equal(toGrams(0.25, 'KILOGRAMS'), 250);
  assert.equal(toGrams(1, 'OUNCES'), 28.35);
  assert.equal(toGrams(1, 'POUNDS'), 453.592);
  assert.equal(toGrams('0.5', 'kg'), 500, 'strings and short unit names');
  for (const missing of [0, null, undefined, '', -1, 'abc']) assert.equal(toGrams(missing, 'GRAMS'), null, String(missing));
  assert.equal(toGrams(10, 'STONES'), null, 'unknown unit');
});

test('999.99 g stays locked, 1000 g unlocks', () => {
  const pricing = { tiers: tiers([1000, 'percentage', 10]), max_grams: null, unit: 'kg' };
  const below = box(pricing, [book('a', 333.33, 3, 100)]);
  assert.equal(below.grams, 999.99);
  assert.equal(below.tier, null);
  assert.equal(below.remainingGrams, 1);
  assert.equal(below.discountMinor, 0);
  assert.equal(formatWeight(below.grams, 'kg'), '0.99 kg', 'never shown as 1 kg');

  const exact = box(pricing, [book('a', 250, 4, 100)]);
  assert.equal(exact.grams, 1000);
  assert.equal(exact.tier.min_grams, 1000);
  assert.equal(exact.discountMinor, 4000);
});

test('the books brief: ~1 kg of ₹100–120 books for ₹900', () => {
  const pricing = { tiers: tiers([1000, 'fixed_price', 900]), max_grams: 1200, unit: 'kg' };
  const result = box(pricing, [book('a', 300, 2, 100), book('b', 450, 1, 120)]);
  assert.equal(result.grams, 1050);
  assert.equal(result.subtotalMinor, 32000);
  // ₹320 is under the ₹900 box price → nothing off, never a negative discount
  assert.equal(result.discountMinor, 0);

  const big = box(pricing, [book('a', 100, 10, 110)]);
  assert.equal(big.subtotalMinor, 110000);
  assert.equal(big.discountMinor, 20000, '₹1100 of books for ₹900');
});

test('max weight: over the max gives no discount at all', () => {
  const pricing = { tiers: tiers([1000, 'percentage', 10], [2000, 'fixed_price', 1700]), max_grams: 2200, unit: 'kg' };
  const at = box(pricing, [book('a', 1100, 2, 1000)]);
  assert.equal(at.grams, 2200);
  assert.equal(at.overMax, false);
  assert.equal(at.tier.min_grams, 2000);
  assert.equal(at.discountMinor, 200000 - 170000);
  const over = box(pricing, [book('a', 1100, 2, 1000), book('b', 1, 1, 10)]);
  assert.equal(over.overMax, true);
  assert.equal(over.tier, null);
  assert.equal(over.discountMinor, 0);
});

test('allocations always add up exactly and never exceed a line', () => {
  for (const [total, weights] of [[100, [1, 1, 1]], [1, [3, 3, 3]], [999, [333, 333, 334]], [7, [0, 5, 2]], [5000, [1999, 1, 3000]], [10, [3]]]) {
    const parts = allocateMinor(total, weights);
    assert.equal(parts.reduce((a, b) => a + b, 0), Math.min(total, weights.reduce((a, b) => a + b, 0)), `${total} over ${weights}`);
    parts.forEach((part, i) => assert.ok(part <= weights[i] && part >= 0, `${part} <= ${weights[i]}`));
  }
  assert.deepEqual(allocateMinor(100, [500, 500, 500]), [34, 33, 33]);
  assert.deepEqual(allocateMinor(100, [1, 1, 1]), [1, 1, 1], 'never more than the lines are worth');
  assert.deepEqual(allocateMinor(0, [1, 2]), [0, 0]);
  assert.deepEqual(allocateMinor(5, [0, 0]), [0, 0]);

  const pricing = { tiers: tiers([100, 'fixed_amount', 10]), max_grams: null };
  const result = box(pricing, [book('a', 100, 1, 3.33), book('b', 100, 1, 3.33), book('c', 100, 1, 3.34)]);
  assert.equal(result.discountMinor, 1000);
  assert.equal(result.allocations.reduce((sum, a) => sum + a.amountMinor, 0), 1000);
});

test('fixed amount is capped at the box subtotal; a fixed price above the subtotal gives 0', () => {
  const amount = box({ tiers: tiers([100, 'fixed_amount', 500]) }, [book('a', 100, 1, 120)]);
  assert.equal(amount.discountMinor, 12000);
  const price = box({ tiers: tiers([100, 'fixed_price', 500]), max_grams: 1000 }, [book('a', 100, 1, 120)]);
  assert.equal(price.discountMinor, 0);
  assert.deepEqual(price.allocations, []);
});

test('JPY: zero-decimal currency, rate applied to fixed amounts', () => {
  assert.equal(decimalsFor('JPY'), 0);
  assert.equal(decimalsFor('KWD'), 3);
  assert.equal(decimalsFor('INR'), 2);
  const pricing = { tiers: tiers([500, 'fixed_amount', 10]), max_grams: null };
  // 10 (shop currency) × rate 150 = ¥1500 off a ¥4000 box
  const result = computeBox({ pricing, decimals: 0, rate: 150, lines: [{ key: 'a', unitGrams: 250, quantity: 2, subtotalMinor: 4000 }] });
  assert.equal(result.discountMinor, 1500);
  const price = computeBox({ pricing: { tiers: tiers([500, 'fixed_price', 20]), max_grams: 600 }, decimals: 0, rate: 150, lines: [{ key: 'a', unitGrams: 250, quantity: 2, subtotalMinor: 4000 }] });
  assert.equal(price.discountMinor, 1000, '¥4000 box sold for 20 × 150 = ¥3000');
});

test('lines without weight or that do not qualify do not count and are never discounted', () => {
  const pricing = { tiers: tiers([1000, 'percentage', 10]), max_grams: null };
  const result = box(pricing, [
    book('heavy', 600, 2, 100),
    book('noweight', null, 3, 100),
    book('other', 5000, 1, 100, { qualifies: false }),
  ]);
  assert.equal(result.grams, 1200);
  assert.deepEqual(result.countedKeys, ['heavy']);
  assert.deepEqual(result.unweighedKeys, ['noweight']);
  assert.deepEqual(result.allocations, [{ key: 'heavy', amountMinor: 2000 }]);
});

test('percentage is rounded per line, like checkout', () => {
  const pricing = { tiers: tiers([100, 'percentage', 12.5]) };
  const result = box(pricing, [{ key: 'a', unitGrams: 100, quantity: 1, subtotalMinor: 333 }, { key: 'b', unitGrams: 100, quantity: 1, subtotalMinor: 333 }]);
  assert.deepEqual(result.allocations.map((a) => a.amountMinor), [42, 42]);
});

test('several boxes are priced independently', () => {
  const pricing = { tiers: tiers([1000, 'percentage', 10]), max_grams: null };
  const a = box(pricing, [book('a1', 500, 2, 100)]);
  const b = box(pricing, [book('b1', 500, 1, 100)]);
  assert.equal(a.discountMinor, 2000);
  assert.equal(b.discountMinor, 0);
  assert.equal(b.remainingGrams, 500);
  assert.equal(b.nextTier.min_grams, 1000);
});

test('normalize: valid config, defaults and a stable hash', () => {
  const { value, errors } = normalizeWeightPricing({
    unit: 'kg', max_grams: 2200,
    tiers: [{ min_grams: 1000, type: 'percentage', value: 10 }, { min_grams: 2000, type: 'fixed_price', value: 1700, label: '2 kg box for ₹1700' }],
  });
  assert.deepEqual(errors, []);
  assert.equal(value.qualify.mode, 'layout_collections');
  assert.equal(value.messages.locked, 'Add {{remaining}} more to unlock {{tier}}');
  assert.match(value.hash, /^[0-9a-f]{16}$/);
  assert.equal(value.hash, pricingHash(value));
  assert.equal(normalizeWeightPricing(value).value.hash, value.hash, 'normalizing twice keeps the hash');
  const changed = normalizeWeightPricing({ ...value, tiers: [{ ...value.tiers[0], value: 11 }, value.tiers[1]] }).value;
  assert.notEqual(changed.hash, value.hash, 'a price change changes the hash');
  const msg = normalizeWeightPricing({ ...value, messages: { locked: 'Keep going!' } }).value;
  assert.equal(msg.hash, value.hash, 'messages do not change the price');
  assert.equal(tierLabel(value.tiers[0], 'kg'), '1 kg box discount');
  assert.equal(tierLabel(value.tiers[1], 'kg'), '2 kg box for ₹1700');
});

test('normalize: the validation rules', () => {
  const errorsFor = (raw) => normalizeWeightPricing(raw).errors.map((e) => e.field);
  assert.deepEqual(errorsFor({ tiers: [] }), ['tiers']);
  assert.ok(errorsFor({ tiers: Array.from({ length: 6 }, (_, i) => ({ min_grams: (i + 1) * 100, type: 'percentage', value: 5 })) }).includes('tiers'));
  assert.deepEqual(errorsFor({ tiers: [{ min_grams: 1000.5, type: 'percentage', value: 10 }] }), ['tiers.0.min_grams']);
  assert.deepEqual(errorsFor({ tiers: [{ min_grams: 1000, type: 'percentage', value: 0 }] }), ['tiers.0.value']);
  assert.deepEqual(errorsFor({ tiers: [{ min_grams: 1000, type: 'percentage', value: 101 }] }), ['tiers.0.value']);
  assert.deepEqual(errorsFor({ tiers: [{ min_grams: 1000, type: 'fixed_amount', value: -5 }] }), ['tiers.0.value']);
  assert.deepEqual(errorsFor({ tiers: [{ min_grams: 1000, type: 'bogus', value: 5 }] }), ['tiers.0.type']);
  assert.deepEqual(errorsFor({ tiers: [{ min_grams: 1000, type: 'percentage', value: 5 }, { min_grams: 1000, type: 'percentage', value: 10 }] }), ['tiers.1.min_grams'], 'strictly ascending');
  assert.deepEqual(errorsFor({ tiers: [{ min_grams: 2000, type: 'percentage', value: 5 }, { min_grams: 1000, type: 'percentage', value: 10 }] }), ['tiers.1.min_grams']);
  assert.deepEqual(errorsFor({ max_grams: 500, tiers: [{ min_grams: 1000, type: 'percentage', value: 5 }] }), ['max_grams'], 'max below the top tier');
  assert.deepEqual(errorsFor({ tiers: [{ min_grams: 1000, type: 'fixed_price', value: 900 }] }), ['max_grams'], 'box price needs a max');
  assert.deepEqual(errorsFor({ max_grams: 1200, tiers: [{ min_grams: 1000, type: 'fixed_price', value: 900 }] }), []);
  assert.deepEqual(errorsFor({ max_grams: 0, tiers: [{ min_grams: 1000, type: 'percentage', value: 5 }] }), ['max_grams']);
  assert.deepEqual(errorsFor({ qualify: { mode: 'selected' }, tiers: [{ min_grams: 1000, type: 'percentage', value: 5 }] }), ['qualify']);
  const many = Array.from({ length: 51 }, (_, i) => `gid://shopify/Product/${i + 1}`);
  assert.deepEqual(errorsFor({ qualify: { mode: 'selected', product_ids: many }, tiers: [{ min_grams: 1000, type: 'percentage', value: 5 }] }), ['qualify.product_ids']);
});

test('normalize: qualifying ids are cleaned; layout mode keeps none', () => {
  const { value, errors } = normalizeWeightPricing({
    qualify: { mode: 'selected', product_ids: ['12', 'gid://shopify/Product/12', 'gid://shopify/Collection/9', { id: 'gid://shopify/Product/13' }], collection_ids: ['gid://shopify/Collection/5', 'junk'] },
    tiers: [{ min_grams: 1000, type: 'percentage', value: 5 }],
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(value.qualify.product_ids, ['gid://shopify/Product/12', 'gid://shopify/Product/13']);
  assert.deepEqual(value.qualify.collection_ids, ['gid://shopify/Collection/5']);
  const layout = normalizeWeightPricing({ qualify: { mode: 'layout_collections', product_ids: ['12'] }, tiers: [{ min_grams: 1000, type: 'percentage', value: 5 }] }).value;
  assert.deepEqual(layout.qualify.product_ids, []);
});

test('the factory is self-contained: its source text runs on its own (as the storefront ships it)', () => {
  const source = createComboWeightCore.toString();
  assert.doesNotMatch(source, /=>|\bconst\b|\blet\b|`|\?\.|\?\?/, 'ES5 only inside the factory');
  // eslint-disable-next-line no-new-func
  const fresh = new Function(`return (${source})();`)();
  const pricing = { tiers: [{ min_grams: 1000, type: 'percentage', value: 10 }], max_grams: null };
  const lines = [{ key: 'a', unitGrams: 500, quantity: 2, subtotalMinor: 20000 }];
  assert.deepEqual(fresh.computeBox({ pricing, lines, decimals: 2 }), computeBox({ pricing, lines, decimals: 2 }));
  assert.equal(fresh.pricingHash(defaultWeightPricing()), pricingHash(defaultWeightPricing()));
});

test('The Weight Box (layout5) is always a weight combo and counts its collection pills', () => {
  assert.equal(WEIGHT_BOX_LAYOUT, 'layout5');
  assert.equal(isWeightCombo({ layout: 'layout5' }), true, 'even without pricing_mode');
  assert.equal(isWeightCombo({ layout: 'layout2' }), false);
  assert.equal(isWeightCombo({ layout: 'layout1', pricing_mode: 'weight' }), true);
  assert.deepEqual(comboCollectionHandles({ layout: 'layout5', tab_count: 2, col_1: 'novels', col_2: 'comics', col_3: 'ignored' }), ['novels', 'comics']);
  assert.deepEqual(comboCollectionHandles({ layout: 'layout5', col_1: 'a', col_4: 'd' }), ['a', 'd'], 'up to 4 by default');
});

test('layout collection handles and message placeholders', () => {
  assert.deepEqual(comboCollectionHandles({ layout: 'layout1', step_1_collection: 'books', step_2_collection: 'comics', step_3_title: 'Extras' }), ['books', 'comics']);
  assert.deepEqual(comboCollectionHandles({ layout: 'layout2', tab_count: 2, col_1: 'a', col_2: 'b', col_3: 'c' }), ['a', 'b']);
  assert.deepEqual(comboCollectionHandles({ layout: 'layout3', collection_handle: 'all', col_1: 'a', col_4: 'd' }), ['all', 'a', 'd']);
  assert.deepEqual(comboCollectionHandles({ layout: 'layout4', step_1_collection: 'x' }), ['x']);
  assert.equal(fillMessage('Add {{remaining}} more to unlock {{tier}}', { remaining: '200 g', tier: '10% off' }), 'Add 200 g more to unlock 10% off');
  assert.equal(fillMessage('Hi {{unknown}}', {}), 'Hi {{unknown}}');
  assert.equal(formatWeight(1050, 'kg'), '1.05 kg');
  assert.equal(formatWeight(1050, 'g'), '1050 g');
});

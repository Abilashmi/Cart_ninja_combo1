// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight
// Box measures: the same tier engine priced by weight (default), number of
// items ('quantity') or subtotal ('value') — core rules, hash compatibility,
// the checkout Function and the config it is synced from. Logic only: does
// NOT prove Shopify applies it (needs the Function deployed to a store).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBox, normalizeWeightPricing, boxMessage, progressOf, tierLabel, formatAmount, isWeightCombo,
  QUICK_SHOP_LAYOUT, WEIGHT_BOX_LAYOUT,
} from '../../app/utils/combo-weight.shared.js';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/brix-combo-weight-discount/src/cart_lines_discounts_generate_run.js';
import { buildComboWeightFunctionConfig } from '../../app/services/combo-weight-shopify.server.js';

const tiers = (...list) => list.map(([min, type, value, label = ''], i) => ({ id: `t${i + 1}`, min_grams: min, type, value, label }));
const item = (key, qty, price, extra = {}) => ({ key, unitGrams: null, quantity: qty, subtotalMinor: price * qty * 100, ...extra });
const box = (pricing, lines, extra = {}) => computeBox({ pricing, lines, decimals: 2, rate: 1, ...extra });

test('a weight box hashes and normalizes exactly as before measures existed', () => {
  const raw = { unit: 'kg', max_grams: 2000, tiers: tiers([1000, 'percentage', 10]) };
  const before = normalizeWeightPricing(raw).value;
  const explicit = normalizeWeightPricing({ ...raw, measure: 'weight' }).value;
  assert.equal(before.measure, undefined, 'no measure key on weight boxes');
  assert.equal(explicit.hash, before.hash);
  // The hash this box had before measures existed: weight boxes already live keep it.
  assert.equal(before.hash, '8f2c6aed45c0d639');
  const quantity = normalizeWeightPricing({ ...raw, measure: 'quantity', max_grams: 5, tiers: tiers([3, 'percentage', 10]) }).value;
  assert.equal(quantity.measure, 'quantity');
  assert.notEqual(normalizeWeightPricing({ ...raw, measure: 'quantity' }).value.hash, before.hash, 'the measure changes the price, so the hash');
});

test('quantity: 3 items unlock, weight does not matter, lines without a weight still count', () => {
  const pricing = normalizeWeightPricing({ measure: 'quantity', tiers: tiers([3, 'percentage', 10], [5, 'percentage', 20]) }).value;
  const two = box(pricing, [item('a', 2, 100)]);
  assert.equal(two.amount, 2);
  assert.equal(two.tier, null);
  assert.equal(two.remaining, 1);
  const three = box(pricing, [item('a', 2, 100), item('b', 1, 150)]);
  assert.equal(three.tier.min_grams, 3);
  assert.equal(three.discountMinor, 3500);
  assert.deepEqual(three.unweighedKeys, [], 'no weight needed');
  const five = box(pricing, [item('a', 5, 100)]);
  assert.equal(five.tier.min_grams, 5);
  assert.equal(five.discountMinor, 10000);
});

test('quantity: any 3 for ₹499 needs a max, and over the max gives nothing', () => {
  const noMax = normalizeWeightPricing({ measure: 'quantity', tiers: tiers([3, 'fixed_price', 499]) });
  assert.ok(noMax.errors.some((e) => e.field === 'max_grams'));
  const { value, errors } = normalizeWeightPricing({ measure: 'quantity', max_grams: 3, tiers: tiers([3, 'fixed_price', 499]) });
  assert.deepEqual(errors, []);
  const exact = box(value, [item('a', 3, 200)]);
  assert.equal(exact.discountMinor, 60000 - 49900);
  const over = box(value, [item('a', 4, 200)]);
  assert.equal(over.overMax, true);
  assert.equal(over.discountMinor, 0);
  assert.equal(boxMessage({ ...value, maxGrams: value.max_grams, enabled: true }, over).text, 'Your box can hold up to 3 items. Remove something to add this.');
});

test('quantity: thresholds and max must be whole numbers', () => {
  const { errors } = normalizeWeightPricing({ measure: 'quantity', max_grams: 2.5, tiers: tiers([1.5, 'percentage', 10]) });
  assert.ok(errors.some((e) => e.field === 'tiers.0.min_grams'));
  assert.ok(errors.some((e) => e.field === 'max_grams'));
});

test('value: spend ₹999 → ₹100 off; threshold checked before the discount; no max', () => {
  const { value, errors } = normalizeWeightPricing({ measure: 'value', max_grams: 5, tiers: tiers([999, 'fixed_amount', 100], [1999.5, 'percentage', 15]) });
  assert.deepEqual(errors, []);
  assert.equal(value.max_grams, null, 'a value box has no max');
  const under = box(value, [item('a', 1, 998.99)]);
  assert.equal(under.amount, 99899);
  assert.equal(under.tier, null);
  assert.equal(under.remaining, 1);
  const at = box(value, [item('a', 3, 333)]);
  assert.equal(at.tier.min_grams, 999);
  assert.equal(at.discountMinor, 10000);
  const top = box(value, [item('a', 1, 1999.5)]);
  assert.equal(top.tier.min_grams, 1999.5);
  assert.equal(top.discountMinor, Math.round(199950 * 0.15));
});

test('value: thresholds are in the shop currency, converted with the rate', () => {
  const { value } = normalizeWeightPricing({ measure: 'value', tiers: tiers([1000, 'percentage', 10]) });
  // ₹1000 at a rate of 0.012 = $12.00 in the box currency.
  assert.equal(box(value, [item('a', 1, 11.99)], { rate: 0.012 }).tier, null);
  assert.equal(box(value, [item('a', 1, 12)], { rate: 0.012 }).tier.min_grams, 1000);
});

test('value: a box price is not allowed', () => {
  const { errors } = normalizeWeightPricing({ measure: 'value', tiers: tiers([999, 'fixed_price', 899]) });
  assert.ok(errors.some((e) => e.field === 'tiers.0.type'));
});

test('labels and messages speak each measure', () => {
  assert.equal(tierLabel({ min_grams: 3 }, 'kg', 'quantity'), '3 items box discount');
  assert.equal(tierLabel({ min_grams: 999 }, 'kg', 'value'), 'Spend 999 discount');
  assert.equal(tierLabel({ min_grams: 1500 }, 'kg'), '1.5 kg box discount');
  assert.equal(formatAmount({ measure: 'value', currencySymbol: '₹' }, 25050, 2, true), '₹250.50');
  assert.equal(formatAmount({ measure: 'quantity' }, 1), '1 item');

  const pricing = normalizeWeightPricing({ measure: 'value', tiers: tiers([999, 'percentage', 10, '10% OFF']) }).value;
  const view = { ...pricing, maxGrams: null, enabled: true, currencySymbol: '₹' };
  assert.equal(boxMessage(view, box(pricing, [item('a', 1, 749)])).text, 'Add ₹250 more to unlock 10% OFF');
  assert.equal(boxMessage(view, box(pricing, [item('a', 1, 999)])).text, '10% OFF unlocked!');
  assert.equal(boxMessage({ ...view, enabled: false }, box(pricing, [item('a', 1, 999)])).text, 'Your box: ₹999');
});

test('progressOf: fill and tier marks on a scale ending at the biggest tier (not the max)', () => {
  const pricing = normalizeWeightPricing({ measure: 'quantity', max_grams: 10, tiers: tiers([2, 'percentage', 5], [4, 'percentage', 10]) }).value;
  const view = { ...pricing, maxGrams: pricing.max_grams };
  const p = progressOf(view, box(pricing, [item('a', 3, 10)]));
  assert.equal(p.percent, 75);
  assert.deepEqual(p.marks.map((m) => [m.percent, m.hit, Boolean(m.next)]), [[50, true, false], [100, false, true]]);
  const full = progressOf(view, box(pricing, [item('a', 9, 10)]));
  assert.equal(full.percent, 100, 'never past the end');
});

test('Quick Shop is always box-priced; the Weight Box too', () => {
  assert.equal(isWeightCombo({ layout: QUICK_SHOP_LAYOUT }), true);
  assert.equal(isWeightCombo({ layout: WEIGHT_BOX_LAYOUT }), true);
  assert.equal(isWeightCombo({ layout: 'layout2' }), false);
});

/* ── checkout Function + synced config ─────────────────────────────────── */

let lineNo = 0;
function cartLine({ quantity = 1, price = 100, grams = null, combo = '7', group = 'g1' } = {}) {
  lineNo += 1;
  return {
    id: `gid://shopify/CartLine/${lineNo}`,
    quantity,
    comboId: { value: combo },
    comboGroup: { value: group },
    cost: { subtotalAmount: { amount: (price * quantity).toFixed(2), currencyCode: 'INR' } },
    merchandise: {
      __typename: 'ProductVariant', id: `gid://shopify/ProductVariant/${lineNo}`, weight: grams, weightUnit: 'GRAMS',
      product: { id: 'gid://shopify/Product/100', inCollections: [{ collectionId: 'gid://shopify/Collection/900', isMember: true }] },
    },
  };
}
const fnInput = (template, lines) => ({
  cart: { lines }, discount: { discountClasses: ['PRODUCT'] }, presentmentCurrencyRate: '1.0',
  shop: { metafield: { jsonValue: { version: 1, currency: 'INR', templates: { 7: template } } } },
});
const candidatesOf = (result) => result.operations[0]?.productDiscountsAdd.candidates ?? [];

function syncedTemplate(weightPricing) {
  const { value, errors } = normalizeWeightPricing(weightPricing);
  const built = buildComboWeightFunctionConfig({
    planLive: true,
    templates: [{ id: 7, active: true, config: { layout: QUICK_SHOP_LAYOUT, tab_count: 1, col_1: 'chicken' }, pricing: value, errors }],
    collectionIdsByHandle: { chicken: 'gid://shopify/Collection/900' },
  });
  return built.config.templates['7'];
}

test('sync: non-weight boxes carry their measure into the Function config; weight boxes do not', () => {
  assert.equal(syncedTemplate({ measure: 'quantity', tiers: tiers([3, 'percentage', 10]) }).measure, 'quantity');
  assert.equal(syncedTemplate({ measure: 'quantity', tiers: tiers([3, 'percentage', 10]) }).tiers[0].label, '3 items box discount');
  assert.equal('measure' in syncedTemplate({ tiers: tiers([1000, 'percentage', 10]) }), false);
});

test('Function, quantity: 3 lines without any weight get 10% off', () => {
  const template = syncedTemplate({ measure: 'quantity', tiers: tiers([3, 'percentage', 10, '3 for 10% off']) });
  assert.deepEqual(run(fnInput(template, [cartLine({ quantity: 2 })])), { operations: [] });
  const [candidate] = candidatesOf(run(fnInput(template, [cartLine({ quantity: 2 }), cartLine({ quantity: 1 })])));
  assert.equal(candidate.message, '3 for 10% off');
  assert.equal(candidate.value.percentage.value, '10');
});

test('Function, value: ₹100 off once the box reaches ₹999', () => {
  const template = syncedTemplate({ measure: 'value', tiers: tiers([999, 'fixed_amount', 100]) });
  assert.deepEqual(run(fnInput(template, [cartLine({ price: 998 })])), { operations: [] });
  const found = candidatesOf(run(fnInput(template, [cartLine({ price: 500 }), cartLine({ price: 499 })])));
  const total = found.reduce((sum, c) => sum + Number(c.value.fixedAmount.amount), 0);
  assert.equal(total, 100);
  assert.equal(found[0].message, 'Spend 999 discount');
});

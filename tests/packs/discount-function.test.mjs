// Run with: node --test tests/packs
// Exercises the BRIX Packs checkout discount function logic directly (pure
// function). This proves the *logic*; it does NOT prove Shopify applies it —
// that needs the function deployed to a store (see CLAUDE.md, "BRIX Packs").
import test from 'node:test';
import assert from 'node:assert/strict';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/brix-packs-discount/src/cart_lines_discounts_generate_run.js';
import { calculateTier } from '../../app/utils/packs.shared.js';
import { buildFunctionConfig } from '../../app/services/packs-shopify.server.js';

const TIERS = [
  { quantity: 1, discountType: 'none', discountValue: 0 },
  { quantity: 2, discountType: 'percentage', discountValue: 5 },
  { quantity: 3, discountType: 'percentage', discountValue: 10 },
  { quantity: 5, discountType: 'fixed', discountValue: 40 },
];
const config = { version: 1, currency: 'INR', packs: { 7: { id: 7, productId: '100', variantId: '200', template: 'same_variant', tiers: TIERS } } };

function line({ id = 'gid://shopify/CartLine/1', quantity, variant = '200', product = '100', pack = '7', packQty, group = 'g1', unit = 80, currency = 'INR' }) {
  return {
    id, quantity,
    packId: pack === null ? null : { value: String(pack) },
    packQuantity: packQty === undefined ? null : { value: String(packQty) },
    packGroup: group === null ? null : { value: group },
    cost: { subtotalAmount: { amount: String((unit * quantity).toFixed(2)), currencyCode: currency } },
    merchandise: { __typename: 'ProductVariant', id: `gid://shopify/ProductVariant/${variant}`, product: { id: `gid://shopify/Product/${product}` } },
  };
}
const input = (lines, cfg = config, classes = ['PRODUCT']) => ({ cart: { lines }, discount: { discountClasses: classes }, shop: { metafield: cfg ? { jsonValue: cfg } : null } });
const candidates = (result) => result.operations[0]?.productDiscountsAdd.candidates ?? [];

test('applies the 10% tier to a marked 3-unit line (brief example: 80 x3 -> 216)', () => {
  const result = run(input([line({ quantity: 3, packQty: 3 })]));
  const [candidate] = candidates(result);
  assert.equal(result.operations[0].productDiscountsAdd.selectionStrategy, 'ALL');
  assert.deepEqual(candidate.targets, [{ cartLine: { id: 'gid://shopify/CartLine/1', quantity: 3 } }]);
  assert.equal(candidate.value.percentage.value, '10');
  // cross-check against the admin/server calculation for the same tier
  const expected = calculateTier(80, TIERS[2], { currencyCode: 'INR' });
  assert.equal(expected.price, 216);
  assert.equal(240 - 240 * Number(candidate.value.percentage.value) / 100, expected.price);
});

test('no discount without markers, config, or when quantity does not match a tier', () => {
  assert.deepEqual(run(input([line({ quantity: 3, packQty: 3, pack: null })])), { operations: [] });
  assert.deepEqual(run(input([line({ quantity: 3, packQty: 3 })], null)), { operations: [] });
  assert.deepEqual(run(input([line({ quantity: 4, packQty: 3 })])), { operations: [] }); // edited to 4: not a multiple
  assert.deepEqual(run(input([line({ quantity: 3, packQty: 4 })])), { operations: [] }); // no tier for 4
  assert.deepEqual(run(input([line({ quantity: 1, packQty: 1 })])), { operations: [] }); // "none" tier
  assert.deepEqual(run(input([line({ quantity: 3, packQty: 3 })], config, ['ORDER'])), { operations: [] });
});

test('multiples of a tier quantity still discount (two Buy-3 packs merged into 6 units)', () => {
  const [candidate] = candidates(run(input([line({ quantity: 6, packQty: 3 })])));
  assert.equal(candidate.value.percentage.value, '10');
  assert.equal(candidate.targets[0].cartLine.quantity, 6);
});

test('forged properties cannot discount the wrong product or variant', () => {
  assert.deepEqual(run(input([line({ quantity: 3, packQty: 3, product: '999' })])), { operations: [] });
  assert.deepEqual(run(input([line({ quantity: 3, packQty: 3, variant: '201' })])), { operations: [] });
  assert.deepEqual(run(input([line({ quantity: 3, packQty: 3, pack: '8' })])), { operations: [] }); // unknown pack id
});

test('different packs / groups discount independently', () => {
  const lines = [line({ id: 'gid://shopify/CartLine/1', quantity: 2, packQty: 2, group: 'a' }), line({ id: 'gid://shopify/CartLine/2', quantity: 3, packQty: 3, group: 'b' })];
  const result = candidates(run(input(lines)));
  assert.deepEqual(result.map((c) => c.value.percentage.value), ['5', '10']);
});

test('fixed discount: total off per pack, only in the shop currency', () => {
  const [candidate] = candidates(run(input([line({ quantity: 5, packQty: 5 })])));
  assert.deepEqual(candidate.value, { fixedAmount: { amount: '40.00', appliesToEachItem: false } });
  assert.equal(calculateTier(80, TIERS[3], { currencyCode: 'INR' }).price, 360);
  assert.deepEqual(run(input([line({ quantity: 5, packQty: 5, currency: 'USD' })])), { operations: [] }); // no rate available -> skip, never guess
  const two = candidates(run(input([line({ quantity: 10, packQty: 5 })])));
  assert.equal(two[0].value.fixedAmount.amount, '80.00'); // two packs
});

test('choose-each-item: mixed variants in one group share one pack discount', () => {
  const mixed = { ...config, packs: { 7: { ...config.packs[7], template: 'choose_each_item' } } };
  const lines = [
    line({ id: 'gid://shopify/CartLine/1', quantity: 2, packQty: 3, variant: '200', group: 'x', unit: 10 }),
    line({ id: 'gid://shopify/CartLine/2', quantity: 1, packQty: 3, variant: '201', group: 'x', unit: 30 }),
  ];
  const percent = candidates(run(input(lines, mixed)));
  assert.equal(percent.length, 2);
  assert.ok(percent.every((c) => c.value.percentage.value === '10'));
  // fixed: split proportionally to line subtotals, remainder to the last line, total preserved
  const fixedCfg = { ...mixed, packs: { 7: { ...mixed.packs[7], tiers: [{ quantity: 3, discountType: 'fixed', discountValue: 10 }] } } };
  const fixed = candidates(run(input(lines, fixedCfg)));
  const total = fixed.reduce((sum, c) => sum + Number(c.value.fixedAmount.amount), 0);
  assert.equal(Math.round(total * 100), 1000);
  // ...but a non-choose template must NOT accept a different variant
  assert.deepEqual(run(input([line({ quantity: 3, packQty: 3, variant: '201' })])), { operations: [] });
});

test('buildFunctionConfig (server) produces exactly the shape the function reads', () => {
  const built = buildFunctionConfig([{ id: 7, version: 3, productId: '100', variantId: '200', template: 'same_variant', tiers: [{ quantity: 3, discountType: 'percentage', discountValue: 10, name: 'x', badge: 'y' }, { quantity: 1, discountType: 'none' }] }], 'INR');
  assert.equal(built.currency, 'INR');
  assert.deepEqual(built.packs['7'].tiers, [{ quantity: 1, discountType: 'none', discountValue: 0 }, { quantity: 3, discountType: 'percentage', discountValue: 10 }]);
  const [candidate] = candidates(run(input([line({ quantity: 3, packQty: 3 })], built)));
  assert.equal(candidate.value.percentage.value, '10');
});

test('never crashes on malformed input', () => {
  assert.deepEqual(run({}), { operations: [] });
  assert.deepEqual(run({ cart: { lines: [] }, shop: {} }), { operations: [] });
  assert.deepEqual(run(input([line({ quantity: 3, packQty: 'abc' })])), { operations: [] });
  assert.deepEqual(run(input([{ id: 'x', quantity: 1, merchandise: { __typename: 'CustomProduct' } }])), { operations: [] });
});

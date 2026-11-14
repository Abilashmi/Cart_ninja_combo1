// Run with: node --import ./tests/packs/register.mjs --test tests/packs/extra-products.test.mjs
// A Mix & Match Pack that includes OTHER products: the pure rules, the checkout Function's matching and
// the config size guard. Logic only; a real checkout on a store has not been run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/brix-packs-discount/src/cart_lines_discounts_generate_run.js';
import { sanitizeExtraProducts, sanitizeShowOn, validateExtraProducts, MAX_EXTRA_PRODUCTS, MAX_SHOW_ON } from '../../app/utils/packs.shared.js';
import { packDiscountsFor, packCoversLine } from '../../app/utils/packs-discount.shared.js';
import { buildFunctionConfig, fitPacksConfig, PACKS_CONFIG_BYTE_LIMIT } from '../../app/services/packs-shopify.server.js';

const TIERS = [{ quantity: 3, discountType: 'percentage', discountValue: 10 }, { quantity: 4, discountType: 'fixed', discountValue: 40 }];
const pack = (over = {}) => ({
  id: 7, version: 1, productId: '100', variantId: '200', template: 'choose_each_item', variantScope: 'all', allowedVariantIds: [], tiers: TIERS,
  extraProducts: [{ productId: '101', variantScope: 'selected', allowedVariantIds: ['301', '302'] }, { productId: '102', variantScope: 'all', allowedVariantIds: [] }],
  ...over,
});
const config = (p = pack()) => buildFunctionConfig([p], 'INR');

const gid = (type, id) => `gid://shopify/${type}/${id}`;
function line({ id = 1, quantity = 1, variant = '200', product = '100', pack: packId = '7', packQty = 3, group = 'g1', unit = 100 }) {
  return {
    id: gid('CartLine', id), quantity,
    packId: { value: String(packId) }, packQuantity: { value: String(packQty) }, packGroup: { value: group },
    cost: { subtotalAmount: { amount: (unit * quantity).toFixed(2), currencyCode: 'INR' } },
    merchandise: { __typename: 'ProductVariant', id: gid('ProductVariant', variant), product: { id: gid('Product', product) } },
  };
}
const input = (lines, cfg = config()) => ({ cart: { lines }, discount: { discountClasses: ['PRODUCT'] }, shop: { metafield: cfg ? { jsonValue: cfg } : null } });
const candidates = (result) => result.operations[0]?.productDiscountsAdd.candidates ?? [];

/* ── pure rules ─────────────────────────────────────────────────────────────── */

test('sanitizeExtraProducts: numeric ids, safe handle, https image, deduped and capped', () => {
  const out = sanitizeExtraProducts([
    { productId: 'gid://shopify/Product/5', handle: 'a-b', title: 'T', image: 'https://x/y.png', variantScope: 'selected', allowedVariantIds: ['1', 'gid://shopify/ProductVariant/2', 'x'] },
    { productId: '5' }, // duplicate
    { productId: 'nope' },
    { productId: '6', handle: '../etc', image: 'javascript:alert(1)', variantScope: 'all', allowedVariantIds: ['9'] },
  ]);
  assert.deepEqual(out[0], { productId: '5', handle: 'a-b', title: 'T', image: 'https://x/y.png', variantScope: 'selected', allowedVariantIds: ['1', '2'] });
  assert.equal(out.length, 2);
  assert.equal(out[1].handle, '', 'a handle that is not a slug is dropped');
  assert.equal(out[1].image, '', 'only https images are kept');
  assert.deepEqual(out[1].allowedVariantIds, [], 'scope all stores no variant list');
  assert.equal(sanitizeExtraProducts(Array.from({ length: 20 }, (_, i) => ({ productId: String(i + 1) }))).length, MAX_EXTRA_PRODUCTS);
  assert.deepEqual(sanitizeExtraProducts('x'), []);
  assert.equal(sanitizeShowOn(Array.from({ length: 50 }, (_, i) => String(i + 1))).length, MAX_SHOW_ON);
  assert.deepEqual(sanitizeShowOn(['gid://shopify/Product/3', '3', 'z']), ['3']);
});

test('validateExtraProducts: Mix & Match only, no main product twice, selected needs a variant', () => {
  const extras = sanitizeExtraProducts([{ productId: '101', title: 'Soap', variantScope: 'selected', allowedVariantIds: ['1'] }]);
  assert.equal(validateExtraProducts({ packType: 'mix_match', productId: '100', extraProducts: extras }).valid, true);
  assert.equal(validateExtraProducts({ packType: 'mix_match', productId: '100', extraProducts: [] }).valid, true, 'no extras is always fine');
  assert.match(validateExtraProducts({ packType: 'same_variant', productId: '100', extraProducts: extras }).errors[0].message, /Mix & Match/);
  assert.match(validateExtraProducts({ packType: 'mix_match', productId: '101', extraProducts: extras }).errors[0].message, /already included/);
  const none = sanitizeExtraProducts([{ productId: '101', title: 'Soap', variantScope: 'selected', allowedVariantIds: [] }]);
  assert.match(validateExtraProducts({ packType: 'mix_match', productId: '100', extraProducts: none }).errors[0].message, /at least one variant of Soap/);
});

/* ── which lines belong to the pack ─────────────────────────────────────────── */

test('packCoversLine: main product by its own scope, extra products by theirs, nothing else', () => {
  const p = config().packs['7']; // the shape the Function reads
  const l = (product, variant) => ({ productId: product, variantId: variant });
  assert.equal(packCoversLine(p, l('100', '999')), true, 'main product, scope all');
  assert.equal(packCoversLine(p, l('101', '301')), true, 'extra product, allowed variant');
  assert.equal(packCoversLine(p, l('101', '399')), false, 'extra product, variant not picked');
  assert.equal(packCoversLine(p, l('102', '555')), true, 'extra product with scope all');
  assert.equal(packCoversLine(p, l('103', '301')), false, 'a product the pack does not list');
  const mainSelected = config(pack({ variantScope: 'selected', allowedVariantIds: ['200'] })).packs['7'];
  assert.equal(packCoversLine(mainSelected, l('100', '201')), false);
  assert.equal(packCoversLine(config(pack({ extraProducts: [] })).packs['7'], l('101', '301')), false, 'a pack without extras is exactly as before');
});

/* ── the checkout Function ──────────────────────────────────────────────────── */

test('Function: items from several products in ONE group share the pack discount', () => {
  const result = run(input([
    line({ id: 1, quantity: 1, variant: '200', product: '100' }),
    line({ id: 2, quantity: 1, variant: '301', product: '101' }),
    line({ id: 3, quantity: 1, variant: '555', product: '102' }),
  ]));
  const found = candidates(result);
  assert.equal(found.length, 3, 'every line of the mixed pack gets the discount');
  assert.ok(found.every((c) => c.value.percentage.value === '10'));
});

test('Function: a forged line (product or variant the pack does not list) breaks the group, never gets a discount', () => {
  // 103 is not part of the pack: only 2 of the 3 items count, which is not a whole multiple of 3
  const forged = run(input([
    line({ id: 1, quantity: 1, variant: '200', product: '100' }),
    line({ id: 2, quantity: 1, variant: '301', product: '101' }),
    line({ id: 3, quantity: 1, variant: '777', product: '103' }),
  ]));
  assert.deepEqual(forged, { operations: [] });
  // right product, variant that was not picked
  const unpicked = run(input([line({ id: 1, quantity: 2, product: '100' }), line({ id: 2, quantity: 1, variant: '399', product: '101' })]));
  assert.deepEqual(unpicked, { operations: [] });
});

test('Function: a pack WITHOUT extra products rejects another product exactly as it always did', () => {
  const plain = config(pack({ extraProducts: [] }));
  assert.equal(plain.packs['7'].extraProducts, undefined, 'the key is only written when used');
  const result = run(input([line({ id: 1, quantity: 2, product: '100' }), line({ id: 2, quantity: 1, variant: '301', product: '101' })], plain));
  assert.deepEqual(result, { operations: [] });
});

test('fixed amount tier is split across the products by price and never exceeds the group subtotal', () => {
  const p = pack();
  const cfg = config(p);
  const lines = [
    { id: 'a', quantity: 2, packId: '7', packQuantity: 4, packGroup: 'g', productId: '100', variantId: '200', subtotalAmount: '200.00', currencyCode: 'INR' },
    { id: 'b', quantity: 2, packId: '7', packQuantity: 4, packGroup: 'g', productId: '101', variantId: '301', subtotalAmount: '600.00', currencyCode: 'INR' },
  ];
  const out = packDiscountsFor(cfg, lines);
  assert.equal(out.length, 2);
  assert.equal(out.reduce((s, d) => s + d.amount, 0), 4000, 'Rs 40 off the pack, in minor units');
  assert.equal(out.find((d) => d.id === 'a').amount, 1000, 'shares follow the line subtotals (200 : 600)');
  assert.equal(out.find((d) => d.id === 'b').amount, 3000);
});

/* ── config shape and size ──────────────────────────────────────────────────── */

test('buildFunctionConfig: extra products by id with their own scope; ids are numeric strings', () => {
  const built = config(pack({ extraProducts: [{ productId: 'gid://shopify/Product/101', variantScope: 'selected', allowedVariantIds: ['gid://shopify/ProductVariant/301'] }, { productId: '102', variantScope: 'all', allowedVariantIds: ['9'] }] })).packs['7'];
  assert.deepEqual(built.extraProducts, { 101: { scope: 'selected', allowedVariantIds: ['301'] }, 102: { scope: 'all', allowedVariantIds: [] } });
});

test('fitPacksConfig: leaves a small config alone; over the limit it drops only packs with extra products', () => {
  const small = config();
  assert.equal(fitPacksConfig(small).skipped.length, 0);
  assert.equal(fitPacksConfig(small).config, small);

  const many = (id, n) => pack({ id, extraProducts: Array.from({ length: n }, (_, i) => ({ productId: String(1000 + i), variantScope: 'selected', allowedVariantIds: Array.from({ length: 100 }, (_x, j) => String(5000000 + i * 1000 + j)) })) });
  const plain = pack({ id: 1, extraProducts: [] });
  const big = buildFunctionConfig([plain, many(2, 6), many(3, 6)], 'INR');
  const fit = fitPacksConfig(big);
  assert.ok(fit.skipped.length >= 1, 'something had to go');
  assert.ok(new TextEncoder().encode(JSON.stringify(fit.config)).length <= PACKS_CONFIG_BYTE_LIMIT);
  assert.ok('1' in fit.config.packs, 'a pack without extra products is never dropped');
  assert.ok(!fit.skipped.includes('1'));
  // what stays is untouched
  for (const id of Object.keys(fit.config.packs)) assert.deepEqual(fit.config.packs[id], big.packs[id]);
});

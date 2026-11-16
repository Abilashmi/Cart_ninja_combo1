// Run with: node --import ./tests/packs/register.mjs --test tests/packs/shared-packs.test.mjs
// One Pack used on more products and collections (appliesTo), and the set pack price ('set').
// Pure logic plus the checkout Function run on a fake input; never touches a store or database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAppliesTo, appliesProductIds, appliesCollectionIds, isSharedPack, calculateTierFromPrices, validateTiers, normalizeTiers, MAX_APPLIES_PRODUCTS,
} from '../../app/utils/packs.shared.js';
import { packDiscountsFor } from '../../app/utils/packs-discount.shared.js';
import { buildFunctionConfig, buildPacksVariables } from '../../app/services/packs-shopify.server.js';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/brix-packs-discount/src/cart_lines_discounts_generate_run.js';

test('appliesTo: clean ids, no duplicates, the Pack\'s own product never listed, limits kept', () => {
  const raw = {
    products: [{ productId: 'gid://shopify/Product/5', title: 'Polo', image: 'https://cdn/x.jpg' }, { productId: '5' }, { productId: '1' }, { productId: 'bad' }, { productId: '6', image: 'javascript:alert(1)' }],
    collections: [{ collectionId: 'gid://shopify/Collection/9', title: 'Kurtas' }, { collectionId: '9' }, { collectionId: '10', sync: false, frozenIds: ['11', '11', '12', 'x'] }],
    excluded: ['1', '7', '7'],
  };
  const clean = sanitizeAppliesTo(raw, '1');
  assert.deepEqual(clean.products.map((item) => item.productId), ['5', '6']);
  assert.equal(clean.products[1].image, '');
  assert.deepEqual(clean.collections.map((item) => [item.collectionId, item.sync]), [['9', true], ['10', false]]);
  assert.deepEqual(clean.collections[1].frozenIds, ['11', '12']);
  assert.equal(clean.collections[0].frozenIds, undefined, 'a synced collection keeps no product list');
  assert.deepEqual(clean.excluded, ['7']);
  assert.deepEqual(appliesProductIds(clean), ['5', '6', '11', '12']);
  assert.deepEqual(appliesCollectionIds(clean), ['9']);
  assert.equal(isSharedPack({ appliesTo: clean }), true);
  assert.equal(isSharedPack({ appliesTo: sanitizeAppliesTo(null, '1') }), false);
  const many = sanitizeAppliesTo({ products: Array.from({ length: 150 }, (_, i) => ({ productId: String(1000 + i) })) });
  assert.equal(many.products.length, MAX_APPLIES_PRODUCTS);
  // A left-out product never counts, even if a frozen collection holds it.
  assert.deepEqual(appliesProductIds(sanitizeAppliesTo({ collections: [{ collectionId: '3', sync: false, frozenIds: ['20', '21'] }], excluded: ['21'] }, '1')), ['20']);
});

test('set pack price: the pack costs exactly that; never a negative discount', () => {
  const two = calculateTierFromPrices([599, 599], { quantity: 2, discountType: 'set', discountValue: 999 }, 2);
  assert.deepEqual([two.subtotal, two.price, two.savings], [1198, 999, 199]);
  const cheap = calculateTierFromPrices([449, 449], { quantity: 2, discountType: 'set', discountValue: 999 }, 2);
  assert.deepEqual([cheap.price, cheap.savings], [898, 0], 'already cheaper: full price, no saving');
  assert.equal(normalizeTiers([{ quantity: 2, discountType: 'set', discountValue: '999' }])[0].discountType, 'set');
});

test('set pack price validation: above zero; below the full price unless the Pack runs on other products', () => {
  const tiers = [{ quantity: 2, discountType: 'set', discountValue: 999 }];
  assert.equal(validateTiers(tiers, { basePrice: 599, currencyCode: 'INR' }).valid, true);
  assert.match(validateTiers(tiers, { basePrice: 449, currencyCode: 'INR' }).errors[0].message, /lower than the full price/);
  assert.equal(validateTiers(tiers, { basePrice: 449, currencyCode: 'INR', sharedPrices: true }).valid, true, 'shared: checked per product in the builder');
  assert.match(validateTiers([{ quantity: 2, discountType: 'set', discountValue: 0 }], { basePrice: 599 }).errors[0].message, /greater than 0/);
});

// ── checkout rule ──
const kurtaPack = {
  id: 7, version: 3, productId: '100', variantId: '1001', variantScope: 'all', allowedVariantIds: [],
  tiers: [{ quantity: 1, discountType: 'none', discountValue: 0 }, { quantity: 2, discountType: 'set', discountValue: 999 }],
  applies: { p: ['200'], c: ['900'], x: ['300'] },
};
const config = { version: 1, currency: 'INR', packs: { 7: kurtaPack } };
const line = (over) => ({ id: over.id || 'l1', quantity: 2, packId: '7', packQuantity: '2', packGroup: 'g', productId: '100', variantId: '1001', subtotalAmount: 1198, currencyCode: 'INR', collectionIds: [], ...over });

test('a shared Pack covers its own product, listed products and collection members; never left-out or unknown ones', () => {
  assert.equal(packDiscountsFor(config, [line({})])[0].amount, 19900, 'own product: 1198 -> 999');
  assert.equal(packDiscountsFor(config, [line({ productId: '200', variantId: '2001' })])[0].amount, 19900, 'listed product, any variant');
  assert.equal(packDiscountsFor(config, [line({ productId: '400', variantId: '4001', collectionIds: ['900'] })])[0].amount, 19900, 'in a synced collection');
  assert.deepEqual(packDiscountsFor(config, [line({ productId: '400', variantId: '4001', collectionIds: [] })]), [], 'not in the collection');
  assert.deepEqual(packDiscountsFor(config, [line({ productId: '300', variantId: '3001', collectionIds: ['900'] })]), [], 'left out');
});

test('set price at checkout: shared across lines by price, nothing when the pack already costs less, shop currency only', () => {
  const split = packDiscountsFor(config, [
    line({ id: 'a', quantity: 1, subtotalAmount: 599 }),
    line({ id: 'b', quantity: 1, variantId: '1002', subtotalAmount: 599 }),
  ]);
  assert.equal(split.reduce((sum, d) => sum + d.amount, 0), 19900);
  assert.deepEqual(packDiscountsFor(config, [line({ subtotalAmount: 898 })]), [], 'already under the set price');
  assert.deepEqual(packDiscountsFor(config, [line({ currencyCode: 'USD' })]), [], 'other currency');
  // Two packs in one add (quantity 4): two set prices.
  assert.equal(packDiscountsFor(config, [line({ quantity: 4, subtotalAmount: 2396 })])[0].amount, 39800);
});

test('one pack group is one product: two different kurtas never make one "Buy 2"', () => {
  const mixed = packDiscountsFor(config, [
    line({ id: 'a', quantity: 1, subtotalAmount: 599 }),
    line({ id: 'b', quantity: 1, productId: '200', variantId: '2001', subtotalAmount: 1299 }),
  ]);
  assert.deepEqual(mixed, []);
});

test('Fixed Combo used on a whole collection: any kurta of it + the dupatta at the set price', () => {
  const combo = {
    id: 8, version: 1, productId: '100', variantId: '1001', variantScope: 'all', allowedVariantIds: [], packType: 'combo',
    tiers: [{ quantity: 2, discountType: 'set', discountValue: 1199, items: [{ p: '500', v: '5001', q: 1 }] }],
    applies: { p: [], c: ['900'], x: [] },
  };
  const cfg = { version: 1, currency: 'INR', packs: { 8: combo } };
  const kurta = { id: 'k', quantity: 1, packId: '8', packQuantity: '2', packGroup: 'g', productId: '400', variantId: '4001', subtotalAmount: 999, currencyCode: 'INR', collectionIds: ['900'] };
  const dupatta = { ...kurta, id: 'd', productId: '500', variantId: '5001', subtotalAmount: 399, collectionIds: [] };
  const out = packDiscountsFor(cfg, [kurta, dupatta]);
  assert.equal(out.reduce((sum, d) => sum + d.amount, 0), 19900, '999 + 399 -> 1199');
  assert.deepEqual(packDiscountsFor(cfg, [{ ...kurta, collectionIds: [] }, dupatta]), [], 'a kurta outside the collection');
});

test('checkout config: `applies` only on shared Packs; the discount gets every synced collection as a gid', () => {
  const plain = { id: 1, version: 1, productId: '100', variantId: '1001', variantScope: 'all', tiers: [{ quantity: 2, discountType: 'percentage', discountValue: 10 }], appliesTo: sanitizeAppliesTo(null, '100') };
  const shared = { ...plain, id: 2, appliesTo: sanitizeAppliesTo({ products: [{ productId: '200' }], collections: [{ collectionId: '900' }, { collectionId: '901', sync: false, frozenIds: ['210'] }], excluded: ['300'] }, '100') };
  const built = buildFunctionConfig([plain, shared], 'INR');
  assert.equal(built.packs[1].applies, undefined, 'a plain Pack stays byte-for-byte what it was');
  assert.deepEqual(built.packs[2].applies, { p: ['200', '210'], c: ['900'], x: ['300'] });
  assert.deepEqual(buildPacksVariables([plain, shared]), { collectionIds: ['gid://shopify/Collection/900'] });
  assert.deepEqual(buildPacksVariables([plain]), { collectionIds: [] });
});

test('the checkout Function reads collection membership from inCollections', () => {
  const cartLine = (inCollections) => ({
    id: 'gid://shopify/CartLine/1', quantity: 2,
    packId: { value: '7' }, packQuantity: { value: '2' }, packGroup: { value: 'g' },
    cost: { subtotalAmount: { amount: '1198.00', currencyCode: 'INR' } },
    merchandise: { __typename: 'ProductVariant', id: 'gid://shopify/ProductVariant/4001', product: { id: 'gid://shopify/Product/400', inCollections } },
  });
  const input = (lines) => ({ cart: { lines }, discount: { discountClasses: ['PRODUCT'] }, shop: { metafield: { jsonValue: config } } });
  const member = run(input([cartLine([{ collectionId: 'gid://shopify/Collection/900', isMember: true }])]));
  const candidate = member.operations[0].productDiscountsAdd.candidates[0];
  assert.equal(candidate.value.fixedAmount.amount, '199.00');
  assert.deepEqual(run(input([cartLine([{ collectionId: 'gid://shopify/Collection/900', isMember: false }])])), { operations: [] });
  assert.deepEqual(run(input([cartLine(undefined)])), { operations: [] }, 'no variables written yet: no membership');
});

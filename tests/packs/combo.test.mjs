// Run with: node --import ./tests/packs/register.mjs --test tests/packs/combo.test.mjs
// Fixed Combo packs (pack type 'combo'): each tier is this product (the
// shopper's variant) + fixed items the merchant chose. Tier rules, the
// checkout / COD discount (only for a cart holding exactly a pack's items)
// and the Function config.
import test from 'node:test';
import assert from 'node:assert/strict';

const { normalizeTiers, validateTiers, validateComboTiers, comboTierQuantity, sanitizeComboItems, PACK_TYPES } = await import('../../app/utils/packs.shared.js');
const { packDiscountsFor, packCoversLine } = await import('../../app/utils/packs-discount.shared.js');
const { buildFunctionConfig } = await import('../../app/services/packs-shopify.server.js');

const DUPATTA_RED = { productId: '201', variantId: '2011', quantity: 1, handle: 'dupatta', title: 'Dupatta', variantTitle: 'Red', image: 'https://cdn.test/d.jpg' };
const PALAZZO = { productId: '301', variantId: '3011', quantity: 1, handle: 'palazzo', title: 'Palazzo' };
const SCARF = { productId: '401', variantId: '4011', quantity: 1, handle: 'scarf', title: 'Scarf' };

test('combo type and tier items: quantity = this product + the items', () => {
  assert.ok(PACK_TYPES.some((t) => t.id === 'combo' && t.templates.includes('fixed_combo')));
  const tiers = normalizeTiers([
    { name: 'Kurta only', quantity: 99, discountType: 'none', items: [] },
    { name: 'With dupatta', quantity: 1, discountType: 'percentage', discountValue: 10, items: [DUPATTA_RED] },
    { name: 'Full set', discountType: 'fixed', discountValue: 300, items: [DUPATTA_RED, { ...PALAZZO, quantity: 2 }] },
  ]);
  assert.deepEqual(tiers.map((t) => [t.name, t.quantity]), [['Kurta only', 1], ['With dupatta', 2], ['Full set', 4]], 'quantity always follows the items');
  assert.equal(comboTierQuantity({ items: [DUPATTA_RED, DUPATTA_RED] }), 3, 'the same variant twice counts as 2');
  assert.deepEqual(sanitizeComboItems([{ productId: 'gid://shopify/Product/201', variantId: 'gid://shopify/ProductVariant/2011', quantity: 50 }]).map((i) => [i.productId, i.variantId, i.quantity]), [['201', '2011', 10]]);
  assert.equal(sanitizeComboItems([{ productId: '1', variantId: '2', image: 'http://insecure.test/x.jpg' }])[0].image, '', 'images must be https');
  // Other tier types are unchanged (no items key).
  assert.equal('items' in normalizeTiers([{ quantity: 2, discountType: 'none' }])[0], false);
});

test('combo tiers: same item count allowed; fixed discount checked against the pack\'s own items', () => {
  const tiers = normalizeTiers([
    { name: 'Kurta + dupatta', discountType: 'fixed', discountValue: 200, items: [DUPATTA_RED] },
    { name: 'Kurta + scarf', discountType: 'fixed', discountValue: 900, items: [SCARF] },
  ]);
  assert.equal(validateTiers(tiers).valid, false, 'other pack types still need unique quantities');
  assert.equal(validateTiers(tiers, { packType: 'combo' }).valid, true);
  const priced = validateTiers(tiers, { packType: 'combo', tierSubtotals: [1999, 800], currencyCode: 'INR' });
  assert.equal(priced.valid, false);
  assert.deepEqual(priced.errors.map((e) => [e.index, e.field]), [[1, 'discountValue']], '₹900 off an ₹800 pack is refused, ₹200 off ₹1,999 is fine');
  assert.equal(validateComboTiers([{ items: [{ productId: '100', variantId: '1001' }] }], 'gid://shopify/Product/100').valid, false, 'this product can\'t be one of its own items');
});

// The Function config as buildFunctionConfig writes it for a combo pack on product 100.
const PACK = {
  id: 7, version: 3, productId: '100', variantId: '1001', template: 'fixed_combo', packType: 'combo', variantScope: 'all', allowedVariantIds: [],
  tiers: [
    { name: 'Kurta + dupatta', discountType: 'percentage', discountValue: 10, items: [DUPATTA_RED] },
    { name: 'Kurta + scarf', discountType: 'percentage', discountValue: 20, items: [SCARF] },
    { name: 'Full set', discountType: 'fixed', discountValue: 300, items: [DUPATTA_RED, PALAZZO] },
  ],
};
const config = buildFunctionConfig([PACK], 'INR');
const line = (id, productId, variantId, quantity, amount, packQuantity, group = 'g1') => ({ id, quantity, packId: '7', packQuantity: String(packQuantity), packGroup: group, productId, variantId, subtotalAmount: amount, currencyCode: 'INR' });

test('config: combo tiers carry their exact items; other packs are byte-for-byte as before', () => {
  assert.equal(config.packs['7'].packType, 'combo');
  assert.deepEqual(config.packs['7'].tiers.map((t) => t.items), [[{ p: '201', v: '2011', q: 1 }], [{ p: '401', v: '4011', q: 1 }], [{ p: '201', v: '2011', q: 1 }, { p: '301', v: '3011', q: 1 }]]);
  const plain = buildFunctionConfig([{ ...PACK, id: 8, packType: 'same_variant', template: 'same_variant', tiers: [{ quantity: 2, discountType: 'percentage', discountValue: 10 }] }], 'INR');
  assert.equal('packType' in plain.packs['8'], false);
  assert.equal('items' in plain.packs['8'].tiers[0], false);
});

test('discount: exactly a pack\'s items = its discount; the contents pick the tier when counts match', () => {
  // Kurta (any size) + red dupatta → the 10% tier.
  const withDupatta = packDiscountsFor(config, [line('a', '100', '1002', 1, 1599, 2), line('b', '201', '2011', 1, 400, 2)]);
  assert.deepEqual(withDupatta.map((d) => [d.id, d.percent]), [['a', 10], ['b', 10]]);
  // Kurta + scarf → also 2 items, but the 20% tier.
  const withScarf = packDiscountsFor(config, [line('a', '100', '1001', 1, 1599, 2), line('b', '401', '4011', 1, 300, 2)]);
  assert.deepEqual(withScarf.map((d) => d.percent), [20, 20]);
  // Two full sets in one group: the fixed ₹300 twice, shared by price.
  const twoSets = packDiscountsFor(config, [line('a', '100', '1001', 2, 3198, 3), line('b', '201', '2011', 2, 800, 3), line('c', '301', '3011', 2, 1200, 3)]);
  assert.equal(twoSets.reduce((s, d) => s + d.amount, 0), 60000, '₹600 in paise');
});

test('discount: no pack, no discount (missing item, wrong variant, extra item, wrong count)', () => {
  assert.deepEqual(packDiscountsFor(config, [line('a', '100', '1001', 1, 1599, 2)]), [], 'dupatta removed from the cart');
  assert.deepEqual(packDiscountsFor(config, [line('a', '100', '1001', 1, 1599, 2), line('b', '201', '2099', 1, 400, 2)]), [], 'a different dupatta colour isn\'t the pack\'s');
  assert.deepEqual(packDiscountsFor(config, [line('a', '100', '1001', 1, 1599, 2), line('b', '201', '2011', 2, 800, 2)]), [], 'two dupattas with one kurta isn\'t a pack');
  assert.deepEqual(packDiscountsFor(config, [line('a', '100', '1001', 1, 1599, 3), line('b', '201', '2011', 1, 400, 3)]), [], 'claims the full set but the palazzo is missing');
  assert.equal(packCoversLine(config.packs['7'], { productId: '999', variantId: '9991' }), false);
  assert.equal(packCoversLine(config.packs['7'], { productId: '301', variantId: '3011' }), true);
});

test('prices: a combo tier is this product + its items; two packs with the same contents are refused', async () => {
  const { calculateComboTier } = await import('../../app/utils/packs.shared.js');
  const full = calculateComboTier(1599, { discountType: 'fixed', discountValue: 300, items: [DUPATTA_RED, { ...PALAZZO, quantity: 2 }] }, { 2011: 400, 3011: 600 }, { currencyCode: 'INR' });
  assert.deepEqual([full.quantity, full.subtotal, full.price, full.formatted.price], [4, 3199, 2899, '₹2,899.00']);
  assert.equal(calculateComboTier(1599, { discountType: 'none', items: [DUPATTA_RED] }, {}), null, 'an item with no known price is never guessed');
  const twins = validateComboTiers([{ items: [DUPATTA_RED] }, { items: [{ ...DUPATTA_RED, title: 'renamed' }] }], '100');
  assert.deepEqual(twins.errors.map((e) => [e.index, e.field]), [[1, 'items']]);
  assert.equal(validateComboTiers([{ items: [] }, { items: [DUPATTA_RED] }, { items: [DUPATTA_RED, SCARF] }], '100').valid, true);
  assert.equal(validateComboTiers([{ items: [] }, { items: [] }], '100').valid, false, 'two "this product only" packs');
});

// A fake Admin API answering PackProduct with the given product nodes (by numeric id).
const fakeAdmin = (nodes) => ({
  graphql: async (query, { variables }) => ({ json: async () => ({ data: { product: nodes[String(variables.id).split('/').pop()] || null } }) }),
});
const productNode = (id, status, over = {}) => ({
  id: `gid://shopify/Product/${id}`, title: `Product ${id}`, handle: `p-${id}`, status, onlineStoreUrl: status === 'ACTIVE' ? `https://shop.test/products/p-${id}` : null, featuredImage: null,
  variants: { nodes: [{ id: `gid://shopify/ProductVariant/${id}1`, title: 'Default Title', price: '400.00', availableForSale: true, inventoryQuantity: 5, inventoryPolicy: 'DENY', image: null, selectedOptions: [] }] },
  ...over,
});

test('unlisted products can be in a Pack (main product, Mix & Match extras, combo items); drafts and archived cannot', async () => {
  const { verifyComboTiers, verifyExtraProducts, verifyPackCoverage, isSellableStatus } = await import('../../app/services/packs-shopify.server.js');
  assert.deepEqual(['ACTIVE', 'UNLISTED', 'DRAFT', 'ARCHIVED'].map(isSellableStatus), [true, true, false, false]);
  const admin = fakeAdmin({ 100: productNode(100, 'UNLISTED'), 201: productNode(201, 'UNLISTED'), 301: productNode(301, 'DRAFT'), 401: productNode(401, 'ARCHIVED') });
  const tiers = normalizeTiers([{ discountType: 'none', items: [{ productId: '201', variantId: '2011', quantity: 1 }] }]);
  const ok = await verifyComboTiers(admin, { productId: '100', tiers, mainPrice: 1599 }, { requireAvailable: true });
  assert.deepEqual(ok.tiers[0].items.map((i) => [i.productId, i.handle]), [['201', 'p-201']]);
  assert.deepEqual(ok.subtotals, [1999]);
  for (const id of ['301', '401']) {
    await assert.rejects(verifyComboTiers(admin, { productId: '100', tiers: normalizeTiers([{ discountType: 'none', items: [{ productId: id, variantId: `${id}1`, quantity: 1 }] }]), mainPrice: 1 }), { code: 'product_inactive' });
  }
  const extra = await verifyExtraProducts(admin, { packType: 'mix_match', productId: '100', extraProducts: [{ productId: '201', variantScope: 'all' }] }, { requireAvailable: true });
  assert.equal(extra.extraProducts[0].productId, '201');
  const coverage = await verifyPackCoverage(admin, '100', { packType: 'same_variant', variantScope: 'all', allowedVariantIds: [] }, { requireAvailable: true });
  assert.equal(coverage.anchorVariant.id, '1001');
});

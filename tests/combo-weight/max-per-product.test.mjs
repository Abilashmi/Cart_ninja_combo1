// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight/max-per-product.test.mjs
// Box templates: "Max of each product" (qs_max_per_product): the most of one
// product a box can hold, all its variants together. The kit disables + / Add
// on its cards and box lines at the limit; the storefront and the builder
// preview refuse the add with qs_max_per_product_text (browser checks in
// quickshop-browser-check.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createComboWeightCore } from '../../app/utils/combo-weight.shared.js';
import { createQuickShopKit } from '../../app/utils/combo-quickshop.shared.js';

const kit = createQuickShopKit(createComboWeightCore());

const TEE = {
  id: 'gid://shopify/Product/1', title: 'Tee', tags: [],
  variants: [
    { id: 'v-m', title: 'M', price: '300.00', available: true },
    { id: 'v-l', title: 'L', price: '300.00', available: true },
  ],
};
const SOCKS = { id: 'gid://shopify/Product/2', title: 'Socks', tags: [], variants: [{ id: 'v-s', title: 'Default Title', price: '100.00', available: true }] };

function model(config, selection, extra = {}) {
  return kit.buildModel({
    config: { layout: 'layout7', tab_count: 1, col_1: 'kids', ...config },
    productsByHandle: { kids: [TEE, SOCKS] },
    handles: ['kids'],
    ui: { chip: 'all', dd: {}, ...(extra.ui || {}) },
    pricing: { tiers: [], enabled: false },
    selection,
    symbol: '₹',
  });
}

test('the limit: 1-99, empty / 0 / nonsense = none', () => {
  assert.equal(kit.maxPerProduct({}), 0, 'not set');
  assert.equal(kit.maxPerProduct({ qs_max_per_product: null }), 0);
  assert.equal(kit.maxPerProduct({ qs_max_per_product: 0 }), 0);
  assert.equal(kit.maxPerProduct({ qs_max_per_product: 'abc' }), 0);
  assert.equal(kit.maxPerProduct({ qs_max_per_product: 2 }), 2);
  assert.equal(kit.maxPerProduct({ qs_max_per_product: '3' }), 3);
  assert.equal(kit.maxPerProduct({ qs_max_per_product: 500 }), 99);
});

test('counts every variant of a product together; only a product that grows is refused', () => {
  const cfg = { qs_max_per_product: 2 };
  const box = { 'v-m': { productId: TEE.id, qty: 1 }, 'v-l': { productId: TEE.id, qty: 1 }, 'v-s': { productId: SOCKS.id, qty: 5 } };
  assert.equal(kit.productQty(box, TEE.id), 2);
  assert.equal(kit.productLimitMessage(cfg, box, { ...box, 'v-m': { productId: TEE.id, qty: 2 } }), 'You can add up to 2 of each product.', 'a third tee in another size');
  assert.equal(kit.productLimitMessage(cfg, box, { ...box, 'v-m': { productId: TEE.id, qty: 0 } }), '', 'taking one out');
  assert.equal(kit.productLimitMessage(cfg, box, { ...box, 'v-s': { productId: SOCKS.id, qty: 4 } }), '', 'socks were already over (limit set later): taking one out is fine');
  assert.equal(kit.productLimitMessage({}, box, { ...box, 'v-m': { productId: TEE.id, qty: 9 } }), '', 'no limit set');
  assert.equal(kit.productLimitMessage({ qs_max_per_product: 2, qs_max_per_product_text: 'Only {{max}} per kid style' }, box, { ...box, 'v-l': { productId: TEE.id, qty: 2 } }), 'Only 2 per kid style');
  assert.equal(kit.productLimitMessage({ qs_max_per_product: 2, qs_max_per_product_text: '' }, box, { ...box, 'v-l': { productId: TEE.id, qty: 2 } }), 'You can add up to 2 of each product.', 'an emptied text falls back');
});

test('cards: + and Add are off once the product is at the limit, in any size', () => {
  const box = { 'v-m': { productId: TEE.id, qty: 2 } };
  const m = model({ qs_max_per_product: 2 }, box);
  const tee = m.cards.find((c) => c.id === TEE.id);
  const socks = m.cards.find((c) => c.id === SOCKS.id);
  assert.equal(tee.full, true);
  assert.equal(socks.full, false);
  const html = kit.render(m);
  const teeCard = html.slice(html.indexOf(`data-product-id="${TEE.id}"`), html.indexOf(`data-product-id="${SOCKS.id}"`));
  assert.match(teeCard, /data-combo-action="qty-inc"[^>]*disabled/, 'tee + is off');
  // Same tee shown in L (not in the box yet): its Add is off too.
  const lCard = kit.buildModel({ config: { layout: 'layout7', tab_count: 1, col_1: 'kids', qs_max_per_product: 2 }, productsByHandle: { kids: [TEE] }, handles: ['kids'], ui: {}, pricing: { tiers: [] }, selection: box, pending: { [TEE.id]: 'v-l' } });
  assert.equal(lCard.cards[0].variantId, 'v-l');
  assert.equal(lCard.cards[0].qty, 0);
  assert.match(kit.render(lCard), /class="bxq-add"[^>]*disabled/, 'the L Add button is off');
  // No limit: nothing is off.
  assert.doesNotMatch(kit.render(model({}, box)), /data-combo-action="qty-inc"[^>]*disabled/);
});

test('normal card layout and the box lines follow the limit too', () => {
  const box = { 'v-m': { productId: TEE.id, qty: 2 }, 'v-s': { productId: SOCKS.id, qty: 1 } };
  const normal = kit.render(model({ qs_max_per_product: 2, qs_card_layout: 'normal' }, box));
  const teeCard = normal.slice(normal.indexOf(`data-product-id="${TEE.id}"`), normal.indexOf(`data-product-id="${SOCKS.id}"`));
  assert.match(teeCard, /aria-label="Add one" disabled/);
  const open = kit.render(model({ qs_max_per_product: 2 }, box, { ui: { sheetOpen: true } }));
  assert.match(open, /data-combo-action="box-inc" data-variant-id="v-m" aria-label="Add one" disabled/, 'tee line + off');
  assert.match(open, /data-combo-action="box-inc" data-variant-id="v-s" aria-label="Add one">/, 'socks line + on');
});

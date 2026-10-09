// Run with: node --test tests/fbt/core.test.mjs
// The FBT v2 core (app/utils/fbt-core.shared.js): settings, which products
// show where, prices, the widget's markup, and the built storefront asset.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeConfig, fromLegacy, plan, addOffers, formatMoney, totals, html, itemFromProduct, chooseVariant, ruleProblem, numericId,
} from '../../app/utils/fbt-core.shared.js';
import { buildFbtAsset, ASSET } from '../../scripts/build-fbt-asset.mjs';

const ref = (id, handle) => ({ id: String(id), handle, title: handle });
const rule = (id, when, show) => ({ id, when, show });

test('settings: defaults, and bad values fall back', () => {
  const c = normalizeConfig({});
  assert.equal(c.style, 'bundle');
  assert.equal(c.maxItems, 3);
  assert.equal(c.placement, 'below_cart');
  assert.deepEqual(c.sources, { orders: true, carts: true, ai: true, shopify: true });
  const bad = normalizeConfig({ style: 'x', maxItems: 99, placement: 'top', theme: { bg: 'red', radius: 99 }, rules: 'no' });
  assert.deepEqual([bad.style, bad.maxItems, bad.placement, bad.theme.bg, bad.theme.radius, bad.rules.length], ['bundle', 6, 'below_cart', '#ffffff', 32, 0]);
});

test('rules: ids and refs are cleaned; a type switch drops the other lists', () => {
  const c = normalizeConfig({ rules: [
    { id: 'a', when: { type: 'collections', collections: [{ id: 'gid://shopify/Collection/5', handle: 'Tees', title: 'Tees' }], products: [ref(1, 'x')] }, show: { type: 'collection', collection: { id: 9, handle: 'shorts' } } },
    { id: 'a', when: { type: 'products', products: [{ id: 'gid://shopify/Product/7', handle: 'cap' }, { id: 7, handle: 'cap' }] }, show: { type: 'products', products: [] } },
  ] });
  assert.equal(c.rules[0].when.collections[0].id, '5');
  assert.equal(c.rules[0].when.collections[0].handle, 'tees');
  assert.deepEqual(c.rules[0].when.products, [], 'products ignored for a collection rule');
  assert.equal(c.rules[1].id, 'ax', 'duplicate id made unique');
  assert.equal(c.rules[1].when.products.length, 1, 'duplicate product dropped');
  assert.equal(ruleProblem(c.rules[1]), 'Pick the products to show.');
  assert.equal(ruleProblem(c.rules[0]), '');
});

test('which products: this product\'s rules, then its collections\', then every page\'s, then automatic pairs, then Shopify', () => {
  const c = normalizeConfig({
    rules: [
      rule('all', { type: 'all' }, { type: 'products', products: [ref(90, 'gift-card')] }),
      rule('col', { type: 'collections', collections: [{ id: '5', handle: 'tees' }] }, { type: 'collection', collection: { id: '9', handle: 'shorts' } }),
      rule('prod', { type: 'products', products: [ref(1, 'tee')] }, { type: 'products', products: [ref(2, 'cap')] }),
      rule('other', { type: 'products', products: [ref(3, 'mug')] }, { type: 'products', products: [ref(4, 'spoon')] }),
      { ...rule('off', { type: 'all' }, { type: 'products', products: [ref(5, 'x')] }), enabled: false },
    ],
    pairs: { 1: [{ id: '6', handle: 'socks', source: 'orders' }, { id: '7', handle: 'belt', source: 'ai' }] },
  });
  const steps = plan(c, { id: '1', collectionIds: ['5'], collectionHandles: [] });
  assert.deepEqual(steps.map((s) => s.ruleId || s.kind), ['prod', 'col', 'all', 'products', 'shopify']);
  assert.equal(steps[1].ref.handle, 'shorts');
  assert.deepEqual(steps[3].items.map((i) => i.handle), ['socks', 'belt']);
  const byHandle = plan(c, { id: '1', collectionIds: [], collectionHandles: ['tees'] });
  assert.ok(byHandle.some((s) => s.ruleId === 'col'), 'collection matched by handle too');
  const noAi = plan({ ...c, sources: { ...c.sources, ai: false, shopify: false } }, { id: '1' });
  assert.deepEqual(noAi.map((s) => s.ruleId || s.kind), ['prod', 'all', 'products']);
  assert.deepEqual(noAi[2].items.map((i) => i.handle), ['socks'], 'a source turned off is left out');
});

test('offers: no repeats and never the product being viewed', () => {
  const picked = addOffers([], [ref(1, 'tee'), ref(2, 'cap'), ref(2, 'cap'), { handle: 'cap' }, ref(3, 'mug')], '1', 5);
  assert.deepEqual(picked.map((p) => p.handle), ['cap', 'mug']);
  assert.equal(addOffers([], [ref(2, 'a'), ref(3, 'b'), ref(4, 'c')], '1', 2).length, 2);
});

test('old settings keep working: rules become v2 rules, old "AI:" rules become pairs', () => {
  const c = fromLegacy([
    { name: 'Rule 1', displayScope: 'per_product', triggerProducts: [{ id: 'gid://shopify/Product/1', handle: 'tee' }], fbtProducts: [{ id: 2, handle: 'cap' }] },
    { name: 'Everywhere', displayScope: 'all', triggerProducts: [], fbtProducts: [{ id: 3, handle: 'mug' }] },
    { name: 'AI: Tee', aiGenerated: true, triggerProducts: [{ id: 1, handle: 'tee' }], fbtProducts: [{ id: 8, handle: 'shirt' }] },
  ], { interactionType: 'classic', bgColor: '#000000', widgetPlacement: 'above_cart', showAddAllButton: false });
  assert.deepEqual(c.rules.map((r) => [r.when.type, r.show.products.map((p) => p.handle).join()]), [['products', 'cap'], ['all', 'mug']]);
  assert.deepEqual(c.pairs['1'].map((p) => [p.handle, p.source]), [['shirt', 'ai']]);
  assert.deepEqual([c.style, c.theme.bg, c.placement, c.cardsAddAll, c.sources.shopify], ['cards', '#000000', 'above_cart', false, false]);
});

test('money: Shopify money formats', () => {
  assert.equal(formatMoney(59900, 'Rs. {{amount}}'), 'Rs. 599.00');
  assert.equal(formatMoney(129900, '₹{{amount_no_decimals}}'), '₹1,299');
  assert.equal(formatMoney(123456, '{{amount_with_comma_separator}} €'), '1.234,56 €');
  assert.equal(formatMoney(5000, '<span class=money>${{amount}}</span>'), '$50.00', 'HTML in the format is dropped');
});

const productJs = (id, title, variants) => ({ id, handle: title.toLowerCase(), title, featured_image: '//cdn.shopify.com/a.jpg', variants });

test('items: first available variant, or the one asked for; sold out = nothing', () => {
  const p = productJs(1, 'Tee', [
    { id: 11, title: 'S', price: 59900, available: false },
    { id: 12, title: 'M', price: 59900, compare_at_price: 79900, available: true },
    { id: 13, title: 'L', price: 64900, available: true },
  ]);
  const it = itemFromProduct(p, 'k', true);
  assert.deepEqual([it.variantId, it.price, it.compareAt, it.variants.length], ['12', 59900, 79900, 3]);
  assert.equal(itemFromProduct(p, 'k', true, 13).variantId, '13');
  assert.equal(chooseVariant(it, '11'), false, 'sold-out variant not chosen');
  assert.equal(chooseVariant(it, '13'), true);
  assert.equal(it.price, 64900);
  assert.equal(itemFromProduct(productJs(2, 'X', [{ id: 21, price: 1, available: false }]), 'x'), null);
  assert.deepEqual(totals([{ checked: true, price: 100, compareAt: 150 }, { checked: false, price: 50 }, { checked: true, price: 70 }]), { count: 2, total: 170, compare: 220 });
});

test('markup: bundle (pictures joined by +, ticks, total, one button) and cards (one Add per product)', () => {
  const money = (c) => formatMoney(c, 'Rs. {{amount}}');
  const cur = itemFromProduct(productJs(1, 'Tee', [{ id: 11, title: 'Default Title', price: 59900, available: true }]), 'current', true);
  const a = itemFromProduct(productJs(2, 'Cap', [{ id: 21, title: 'Default', price: 19900, available: true }]), 'p2', true);
  const b = itemFromProduct(productJs(3, 'Mug <b>', [{ id: 31, title: 'Default', price: 9900, available: true }]), 'p3', false);
  const config = normalizeConfig({ style: 'bundle', title: 'Goes well with' });
  const out = html({ config, current: cur, items: [a, b], money });
  assert.match(out, /class="bxf bxf--bundle"/);
  assert.equal((out.match(/class="bxf-plus"/g) || []).length, 2);
  assert.match(out, /This item:<\/span> Tee/);
  assert.match(out, /Total price: <b>Rs\. 798\.00<\/b>/, 'only ticked items count');
  assert.match(out, /Add 2 to cart/);
  assert.match(out, /Mug &lt;b&gt;/, 'titles are escaped');
  assert.match(out, /--bxf-btn:#111827/);
  const cards = html({ config: normalizeConfig({ style: 'cards' }), current: cur, items: [a, b], money });
  assert.equal((cards.match(/data-fbt-add="/g) || []).length, 2);
  assert.match(cards, /Add all 3 to cart/);
  assert.doesNotMatch(cards, /data-fbt-toggle/);
});

test('ids: numericId takes gids, numbers and strings', () => {
  assert.deepEqual([numericId('gid://shopify/Product/12'), numericId(12), numericId(''), numericId(null)], ['12', '12', '', '']);
});

test('the storefront asset is built from the current core + runtime, ASCII only', () => {
  assert.equal(fs.readFileSync(ASSET, 'utf8'), buildFbtAsset(), 'run: npm run build:fbt');
  assert.doesNotThrow(() => new Function(fs.readFileSync(ASSET, 'utf8')));
});

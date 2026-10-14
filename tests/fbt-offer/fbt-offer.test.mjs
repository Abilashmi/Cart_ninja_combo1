// Run with: node --import ./tests/packs/register.mjs --test tests/fbt-offer/*.test.mjs
// FBT "buy all together" offer: shared rules (app/utils/fbt-offer.shared.js)
// and the checkout Function's logic (extensions/brix-fbt-discount). Logic
// only: it does NOT prove Shopify applies the discount — that needs the
// Function deployed and a real checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFbtOffer, sanitizeRuleOffer, effectiveOffer, buildFbtOfferConfig, fbtOfferText, withConditionOffers,
  FBT_OFFER_CONFIG_MAX_BYTES,
} from '../../app/utils/fbt-offer.shared.js';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/brix-fbt-discount/src/cart_lines_discounts_generate_run.js';

const G = (n) => ({ id: `gid://shopify/Product/${n}` });
const rule = (id, t, o, extra = {}) => ({ id, displayScope: t.length ? 'per_product' : 'all', triggerProducts: t.map(G), fbtProducts: o.map(G), ...extra });
const ON = sanitizeFbtOffer({ enabled: true, type: 'percentage', value: 10 });

test('widget offer: defaults off, values cleaned, percent capped at 90', () => {
  assert.deepEqual(sanitizeFbtOffer({}), { enabled: false, type: 'percentage', value: 10, text: 'Buy all {count} together and save {discount}' });
  assert.equal(sanitizeFbtOffer({ enabled: 1, type: 'percentage', value: 150 }).value, 90);
  assert.equal(sanitizeFbtOffer({ enabled: '0' }).enabled, false);
  assert.equal(sanitizeFbtOffer({ type: 'bogus', value: -5 }).type, 'percentage');
  assert.equal(sanitizeFbtOffer({ text: '<b>Hi</b>' }).text, 'bHi/b');
});

test('rule offer: own value, none, or the widget\'s', () => {
  assert.deepEqual(sanitizeRuleOffer('percentage', '15'), { mode: 'percentage', value: 15 });
  assert.deepEqual(sanitizeRuleOffer('fixed_amount', 0), { mode: 'widget', value: 0 }, 'an own offer of 0 falls back to the widget');
  assert.equal(effectiveOffer({ offerMode: 'none' }, ON), null);
  assert.deepEqual(effectiveOffer({ offerMode: 'widget' }, ON), { type: 'percentage', value: 10 });
  assert.deepEqual(effectiveOffer({}, ON), { type: 'percentage', value: 10 }, 'rules saved before the offer follow the widget');
  assert.deepEqual(effectiveOffer({ offerMode: 'fixed_amount', offerValue: 100 }, { ...ON, enabled: false }), { type: 'fixed_amount', value: 100 }, 'own offer works with the widget offer off');
  assert.equal(effectiveOffer({ offerMode: 'widget' }, { ...ON, enabled: false }), null);
});

test('config: one set per rule with an offer; triggers never repeated as offers; bad rules skipped', () => {
  const { config, included, skipped } = buildFbtOfferConfig(ON, [
    rule('1', [10], [20, 30]),
    rule('2', [10], [10]),
    rule('3', [], [40]),
    rule('4', [11], [21], { offerMode: 'none' }),
    rule('5', [12], [22], { offerMode: 'fixed_amount', offerValue: 150 }),
  ], 'INR');
  assert.equal(config.currency, 'INR');
  assert.deepEqual(config.sets, [
    { id: '1', t: ['10'], o: ['20', '30'], k: 'p', v: 10 },
    { id: '3', t: [], o: ['40'], k: 'p', v: 10 },
    { id: '5', t: ['12'], o: ['22'], k: 'f', v: 150 },
  ]);
  assert.deepEqual(included, ['1', '3', '5']);
  assert.deepEqual(skipped, [{ id: '2', reason: 'no_products' }]);
});

test('config stays under the size Shopify passes to the Function', () => {
  const many = Array.from({ length: 400 }, (_, i) => rule(String(i), [1000 + i], [2000 + i, 3000 + i, 4000 + i]));
  const { config, skipped } = buildFbtOfferConfig(ON, many, 'INR');
  assert.ok(JSON.stringify(config).length <= FBT_OFFER_CONFIG_MAX_BYTES);
  assert.ok(skipped.length > 0 && skipped.every((s) => s.reason === 'too_big'));
});

test('text: {count} and {discount} filled in', () => {
  assert.equal(fbtOfferText('Buy all {count} together and save {discount}', { count: 3, offer: { type: 'percentage', value: 10 } }), 'Buy all 3 together and save 10%');
  assert.equal(fbtOfferText('Get {{discount}} off all {{count}}', { count: 2, offer: { type: 'fixed_amount', value: 99.5 }, symbol: '₹' }), 'Get ₹99.50 off all 2');
});

test('storefront condition: offer only on live rules, removed everywhere else', () => {
  const rules = new Map([['1', rule('1', [10], [20])], ['2', rule('2', [11], [21], { offerMode: 'none' })], ['3', rule('3', [12], [22])]]);
  const condition = [{ id: '1', fbtProducts: [] }, { id: '2', fbtProducts: [] }, { id: '3', fbtProducts: [], offer: { type: 'percentage', value: 50 } }];
  const out = withConditionOffers(condition, rules, ON, ['1']);
  assert.deepEqual(out[0].offer, { type: 'percentage', value: 10, text: ON.text });
  assert.equal(out[1].offer, undefined);
  assert.equal(out[2].offer, undefined, 'a rule that is not live loses an old offer');
});

// ── Function ──
const line = (id, product, amount, { qty = 1, reward = null, pack = null, combo = null, currency = 'INR' } = {}) => ({
  id, quantity: qty, reward: reward ? { value: reward } : null, pack: pack ? { value: pack } : null, combo: combo ? { value: combo } : null,
  cost: { subtotalAmount: { amount: String(amount), currencyCode: currency } },
  merchandise: { __typename: 'ProductVariant', id: `gid://shopify/ProductVariant/${product}0`, product: { id: `gid://shopify/Product/${product}` } },
});
const input = (lines, sets, currency = 'INR', classes = ['PRODUCT']) => ({ cart: { lines }, discount: { discountClasses: classes }, shop: { metafield: sets ? { jsonValue: { version: 1, currency, sets } } : null } });
const cands = (out) => out.operations[0]?.productDiscountsAdd.candidates ?? [];
const SET = { id: '1', t: ['10'], o: ['20', '30'], k: 'p', v: 10 };

test('function: viewed product + every recommended one → 10% off one unit of each', () => {
  const out = run(input([line('a', 10, 1000), line('b', 20, 300), line('c', 30, 200)], [SET]));
  const c = cands(out);
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].targets.map((t) => t.cartLine), [{ id: 'b', quantity: 1 }, { id: 'c', quantity: 1 }, { id: 'a', quantity: 1 }]);
  assert.deepEqual(c[0].value, { percentage: { value: '10' } });
});

test('function: nothing when one recommended product or the viewed product is missing', () => {
  assert.deepEqual(run(input([line('a', 10, 1000), line('b', 20, 300)], [SET])), { operations: [] });
  assert.deepEqual(run(input([line('b', 20, 300), line('c', 30, 200)], [SET])), { operations: [] });
});

test('function: two of a product still discounts one unit', () => {
  const c = cands(run(input([line('a', 10, 2000, { qty: 2 }), line('b', 20, 300), line('c', 30, 200)], [SET])));
  assert.ok(c[0].targets.every((t) => t.cartLine.quantity === 1));
});

test('function: free gifts, Packs and combo box lines never count or get the discount', () => {
  for (const mark of [{ reward: 'true' }, { pack: 'p1' }, { combo: '7' }]) {
    const out = run(input([line('a', 10, 1000), line('b', 20, 300, mark), line('c', 30, 200)], [SET]));
    assert.deepEqual(out, { operations: [] }, JSON.stringify(mark));
  }
});

test('function: fixed amount split by price, never more than the set costs; other currency = no fixed offer', () => {
  const FIX = { ...SET, k: 'f', v: 150 };
  const c = cands(run(input([line('a', 10, 1000), line('b', 20, 300), line('c', 30, 200)], [FIX])));
  const amounts = c.map((x) => Number(x.value.fixedAmount.amount));
  assert.equal(Math.round(amounts.reduce((s, a) => s + a, 0) * 100), 15000);
  assert.ok(c.every((x) => x.value.fixedAmount.appliesToEachItem === false && x.targets[0].cartLine.quantity === 1));
  const huge = cands(run(input([line('a', 10, 10), line('b', 20, 5), line('c', 30, 5)], [{ ...FIX, v: 1000 }])));
  assert.equal(Math.round(huge.reduce((s, x) => s + Number(x.value.fixedAmount.amount), 0) * 100), 2000, 'capped at the set price');
  assert.deepEqual(run(input([line('a', 10, 1000, { currency: 'USD' }), line('b', 20, 300, { currency: 'USD' }), line('c', 30, 200, { currency: 'USD' })], [FIX])), { operations: [] });
});

test('function: rule on every page needs another product; overlapping sets — the bigger saving wins, each line once', () => {
  const ALL = { id: '9', t: [], o: ['20'], k: 'p', v: 50 };
  assert.deepEqual(run(input([line('b', 20, 300)], [ALL])), { operations: [] }, 'just the recommended product alone');
  const c = cands(run(input([line('a', 10, 1000), line('b', 20, 300), line('c', 30, 200)], [SET, ALL])));
  // SET saves 150 (10% of 1500); ALL saves 150 (50% of 300) — equal, first stays; b is used once.
  const targeted = c.flatMap((x) => x.targets.map((t) => t.cartLine.id));
  assert.equal(new Set(targeted).size, targeted.length, 'no line discounted twice');
});

test('function: no config, wrong class or tampered config = nothing', () => {
  const lines = [line('a', 10, 1000), line('b', 20, 300), line('c', 30, 200)];
  assert.deepEqual(run(input(lines, null)), { operations: [] });
  assert.deepEqual(run(input(lines, [SET], 'INR', ['ORDER'])), { operations: [] });
  assert.deepEqual(run(input(lines, [{ ...SET, v: 500 }])), { operations: [] }, 'over 100% is ignored');
  assert.deepEqual(run(input(lines, [{ ...SET, k: 'x' }])), { operations: [] });
});

// ── Start selected (widget setting) ──
import { fbtStartsSelected, pickFbtLayout } from '../../app/utils/fbt-style.shared.js';
test('start selected: style defaults unless the merchant chose; Bundle always', () => {
  assert.equal(fbtStartsSelected('classic', null), true);
  assert.equal(fbtStartsSelected('quick-add', null), false);
  assert.equal(fbtStartsSelected('quickAdd', true), true);
  assert.equal(fbtStartsSelected('classic', false), false);
  assert.equal(fbtStartsSelected('bundle', false), true);
  assert.equal(pickFbtLayout({}).startSelected, null);
  assert.equal(pickFbtLayout({ startSelected: 'yes' }).startSelected, null);
  assert.equal(pickFbtLayout({ startSelected: false }).startSelected, false);
});

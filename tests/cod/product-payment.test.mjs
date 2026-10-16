// Product page payment options (Pay Online / Cash on Delivery) and the BRIX
// prepaid discount: settings, pricing, the Discount Function's logic and the
// Shopify sync. Run with: node --import ./tests/packs/register.mjs --test tests/cod
//
// The Function test is logic-only: it does NOT prove Shopify applies the
// discount at checkout — that needs the app deployed and a real test order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PRODUCT_PAYMENT, sanitizeProductPayment, parsePrepaidPercent, parseMinSubtotal, productPaymentPricing,
  fillPaymentText, onlineButtonLabel, visiblePaymentMethods, initialPaymentMethod, prepaidDiscountLive, PAY_TEXT_LIMITS, excludedCollectionIds,
} from '../../app/utils/product-payment.shared.js';
import { sanitizeCodSettings, DEFAULT_COD_SETTINGS } from '../../app/utils/cod.shared.js';
import { cartLinesDiscountsGenerateRun as run } from '../../extensions/brix-prepaid-discount/src/cart_lines_discounts_generate_run.js';
import {
  buildPrepaidConfig, syncPrepaidDiscount, prepaidRuntime, PREPAID_DISCOUNT_TITLE, PREPAID_FUNCTION_HANDLE,
} from '../../app/services/prepaid-discount-shopify.server.js';
import { paymentErrors, paymentForm, paymentSettings, toForm, toSettings } from '../../app/components/cod/codSettingsForm.js';

/* ── settings ──────────────────────────────────────────────────────────────── */

test('defaults: off for existing merchants, both methods shown when turned on, prepaid off, 10%', () => {
  const s = sanitizeCodSettings({});
  assert.equal(s.productPayment.enabled, false);
  assert.equal(s.productPayment.online.enabled, true);
  assert.equal(s.productPayment.cod.enabled, true);
  assert.equal(s.productPayment.prepaid.enabled, false);
  assert.equal(s.productPayment.prepaid.percent, 10);
  assert.equal(s.productPayment.prepaid.minSubtotal, 0);
  assert.equal(s.productPayment.layout.placement, 'before_purchase_buttons');
  assert.equal(s.productPayment.appearance.onlineColor, '#008060');
  assert.deepEqual(sanitizeProductPayment(undefined), JSON.parse(JSON.stringify(DEFAULT_PRODUCT_PAYMENT)));
  // Existing COD settings (stored before this feature) keep every value.
  const old = sanitizeCodSettings({ enabled: true, codFee: 49, buttons: { productText: 'Order COD' } });
  assert.equal(old.enabled, true);
  assert.equal(old.codFee, 49);
  assert.equal(old.buttons.productText, 'Order COD');
  assert.equal(old.productPayment.enabled, false);
});

test('percent: 1–50 only, never 0, negative or above 50', () => {
  assert.equal(parsePrepaidPercent(10), 10);
  assert.equal(parsePrepaidPercent('12.5'), 12.5);
  assert.equal(parsePrepaidPercent(1), 1);
  assert.equal(parsePrepaidPercent(50), 50);
  for (const bad of [0, -5, 50.01, 51, 100, '', null, undefined, 'abc', NaN, true]) assert.equal(parsePrepaidPercent(bad), null, String(bad));
  const base = sanitizeProductPayment({ prepaid: { percent: 20 } });
  assert.equal(sanitizeProductPayment({ prepaid: { percent: 0 } }, base).prepaid.percent, 20, 'invalid patch keeps the saved value');
  assert.equal(sanitizeProductPayment({ prepaid: { percent: 75 } }, base).prepaid.percent, 20);
  assert.equal(sanitizeProductPayment({ prepaid: { percent: '15' } }, base).prepaid.percent, 15);
});

test('minimum amount: non-negative money, empty = none', () => {
  assert.equal(parseMinSubtotal(''), 0);
  assert.equal(parseMinSubtotal('999'), 999);
  assert.equal(parseMinSubtotal(999.999), 1000);
  assert.equal(parseMinSubtotal(-1), null);
  assert.equal(parseMinSubtotal('x'), null);
  assert.equal(sanitizeProductPayment({ prepaid: { minSubtotal: -50 } }).prepaid.minSubtotal, 0);
  assert.equal(sanitizeProductPayment({ prepaid: { minSubtotal: 999 } }).prepaid.minSubtotal, 999);
});

test('text: trimmed, control characters removed, length-limited, empty falls back', () => {
  const pp = sanitizeProductPayment({
    online: { label: `  Pay\u0000 now ${'x'.repeat(100)}`, buttonText: '   ' },
    cod: { description: 'Pay when it arrives\n\ttoday' },
    prepaid: { title: 'P'.repeat(200), offerTitle: '' },
    heading: '',
  });
  assert.ok(pp.online.label.startsWith('Pay now x'));
  assert.equal(pp.online.label.length, PAY_TEXT_LIMITS.label);
  assert.equal(pp.online.buttonText, 'Buy it now', 'empty → default');
  assert.equal(pp.cod.description, 'Pay when it arrives today');
  assert.equal(pp.prepaid.title.length, PAY_TEXT_LIMITS.title);
  assert.equal(pp.prepaid.offerTitle, DEFAULT_PRODUCT_PAYMENT.prepaid.offerTitle);
  assert.equal(pp.heading, '', 'heading can be removed');
});

test('enums, colours, radius and booleans are validated; unknown keys dropped', () => {
  const pp = sanitizeProductPayment({
    defaultMethod: 'bitcoin', relabelBuyNow: 'false', evil: 1,
    layout: { placement: 'footer', cardLayout: 'vertical', cardStyle: 'filled', selectedStyle: 'background', radius: 99, spacing: 'huge', showRadio: 'nope' },
    appearance: { onlineColor: 'red', codColor: '#123', badgeText: 'url(x)' },
  });
  assert.equal(pp.defaultMethod, 'online');
  assert.equal(pp.relabelBuyNow, false);
  assert.equal('evil' in pp, false);
  assert.equal(pp.layout.placement, 'before_purchase_buttons');
  assert.equal(pp.layout.cardLayout, 'vertical');
  assert.equal(pp.layout.cardStyle, 'filled');
  assert.equal(pp.layout.selectedStyle, 'background');
  assert.equal(pp.layout.radius, 24);
  assert.equal(pp.layout.spacing, 'medium');
  assert.equal(pp.layout.showRadio, true);
  assert.equal(pp.appearance.onlineColor, '#008060');
  assert.equal(pp.appearance.codColor, '#123');
  assert.equal(pp.appearance.badgeText, '#ffffff');
  assert.equal(sanitizeProductPayment({ layout: { radius: -4 } }).layout.radius, 0);
});

test('admin form: round-trips, and flags bad values before saving', () => {
  const settings = sanitizeCodSettings({ productPayment: { enabled: true, prepaid: { enabled: true, percent: 12, minSubtotal: 999 } } });
  const form = toForm(settings);
  assert.equal(form.pp.prepaid.percent, '12');
  assert.equal(form.pp.prepaid.minSubtotal, '999');
  assert.deepEqual(sanitizeCodSettings(toSettings(form)).productPayment, settings.productPayment);
  assert.deepEqual(paymentErrors(form.pp), {});
  const bad = paymentForm(settings.productPayment);
  bad.prepaid.percent = '0';
  bad.prepaid.minSubtotal = '-1';
  bad.appearance.codColor = 'blue';
  bad.online.label = ' ';
  const e = paymentErrors(bad);
  assert.ok(e.ppPercent && e.ppMinSubtotal && e.pp_codColor && e.ppOnlineLabel, JSON.stringify(e));
  bad.prepaid.enabled = false;
  assert.equal(paymentErrors(bad).ppPercent, undefined, 'percent only required while prepaid is on');
  assert.equal(paymentSettings({ ...form.pp, prepaid: { ...form.pp.prepaid, percent: '15' } }).prepaid.percent, 15);
});

/* ── which cards show ─────────────────────────────────────────────────────── */

test('cards: both, online only, COD only, both off, selector off, COD unavailable', () => {
  const pp = (patch) => sanitizeProductPayment({ enabled: true, ...patch });
  assert.deepEqual(visiblePaymentMethods(pp({}), { codAvailable: true }), { online: true, cod: true });
  assert.deepEqual(visiblePaymentMethods(pp({ cod: { enabled: false } }), { codAvailable: true }), { online: true, cod: false });
  assert.deepEqual(visiblePaymentMethods(pp({ online: { enabled: false } }), { codAvailable: true }), { online: false, cod: true });
  assert.deepEqual(visiblePaymentMethods(pp({ online: { enabled: false }, cod: { enabled: false } }), { codAvailable: true }), { online: false, cod: false });
  assert.deepEqual(visiblePaymentMethods(sanitizeProductPayment({}), { codAvailable: true }), { online: false, cod: false }, 'feature off');
  assert.deepEqual(visiblePaymentMethods(pp({}), { codAvailable: false }), { online: true, cod: false }, 'COD off/unavailable → no COD card');
  assert.equal(initialPaymentMethod(pp({}), { online: true, cod: true }), 'online');
  assert.equal(initialPaymentMethod(pp({ defaultMethod: 'cod' }), { online: true, cod: true }), 'cod');
  assert.equal(initialPaymentMethod(pp({ defaultMethod: 'cod' }), { online: true, cod: false }), 'online');
  assert.equal(initialPaymentMethod(pp({}), { online: false, cod: true }), 'cod');
  assert.equal(initialPaymentMethod(pp({}), { online: false, cod: false }), null);
});

/* ── pricing (what the product page shows; Shopify decides the real price) ─ */

const prepaid10 = { percent: 10, minSubtotal: 0, showBadge: true };

test('pricing: ₹1,100 with 10% prepaid → online ₹990, COD ₹1,100', () => {
  const pr = productPaymentPricing({ unitPrice: 1100, quantity: 1, prepaid: prepaid10 });
  assert.deepEqual([pr.subtotal, pr.savings, pr.online, pr.cod, pr.qualifies], [1100, 110, 990, 1100, true]);
});

test('pricing: quantity 2 → online ₹1,980, COD ₹2,200', () => {
  const pr = productPaymentPricing({ unitPrice: 1100, quantity: 2, prepaid: prepaid10 });
  assert.deepEqual([pr.subtotal, pr.savings, pr.online, pr.cod], [2200, 220, 1980, 2200]);
});

test('pricing: variant ₹1,500 → online ₹1,350, COD ₹1,500 (recalculated, nothing stale)', () => {
  const a = productPaymentPricing({ unitPrice: 1100, prepaid: prepaid10 });
  const b = productPaymentPricing({ unitPrice: 1500, prepaid: prepaid10 });
  assert.deepEqual([a.online, a.cod], [990, 1100]);
  assert.deepEqual([b.online, b.cod], [1350, 1500]);
});

test('pricing: COD fee is added to COD only, never discounted', () => {
  const pr = productPaymentPricing({ unitPrice: 1100, prepaid: prepaid10, codFee: 50 });
  assert.equal(pr.codTotal, 1150);
  assert.equal(pr.cod, 1100);
  assert.equal(pr.online, 990);
});

test('pricing: minimum not met → no saving promised; met → saving', () => {
  const p = { ...prepaid10, minSubtotal: 999 };
  const below = productPaymentPricing({ unitPrice: 799, prepaid: p });
  assert.deepEqual([below.qualifies, below.minMissing, below.savings, below.online], [false, true, 0, 799]);
  assert.equal(onlineButtonLabel('Buy it now', below, p), 'Buy it now', 'no false discount on the button');
  const met = productPaymentPricing({ unitPrice: 799, quantity: 2, prepaid: p });
  assert.deepEqual([met.qualifies, met.savings, met.online], [true, 159.8, 1438.2]);
  assert.equal(productPaymentPricing({ unitPrice: 999, prepaid: p }).qualifies, true, 'exactly the minimum counts');
  const otherCurrency = productPaymentPricing({ unitPrice: 2000, prepaid: p, currencyMatches: false });
  assert.equal(otherCurrency.qualifies, false, 'minimum in another currency → never promised');
});

test('pricing: prepaid off / not verified → no saving anywhere', () => {
  const pr = productPaymentPricing({ unitPrice: 1100, prepaid: null });
  assert.deepEqual([pr.qualifies, pr.savings, pr.online, pr.percent], [false, 0, 1100, null]);
  assert.equal(onlineButtonLabel('Buy it now', pr, null), 'Buy it now');
});

test('button text: "· Save 10%" once, only with the badge on, never stacked', () => {
  const pr = productPaymentPricing({ unitPrice: 1100, prepaid: prepaid10 });
  assert.equal(onlineButtonLabel('Buy it now', pr, prepaid10), 'Buy it now · Save 10%');
  assert.equal(onlineButtonLabel('Buy now', pr, prepaid10), 'Buy now · Save 10%');
  assert.equal(onlineButtonLabel('Buy now', pr, { ...prepaid10, showBadge: false }), 'Buy now');
  const label = onlineButtonLabel('Buy it now', pr, prepaid10);
  assert.equal(onlineButtonLabel('Buy it now', pr, prepaid10), label, 'same input, same text (idempotent)');
  assert.equal((label.match(/Save 10%/g) || []).length, 1);
});

test('merchant text: {percent} {amount} {min} {price} filled in', () => {
  const vars = { percent: 10, amount: '₹110', min: '₹999', price: '₹990' };
  assert.equal(fillPaymentText('{percent}% off when you pay online', vars), '10% off when you pay online');
  assert.equal(fillPaymentText('Pay online and save {amount}', vars), 'Pay online and save ₹110');
  assert.equal(fillPaymentText('Get {percent}% off on orders above {min}', vars), 'Get 10% off on orders above ₹999');
  assert.equal(fillPaymentText('Only {price}', vars), 'Only ₹990');
  assert.equal(fillPaymentText('Save {amount}', { percent: 10 }), 'Save 10%', 'no amount → the percentage');
});

/* ── the Discount Function (logic only) ───────────────────────────────────── */

const cfg = (patch = {}) => ({ version: 1, enabled: true, percent: 10, minSubtotal: 0, currency: 'INR', title: 'Prepaid discount', ...patch });
const line = (id, amount, { cod = null, reward = null, currency = 'INR', excluded = null, combo = null } = {}) => ({
  id, cod: cod == null ? null : { value: cod }, reward: reward == null ? null : { value: reward }, combo: combo == null ? null : { value: combo },
  cost: { subtotalAmount: { amount: String(amount), currencyCode: currency } },
  // Shopify answers inCollections for the excluded collections ($collectionIds).
  merchandise: { __typename: 'ProductVariant', product: { inCollections: excluded == null ? [] : [{ isMember: excluded }] } },
});
const fnInput = (lines, config, { cartCod = null, classes = ['ORDER'], codes = [] } = {}) => ({
  enteredDiscountCodes: codes.map((code) => ({ code, rejectable: true })),
  cart: { cod: cartCod == null ? null : { value: cartCod }, lines },
  discount: { discountClasses: classes },
  shop: { metafield: config ? { jsonValue: config } : null },
});
const order = (out) => out.operations[0]?.orderDiscountsAdd;

test('Function: online checkout gets the configured % off the order subtotal', () => {
  const out = run(fnInput([line('L1', 1100)], cfg()));
  const op = order(out);
  assert.equal(op.selectionStrategy, 'FIRST');
  assert.deepEqual(op.candidates[0].value, { percentage: { value: '10' } });
  assert.deepEqual(op.candidates[0].targets, [{ orderSubtotal: { excludedCartLineIds: [] } }]);
  assert.equal(op.candidates[0].message, 'Prepaid discount');
});

test('Function: a cart marked _brixCod (COD order) gets nothing — order or any line', () => {
  assert.deepEqual(run(fnInput([line('L1', 1100)], cfg(), { cartCod: 'true' })), { operations: [] });
  assert.deepEqual(run(fnInput([line('L1', 1100), line('L2', 500, { cod: 'true' })], cfg())), { operations: [] });
  assert.deepEqual(run(fnInput([line('L1', 1100, { cod: 'yes' })], cfg())), { operations: [] }, 'any marker value counts');
  assert.equal(order(run(fnInput([line('L1', 1100, { cod: '' })], cfg()))).candidates.length, 1, 'an empty attribute is no marker');
});

test('Function: minimum subtotal, in the shop currency only', () => {
  assert.deepEqual(run(fnInput([line('L1', 799)], cfg({ minSubtotal: 999 }))), { operations: [] });
  assert.equal(order(run(fnInput([line('L1', 799), line('L2', 300)], cfg({ minSubtotal: 999 })))).candidates.length, 1);
  assert.deepEqual(run(fnInput([line('L1', 5000, { currency: 'USD' })], cfg({ minSubtotal: 999 }))), { operations: [] }, 'no guessing across currencies');
  assert.equal(order(run(fnInput([line('L1', 50, { currency: 'USD' })], cfg()))).candidates.length, 1, 'no minimum → any currency');
});

test('Function: free gifts are left out of the subtotal and the minimum', () => {
  const out = run(fnInput([line('L1', 900), line('G1', 200, { reward: 'true' })], cfg({ minSubtotal: 999 })));
  assert.deepEqual(out, { operations: [] }, 'the gift does not help reach the minimum');
  const ok = order(run(fnInput([line('L1', 1100), line('G1', 200, { reward: 'true' })], cfg())));
  assert.deepEqual(ok.candidates[0].targets[0].orderSubtotal.excludedCartLineIds, ['G1']);
});

test('Function: products in an excluded collection are left out of the discount and the minimum', () => {
  const op = order(run(fnInput([line('L1', 1100), line('X1', 500, { excluded: true }), line('L2', 300, { excluded: false })], cfg())));
  assert.deepEqual(op.candidates[0].targets[0].orderSubtotal.excludedCartLineIds, ['X1']);
  assert.deepEqual(run(fnInput([line('X1', 500, { excluded: true })], cfg())), { operations: [] }, 'only excluded products → nothing');
  assert.deepEqual(run(fnInput([line('L1', 800), line('X1', 500, { excluded: true })], cfg({ minSubtotal: 999 }))), { operations: [] }, 'excluded products do not help reach the minimum');
  const both = order(run(fnInput([line('L1', 1100), line('G1', 200, { reward: 'true', excluded: true }), line('X1', 50, { excluded: true })], cfg())));
  assert.deepEqual(both.candidates[0].targets[0].orderSubtotal.excludedCartLineIds, ['G1', 'X1'], 'a gift in an excluded collection is listed once');
  const old = { ...line('L1', 1100) };
  delete old.merchandise;
  assert.equal(order(run(fnInput([old], cfg()))).candidates.length, 1, 'no collection data (no exclusions) → as before');
});

test('settings: excluded collections are cleaned (collection ids only, unique, at most 50)', () => {
  const pp = sanitizeProductPayment({ prepaid: { excludedCollections: [{ id: 'gid://shopify/Collection/12', title: 'Toys' }, '34', { id: 'gid://shopify/Product/1' }, { id: 'gid://shopify/Collection/12' }] } });
  assert.deepEqual(pp.prepaid.excludedCollections, [{ id: 'gid://shopify/Collection/12', title: 'Toys' }, { id: 'gid://shopify/Collection/34', title: '' }]);
  assert.deepEqual(excludedCollectionIds(pp.prepaid), ['12', '34']);
  assert.deepEqual(sanitizeProductPayment({}).prepaid.excludedCollections, [], 'none by default');
  assert.deepEqual(sanitizeProductPayment({ prepaid: { percent: 12 } }, pp).prepaid.excludedCollections, pp.prepaid.excludedCollections, 'kept when not in the patch');
  const many = Array.from({ length: 60 }, (_, i) => `gid://shopify/Collection/${i + 1}`);
  assert.equal(sanitizeProductPayment({ prepaid: { excludedCollections: many } }).prepaid.excludedCollections.length, 50);
});

test('Function: off, missing, or tampered config → nothing; never a shopper-chosen percentage', () => {
  const lines = [line('L1', 1100)];
  assert.deepEqual(run(fnInput(lines, null)), { operations: [] });
  assert.deepEqual(run(fnInput(lines, cfg({ enabled: false }))), { operations: [] });
  assert.deepEqual(run(fnInput(lines, cfg({ enabled: 'true' }))), { operations: [] });
  for (const percent of [0, -10, 51, 100, 'abc']) assert.deepEqual(run(fnInput(lines, cfg({ percent }))), { operations: [] }, String(percent));
  assert.deepEqual(run(fnInput(lines, cfg(), { classes: ['PRODUCT'] })), { operations: [] }, 'only as an order discount');
  assert.deepEqual(run(fnInput([], cfg())), { operations: [] });
});

/* ── Shopify sync (fake Admin API) ────────────────────────────────────────── */

function fakeShopify({ existing = null, createErrors = [], status = 'ACTIVE' } = {}) {
  const calls = [];
  return {
    calls,
    async graphql(query, { variables } = {}) {
      const op = /(query|mutation)\s+(\w+)/.exec(query)[2];
      calls.push({ op, variables });
      let data;
      if (op === 'PrepaidShopId') data = { shop: { id: 'gid://shopify/Shop/1' } };
      else if (op === 'PrepaidConfig') data = { metafieldsSet: { metafields: [{ id: 'm1' }], userErrors: [] } };
      else if (op === 'PrepaidDiscounts') data = { discountNodes: { nodes: existing ? [{ id: 'd1', discount: { __typename: 'DiscountAutomaticApp', title: PREPAID_DISCOUNT_TITLE, status: existing } }] : [] } };
      else if (op === 'PrepaidDiscountVars') data = { metafieldsSet: { metafields: [{ id: 'm2' }], userErrors: [] } };
      else if (op === 'PrepaidDiscountCreate') data = { discountAutomaticAppCreate: { automaticAppDiscount: createErrors.length ? null : { discountId: 'd1', status }, userErrors: createErrors } };
      else throw new Error(`unhandled ${op}`);
      return new Response(JSON.stringify({ data }));
    },
  };
}

const settingsWith = (pp) => sanitizeCodSettings({ productPayment: { enabled: true, prepaid: { enabled: true, percent: 10, minSubtotal: 999 }, ...pp } });

test('sync: config comes from saved settings only, and is off unless the plan publishes it', () => {
  assert.deepEqual(buildPrepaidConfig(settingsWith({}), { currencyCode: 'INR', planLive: true }),
    { version: 1, enabled: true, percent: 10, minSubtotal: 999, currency: 'INR', title: 'Prepaid discount' });
  assert.equal(buildPrepaidConfig(settingsWith({}), { currencyCode: 'INR', planLive: false }).enabled, false);
  assert.equal(buildPrepaidConfig(settingsWith({ online: { enabled: false } }), { planLive: true }).enabled, false, 'no Pay Online → no discount');
  assert.equal(buildPrepaidConfig(settingsWith({ enabled: false }), { planLive: true }).enabled, false, 'selector off → no discount');
  assert.equal(buildPrepaidConfig(sanitizeCodSettings({}), { planLive: true }).enabled, false);
  assert.equal(prepaidDiscountLive(DEFAULT_COD_SETTINGS.productPayment, true), false);
});

test('sync: writes the metafield, creates the automatic ORDER discount once, verifies ACTIVE', async () => {
  const admin = fakeShopify();
  const result = await syncPrepaidDiscount(admin, settingsWith({}), { currencyCode: 'INR', planLive: true });
  assert.equal(result.verified, true);
  assert.equal(result.state, 'active');
  const meta = admin.calls.find((c) => c.op === 'PrepaidConfig').variables.metafields[0];
  assert.equal(meta.namespace, '$app');
  assert.equal(meta.key, 'prepaid_discount_config');
  assert.deepEqual(JSON.parse(meta.value), { version: 1, enabled: true, percent: 10, minSubtotal: 999, currency: 'INR', title: 'Prepaid discount' });
  const create = admin.calls.find((c) => c.op === 'PrepaidDiscountCreate').variables.discount;
  assert.equal(create.functionHandle, PREPAID_FUNCTION_HANDLE);
  assert.deepEqual(create.discountClasses, ['ORDER']);
  assert.deepEqual(prepaidRuntime(result, result.config).percent, 10);

  assert.deepEqual(JSON.parse(create.metafields[0].value), { collectionIds: [] }, 'input variables on the new discount');
  assert.equal(create.metafields[0].key, 'prepaid_discount_vars');

  const again = fakeShopify({ existing: 'ACTIVE' });
  const ex = settingsWith({ prepaid: { enabled: true, percent: 10, excludedCollections: [{ id: 'gid://shopify/Collection/77', title: 'Books' }] } });
  const r2 = await syncPrepaidDiscount(again, ex, { currencyCode: 'INR', planLive: true });
  assert.equal(r2.verified, true);
  assert.equal(again.calls.some((c) => c.op === 'PrepaidDiscountCreate'), false, 'never a second discount');
  const vars = again.calls.find((c) => c.op === 'PrepaidDiscountVars').variables.metafields[0];
  assert.equal(vars.ownerId, 'd1');
  assert.deepEqual(JSON.parse(vars.value), { collectionIds: ['gid://shopify/Collection/77'] }, 'the existing discount gets the excluded collections');
  assert.deepEqual(prepaidRuntime(r2, r2.config).excludedCollections, ['77'], 'the storefront and Shiprocket code get the verified numeric ids');
});

test('sync: honest states — not deployed, inactive, plan locked, off; never throws', async () => {
  const notDeployed = await syncPrepaidDiscount(fakeShopify({ createErrors: [{ field: ['functionHandle'], message: 'Function not found', code: 'INVALID' }] }), settingsWith({}), { planLive: true });
  assert.deepEqual([notDeployed.verified, notDeployed.state], [false, 'not_deployed']);
  const inactive = await syncPrepaidDiscount(fakeShopify({ existing: 'EXPIRED' }), settingsWith({}), { planLive: true });
  assert.deepEqual([inactive.verified, inactive.state], [false, 'inactive']);
  const locked = await syncPrepaidDiscount(fakeShopify(), settingsWith({}), { planLive: false });
  assert.deepEqual([locked.verified, locked.state], [false, 'plan_locked']);
  const offAdmin = fakeShopify();
  const off = await syncPrepaidDiscount(offAdmin, settingsWith({ prepaid: { enabled: false } }), { planLive: true });
  assert.deepEqual([off.verified, off.state], [false, 'not_needed']);
  assert.equal(JSON.parse(offAdmin.calls.find((c) => c.op === 'PrepaidConfig').variables.metafields[0].value).enabled, false, 'turning it off switches the Function off');
  const broken = { graphql: async () => { throw new Error('network down'); } };
  const failed = await syncPrepaidDiscount(broken, settingsWith({}), { planLive: true });
  assert.deepEqual([failed.verified, failed.state], [false, 'failed']);
  const rt = prepaidRuntime(failed, failed.config);
  assert.deepEqual(rt, { verified: false, state: 'failed', at: rt.at }, 'nothing the storefront could show');
});

/* ── maximum discount (cap) ───────────────────────────────────────────────── */

test('cap: settings keep it, empty = no cap; pricing never promises more than the cap', () => {
  const s = sanitizeProductPayment({ prepaid: { maxDiscount: '200' } });
  assert.equal(s.prepaid.maxDiscount, 200);
  assert.equal(sanitizeProductPayment({}).prepaid.maxDiscount, 0);
  assert.equal(sanitizeProductPayment({ prepaid: { maxDiscount: -5 } }).prepaid.maxDiscount, 0, 'bad value keeps the base');
  const big = productPaymentPricing({ unitPrice: 3000, prepaid: { percent: 10, maxDiscount: 200 } });
  assert.equal(big.savings, 200);
  assert.equal(big.online, 2800);
  assert.equal(productPaymentPricing({ unitPrice: 1000, prepaid: { percent: 10, maxDiscount: 200 } }).savings, 100);
  const other = productPaymentPricing({ unitPrice: 3000, prepaid: { percent: 10, maxDiscount: 200 }, currencyMatches: false });
  assert.equal(other.savings, 0, 'another currency: no saving promised');
  assert.equal(other.minMissing, false, 'and no "orders above" text without a minimum');
});

test('Function: over the cap takes exactly the cap off; under it, the percentage', () => {
  const over = order(run(fnInput([line('L1', 3000)], cfg({ maxDiscount: 200 }))));
  assert.deepEqual(over.candidates[0].value, { fixedAmount: { amount: '200.00' } });
  assert.deepEqual(over.candidates[0].targets, [{ orderSubtotal: { excludedCartLineIds: [] } }]);
  const under = order(run(fnInput([line('L1', 1000)], cfg({ maxDiscount: 200 }))));
  assert.deepEqual(under.candidates[0].value, { percentage: { value: '10' } });
  assert.deepEqual(run(fnInput([line('L1', 3000, { currency: 'USD' })], cfg({ maxDiscount: 200 }))), { operations: [] }, 'cap in another currency: no guessing');
  const gifts = order(run(fnInput([line('L1', 1500), line('G', 900, { reward: 'true' })], cfg({ maxDiscount: 200 }))));
  assert.deepEqual(gifts.candidates[0].value, { percentage: { value: '10' } }, 'gifts are not part of the subtotal the cap compares');
});

test('sync: the cap reaches the Function config only when set', () => {
  const settings = sanitizeCodSettings({ productPayment: { enabled: true, prepaid: { enabled: true, percent: 10, maxDiscount: 250 } } });
  assert.equal(buildPrepaidConfig(settings, { currencyCode: 'INR', planLive: true }).maxDiscount, 250);
  const plain = sanitizeCodSettings({ productPayment: { enabled: true, prepaid: { enabled: true, percent: 10 } } });
  assert.equal('maxDiscount' in buildPrepaidConfig(plain, { currencyCode: 'INR', planLive: true }), false);
  assert.equal(prepaidRuntime({ verified: true, state: 'active' }, { percent: 10, minSubtotal: 0, maxDiscount: 250, currency: 'INR' }).maxDiscount, 250);
});

test('Function: combo box lines (already at the box price) never get the prepaid discount', () => {
  assert.deepEqual(run(fnInput([line('B1', 500, { combo: '9' }), line('B2', 469, { combo: '9' })], cfg())), { operations: [] }, 'a box-only cart gets nothing');
  const mixed = order(run(fnInput([line('B1', 500, { combo: '9' }), line('P1', 1100)], cfg())));
  assert.deepEqual(mixed.candidates[0].targets, [{ orderSubtotal: { excludedCartLineIds: ['B1'] } }], 'the box line is left out, the other line gets 10%');
  assert.deepEqual(run(fnInput([line('B1', 900, { combo: '9' }), line('P1', 300)], cfg({ minSubtotal: 999 }))), { operations: [] }, 'and box lines don\'t count toward the minimum');
  assert.equal(order(run(fnInput([line('B1', 500, { combo: '' }), line('P1', 300)], cfg()))).candidates[0].targets[0].orderSubtotal.excludedCartLineIds.length, 0, 'an empty attribute is no box');
});

test('Function: a BRIX box code (Shiprocket box checkout) keeps the prepaid discount out', () => {
  // As on extrokids: 10 items at ₹204 with box code BXPM43NHRL9P (box at ₹1999) got another 10% on top.
  assert.deepEqual(run(fnInput([line('L1', 2040)], cfg(), { codes: ['BXPM43NHRL9P'] })), { operations: [] });
  assert.deepEqual(run(fnInput([line('L1', 2040)], cfg(), { codes: ['bxpm43nhrl9p'] })), { operations: [] }, 'any letter case');
  assert.equal(order(run(fnInput([line('L1', 2040)], cfg(), { codes: ['WELCOME10'] }))).candidates.length, 1, 'other codes: prepaid as usual');
  assert.equal(order(run(fnInput([line('L1', 2040)], cfg(), { codes: ['BXSALE'] }))).candidates.length, 1, 'a merchant code that only starts with BX is not a box code');
  assert.equal(order(run(fnInput([line('L1', 2040)], cfg(), { codes: ['BXPM43NHRL0P'] }))).candidates.length, 1, '0 is not in the box code letters');
});

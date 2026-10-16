// Run with: node --import ./tests/packs/register.mjs --test tests/cod/cod-discounts.test.mjs
// The cart's discounts in COD orders (settings.cartDiscounts): quoteCod in
// app/services/cod.server.js against a fake Admin API that records every
// draftOrderCalculate input. Proves what BRIX asks Shopify for; not which
// discounts Shopify then gives on a real store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteCod } from '../../app/services/cod.server.js';
import { sanitizeCodSettings } from '../../app/utils/cod.shared.js';

const LINES = [{ variantId: '11', quantity: 2, properties: {} }];

// calc(input) → what Shopify "returns" for that input.
function fakeAdmin(calc, { platformFails = false } = {}) {
  const inputs = [];
  const admin = {
    async graphql(query, { variables } = {}) {
      const reply = (data) => ({ json: async () => data });
      if (query.includes('CodVariants')) {
        return reply({ data: { nodes: [{ id: 'gid://shopify/ProductVariant/11', availableForSale: true, product: { id: 'gid://shopify/Product/1', title: 'Tee', tags: [], status: 'ACTIVE' } }] } });
      }
      if (query.includes('CodCalculate')) {
        if (platformFails && query.includes('platformDiscounts')) return reply({ errors: [{ message: "Field 'platformDiscounts' doesn't exist on type 'CalculatedDraftOrder'" }] });
        inputs.push(variables.input);
        return reply({ data: { draftOrderCalculate: { calculatedDraftOrder: calc(variables.input, query.includes('platformDiscounts')), userErrors: [] } } });
      }
      throw new Error(`unexpected query ${query.slice(0, 60)}`);
    },
  };
  return { admin, inputs };
}

const money = (n) => ({ shopMoney: { amount: String(n) } });
// ₹1000 of items; each known code takes ₹100, the automatic discount ₹50.
function shopify(input, withPlatform) {
  const codes = (input.discountCodes || []).filter((c) => ['KO10', 'WELCOME'].includes(c.toUpperCase()));
  const platform = [
    ...(input.acceptAutomaticDiscounts ? [{ title: 'Buy 2, save 50', code: null, automaticDiscount: true, totalAmountPriceSet: money(50) }] : []),
    ...codes.map((c) => ({ title: c, code: c, automaticDiscount: false, totalAmountPriceSet: money(100) })),
  ];
  const off = platform.reduce((s, d) => s + Number(d.totalAmountPriceSet.shopMoney.amount), 0);
  return {
    currencyCode: 'INR', taxesIncluded: true, discountCodes: input.discountCodes || [],
    ...(withPlatform ? { platformDiscounts: platform } : {}),
    lineItems: [{ name: 'Tee', title: 'Tee', quantity: 2, originalTotalSet: money(1000), discountedTotalSet: money(1000 - off), variant: { id: 'gid://shopify/ProductVariant/11' }, product: { id: 'gid://shopify/Product/1' } }],
    lineItemsSubtotalPrice: money(1000), subtotalPriceSet: money(1000 - off), totalDiscountsSet: money(off),
    totalShippingPriceSet: money(0), totalTaxSet: money(0), totalPriceSet: money(1000 - off),
  };
}

const settings = (patch = {}) => sanitizeCodSettings({ enabled: true, codFeeEnabled: false, shippingFee: 0, ...patch });

test('cartDiscounts defaults to on, and an explicit off sticks', () => {
  assert.equal(settings().cartDiscounts, true);
  assert.equal(settings({ cartDiscounts: false }).cartDiscounts, false);
  assert.equal(sanitizeCodSettings({ cartDiscounts: false }, settings()).cartDiscounts, false);
});

test('on: automatic discounts + the cart\'s codes, each named; unused codes left off the order', async () => {
  const { admin, inputs } = fakeAdmin(shopify);
  const { quote, input } = await quoteCod(admin, {
    settings: settings(), lines: LINES, surface: 'drawer',
    cartCodes: ['KO10', 'ko10', 'EXPIRED', ' '], cartAttributes: { gift_note: 'Happy birthday', _brixInternal: 'x', nested: { a: 1 } },
  });
  assert.equal(inputs[0].acceptAutomaticDiscounts, true);
  assert.deepEqual(inputs[0].discountCodes, ['KO10', 'EXPIRED'], 'deduped, blanks dropped');
  assert.deepEqual(quote.cartCodes, [{ code: 'KO10', applied: true }, { code: 'EXPIRED', applied: false }]);
  assert.deepEqual(input.discountCodes, ['KO10'], 'only the code Shopify used goes on the order');
  assert.equal(quote.discounts, 150);
  assert.deepEqual(quote.discountList.map((d) => [d.code || d.title, d.amount, d.automatic]), [['Buy 2, save 50', 50, true], ['KO10', 100, false]]);
  assert.deepEqual(inputs[0].customAttributes.map((a) => a.key), ['_brixCod', 'gift_note'], 'cart attributes go along, BRIX keys and objects dropped');
});

test('off: no automatic discounts and no cart codes reach Shopify', async () => {
  const { admin, inputs } = fakeAdmin(shopify);
  const { quote, input } = await quoteCod(admin, {
    settings: settings({ cartDiscounts: false }), lines: LINES, surface: 'drawer', cartCodes: ['KO10'],
  });
  assert.equal(inputs[0].acceptAutomaticDiscounts, false);
  assert.equal(inputs[0].discountCodes, undefined);
  assert.equal(input.discountCodes, undefined);
  assert.equal(quote.discounts, 0);
  assert.deepEqual(quote.cartCodes, []);
  assert.equal(quote.total, 1000);
});

test('off still lets a code the shopper types in the popup through (Coupons section)', async () => {
  const { admin, inputs } = fakeAdmin(shopify);
  const { quote } = await quoteCod(admin, { settings: settings({ cartDiscounts: false, allowCoupons: true }), lines: LINES, surface: 'drawer', coupon: 'WELCOME', cartCodes: ['KO10'] });
  assert.deepEqual(inputs[0].discountCodes, ['WELCOME']);
  assert.deepEqual(quote.coupon, { code: 'WELCOME', applied: true });
});

test('a typed coupon and the same cart code are sent once', async () => {
  const { admin, inputs } = fakeAdmin(shopify);
  await quoteCod(admin, { settings: settings(), lines: LINES, surface: 'drawer', coupon: 'KO10', cartCodes: ['ko10', 'WELCOME'] });
  assert.deepEqual(inputs[0].discountCodes, ['KO10', 'WELCOME']);
});

test('an API version without platformDiscounts falls back and still prices the order', async () => {
  const { admin, inputs } = fakeAdmin(shopify, { platformFails: true });
  const { quote, input } = await quoteCod(admin, { settings: settings(), lines: LINES, surface: 'drawer', cartCodes: ['KO10'] });
  assert.equal(inputs.length > 0, true);
  assert.equal(quote.discountList, null);
  assert.equal(quote.discounts, 150);
  assert.deepEqual(input.discountCodes, ['KO10']);
});

/* ── settings.couponMaxDiscount: the most a typed code may take off ── */

// Like shopify() above, with an order-level fixed discount (appliedDiscount) honoured.
function shopifyWithManual(input, withPlatform) {
  const base = shopify(input, withPlatform);
  const manual = input.appliedDiscount ? Number(input.appliedDiscount.value) : 0;
  if (!manual) return base;
  const off = Number(base.totalDiscountsSet.shopMoney.amount) + manual;
  return { ...base, subtotalPriceSet: money(1000 - off), totalDiscountsSet: money(off), totalPriceSet: money(1000 - off) };
}
function capAdmin({ limited = false, lookupFails = false } = {}) {
  const { admin, inputs } = fakeAdmin(shopifyWithManual);
  const inner = admin.graphql;
  admin.graphql = async (query, opts) => {
    if (query.includes('CodCouponLimits')) {
      if (lookupFails) throw new Error('boom');
      return { json: async () => ({ data: { codeDiscountNodeByCode: { codeDiscount: limited ? { usageLimit: 100, appliesOncePerCustomer: false } : { usageLimit: null, appliesOncePerCustomer: false } } } }) };
    }
    return inner(query, opts);
  };
  return { admin, inputs };
}

test('coupon cap: a code worth more becomes a fixed discount of exactly the cap', async () => {
  const { admin, inputs } = capAdmin();
  const { quote, input } = await quoteCod(admin, { settings: settings({ allowCoupons: true, couponMaxDiscount: 60 }), lines: LINES, surface: 'drawer', coupon: 'WELCOME', cartCodes: [] });
  assert.deepEqual(quote.coupon, { code: 'WELCOME', applied: true, capped: true, amount: 60 });
  assert.equal(input.discountCodes, undefined, 'the code itself is not on the order');
  assert.deepEqual(input.appliedDiscount, { title: 'WELCOME', description: 'WELCOME, up to ₹60.00 on COD', value: 60, valueType: 'FIXED_AMOUNT' });
  assert.ok(input.customAttributes.some((a) => a.key === 'brix_coupon_capped' && a.value === 'WELCOME'));
  assert.equal(quote.total, 890, '₹1000 − ₹50 automatic − ₹60 (the cap, not the code\'s ₹100)');
  assert.equal(inputs.at(-1).appliedDiscount.value, 60);
});

test('coupon cap: within the cap the code applies as usual; no cap = as before', async () => {
  let { admin } = capAdmin();
  let { quote, input } = await quoteCod(admin, { settings: settings({ allowCoupons: true, couponMaxDiscount: 150 }), lines: LINES, surface: 'drawer', coupon: 'WELCOME' });
  assert.deepEqual(quote.coupon, { code: 'WELCOME', applied: true });
  assert.deepEqual(input.discountCodes, ['WELCOME']);
  ({ admin } = capAdmin());
  ({ quote } = await quoteCod(admin, { settings: settings({ allowCoupons: true }), lines: LINES, surface: 'drawer', coupon: 'WELCOME' }));
  assert.deepEqual(quote.coupon, { code: 'WELCOME', applied: true });
});

test('coupon cap: a code with a usage limit (or an unknown one) is refused over the cap', async () => {
  for (const opts of [{ limited: true }, { lookupFails: true }]) {
    const { admin } = capAdmin(opts);
    const { quote, input } = await quoteCod(admin, { settings: settings({ allowCoupons: true, couponMaxDiscount: 60 }), lines: LINES, surface: 'drawer', coupon: 'WELCOME' });
    assert.equal(quote.coupon.applied, false);
    assert.match(quote.coupon.message, /WELCOME takes off more than ₹60/);
    assert.equal(input.discountCodes, undefined);
    assert.equal(input.appliedDiscount, undefined);
    assert.equal(quote.total, 950, 'priced without it (the ₹50 automatic discount stays)');
  }
});

test('coupon cap: works without platformDiscounts (difference against the draft without the code)', async () => {
  const { admin } = fakeAdmin(shopifyWithManual, { platformFails: true });
  const inner = admin.graphql;
  admin.graphql = async (query, opts) => (query.includes('CodCouponLimits')
    ? { json: async () => ({ data: { codeDiscountNodeByCode: { codeDiscount: { usageLimit: null, appliesOncePerCustomer: false } } } }) }
    : inner(query, opts));
  const { quote } = await quoteCod(admin, { settings: settings({ allowCoupons: true, couponMaxDiscount: 60, cartDiscounts: false }), lines: LINES, surface: 'drawer', coupon: 'WELCOME' });
  assert.equal(quote.coupon.capped, true);
  assert.equal(quote.total, 940);
});

test('coupon cap: settings keep it; empty = no limit', () => {
  assert.equal(settings().couponMaxDiscount, 0);
  assert.equal(settings({ couponMaxDiscount: '250' }).couponMaxDiscount, 250);
});

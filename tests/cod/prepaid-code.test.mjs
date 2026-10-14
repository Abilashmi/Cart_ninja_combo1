// Run with: node --import ./tests/packs/register.mjs --test tests/cod/prepaid-code.test.mjs
// app/services/prepaid-code.server.js against a fake Admin API: the one-time
// Shopify code that carries the product page's prepaid saving into
// Shiprocket. Proves what BRIX asks Shopify to create; that Shiprocket
// accepts it is the same hand check as box codes, not tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

const { createPrepaidCode, prepaidOffer, PREPAID_CODE_TITLE_PREFIX } = await import('../../app/services/prepaid-code.server.js');

function fakeAdmin(opts = {}) {
  const calls = [];
  return {
    calls,
    async graphql(query, { variables } = {}) {
      const op = /(query|mutation)\s+(\w+)/.exec(query)[2];
      calls.push({ op, variables });
      if (op === 'BrixPrepaidPrices') {
        const prices = opts.prices || { 41: '201.00' };
        const collections = opts.collections || {};
        return new Response(JSON.stringify({ data: { nodes: variables.ids.map((id) => {
          const v = id.split('/').pop();
          if (!prices[v]) return null;
          return { id, price: prices[v], product: { collections: { nodes: (collections[v] || []).map((c) => ({ id: `gid://shopify/Collection/${c}` })) } } };
        }) } }));
      }
      if (op !== 'BrixPrepaidCode') throw new Error(`fake admin: unhandled op ${op}`);
      const data = opts.reject
        ? { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ field: ['code'], code: 'TAKEN', message: 'Code must be unique' }] } }
        : { discountCodeBasicCreate: { codeDiscountNode: { id: 'gid://shopify/DiscountCodeNode/1' }, userErrors: [] } };
      return new Response(JSON.stringify({ data }));
    },
  };
}

const NOW = Date.parse('2026-10-14T10:00:00Z');
const fixedRandom = () => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const SETTINGS = { productPayment: { enabled: true, online: { enabled: true }, prepaid: { enabled: true, percent: 10 } } };
const VERIFIED = { prepaid: { verified: true, percent: 10, minSubtotal: 0, currency: 'INR' } };

test('the offer comes only from saved + verified settings on a live plan', () => {
  assert.deepEqual(prepaidOffer(SETTINGS, VERIFIED, true), { percent: 10, minSubtotal: 0, excludedCollections: [] });
  assert.equal(prepaidOffer(SETTINGS, VERIFIED, false), null, 'plan off');
  assert.equal(prepaidOffer(SETTINGS, { prepaid: { verified: false, percent: 10 } }, true), null, 'not verified in Shopify');
  assert.equal(prepaidOffer(SETTINGS, {}, true), null, 'never synced');
  const off = { productPayment: { ...SETTINGS.productPayment, prepaid: { enabled: false, percent: 10 } } };
  assert.equal(prepaidOffer(off, VERIFIED, true), null, 'merchant switched it off');
  const onlineOff = { productPayment: { ...SETTINGS.productPayment, online: { enabled: false } } };
  assert.equal(prepaidOffer(onlineOff, VERIFIED, true), null, 'Pay Online off');
  // Shopify's verified numbers win over the saved ones.
  assert.deepEqual(prepaidOffer(SETTINGS, { prepaid: { verified: true, percent: 12.5, minSubtotal: 999 } }, true), { percent: 12.5, minSubtotal: 999, excludedCollections: [] });
});

test('a one-time code: X% of the Shopify prices + one paisa, a fixed amount on the items, never with order discounts', async () => {
  const admin = fakeAdmin({ prices: { 41: '201.00', 42: '99.50' } });
  const result = await createPrepaidCode(admin, {
    offer: { percent: 10, minSubtotal: 0 }, items: [{ variantId: '41', quantity: 2 }, { variantId: '41', quantity: 1 }, { variantId: '42', quantity: 1 }], now: NOW, random: fixedRandom,
  });
  assert.equal(result.code, 'PPABCDEFGHJK');
  assert.equal(result.amount, '70.26'); // 10% of 3 × 201 + 99.50 = 702.50 → 70.25, + one paisa so Shopify prefers it to the Function
  const input = admin.calls.find((c) => c.op === 'BrixPrepaidCode').variables.input;
  assert.equal(input.code, result.code);
  assert.equal(input.title, `${PREPAID_CODE_TITLE_PREFIX} ${result.code}`);
  assert.equal(input.usageLimit, 1);
  assert.equal(input.endsAt, new Date(NOW + 2 * 60 * 60 * 1000).toISOString());
  assert.deepEqual(input.customerGets.value, { discountAmount: { amount: '70.26', appliesOnEachItem: false } });
  assert.deepEqual(input.customerGets.items.products.productVariantsToAdd, ['gid://shopify/ProductVariant/41', 'gid://shopify/ProductVariant/42']);
  assert.deepEqual(input.minimumRequirement, { subtotal: { greaterThanOrEqualToSubtotal: '702.50' } });
  // Never stacks with the prepaid Function (Shiprocket showed 10% + 10% when it did).
  assert.deepEqual(input.combinesWith, { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true });
});

test('below the offer minimum, or nothing priced = no code', async () => {
  const admin = fakeAdmin();
  assert.deepEqual(await createPrepaidCode(admin, { offer: { percent: 10, minSubtotal: 999 }, items: [{ variantId: '41', quantity: 1 }], now: NOW, random: fixedRandom }), { code: null });
  assert.ok(!admin.calls.some((c) => c.op === 'BrixPrepaidCode'));
  const gone = fakeAdmin({ prices: {} });
  assert.deepEqual(await createPrepaidCode(gone, { offer: { percent: 10, minSubtotal: 0 }, items: [{ variantId: '41', quantity: 1 }], now: NOW, random: fixedRandom }), { code: null });
  const enough = fakeAdmin();
  const r = await createPrepaidCode(enough, { offer: { percent: 12.5, minSubtotal: 999 }, items: [{ variantId: '41', quantity: 5 }], now: NOW, random: fixedRandom });
  assert.equal(r.amount, '125.64'); // 12.5% of 1005.00 = 125.63, + one paisa
});

test('items in an excluded collection are left out of the code, like the Function', async () => {
  const admin = fakeAdmin({ prices: { 41: '201.00', 42: '500.00' }, collections: { 42: ['77', '5'] } });
  const r = await createPrepaidCode(admin, { offer: { percent: 10, minSubtotal: 0, excludedCollections: ['77'] }, items: [{ variantId: '41', quantity: 1 }, { variantId: '42', quantity: 1 }], now: NOW, random: fixedRandom });
  assert.equal(r.amount, '20.11', '10% of ₹201 only, + one paisa');
  const input = admin.calls.find((c) => c.op === 'BrixPrepaidCode').variables.input;
  assert.deepEqual(input.customerGets.items.products.productVariantsToAdd, ['gid://shopify/ProductVariant/41']);
  assert.deepEqual(input.minimumRequirement, { subtotal: { greaterThanOrEqualToSubtotal: '201.00' } });
  const only = fakeAdmin({ prices: { 42: '500.00' }, collections: { 42: ['77'] } });
  assert.deepEqual(await createPrepaidCode(only, { offer: { percent: 10, minSubtotal: 0, excludedCollections: ['77'] }, items: [{ variantId: '42', quantity: 1 }], now: NOW, random: fixedRandom }), { code: null }, 'only excluded items → no code');
});

test('the offer carries the verified excluded collections', () => {
  const rt = { prepaid: { ...VERIFIED.prepaid, excludedCollections: ['77', 'x', 12] } };
  assert.deepEqual(prepaidOffer(SETTINGS, rt, true).excludedCollections, ['77', '12']);
  assert.deepEqual(prepaidOffer(SETTINGS, VERIFIED, true).excludedCollections, [], 'saved before exclusions existed');
});

test('no live offer = no code and no Shopify call', async () => {
  const admin = fakeAdmin();
  assert.deepEqual(await createPrepaidCode(admin, { offer: null, items: [{ variantId: '41', quantity: 1 }] }), { code: null });
  assert.equal(admin.calls.length, 0);
});

test('Shopify refusing the code is an error (the storefront then uses Shopify checkout)', async () => {
  await assert.rejects(
    createPrepaidCode(fakeAdmin({ reject: true }), { offer: { percent: 10, minSubtotal: 0 }, items: [{ variantId: '41', quantity: 1 }], now: NOW, random: fixedRandom }),
    /discountCodeBasicCreate failed/,
  );
});

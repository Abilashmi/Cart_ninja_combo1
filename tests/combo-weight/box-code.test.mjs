// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight/box-code.test.mjs
// app/services/combo-box-code.server.js against a fake Admin API: the
// one-time Shopify code a box combo carries into Shiprocket. Proves what BRIX
// asks Shopify to create; that Shiprocket accepts a fresh Shopify code was
// checked by hand on a store, not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from "node:buffer";

const { createBoxCode, cleanupExpiredBoxCodes, boxCheckoutOf, newBoxCode, BOX_CODE_TITLE_PREFIX } =
  await import('../../app/services/combo-box-code.server.js');

const COMBO_CONFIG = { version: 1, currency: 'INR', templates: { 12: {
  id: 12, hash: 'h1', unit: 'kg', max_grams: 2200, product_ids: [], collection_ids: ['900'],
  tiers: [
    { min_grams: 1000, type: 'percentage', value: 10, label: '1 kg box: 10% off' },
    { min_grams: 2000, type: 'fixed_price', value: 1700, label: '2 kg box for ₹1700' },
  ],
} } };
const VARIANTS = {
  'gid://shopify/ProductVariant/21': { price: 110, grams: 300, collections: ['gid://shopify/Collection/900'] },
  'gid://shopify/ProductVariant/23': { price: 100, grams: null, collections: ['gid://shopify/Collection/900'] },
  'gid://shopify/ProductVariant/24': { price: 900, grams: 2000, collections: ['gid://shopify/Collection/5'] },
  'gid://shopify/ProductVariant/25': { price: 1000, grams: 500, collections: ['gid://shopify/Collection/900'] },
};

function fakeAdmin(opts = {}) {
  const calls = [];
  return {
    calls,
    async graphql(query, { variables } = {}) {
      const op = /(query|mutation)\s+(\w+)/.exec(query)[2];
      calls.push({ op, variables });
      let data;
      if (op === 'CodComboWeight') {
        data = {
          shop: { metafield: { jsonValue: COMBO_CONFIG } },
          discountNodes: { nodes: [{ discount: { __typename: 'DiscountAutomaticApp', title: 'BRIX Combo Weight', status: opts.comboStatus || 'ACTIVE' } }] },
        };
      } else if (op === 'CodComboVariants') {
        data = { nodes: variables.ids.map((id) => (VARIANTS[id] ? {
          id, price: String(VARIANTS[id].price),
          inventoryItem: { measurement: { weight: VARIANTS[id].grams ? { value: VARIANTS[id].grams, unit: 'GRAMS' } : null } },
          product: {
            id: `gid://shopify/Product/${id.split('/').pop()}`,
            ...Object.fromEntries(Object.entries(variables).filter(([k]) => /^c\d+$/.test(k)).map(([k, gid]) => [k, VARIANTS[id].collections.includes(gid)])),
          },
        } : null)) };
      } else if (op === 'BrixBoxCode') {
        data = opts.rejectCreate
          ? { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ field: ['code'], code: 'TAKEN', message: 'Code must be unique' }] } }
          : { discountCodeBasicCreate: { codeDiscountNode: { id: 'gid://shopify/DiscountCodeNode/1' }, userErrors: [] } };
      } else if (op === 'BrixOldBoxCodes') {
        data = { codeDiscountNodes: { nodes: opts.oldCodes || [] } };
      } else if (op === 'BrixDeleteBoxCodes') {
        data = { discountCodeBulkDelete: { job: { id: 'gid://shopify/Job/1' }, userErrors: [] } };
      } else {
        throw new Error(`fake admin: unhandled op ${op}`);
      }
      return new Response(JSON.stringify({ data }));
    },
  };
}

const NOW = Date.parse('2026-10-10T10:00:00Z');
const fixedRandom = () => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const make = (admin, items, extra = {}) => createBoxCode(admin, {
  templateId: '12', items, comboWeightLive: true, currencyCode: 'INR', now: NOW, random: fixedRandom, ...extra,
});
const created = (admin) => admin.calls.find((c) => c.op === 'BrixBoxCode')?.variables.input;

test('a box that reaches a tier gets a one-time code worth exactly its discount', async () => {
  const admin = fakeAdmin();
  // 4 novels = 1.2 kg, ₹440 → 10% = ₹44 (what Shopify checkout's Function gives)
  const result = await make(admin, [{ variantId: '21', quantity: 4 }]);
  assert.equal(result.code, 'BXABCDEFGHJK');
  assert.equal(result.amount, '44.00');
  const input = created(admin);
  assert.equal(input.code, result.code);
  assert.equal(input.title, `${BOX_CODE_TITLE_PREFIX} 12 ${result.code}`);
  assert.deepEqual(input.customerGets, {
    value: { discountAmount: { amount: '44.00', appliesOnEachItem: false } },
    items: { products: { productVariantsToAdd: ['gid://shopify/ProductVariant/21'] } },
  });
  assert.deepEqual(input.minimumRequirement, { subtotal: { greaterThanOrEqualToSubtotal: '440.00' } }, 'cannot be spent on a smaller box');
  assert.equal(input.usageLimit, 1);
  assert.deepEqual(input.context, { all: 'ALL' });
  assert.deepEqual(input.combinesWith, { productDiscounts: false, orderDiscounts: true, shippingDiscounts: true }, 'never stacks with the box Function');
  assert.equal(input.endsAt, new Date(NOW + 2 * 60 * 60 * 1000).toISOString());
  assert.ok(Date.parse(input.startsAt) < NOW, 'already valid when the shopper lands in Shiprocket');
});

test('fixed box price: the code is the difference to the box price', async () => {
  const admin = fakeAdmin();
  // 4 box sets = 2 kg, ₹4000 → box for ₹1700 → ₹2300 off
  const result = await make(admin, [{ variantId: '25', quantity: 4 }]);
  assert.equal(result.amount, '2300.00');
  assert.equal(created(admin).minimumRequirement.subtotal.greaterThanOrEqualToSubtotal, '4000.00');
});

test('only the lines that count toward the box are on the code', async () => {
  const admin = fakeAdmin();
  // novels count; the unweighed poster and the lamp outside the box collection do not
  await make(admin, [{ variantId: '21', quantity: 4 }, { variantId: '23', quantity: 1 }, { variantId: '24', quantity: 1 }]);
  const input = created(admin);
  assert.deepEqual(input.customerGets.items.products.productVariantsToAdd, ['gid://shopify/ProductVariant/21']);
  assert.equal(input.minimumRequirement.subtotal.greaterThanOrEqualToSubtotal, '440.00');
});

test('no code when the box has no discount', async () => {
  const below = fakeAdmin();
  assert.deepEqual(await make(below, [{ variantId: '21', quantity: 2 }]), { code: null }, '600 g, below the first tier');
  assert.ok(!below.calls.some((c) => c.op === 'BrixBoxCode'));

  const off = fakeAdmin({ comboStatus: 'EXPIRED' });
  assert.deepEqual(await make(off, [{ variantId: '21', quantity: 4 }]), { code: null }, 'box discount not active in Shopify');

  const plan = fakeAdmin();
  assert.deepEqual(await make(plan, [{ variantId: '21', quantity: 4 }], { comboWeightLive: false }), { code: null }, 'plan without box pricing');
  assert.equal(plan.calls.length, 0);

  const other = fakeAdmin();
  assert.deepEqual(await make(other, [{ variantId: '21', quantity: 4 }], { templateId: '99' }), { code: null }, 'combo not in the trusted config');
});

test('a Shopify refusal is an error, so the storefront falls back to Shopify checkout', async () => {
  await assert.rejects(make(fakeAdmin({ rejectCreate: true }), [{ variantId: '21', quantity: 4 }]), /discountCodeBasicCreate failed/);
});

test('cleanup deletes only BRIX box codes that have expired, at most once an hour', async () => {
  const node = (id, title, status, __typename = 'DiscountCodeBasic') => ({ id, codeDiscount: { __typename, title, status } });
  const admin = fakeAdmin({ oldCodes: [
    node('gid://shopify/DiscountCodeNode/1', `${BOX_CODE_TITLE_PREFIX} 12 BXAAAA`, 'EXPIRED'),
    node('gid://shopify/DiscountCodeNode/2', `${BOX_CODE_TITLE_PREFIX} 12 BXBBBB`, 'ACTIVE'),
    node('gid://shopify/DiscountCodeNode/3', 'BRIX-BOX-CODES summer sale', 'EXPIRED'),
    node('gid://shopify/DiscountCodeNode/4', 'Diwali', 'EXPIRED'),
  ] });
  assert.deepEqual(await cleanupExpiredBoxCodes(admin, 'a.myshopify.com', NOW), { deleted: 1 });
  assert.deepEqual(admin.calls.find((c) => c.op === 'BrixDeleteBoxCodes').variables.ids, ['gid://shopify/DiscountCodeNode/1']);
  assert.deepEqual(await cleanupExpiredBoxCodes(admin, 'a.myshopify.com', NOW + 5 * 60_000), { skipped: true });
  assert.equal((await cleanupExpiredBoxCodes(admin, 'a.myshopify.com', NOW + 61 * 60_000)).deleted, 1);
});

test('checkout choice and code format', () => {
  assert.equal(boxCheckoutOf({}), 'shopify');
  assert.equal(boxCheckoutOf({ qs_checkout_with: 'shiprocket' }), 'shiprocket');
  assert.equal(boxCheckoutOf({ qs_checkout_with: 'shiprocket_own' }), 'shiprocket_own');
  assert.equal(boxCheckoutOf({ qs_checkout_with: 'paypal' }), 'shopify');
  assert.match(newBoxCode(), /^BX[A-HJ-NP-Z2-9]{10}$/);
});

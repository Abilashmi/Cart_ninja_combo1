// Run with: node --import ./tests/packs/register.mjs --test tests/cod/partial-cod.test.mjs
// Partial COD: the advance/balance split, the one-time code (fake Admin API),
// and finishing the order on orders/create (fake Admin API + fake DB).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

const { partialCodSplit, sanitizePartialCod, DEFAULT_PARTIAL_COD } = await import('../../app/utils/partial-cod.shared.js');
const { sanitizeCodSettings } = await import('../../app/utils/cod.shared.js');
const { createPartialCod, completePartialCodOrder } = await import('../../app/services/partial-cod.server.js');

const NOW = Date.parse('2026-11-13T10:00:00Z');
const fixedRandom = () => Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

test('split: fixed amount, percentage (rounded up), order range, never the whole order', () => {
  const on = { ...DEFAULT_PARTIAL_COD, enabled: true };
  assert.deepEqual(partialCodSplit(on, 1599), { advance: 50, balance: 1549 });
  assert.deepEqual(partialCodSplit({ ...on, mode: 'percent', percent: 10 }, 1599), { advance: 160, balance: 1439 });
  assert.deepEqual(partialCodSplit({ ...on, mode: 'percent', percent: 10 }, 2212.36), { advance: 222, balance: 1990.36 });
  assert.equal(partialCodSplit({ ...on, enabled: false }, 1599), null, 'off');
  assert.equal(partialCodSplit({ ...on, minOrder: 2000 }, 1599), null, 'below the minimum');
  assert.equal(partialCodSplit({ ...on, maxOrder: 1000 }, 1599), null, 'above the maximum');
  assert.equal(partialCodSplit({ ...on, amount: 2000 }, 1599), null, 'advance would cover the whole order');
  assert.equal(partialCodSplit(on, 0), null);
});

test('split: shipping + COD fee mode', () => {
  const on = { ...DEFAULT_PARTIAL_COD, enabled: true, mode: 'charges' };
  assert.deepEqual(partialCodSplit(on, 1698, 99), { advance: 99, balance: 1599 }, '₹60 shipping + ₹39 fee');
  assert.deepEqual(partialCodSplit(on, 1631.98, 31.98), { advance: 32, balance: 1599.98 }, 'rounded up to the rupee');
  assert.equal(partialCodSplit(on, 1599, 0), null, 'free shipping and no fee: normal COD');
  assert.equal(partialCodSplit(on, 1599), null, 'no charges given');
  assert.equal(partialCodSplit({ ...on, maxOrder: 1000 }, 1698, 99), null, 'order range still applies');
  assert.equal(sanitizePartialCod({ mode: 'charges' }).mode, 'charges');
});

test('settings: defaults off, values clamped, part of the COD settings', () => {
  assert.equal(sanitizePartialCod(null).enabled, false);
  const s = sanitizePartialCod({ enabled: true, mode: 'percent', percent: 500, amount: -3, minOrder: 900, maxOrder: 100 });
  assert.equal(s.mode, 'percent');
  assert.equal(s.percent, 90);
  assert.equal(s.amount, 1);
  assert.equal(s.maxOrder, 900, 'max never below min');
  assert.equal(sanitizePartialCod({ mode: 'nope' }).mode, 'fixed');
  const cod = sanitizeCodSettings({ partialCod: { enabled: true, amount: 99 } });
  assert.equal(cod.partialCod.enabled, true);
  assert.equal(cod.partialCod.amount, 99);
  assert.equal(sanitizeCodSettings({}).partialCod.enabled, false);
  assert.equal(sanitizeCodSettings({}).partialCod.only, false, '"only part payment" is off by default');
  assert.equal(sanitizePartialCod({ only: 1 }).only, true);
  assert.equal(sanitizePartialCod({ amount: 60 }, { only: true }).only, true, 'kept when not sent');
});

function fakeAdmin({ prices = { 41: '1599.00' }, failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async graphql(query, { variables } = {}) {
      const op = /(query|mutation)\s+(\w+)/.exec(query)[2];
      calls.push({ op, variables });
      if (failOn && failOn(op)) return new Response(JSON.stringify({ errors: [{ message: 'boom' }] }));
      const data = {
        BrixPartialCodPrices: () => ({ nodes: variables.ids.map((id) => (prices[id.split('/').pop()] ? { id, price: prices[id.split('/').pop()] } : null)) }),
        BrixPartialCodCode: () => ({ discountCodeBasicCreate: { codeDiscountNode: { id: 'gid://shopify/DiscountCodeNode/1' }, userErrors: [] } }),
        BrixPartialCodEditBegin: () => ({ orderEditBegin: { calculatedOrder: { id: 'gid://shopify/CalculatedOrder/9' }, userErrors: [] } }),
        BrixPartialCodAddBalance: () => ({ orderEditAddCustomItem: { calculatedLineItem: { id: 'gid://shopify/CalculatedLineItem/1' }, userErrors: [] } }),
        BrixPartialCodEditCommit: () => ({ orderEditCommit: { order: { id: 'gid://shopify/Order/7' }, userErrors: [] } }),
        BrixPartialCodTags: () => ({ tagsAdd: { node: { id: 'gid://shopify/Order/7' }, userErrors: [] } }),
        CleanupExpired: () => ({ codeDiscountNodes: { nodes: [] } }),
      }[op];
      return new Response(JSON.stringify({ data: data ? data() : {} }));
    },
  };
}

// A tiny stand-in for the MySQL table (only the statements partial-cod.server.js runs).
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    async execute(sql, params = []) {
      if (/^CREATE TABLE/.test(sql.trim())) return [{}];
      if (/^INSERT INTO partial_cod_orders/.test(sql)) {
        const [code, shop, expected, advance, currency] = params;
        rows.set(code, { code, shop, expected_total: String(expected), advance: String(advance), currency, status: 'created' });
        return [{ affectedRows: 1 }];
      }
      if (/^SELECT code/.test(sql)) {
        const [shop, ...codes] = params;
        return [[...rows.values()].filter((r) => r.shop === shop && codes.includes(r.code)).slice(0, 1)];
      }
      if (/SET status = 'processing'/.test(sql)) {
        const [orderId, name, code, shop] = params;
        const r = rows.get(code);
        if (!r || r.shop !== shop || r.status !== 'created') return [{ affectedRows: 0 }];
        Object.assign(r, { status: 'processing', order_id: orderId, order_name: name });
        return [{ affectedRows: 1 }];
      }
      if (/SET status = 'done'/.test(sql)) {
        const [paid, added, code] = params;
        Object.assign(rows.get(code), { status: 'done', paid, balance_added: added });
        return [{ affectedRows: 1 }];
      }
      if (/SET status = 'failed'/.test(sql)) {
        const [paid, error, code] = params;
        Object.assign(rows.get(code), { status: 'failed', paid, error });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`fakeDb: unexpected SQL ${sql.slice(0, 60)}`);
    },
  };
}

const SETTINGS = { partialCod: { ...DEFAULT_PARTIAL_COD, enabled: true, amount: 50 } };
const ADDRESS = { name: 'Asha K', address1: '1 MG Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' };
// What the COD popup priced: Buy 2 at ₹1,599 with a ₹500 Pack saving, free shipping, no fee.
const quoteOf = (total) => async () => ({ quote: { total, currency: 'INR' } });

test('code: worth the items\' Shopify price minus the advance; order total remembered', async () => {
  const admin = fakeAdmin();
  const db = fakeDb();
  const result = await createPartialCod(admin, {
    shop: 'demo.myshopify.com', settings: SETTINGS, lines: [{ variantId: '41', quantity: 2, properties: { _brix_pack_id: '7' } }],
    address: ADDRESS, surface: 'product', db, now: NOW, random: fixedRandom, priceOrder: quoteOf(2698),
  });
  assert.equal(result.code, 'PCABCDEFGHJK');
  assert.equal(result.advance, 50);
  assert.equal(result.balance, 2648);
  assert.equal(result.total, 2698);
  const input = admin.calls.find((c) => c.op === 'BrixPartialCodCode').variables.input;
  // 2 × ₹1,599 = ₹3,198 at Shopify price; checkout charges ₹50.
  assert.deepEqual(input.customerGets.value, { discountAmount: { amount: '3148.00', appliesOnEachItem: false } });
  assert.deepEqual(input.minimumRequirement, { subtotal: { greaterThanOrEqualToSubtotal: '3198.00' } });
  assert.deepEqual(input.customerGets.items.products.productVariantsToAdd, ['gid://shopify/ProductVariant/41']);
  assert.equal(input.usageLimit, 1);
  assert.equal(input.endsAt, new Date(NOW + 2 * 60 * 60 * 1000).toISOString());
  assert.deepEqual(input.combinesWith, { productDiscounts: false, orderDiscounts: false, shippingDiscounts: true });
  assert.equal(db.rows.get('PCABCDEFGHJK').expected_total, '2698');
});

test('code: shipping + COD fee mode takes the advance from the priced order', async () => {
  const admin = fakeAdmin();
  const db = fakeDb();
  const result = await createPartialCod(admin, {
    shop: 'demo.myshopify.com', settings: { partialCod: { ...SETTINGS.partialCod, mode: 'charges' } },
    lines: [{ variantId: '41', quantity: 1 }], address: ADDRESS, surface: 'product', db, now: NOW, random: fixedRandom,
    priceOrder: async () => ({ quote: { total: 1698, shipping: 60, codFee: 39, currency: 'INR' } }),
  });
  assert.equal(result.advance, 99);
  assert.equal(result.balance, 1599);
  const input = admin.calls.find((c) => c.op === 'BrixPartialCodCode').variables.input;
  assert.deepEqual(input.customerGets.value, { discountAmount: { amount: '1500.00', appliesOnEachItem: false } }, '₹1,599 item, ₹99 left to pay online');
  await assert.rejects(createPartialCod(fakeAdmin(), {
    shop: 'demo.myshopify.com', settings: { partialCod: { ...SETTINGS.partialCod, mode: 'charges' } },
    lines: [{ variantId: '41', quantity: 1 }], address: ADDRESS, surface: 'product', db: fakeDb(), now: NOW, random: fixedRandom,
    priceOrder: async () => ({ quote: { total: 1599, shipping: 0, codFee: 0, currency: 'INR' } }),
  }), { code: 'partial_unavailable' }, 'no charges = no part payment');
});

test('code: refused when Partial COD is off for this total or an item is gone', async () => {
  const base = { shop: 'demo.myshopify.com', lines: [{ variantId: '41', quantity: 1 }], address: ADDRESS, surface: 'product', db: fakeDb(), now: NOW, random: fixedRandom };
  await assert.rejects(createPartialCod(fakeAdmin(), { ...base, settings: { partialCod: { ...SETTINGS.partialCod, minOrder: 5000 } }, priceOrder: quoteOf(1599) }), { code: 'partial_unavailable' });
  await assert.rejects(createPartialCod(fakeAdmin({ prices: {} }), { ...base, settings: SETTINGS, priceOrder: quoteOf(1599) }), { code: 'invalid_items' });
});

const ORDER = { id: 7, admin_graphql_api_id: 'gid://shopify/Order/7', name: '#1042', currency: 'INR', current_total_price: '50.00', discount_codes: [{ code: 'PCABCDEFGHJK', amount: '3148.00' }] };

async function codeInDb(total = 2698) {
  const db = fakeDb();
  await createPartialCod(fakeAdmin(), {
    shop: 'demo.myshopify.com', settings: SETTINGS, lines: [{ variantId: '41', quantity: 2 }], address: ADDRESS, surface: 'product',
    db, now: NOW, random: fixedRandom, priceOrder: quoteOf(total),
  });
  return db;
}

test('order: the balance goes back on as an untaxed line, tagged, once', async () => {
  const db = await codeInDb();
  const admin = fakeAdmin();
  const result = await completePartialCodOrder('demo.myshopify.com', ORDER, { getAdmin: async () => admin, db, retries: [] });
  assert.deepEqual(result, { handled: true, balance: 2648, paid: 50 });
  const add = admin.calls.find((c) => c.op === 'BrixPartialCodAddBalance').variables;
  assert.equal(add.title, 'Balance payable on delivery');
  assert.deepEqual(add.price, { amount: '2648.00', currencyCode: 'INR' });
  assert.match(admin.calls.find((c) => c.op === 'BrixPartialCodEditCommit').variables.staffNote, /advance ₹50 paid online, ₹2,648 to collect on delivery/);
  assert.deepEqual(admin.calls.find((c) => c.op === 'BrixPartialCodTags').variables.tags, ['partial-cod', 'BRIX-COD']);
  assert.equal(db.rows.get('PCABCDEFGHJK').status, 'done');
  // orders/create again: nothing happens twice.
  const again = await completePartialCodOrder('demo.myshopify.com', ORDER, { getAdmin: async () => admin, db, retries: [] });
  assert.equal(again.skipped, 'already_handled');
  assert.equal(admin.calls.filter((c) => c.op === 'BrixPartialCodAddBalance').length, 1);
});

test('order: shipping Shopify charged comes off the balance; the order total stays what the popup showed', async () => {
  const db = await codeInDb();
  const admin = fakeAdmin();
  const result = await completePartialCodOrder('demo.myshopify.com', { ...ORDER, current_total_price: '99.00' }, { getAdmin: async () => admin, db, retries: [] });
  assert.equal(result.balance, 2599); // 50 advance + 49 shipping paid, 2698 in all
});

test('order: other orders are left alone; a failure retries, then tags partial-cod-check', async () => {
  const db = await codeInDb();
  assert.deepEqual(await completePartialCodOrder('demo.myshopify.com', { ...ORDER, discount_codes: [{ code: 'SAVE10' }] }, { getAdmin: async () => fakeAdmin(), db }), { handled: false });
  assert.deepEqual(await completePartialCodOrder('other.myshopify.com', ORDER, { getAdmin: async () => fakeAdmin(), db }), { handled: false });

  const admin = fakeAdmin({ failOn: (op) => op === 'BrixPartialCodEditBegin' });
  const waits = [];
  const result = await completePartialCodOrder('demo.myshopify.com', ORDER, { getAdmin: async () => admin, db, retries: [1, 2], wait: async (ms) => { waits.push(ms); } });
  assert.equal(result.failed, true);
  assert.deepEqual(waits, [1, 2]);
  assert.equal(admin.calls.filter((c) => c.op === 'BrixPartialCodEditBegin').length, 3);
  assert.deepEqual(admin.calls.find((c) => c.op === 'BrixPartialCodTags').variables.tags, ['partial-cod', 'BRIX-COD', 'partial-cod-check']);
  assert.equal(db.rows.get('PCABCDEFGHJK').status, 'failed');
});

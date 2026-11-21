/* eslint-env node */
// Run with: node --test tests/cod/saved-addresses.test.mjs
// Saved shopper addresses (services/saved-addresses.server.js): what is kept
// from an order, that nothing readable is stored, one row per place, at most
// 3 per phone per store, and that the redact webhooks delete them.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.CUSTOMER_DATA_KEY = crypto.randomBytes(32).toString('base64');
const sa = await import('../../app/services/saved-addresses.server.js');

// An in-memory customer_addresses table answering the statements the service runs.
function fakeDb() {
  const rows = [];
  let nextId = 1;
  const log = [];
  const db = {
    rows, log,
    async execute(sql, params = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      log.push(s);
      if (s.startsWith('CREATE TABLE')) return [{}];
      if (s.startsWith('INSERT INTO customer_addresses')) {
        const [shop, scope, phone, addr, email, customer, order, payload, first, seen, expires] = params;
        const row = rows.find((r) => r.shop_domain === shop && r.scope === scope && r.phone_hash === phone && r.address_hash === addr);
        if (!row) {
          rows.push({ id: nextId++, shop_domain: shop, scope, phone_hash: phone, address_hash: addr, email_hash: email, customer_hash: customer, order_hash: order, payload_enc: payload, orders_count: 1, first_seen: first, last_seen: seen, expires_at: expires });
          return [{ affectedRows: 1 }];
        }
        if (row.order_hash !== order) row.orders_count += 1;
        Object.assign(row, { order_hash: order, email_hash: email ?? row.email_hash, customer_hash: customer ?? row.customer_hash, payload_enc: payload });
        if (seen > row.last_seen) row.last_seen = seen;
        if (expires > row.expires_at) row.expires_at = expires;
        return [{ affectedRows: 2 }];
      }
      if (s.startsWith('SELECT id FROM customer_addresses')) {
        const [shop, scope, phone] = params;
        return [rows.filter((r) => r.shop_domain === shop && r.scope === scope && r.phone_hash === phone)
          .sort((a, b) => (b.last_seen.localeCompare(a.last_seen)) || b.id - a.id).map((r) => ({ id: r.id }))];
      }
      if (s.startsWith('SELECT id, scope, payload_enc')) {
        const [phone, shop, now] = params;
        return [rows.filter((r) => r.phone_hash === phone && r.shop_domain === shop && r.scope === 'store' && r.expires_at > now)
          .sort((a, b) => (b.last_seen.localeCompare(a.last_seen)) || b.id - a.id).slice(0, 3)];
      }
      if (s.startsWith('DELETE FROM customer_addresses WHERE id IN')) return [remove((r) => params.includes(r.id))];
      if (s.startsWith('DELETE FROM customer_addresses WHERE expires_at <')) return [remove((r) => r.expires_at < params[0])];
      if (s.startsWith("DELETE FROM customer_addresses WHERE shop_domain = ? AND scope = 'store' AND (")) {
        const [shop, ...hashes] = params;
        return [remove((r) => r.shop_domain === shop && r.scope === 'store' && [r.customer_hash, r.email_hash, r.phone_hash, r.order_hash].some((h) => h && hashes.includes(h)))];
      }
      if (s.startsWith("DELETE FROM customer_addresses WHERE shop_domain = ? AND scope = 'store'")) return [remove((r) => r.shop_domain === params[0] && r.scope === 'store')];
      throw new Error(`fake db: unexpected SQL ${s.slice(0, 80)}`);
    },
  };
  function remove(match) {
    let n = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) if (match(rows[i])) { rows.splice(i, 1); n += 1; }
    return { affectedRows: n };
  }
  return db;
}

const order = (over = {}) => ({
  id: 5001, email: 'Asha@Example.com', phone: null, customer: { id: 77, email: 'asha@example.com' },
  shipping_address: { first_name: 'Asha', last_name: 'Rao', address1: '12, MG Road', address2: 'Flat 4B', city: 'Chennai', province: 'Tamil Nadu', province_code: 'TN', zip: '600 001', country_code: 'IN', phone: '+91 98765-43210' },
  ...over,
});
const SHOP = 'naanal.myshopify.com';

test('phones: Indian mobiles only, any common way of writing them', () => {
  assert.deepEqual(['+91 98765 43210', '919876543210', '09876543210', '9876543210', '98765-43210'].map(sa.normalizeIndianMobile), Array(5).fill('9876543210'));
  assert.deepEqual(['5876543210', '12345', '+1 415 555 0100', '', null].map(sa.normalizeIndianMobile), [null, null, null, null, null]);
});

test('what is kept from an order', () => {
  const a = sa.addressFromOrder(order());
  assert.deepEqual(a, { firstName: 'Asha', lastName: 'Rao', address1: '12, MG Road', address2: 'Flat 4B', city: 'Chennai', province: 'Tamil Nadu', provinceCode: 'TN', zip: '600001', countryCode: 'IN', phone: '9876543210', email: 'asha@example.com' });
  // Phone from the order when the address has none; billing when there's no shipping.
  assert.equal(sa.addressFromOrder(order({ phone: '9123456780', shipping_address: { ...order().shipping_address, phone: '' } })).phone, '9123456780');
  assert.equal(sa.addressFromOrder({ billing_address: order().shipping_address }).city, 'Chennai');
  // Not kept: abroad, no Indian mobile, no PIN code, no street, no name, no address (Shopify left it out).
  assert.equal(sa.addressFromOrder(order({ shipping_address: { ...order().shipping_address, country_code: 'US' } })), null);
  assert.equal(sa.addressFromOrder(order({ shipping_address: { ...order().shipping_address, phone: '' } })), null);
  assert.equal(sa.addressFromOrder(order({ shipping_address: { ...order().shipping_address, zip: '' } })), null);
  assert.equal(sa.addressFromOrder(order({ shipping_address: { ...order().shipping_address, address1: ' ' } })), null);
  assert.equal(sa.addressFromOrder(order({ shipping_address: { ...order().shipping_address, first_name: '', last_name: '' } })), null);
  assert.equal(sa.addressFromOrder({ id: 1, email: 'x@y.z' }), null);
});

test('stored: hashes and ciphertext only; reads back only for its own shop and phone', async () => {
  sa.resetSavedAddressState();
  const db = fakeDb();
  assert.equal(await sa.saveAddressFromOrder(db, SHOP, order()), 'saved');
  assert.equal(db.rows.length, 1);
  const row = db.rows[0];
  const stored = JSON.stringify(row);
  for (const plain of ['9876543210', 'asha', 'Asha', 'MG Road', 'Chennai', '600001', '5001', '"77"']) {
    assert.equal(stored.includes(plain), false, `"${plain}" must not be stored readable`);
  }
  assert.match(row.payload_enc, /^v1:[A-Za-z0-9+/=]+$/);
  const ctx = { shop: SHOP, scope: 'store', phoneHash: row.phone_hash };
  assert.equal(sa.decryptAddress(row.payload_enc, ctx).address1, '12, MG Road');
  assert.equal(sa.decryptAddress(row.payload_enc, { ...ctx, shop: 'other.myshopify.com' }), null, 'a row moved to another shop does not decrypt');
  assert.equal(sa.decryptAddress(row.payload_enc.slice(0, -4) + 'AAAA', ctx), null, 'a changed row does not decrypt');

  assert.deepEqual((await sa.findAddresses(db, SHOP, '+919876543210')).map((a) => a.city), ['Chennai']);
  assert.deepEqual(await sa.findAddresses(db, 'other.myshopify.com', '9876543210'), [], 'store addresses stay in their store');
  assert.deepEqual(await sa.findAddresses(db, SHOP, '9000000000'), []);
});

test('one row per place; a retried webhook does not count twice; newest 3 per phone', async () => {
  sa.resetSavedAddressState();
  const db = fakeDb();
  const day = (n) => new Date(Date.UTC(2026, 10, n));
  await sa.saveAddressFromOrder(db, SHOP, order(), { now: day(1) });
  await sa.saveAddressFromOrder(db, SHOP, order(), { now: day(1) }); // Shopify retry
  await sa.saveAddressFromOrder(db, SHOP, order({ id: 5002, shipping_address: { ...order().shipping_address, address1: '12 mg road', zip: '600001' } }), { now: day(2) });
  assert.equal(db.rows.length, 1, 'same place, typed differently');
  assert.equal(db.rows[0].orders_count, 2);
  for (const [n, city] of [[3, 'Madurai'], [4, 'Salem'], [5, 'Trichy']]) {
    await sa.saveAddressFromOrder(db, SHOP, order({ id: 6000 + n, shipping_address: { ...order().shipping_address, address1: `${n} Main St`, city } }), { now: day(n) });
  }
  assert.deepEqual((await sa.findAddresses(db, SHOP, '9876543210')).map((a) => a.city), ['Trichy', 'Salem', 'Madurai'], 'the oldest (Chennai) was dropped');
  assert.equal(db.rows.length, 3);
});

test('customers/redact and shop/redact delete them', async () => {
  sa.resetSavedAddressState();
  const db = fakeDb();
  await sa.saveAddressFromOrder(db, SHOP, order());
  await sa.saveAddressFromOrder(db, SHOP, order({ id: 9, customer: { id: 88 }, email: 'ravi@example.com', shipping_address: { ...order().shipping_address, first_name: 'Ravi', phone: '9123456780' } }));
  await sa.saveAddressFromOrder(db, 'other.myshopify.com', order());
  assert.equal(db.rows.length, 3);
  assert.equal(await sa.deleteForCustomer(db, SHOP, { customerId: 77 }), 1, 'by customer id');
  assert.equal(await sa.deleteForCustomer(db, SHOP, { email: 'RAVI@example.com' }), 1, 'by email');
  assert.equal(db.rows.length, 1, 'the other store keeps its own');
  await sa.saveAddressFromOrder(db, SHOP, order({ id: 42, customer: null, email: '' }));
  assert.equal(await sa.deleteForCustomer(db, SHOP, { orderIds: [42] }), 1, 'by order id');
  assert.equal(await sa.deleteForCustomer(db, SHOP, {}), 0, 'nothing to match = nothing deleted');
  assert.equal(await sa.deleteForShop(db, 'other.myshopify.com'), 1);
  assert.equal(db.rows.length, 0);
});

test('expired rows are purged; no key = nothing collected', async () => {
  sa.resetSavedAddressState();
  const db = fakeDb();
  await sa.saveAddressFromOrder(db, SHOP, order(), { now: new Date(Date.UTC(2024, 0, 1)) });
  sa.resetSavedAddressState(); // lets the purge run again
  await sa.saveAddressFromOrder(db, SHOP, order({ id: 2, shipping_address: { ...order().shipping_address, phone: '9123456780' } }), { now: new Date(Date.UTC(2026, 0, 1)) });
  assert.equal(db.rows.length, 1, 'the 2024 address expired after a year');

  const saved = process.env.CUSTOMER_DATA_KEY;
  try {
    for (const bad of ['', 'short', crypto.randomBytes(16).toString('base64')]) {
      process.env.CUSTOMER_DATA_KEY = bad;
      sa.resetSavedAddressState();
      const empty = fakeDb();
      assert.equal(await sa.saveAddressFromOrder(empty, SHOP, order()), 'disabled');
      assert.equal(empty.log.length, 0, 'no table, no rows');
    }
    process.env.CUSTOMER_DATA_KEY = crypto.randomBytes(32).toString('hex');
    sa.resetSavedAddressState();
    assert.equal(sa.savedAddressesEnabled(), true, 'a hex key works too');
  } finally {
    process.env.CUSTOMER_DATA_KEY = saved;
    sa.resetSavedAddressState();
  }
});

test('COD popup autofill: the phone\'s saved addresses in the popup\'s shape, this store only, never in the way', async () => {
  sa.resetSavedAddressState();
  const db = fakeDb();
  await sa.saveAddressFromOrder(db, SHOP, order({ id: 1 }), { now: new Date('2026-11-01T10:00:00Z') });
  await sa.saveAddressFromOrder(db, SHOP, order({ id: 2, shipping_address: { ...order().shipping_address, address1: '5, Anna Salai', address2: '', zip: '600002' } }), { now: new Date('2026-11-10T10:00:00Z') });
  await sa.saveAddressFromOrder(db, 'other.myshopify.com', order({ id: 3, shipping_address: { ...order().shipping_address, address1: 'Other store road' } }));

  const list = await sa.savedAddressesForShopper(db, SHOP, '+91 98765 43210');
  assert.deepEqual(list, [
    { name: 'Asha Rao', address1: '5, Anna Salai', address2: '', city: 'Chennai', state: 'Tamil Nadu', pincode: '600002', email: 'asha@example.com' },
    { name: 'Asha Rao', address1: '12, MG Road', address2: 'Flat 4B', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001', email: 'asha@example.com' },
  ], 'newest first, popup field names');
  assert.ok(!list.some((a) => a.address1 === 'Other store road'), "another store's addresses never show");
  assert.deepEqual(await sa.savedAddressesForShopper(db, SHOP, '9123456780'), [], 'another phone gets nothing');

  // A slow or broken database never holds the OTP step up: the shopper types the address.
  const slow = { execute: () => new Promise(() => {}) };
  const t0 = Date.now();
  assert.deepEqual(await sa.savedAddressesForShopper(slow, SHOP, '9876543210', { timeoutMs: 50 }), []);
  assert.ok(Date.now() - t0 < 1000);
  const broken = { execute: async () => { throw new Error('db down'); } };
  sa.resetSavedAddressState();
  assert.deepEqual(await sa.savedAddressesForShopper(broken, SHOP, '9876543210'), []);
  // No key on the server = nothing.
  const key = process.env.CUSTOMER_DATA_KEY;
  delete process.env.CUSTOMER_DATA_KEY;
  sa.resetSavedAddressState();
  try {
    assert.deepEqual(await sa.savedAddressesForShopper(db, SHOP, '9876543210'), []);
  } finally {
    process.env.CUSTOMER_DATA_KEY = key;
    sa.resetSavedAddressState();
  }
  assert.equal(sa.addressForPopup({ address1: 'x', zip: '12' }), null, 'no PIN code = not offered');
});

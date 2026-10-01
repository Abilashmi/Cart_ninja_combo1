/* eslint-env node */
/* global globalThis */
// Run with: node --import ./tests/packs/register.mjs --test tests/cod
// Exercises app/services/cod.server.js WITHOUT touching any real database,
// SMS provider or Shopify store: global fetch is replaced by an in-memory
// emulation of php_backend/db_proxy.php, OTPs go to the dev log, and Admin
// API calls go to a fake `admin` object that records every operation.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SHOPIFY_API_SECRET = 'test-secret';
process.env.SHOPIFY_API_KEY = 'test-key';
process.env.COD_OTP_DEV_LOG = '1';
delete process.env.MSG91_AUTH_KEY;

const realFetch = globalThis.fetch;
const SHOP = 'demo.myshopify.com';

/* ── fake db_proxy ─────────────────────────────────────────────────────────── */
let db;
let clock; // ms, drives NOW() inside the fake DB
function resetDb() {
  db = { settings: new Map(), otp: [], orders: [], nextId: 1 };
  clock = Date.UTC(2026, 9, 1, 10, 0, 0);
}
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, init) => {
  if (!String(url).endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql, params: p } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  const rows = (r) => respond({ success: true, rows: r });
  const write = (affectedRows = 1, insertId = 0) => respond({ success: true, affectedRows, insertId });

  if (q.startsWith('CREATE TABLE')) return write(0);
  if (q.startsWith('SELECT settings_json FROM cod_settings')) {
    return rows(db.settings.has(p[0]) ? [{ settings_json: db.settings.get(p[0]) }] : []);
  }
  if (q.startsWith('INSERT INTO cod_settings')) { db.settings.set(p[0], p[1]); return write(); }

  if (q.includes('FROM cod_otp WHERE shop = ? AND phone_hash = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)')) {
    const recent = db.otp.filter((o) => o.shop === p[1] && o.phone_hash === p[2] && clock - o.created < 3600e3);
    const tooSoon = recent.some((o) => (clock - o.created) / 1000 < p[0]);
    return rows([{ sends: recent.length, too_soon: recent.length ? (tooSoon ? 1 : 0) : null }]);
  }
  if (q.startsWith('INSERT INTO cod_otp')) {
    const id = db.nextId++;
    db.otp.push({ id, shop: p[0], phone_hash: p[1], code_hash: p[2], attempts: 0, verified: 0, created: clock, expires: clock + 10 * 60e3 });
    return write(1, id);
  }
  if (q.startsWith('DELETE FROM cod_otp WHERE id = ?')) { db.otp = db.otp.filter((o) => o.id !== p[0]); return write(); }
  if (q.startsWith('SELECT id, code_hash, attempts FROM cod_otp')) {
    const r = db.otp.filter((o) => o.shop === p[0] && o.phone_hash === p[1] && !o.verified && o.expires > clock).sort((a, b) => b.id - a.id);
    return rows(r.slice(0, 1));
  }
  if (q.startsWith('UPDATE cod_otp SET attempts')) { db.otp.find((o) => o.id === p[0]).attempts++; return write(); }
  if (q.startsWith('UPDATE cod_otp SET verified')) { db.otp.find((o) => o.id === p[0]).verified = 1; return write(); }

  if (q.startsWith('SELECT status, order_name, order_id, total, currency FROM cod_orders')) {
    return rows(db.orders.filter((o) => o.shop === p[0] && o.idem_key === p[1]));
  }
  if (q.startsWith('SELECT COUNT(*) AS n FROM cod_orders')) {
    return rows([{ n: db.orders.filter((o) => o.shop === p[0] && o.phone_hash === p[1] && o.status === 'placed' && clock - o.created < 86400e3).length }]);
  }
  if (q.startsWith('INSERT INTO cod_orders')) {
    if (db.orders.some((o) => o.shop === p[0] && o.idem_key === p[1])) {
      return respond({ success: false, error: "SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry 'x' for key 'uniq_cod_orders_idem'" }, 500);
    }
    db.orders.push({ id: db.nextId++, shop: p[0], idem_key: p[1], status: 'creating', source: p[2], phone_hash: p[3], phone_masked: p[4], phone_verified: p[5], customer_name: p[6], pincode: p[7], total: p[8], currency: p[9], created: clock });
    return write();
  }
  if (q.startsWith("DELETE FROM cod_orders WHERE shop = ? AND idem_key = ? AND status = 'creating'")) {
    db.orders = db.orders.filter((o) => !(o.shop === p[0] && o.idem_key === p[1] && o.status === 'creating'));
    return write();
  }
  if (q.startsWith("UPDATE cod_orders SET status = 'placed'")) {
    const o = db.orders.find((r) => r.shop === p[5] && r.idem_key === p[6]);
    Object.assign(o, { status: 'placed', draft_order_id: p[0], order_id: p[1], order_name: p[2], total: p[3], currency: p[4] });
    return write();
  }
  if (q.startsWith('SELECT order_id, order_name, source')) {
    return rows(db.orders.filter((o) => o.shop === p[0] && o.status === 'placed').reverse().map((o) => ({ ...o, created_at: '2026-10-01 10:00:00' })));
  }
  return respond({ success: false, error: `fake db: unhandled SQL: ${q.slice(0, 120)}` }, 500);
};

/* ── fake Shopify admin ────────────────────────────────────────────────────── */
function fakeAdmin(opts = {}) {
  const calls = [];
  const variants = opts.variants || {
    'gid://shopify/ProductVariant/11': { price: 899, title: 'Cold Brew Kit', tags: ['coffee'] },
    'gid://shopify/ProductVariant/12': { price: 899, title: 'Steel Tumbler', tags: [] },
  };
  let orderNo = 1047;
  const admin = {
    calls,
    async graphql(query, { variables } = {}) {
      const op = /(query|mutation)\s+(\w+)/.exec(query)[2];
      calls.push({ op, variables });
      const money = (amount) => ({ shopMoney: { amount: String(amount), currencyCode: 'INR' } });
      let data;
      if (op === 'CodVariants') {
        data = { nodes: variables.ids.map((id) => (variants[id] ? {
          id, availableForSale: variants[id].soldOut !== true,
          product: { id: 'gid://shopify/Product/1', title: variants[id].title, tags: variants[id].tags, status: 'ACTIVE' },
        } : null)) };
      } else if (op === 'CodCalculate') {
        const input = variables.input;
        const items = input.lineItems.reduce((sum, li) => sum + variants[li.variantId].price * li.quantity, 0);
        const discount = (input.discountCodes || []).includes('SAVE10') ? Math.round(items * 0.1) : 0;
        const shipping = Number(input.shippingLine?.priceWithCurrency?.amount || 0);
        data = { draftOrderCalculate: { userErrors: [], calculatedDraftOrder: {
          currencyCode: 'INR', taxesIncluded: true, discountCodes: input.discountCodes || [],
          lineItems: input.lineItems.map((li) => ({ name: variants[li.variantId].title, title: variants[li.variantId].title, variantTitle: 'Default Title', quantity: li.quantity, image: null,
            originalTotalSet: money(variants[li.variantId].price * li.quantity), discountedTotalSet: money(variants[li.variantId].price * li.quantity) })),
          lineItemsSubtotalPrice: money(items), subtotalPriceSet: money(items - discount), totalDiscountsSet: money(discount),
          totalShippingPriceSet: money(shipping), totalTaxSet: money(0), totalPriceSet: money(items - discount + shipping),
        } } };
      } else if (op === 'CodCreate') {
        if (opts.rejectProvince && variables.input.shippingAddress.provinceCode) {
          data = { draftOrderCreate: { draftOrder: null, userErrors: [{ field: ['shippingAddress', 'provinceCode'], message: 'Province is invalid' }] } };
        } else {
          data = { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/9', ready: opts.notReadyAtFirst !== true }, userErrors: [] } };
        }
      } else if (op === 'CodDraftReady') {
        data = { draftOrder: { ready: true } };
      } else if (op === 'CodComplete') {
        if (opts.failComplete) data = { draftOrderComplete: { draftOrder: null, userErrors: [{ field: null, message: 'Inventory unavailable' }] } };
        else {
          const created = calls.filter((c) => c.op === 'CodCalculate').pop();
          const total = created ? Number(created.variables.input.lineItems.reduce((s, li) => s + variants[li.variantId].price * li.quantity, 0)) + Number(created.variables.input.shippingLine?.priceWithCurrency?.amount || 0) : 0;
          data = { draftOrderComplete: { userErrors: [], draftOrder: { order: { id: `gid://shopify/Order/${orderNo}`, name: `#${orderNo++}`, statusPageUrl: 'https://demo.myshopify.com/status', totalPriceSet: money(total) } } } };
        }
      } else if (op === 'CodDraftDelete') {
        data = { draftOrderDelete: { deletedId: variables.input.id } };
      } else if (op === 'CodOrders') {
        data = { nodes: variables.ids.map((id) => ({ id, displayFinancialStatus: 'PENDING', displayFulfillmentStatus: 'UNFULFILLED', cancelledAt: null })) };
      } else {
        throw new Error(`fake admin: unhandled op ${op}`);
      }
      return new Response(JSON.stringify({ data }));
    },
  };
  return admin;
}

const cod = await import('../../app/services/cod.server.js');
const { sanitizeCodSettings } = await import('../../app/utils/cod.shared.js');

const address = { name: 'Ananya Rao', address1: '14, 3rd Cross, Indiranagar', address2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001', email: '' };
const lines = [{ variantId: '11', quantity: 1, properties: { Engraving: 'AR', _brixInternal: 'x' } }, { variantId: '12', quantity: 1, properties: {} }];
const settingsOn = (patch = {}) => sanitizeCodSettings({ enabled: true, codFee: 49, ...patch });
const place = (admin, extra = {}) => cod.placeCodOrder(admin, {
  shop: SHOP, settings: settingsOn(), lines, coupon: null, address, phone: '9876543210', phoneVerified: true,
  surface: 'drawer', attributes: {}, idemKey: 'idem-key-0001', currencyCode: 'INR', ...extra,
});

beforeEach(resetDb);

test('settings: save merges onto what is stored', async () => {
  await cod.saveCodSettings(SHOP, { enabled: true, codFee: 49, minOrder: 299 });
  const next = await cod.saveCodSettings(SHOP, { maxOrder: 5000 });
  assert.equal(next.enabled, true);
  assert.equal(next.codFee, 49);
  assert.equal(next.minOrder, 299);
  assert.equal(next.maxOrder, 5000);
  assert.deepEqual(await cod.getCodSettings(SHOP), next);
  assert.equal((await cod.getCodSettings('other.myshopify.com')).enabled, false);
});

test('OTP: send, wrong code counts an attempt, right code returns a token bound to shop + phone', async () => {
  const logs = [];
  const realLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try { await cod.sendCodOtp(SHOP, '9876543210'); } finally { console.log = realLog; }
  const code = /DEV OTP for \+919876543210: (\d{4})/.exec(logs.join('\n'))[1];
  const wrong = code === '0000' ? '1111' : '0000';

  await assert.rejects(cod.verifyCodOtp(SHOP, '9876543210', wrong), (e) => e.code === 'otp_wrong' && /4 tries left/.test(e.message));
  const { token } = await cod.verifyCodOtp(SHOP, '9876543210', code);
  assert.equal(cod.readPhoneToken(SHOP, token), '9876543210');
  assert.equal(cod.readPhoneToken('other.myshopify.com', token), null);
  assert.equal(cod.readPhoneToken(SHOP, token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))), null);
  assert.equal(cod.readPhoneToken(SHOP, token, Date.now() + 31 * 60e3), null, 'expires after 30 minutes');
  // a used code can't be verified twice
  await assert.rejects(cod.verifyCodOtp(SHOP, '9876543210', code), (e) => e.code === 'otp_expired');
});

test('OTP: resend is throttled to one per 30 seconds and five per hour', async () => {
  const realLog = console.log;
  console.log = () => {};
  try {
    await cod.sendCodOtp(SHOP, '9876543210');
    await assert.rejects(cod.sendCodOtp(SHOP, '9876543210'), (e) => e.code === 'otp_too_soon');
    for (let i = 0; i < 4; i++) { clock += 31e3; await cod.sendCodOtp(SHOP, '9876543210'); }
    clock += 31e3;
    await assert.rejects(cod.sendCodOtp(SHOP, '9876543210'), (e) => e.code === 'otp_limit');
  } finally { console.log = realLog; }
});

test('OTP: five wrong tries lock the code', async () => {
  const logs = [];
  const realLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try { await cod.sendCodOtp(SHOP, '9876543210'); } finally { console.log = realLog; }
  const code = /: (\d{4})$/.exec(logs[0])[1];
  const wrong = code === '9999' ? '1111' : '9999';
  for (let i = 0; i < 5; i++) await assert.rejects(cod.verifyCodOtp(SHOP, '9876543210', wrong), (e) => e.code === 'otp_wrong');
  await assert.rejects(cod.verifyCodOtp(SHOP, '9876543210', code), (e) => e.code === 'otp_locked', 'even the right code is refused once locked');
});

test('quote: priced by Shopify, COD fee added as the shipping line, rules applied to the real subtotal', async () => {
  const admin = fakeAdmin();
  const { quote, input } = await cod.quoteCod(admin, { settings: settingsOn({ shippingFee: 60, freeShippingAbove: 1500 }), lines, pincode: '560001', surface: 'drawer' });
  assert.equal(quote.itemsTotal, 1798);
  assert.equal(quote.shipping, 0, 'free shipping above 1500');
  assert.equal(quote.codFee, 49);
  assert.equal(quote.total, 1847);
  assert.equal(input.shippingLine.priceWithCurrency.amount, '49.00');
  assert.equal(input.shippingLine.priceWithCurrency.currencyCode, 'INR');
  assert.deepEqual(input.lineItems[0].customAttributes, [{ key: 'Engraving', value: 'AR' }], '_brix* properties are dropped');

  await assert.rejects(
    cod.quoteCod(fakeAdmin(), { settings: settingsOn({ minOrder: 2000 }), lines, surface: 'drawer' }),
    (e) => e.code === 'below_min' && /₹2,000/.test(e.message),
  );
  await assert.rejects(
    cod.quoteCod(fakeAdmin(), { settings: settingsOn({ blockedPincodes: ['560001'] }), lines, pincode: '560001', surface: 'drawer' }),
    (e) => e.code === 'pincode_blocked',
  );
  await assert.rejects(
    cod.quoteCod(fakeAdmin(), { settings: settingsOn({ excludedProductTags: ['coffee'] }), lines, surface: 'drawer' }),
    (e) => e.code === 'product_excluded',
  );
});

test('quote: Pack / free-gift lines and sold-out items are refused', async () => {
  await assert.rejects(
    cod.quoteCod(fakeAdmin(), { settings: settingsOn(), lines: [{ variantId: '11', quantity: 2, properties: { _brix_pack_id: '3' } }], surface: 'drawer' }),
    (e) => e.code === 'checkout_only',
  );
  const admin = fakeAdmin({ variants: { 'gid://shopify/ProductVariant/11': { price: 899, title: 'Kit', tags: [], soldOut: true } } });
  await assert.rejects(
    cod.quoteCod(admin, { settings: settingsOn(), lines: [{ variantId: '11', quantity: 1, properties: {} }], surface: 'drawer' }),
    (e) => e.code === 'item_sold_out' && /Kit is sold out/.test(e.message),
  );
});

test('quote: a valid coupon is applied, an unusable one is left off the order', async () => {
  const good = await cod.quoteCod(fakeAdmin(), { settings: settingsOn(), lines, coupon: 'SAVE10', surface: 'drawer' });
  assert.deepEqual(good.quote.coupon, { code: 'SAVE10', applied: true });
  assert.equal(good.quote.discounts, 180);
  assert.deepEqual(good.input.discountCodes, ['SAVE10']);

  const bad = await cod.quoteCod(fakeAdmin(), { settings: settingsOn(), lines, coupon: 'NOPE', surface: 'drawer' });
  assert.deepEqual(bad.quote.coupon, { code: 'NOPE', applied: false });
  assert.equal(bad.input.discountCodes, undefined);

  const off = await cod.quoteCod(fakeAdmin(), { settings: settingsOn({ allowCoupons: false }), lines, coupon: 'SAVE10', surface: 'drawer' });
  assert.equal(off.quote.coupon, null);
});

test('order: creates a payment-pending Shopify order tagged COD with the address and note', async () => {
  const admin = fakeAdmin();
  const order = await place(admin, { attributes: { combo_source: 'ComboForge', 'bad key!': 'x' }, surface: 'combo' });
  assert.equal(order.orderName, '#1047');
  assert.equal(order.total, 1847);

  const create = admin.calls.find((c) => c.op === 'CodCreate').variables.input;
  assert.deepEqual(create.tags, ['COD', 'BRIX-COD', 'brix-src-combo']);
  assert.equal(create.shippingAddress.provinceCode, 'KA');
  assert.equal(create.shippingAddress.countryCode, 'IN');
  assert.equal(create.shippingAddress.phone, '+919876543210');
  assert.equal(create.phone, '+919876543210');
  assert.match(create.note, /combo page/);
  assert.match(create.note, /Phone verified by OTP/);
  assert.ok(create.customAttributes.some((a) => a.key === 'combo_source' && a.value === 'ComboForge'));
  assert.ok(!create.customAttributes.some((a) => a.key === 'bad key!'));
  assert.ok(admin.calls.some((c) => c.op === 'CodComplete' && c.variables.id === 'gid://shopify/DraftOrder/9'));

  const row = db.orders[0];
  assert.equal(row.status, 'placed');
  assert.equal(row.order_name, '#1047');
  assert.equal(row.phone_masked, '98XXXX3210');
  assert.notEqual(row.phone_hash, '9876543210', 'phone is stored hashed');
});

test('order: a repeated tap with the same key returns the first order, never a second one', async () => {
  const admin = fakeAdmin();
  const first = await place(admin);
  const again = await place(admin);
  assert.equal(again.orderName, first.orderName);
  assert.equal(again.repeated, true);
  assert.equal(admin.calls.filter((c) => c.op === 'CodComplete').length, 1);
});

test('order: daily per-phone limit', async () => {
  const admin = fakeAdmin();
  const settings = settingsOn({ dailyLimitPerPhone: 1 });
  await place(admin, { settings, idemKey: 'idem-key-a001' });
  await assert.rejects(place(admin, { settings, idemKey: 'idem-key-a002' }), (e) => e.code === 'daily_limit');
  clock += 86400e3 + 1000;
  await place(admin, { settings, idemKey: 'idem-key-a003' });
});

test('order: when Shopify refuses to complete, the draft is deleted and the shopper can retry', async () => {
  const admin = fakeAdmin({ failComplete: true });
  await assert.rejects(place(admin), (e) => e.code === 'order_rejected' && /Inventory unavailable/.test(e.message));
  assert.ok(admin.calls.some((c) => c.op === 'CodDraftDelete'));
  assert.equal(db.orders.length, 0);
  const order = await place(fakeAdmin());
  assert.equal(order.orderName, '#1047');
});

test('order: an unknown province code is retried with the state in the city line', async () => {
  const admin = fakeAdmin({ rejectProvince: true, notReadyAtFirst: true });
  await place(admin);
  const creates = admin.calls.filter((c) => c.op === 'CodCreate');
  assert.equal(creates.length, 2);
  assert.equal(creates[1].variables.input.shippingAddress.provinceCode, undefined);
  assert.equal(creates[1].variables.input.shippingAddress.city, 'Bengaluru, Karnataka');
  assert.ok(admin.calls.some((c) => c.op === 'CodDraftReady'), 'waits for the draft to be ready');
});

test('admin list reads live payment status and summarizes', async () => {
  await place(fakeAdmin());
  const orders = await cod.listCodOrders(fakeAdmin(), SHOP);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, 'pending');
  assert.equal(orders[0].orderNumericId, '1047');
  assert.deepEqual(cod.summarizeCodOrders(orders), { count: 1, toCollect: 1847, collected: 0, paidCount: 0, cancelledCount: 0, cancelRate: 0 });
});

test('rate limiter', () => {
  const t = 1_000_000;
  assert.equal(cod.rateLimit('k', 2, 1000, t), true);
  assert.equal(cod.rateLimit('k', 2, 1000, t + 1), true);
  assert.equal(cod.rateLimit('k', 2, 1000, t + 2), false);
  assert.equal(cod.rateLimit('k', 2, 1000, t + 1001), true);
});

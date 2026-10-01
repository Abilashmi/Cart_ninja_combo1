/* eslint-env node */
/* global globalThis */
// Run with: node --import ./tests/packs/register.mjs --test tests/cod
// Exercises app/services/cod.server.js against the REAL php_backend/cod_*.php
// files on a throwaway MariaDB (see php-harness.mjs: XAMPP binaries, a fresh
// data folder in the temp dir, its own port). OTPs go to the dev log and
// Admin API calls go to a fake `admin` object that records every operation.
// Nothing touches the shared production database, an SMS provider or a store.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { harnessAvailable, startHarness } from './php-harness.mjs';

if (!harnessAvailable()) {
  console.log('SKIP cod-server tests: XAMPP PHP / MariaDB binaries not found (set XAMPP_DIR).');
  process.exit(0);
}

const harness = await startHarness();
process.env.PHP_BASE_URL = harness.baseUrl;
process.env.SHOPIFY_API_KEY = harness.secret;
process.env.SHOPIFY_API_SECRET = 'test-secret';
process.env.COD_OTP_DEV_LOG = '1';
delete process.env.MSG91_AUTH_KEY;

const SHOP = 'demo.myshopify.com';
const sql = (q, p = []) => harness.db.query(q, p).then(([rows]) => rows);
// "Time travel": age stored rows instead of waiting in real time.
const ageOtp = (seconds) => sql(`UPDATE cod_otp SET created_at = created_at - INTERVAL ${seconds} SECOND`);
const ageOrders = (hours) => sql(`UPDATE cod_orders SET created_at = created_at - INTERVAL ${hours} HOUR`);
const orderRows = () => sql('SELECT * FROM cod_orders ORDER BY id');

async function resetDb() {
  for (const t of ['cod_settings', 'cod_otp', 'cod_orders']) await sql(`DELETE FROM ${t}`).catch(() => {});
}
after(() => harness.stop());

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
    for (let i = 0; i < 4; i++) { await ageOtp(31); await cod.sendCodOtp(SHOP, '9876543210'); }
    await ageOtp(31);
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
  for (let i = 0; i < 4; i++) await assert.rejects(cod.verifyCodOtp(SHOP, '9876543210', wrong), (e) => e.code === 'otp_wrong');
  await assert.rejects(cod.verifyCodOtp(SHOP, '9876543210', wrong), (e) => e.code === 'otp_locked', 'the fifth wrong try locks it');
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

  const [row] = await orderRows();
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
  await ageOrders(25);
  await place(admin, { settings, idemKey: 'idem-key-a003' });
});

test('order: when Shopify refuses to complete, the draft is deleted and the shopper can retry', async () => {
  const admin = fakeAdmin({ failComplete: true });
  await assert.rejects(place(admin), (e) => e.code === 'order_rejected' && /Inventory unavailable/.test(e.message));
  assert.ok(admin.calls.some((c) => c.op === 'CodDraftDelete'));
  assert.equal((await orderRows()).length, 0);
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

/* ── the PHP endpoints themselves ───────────────────────────────────────────── */

const callPhp = (file, body, secret = harness.secret) => fetch(`${harness.baseUrl}/${file}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forge-Secret': secret },
  body: JSON.stringify(body),
}).then(async (res) => ({ status: res.status, json: await res.json() }));

test('PHP: every COD endpoint refuses calls without the Forge secret', async () => {
  for (const file of ['cod_settings.php', 'cod_otp.php', 'cod_orders.php']) {
    const res = await callPhp(file, { action: 'get', shop: SHOP }, 'wrong');
    assert.equal(res.status, 403, file);
  }
});

test('PHP: rejects bad shops, non-hash phones, unknown actions and bad sources', async () => {
  assert.equal((await callPhp('cod_settings.php', { action: 'get', shop: 'evil.com' })).json.code, 'invalid_shop');
  assert.equal((await callPhp('cod_otp.php', { action: 'create', shop: SHOP, phone_hash: '9876543210', code_hash: 'a'.repeat(64) })).json.code, 'invalid_phone_hash');
  assert.equal((await callPhp('cod_orders.php', { action: 'drop_table', shop: SHOP })).json.code, 'invalid_action');
  assert.equal((await callPhp('cod_orders.php', { action: 'begin', shop: SHOP, idem_key: 'idem-key-x001', source: 'admin', phone_hash: 'a'.repeat(64) })).json.code, 'invalid_source');
});

test('PHP: tables hold only hashes, never the raw phone number or OTP code', async () => {
  const logs = [];
  const realLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try { await cod.sendCodOtp(SHOP, '9876543210'); } finally { console.log = realLog; }
  const code = /: (\d{4})$/.exec(logs[0])[1];
  await place(fakeAdmin());
  const dump = JSON.stringify([...(await sql('SELECT * FROM cod_otp')), ...(await orderRows())]);
  assert.ok(!dump.includes('9876543210'), 'raw phone stored');
  assert.ok(!new RegExp(`"${code}"`).test(dump), 'raw OTP stored');
});

test('PHP: settings round-trip through cod_settings.php', async () => {
  await cod.saveCodSettings(SHOP, { enabled: true, blockedPincodes: '744101', buttons: { drawerText: 'Pay cash on delivery' } });
  const [row] = await sql('SELECT settings_json FROM cod_settings WHERE shop = ?', [SHOP]);
  const stored = JSON.parse(row.settings_json);
  assert.equal(stored.enabled, true);
  assert.deepEqual(stored.blockedPincodes, ['744101']);
  assert.equal(stored.buttons.drawerText, 'Pay cash on delivery');
});

/* ── storefront reads: php_backend/cod_storefront.php ───────────────────────── */

const storefront = (query) => fetch(`${harness.baseUrl}/cod_storefront.php?${query}`)
  .then(async (res) => ({ status: res.status, cors: res.headers.get('access-control-allow-origin'), json: await res.json() }));
const setPlan = (plan) => sql('REPLACE INTO shops (shop_domain, plan_name, plan_key) VALUES (?, ?, ?)', [SHOP, plan, plan])
  .catch(() => sql('REPLACE INTO shops (shop_domain, plan_name) VALUES (?, ?)', [SHOP, plan]));

test('storefront config: off until COD is on AND the plan publishes it', async () => {
  assert.deepEqual((await storefront(`action=config&shop=${SHOP}`)).json, { success: true, enabled: false }, 'no settings yet');
  await cod.saveCodSettings(SHOP, { enabled: true });
  await setPlan('free');
  assert.equal((await storefront(`action=config&shop=${SHOP}`)).json.enabled, false, 'Free plan = preview only');
  await sql('UPDATE shops SET plan_key = ? WHERE shop_domain = ?', ['starter', SHOP]);
  const res = await storefront(`action=config&shop=${SHOP}`);
  assert.equal(res.cors, '*');
  assert.equal(res.json.enabled, true);
});

test('storefront config: returns display settings only, OTP only when Node has SMS', async () => {
  await setPlan('pro');
  await sql('UPDATE shops SET plan_key = ? WHERE shop_domain = ?', ['pro', SHOP]);
  await cod.saveCodSettings(SHOP, {
    enabled: true, codFee: 49, minOrder: 299, blockedPincodes: '744101', requireOtp: true,
    surfaces: { combo: false }, buttons: { drawerText: 'Pay cash on delivery', bg: '#0d6b4c' },
  });
  const { json } = await storefront(`action=config&shop=${SHOP}`);
  assert.equal(json.codFee, 49);
  assert.equal(json.minOrder, 299);
  assert.deepEqual(json.blockedPincodes, ['744101']);
  assert.deepEqual(json.surfaces, { drawer: true, product: true, combo: false });
  assert.equal(json.buttons.drawerText, 'Pay cash on delivery');
  assert.equal(json.otpRequired, true, 'COD_OTP_DEV_LOG counts as an SMS provider in tests');
  assert.equal('_runtime' in json, false);
  assert.equal('orderTags' in json, false, 'merchant-only fields are not exposed');

  process.env.COD_OTP_DEV_LOG = '0';
  try {
    await cod.syncCodRuntime(SHOP);
    assert.equal((await storefront(`action=config&shop=${SHOP}`)).json.otpRequired, false, 'no SMS provider → no OTP step');
  } finally {
    process.env.COD_OTP_DEV_LOG = '1';
    await cod.syncCodRuntime(SHOP);
  }
});

test('storefront pincode: validates, reports blocked PINs', async () => {
  await cod.saveCodSettings(SHOP, { enabled: true, blockedPincodes: '744101' });
  assert.equal((await storefront(`action=pincode&shop=${SHOP}&pin=12345`)).json.code, 'invalid_pincode');
  const blocked = (await storefront(`action=pincode&shop=${SHOP}&pin=744101`)).json;
  assert.equal(blocked.success, true);
  assert.equal(blocked.blocked, true);
  assert.equal((await storefront(`action=pincode&shop=${SHOP}&pin=560001`)).json.blocked, false);
  assert.equal((await storefront('action=config&shop=evil.com')).json.code, 'invalid_shop');
});

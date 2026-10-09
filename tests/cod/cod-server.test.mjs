/* eslint-env node */
// Run with: node --import ./tests/packs/register.mjs --test tests/cod
// Exercises app/services/cod.server.js against the REAL php_backend/cod_*.php
// files on a throwaway MariaDB (see php-harness.mjs: XAMPP binaries, a fresh
// data folder in the temp dir, its own port). OTPs go to the dev log and
// Admin API calls go to a fake `admin` object that records every operation.
// Nothing touches the shared production database, an SMS provider or a store.
import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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
// GA4 / Meta server-side events go to the harness's fake app server.
process.env.COD_GA4_MP_URL = harness.appUrl;
process.env.COD_META_GRAPH_URL = harness.appUrl;

const SHOP = 'demo.myshopify.com';
const sql = (q, p = []) => harness.db.query(q, p).then(([rows]) => rows);
// "Time travel": age stored rows instead of waiting in real time.
const ageOtp = (seconds) => sql(`UPDATE cod_otp SET created_at = created_at - INTERVAL ${seconds} SECOND`);
const ageOrders = (hours) => sql(`UPDATE cod_orders SET created_at = created_at - INTERVAL ${hours} HOUR`);
const orderRows = () => sql('SELECT * FROM cod_orders ORDER BY id');

async function resetDb() {
  for (const t of ['cod_settings', 'cod_otp', 'cod_orders', 'cod_secrets']) await sql(`DELETE FROM ${t}`).catch(() => {});
}
after(() => harness.stop());

/* ── fake Shopify admin ────────────────────────────────────────────────────── */
// The trusted config the combo weight Function reads (combo-weight-shopify.server.js).
const COMBO_CONFIG = { version: 1, currency: 'INR', templates: { 12: {
  id: 12, hash: 'h1', unit: 'kg', max_grams: 2200, product_ids: [], collection_ids: ['900'],
  tiers: [
    { min_grams: 1000, type: 'percentage', value: 10, label: '1 kg box: 10% off' },
    { min_grams: 2000, type: 'fixed_price', value: 1700, label: '2 kg box for ₹1700' },
  ],
} } };
const BOOKS = {
  'gid://shopify/ProductVariant/21': { price: 110, title: 'Novel', tags: [], grams: 300, collections: ['gid://shopify/Collection/900'] },
  'gid://shopify/ProductVariant/22': { price: 120, title: 'Atlas', tags: [], grams: 450, collections: ['gid://shopify/Collection/900'] },
  'gid://shopify/ProductVariant/23': { price: 100, title: 'Poster', tags: [], grams: null, collections: ['gid://shopify/Collection/900'] },
  'gid://shopify/ProductVariant/24': { price: 900, title: 'Lamp', tags: [], grams: 2000, collections: ['gid://shopify/Collection/5'] },
  'gid://shopify/ProductVariant/25': { price: 1000, title: 'Box set', tags: [], grams: 500, collections: ['gid://shopify/Collection/900'] },
};

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
        // A FIXED_AMOUNT line discount, read the way opts.lineDiscountPer says
        // Shopify reads it ('unit' by default; 'line'; or 'none' = ignored).
        const round2 = (n) => Math.round(n * 100) / 100;
        const priced = input.lineItems.map((li) => {
          const original = variants[li.variantId].price * li.quantity;
          const d = li.appliedDiscount;
          const per = opts.lineDiscountPer || 'unit';
          const manual = !d || per === 'none' ? 0 : round2(per === 'line' ? d.value : d.value * li.quantity);
          // opts.autoPercent: an automatic product discount on every line when
          // automatic discounts are accepted (opts.autoSkipsManual: not on lines
          // that already carry a manual line discount).
          const auto = input.acceptAutomaticDiscounts && opts.autoPercent && !(d && opts.autoSkipsManual)
            ? round2(((original - manual) * opts.autoPercent) / 100) : 0;
          return { li, original, off: round2(manual + auto) };
        });
        const items = round2(priced.reduce((sum, p) => sum + p.original - p.off, 0));
        const lineOff = round2(priced.reduce((sum, p) => sum + p.off, 0));
        const discount = (input.discountCodes || []).includes('SAVE10') ? Math.round(items * 0.1) : 0;
        const shipping = Number(input.shippingLine?.priceWithCurrency?.amount || 0);
        data = { draftOrderCalculate: { userErrors: [], calculatedDraftOrder: {
          currencyCode: 'INR', taxesIncluded: true, discountCodes: input.discountCodes || [],
          lineItems: priced.map(({ li, original, off }) => ({ name: variants[li.variantId].title, title: variants[li.variantId].title, variantTitle: 'Default Title', quantity: li.quantity, image: null,
            sku: `SKU-${li.variantId.split('/').pop()}`, variant: { id: li.variantId }, product: { id: 'gid://shopify/Product/1' },
            originalTotalSet: money(original), discountedTotalSet: money(round2(original - off)) })),
          lineItemsSubtotalPrice: money(items), subtotalPriceSet: money(items - discount), totalDiscountsSet: money(lineOff + discount),
          totalShippingPriceSet: money(shipping), totalTaxSet: money(0), totalPriceSet: money(round2(items - discount + shipping)),
        } } };
      } else if (op === 'CodComboWeight') {
        data = {
          shop: { metafield: opts.comboConfig === null ? null : { jsonValue: opts.comboConfig || COMBO_CONFIG } },
          discountNodes: { nodes: [{ discount: { __typename: 'DiscountAutomaticApp', title: 'BRIX Combo Weight', status: opts.comboStatus || 'ACTIVE' } }] },
        };
      } else if (op === 'CodComboVariants') {
        data = { nodes: variables.ids.map((id) => (variants[id] ? {
          id, price: String(variants[id].price),
          inventoryItem: { measurement: { weight: variants[id].grams ? { value: variants[id].grams, unit: 'GRAMS' } : null } },
          product: {
            id: variants[id].product || 'gid://shopify/Product/1',
            ...Object.fromEntries(Object.entries(variables).filter(([k]) => /^c\d+$/.test(k)).map(([k, gid]) => [k, (variants[id].collections || []).includes(gid)])),
          },
        } : null)) };
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
  assert.deepEqual(input.lineItems[0].customAttributes, [{ key: 'Engraving', value: 'AR' }, { key: '_brixCod', value: 'true' }], 'shopper _brix* properties are dropped; the server adds the COD marker');
  assert.deepEqual(input.lineItems[1].customAttributes, [{ key: '_brixCod', value: 'true' }], 'every COD line is marked');
  assert.deepEqual(input.customAttributes, [{ key: '_brixCod', value: 'true' }], 'the draft is marked while it is priced');
  assert.deepEqual(
    { variantId: quote.lines[0].variantId, productId: quote.lines[0].productId, sku: quote.lines[0].sku, unitPrice: quote.lines[0].unitPrice },
    { variantId: '11', productId: '1', sku: 'SKU-11', unitPrice: 899 },
    'lines carry the ids GA4 / Meta need',
  );

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
  // The prepaid discount Function refuses any cart carrying _brixCod, so the
  // order and every line carry it (set by the server, never by the shopper).
  assert.equal(create.customAttributes.filter((a) => a.key === '_brixCod').length, 1);
  assert.ok(create.customAttributes.some((a) => a.key === '_brixCod' && a.value === 'true'));
  assert.ok(create.lineItems.every((li) => li.customAttributes.some((a) => a.key === '_brixCod' && a.value === 'true')));
  assert.equal(create.acceptAutomaticDiscounts, true, 'other automatic discounts still apply to COD');
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
  assert.equal(orders[0].lifecycle, 'placed');
  assert.deepEqual(cod.summarizeCodOrders(orders), { count: 1, toCollect: 1847, collected: 0, paidCount: 0, cancelledCount: 0, cancelRate: 0, rtoCount: 0 });
});

/* ── ads & analytics: GA4 Measurement Protocol + Meta Conversions API ──────── */

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const waitUntil = async (fn, label, ms = 5000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`timed out waiting for ${label}`);
};
const trackingOn = (patch = {}) => settingsOn({ tracking: { ga4Id: 'G-TEST123', metaPixelId: '123456789012345' }, ...patch });
const shopperTrack = (consent = { analytics: true, marketing: true }) => ({
  gaClientId: '111.222', gaSessionId: '1700000123', fbp: 'fb.1.1700000000000.42', fbc: '', consent, pageUrl: 'https://demo.myshopify.com/cart',
});
const adsRequests = () => harness.app.requests.filter((r) => r.path.startsWith('/mp/') || r.path.includes('/events'));
const okAds = () => { harness.app.requests.length = 0; harness.app.reply = () => ({ status: 200, body: {} }); };

test('secrets: saved separately, kept when blank, removed with null; admin only sees the last 4', async () => {
  await cod.saveCodSecrets(SHOP, { ga4ApiSecret: 'ga4-secret-ABCD', metaCapiToken: 'EAAGtoken1234' });
  await cod.saveCodSecrets(SHOP, { ga4ApiSecret: '', metaTestCode: 'TEST999' });
  assert.deepEqual(await cod.getCodSecrets(SHOP), { ga4ApiSecret: 'ga4-secret-ABCD', metaCapiToken: 'EAAGtoken1234', metaTestCode: 'TEST999' });
  const status = await cod.getCodSecretsStatus(SHOP);
  assert.deepEqual(status.ga4ApiSecret, { set: true, last4: 'ABCD' });
  assert.ok(!JSON.stringify(status).includes('ga4-secret'), 'status never carries the secret');
  await cod.saveCodSecrets(SHOP, { metaTestCode: null });
  assert.equal((await cod.getCodSecrets(SHOP)).metaTestCode, '');
  await assert.rejects(cod.saveCodSecrets(SHOP, { metaCapiToken: 'has spaces in it' }), (e) => e.code === 'invalid_metaCapiToken');
  assert.equal((await cod.getCodSettings(SHOP)).tracking.ga4Id, '', 'secrets are not in the settings blob');
});

test('order: server-side GA4 purchase + Meta Purchase with the browser ids, hashed customer data', async () => {
  okAds();
  await cod.saveCodSecrets(SHOP, { ga4ApiSecret: 'ga4secret', metaCapiToken: 'metatoken' });
  const order = await place(fakeAdmin(), {
    settings: trackingOn(), track: shopperTrack(), clientIp: '203.0.113.9', userAgent: 'Mozilla/5.0 test',
    address: { ...address, email: 'Ananya@Example.com' },
  });
  assert.equal(order.orderName, '#1047');
  await waitUntil(async () => (await orderRows())[0]?.meta_status, 'tracking status');

  const [ga] = adsRequests().filter((r) => r.path.startsWith('/mp/collect'));
  assert.match(ga.path, /measurement_id=G-TEST123/);
  assert.match(ga.path, /api_secret=ga4secret/);
  assert.equal(ga.body.client_id, '111.222');
  const p = ga.body.events[0].params;
  assert.equal(ga.body.events[0].name, 'purchase');
  assert.equal(p.transaction_id, '#1047', 'same transaction_id as the browser purchase');
  assert.equal(p.value, 1847);
  assert.equal(p.session_id, '1700000123');
  assert.deepEqual(p.items.map((i) => i.item_id), ['shopify_IN_1_11', 'shopify_IN_1_12']);

  const [meta] = adsRequests().filter((r) => r.path.includes('/123456789012345/events'));
  assert.match(meta.path, /access_token=metatoken/);
  const ev = meta.body.data[0];
  assert.equal(ev.event_name, 'Purchase');
  assert.equal(ev.event_id, 'brixcod_1047', 'same eventID as the browser pixel');
  assert.equal(ev.user_data.ph[0], sha256('919876543210'));
  assert.equal(ev.user_data.em[0], sha256('ananya@example.com'));
  assert.equal(ev.user_data.st[0], sha256('ka'));
  assert.equal(ev.user_data.client_ip_address, '203.0.113.9');
  assert.equal(ev.user_data.client_user_agent, 'Mozilla/5.0 test');
  assert.equal(ev.user_data.fbp, 'fb.1.1700000000000.42');
  assert.ok(!JSON.stringify(meta.body).includes('9876543210'), 'raw phone never sent');
  assert.ok(!JSON.stringify(meta.body).toLowerCase().includes('ananya@'), 'raw email never sent');

  const [row] = await orderRows();
  assert.equal(row.ga4_status, 'sent');
  assert.equal(row.meta_status, 'sent');

  // A repeated tap returns the first order and sends nothing again.
  const before = adsRequests().length;
  await place(fakeAdmin(), { settings: trackingOn(), track: shopperTrack() });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(adsRequests().length, before);
});

test('order: no consent, no GA client id, or no keys → nothing sent, recorded why', async () => {
  okAds();
  await cod.saveCodSecrets(SHOP, { ga4ApiSecret: 'ga4secret', metaCapiToken: 'metatoken' });
  await place(fakeAdmin(), { settings: trackingOn(), track: shopperTrack({ analytics: false, marketing: false }) });
  await waitUntil(async () => (await orderRows())[0]?.meta_status, 'tracking status');
  let [row] = await orderRows();
  assert.equal(row.ga4_status, 'no_consent');
  assert.equal(row.meta_status, 'no_consent');

  await place(fakeAdmin(), { settings: trackingOn(), idemKey: 'idem-key-0002', track: { ...shopperTrack(), gaClientId: '' } });
  await waitUntil(async () => (await orderRows())[1]?.meta_status, 'tracking status');
  row = (await orderRows())[1];
  assert.equal(row.ga4_status, 'no_client_id', 'GA4 needs the browser client id');
  assert.equal(row.meta_status, 'sent');

  await cod.saveCodSecrets(SHOP, { ga4ApiSecret: null, metaCapiToken: null });
  await place(fakeAdmin(), { settings: trackingOn(), idemKey: 'idem-key-0003', track: shopperTrack() });
  await waitUntil(async () => (await orderRows())[2]?.meta_status, 'tracking status');
  row = (await orderRows())[2];
  assert.equal(row.ga4_status, 'off');
  assert.equal(row.meta_status, 'off');
  assert.equal(adsRequests().filter((r) => r.path.startsWith('/mp/')).length, 0);
});

test('order: GA4 / Meta being down never fails the order', async () => {
  harness.app.requests.length = 0;
  harness.app.reply = () => ({ status: 500, body: { error: { message: 'boom' } } });
  await cod.saveCodSecrets(SHOP, { ga4ApiSecret: 'ga4secret', metaCapiToken: 'metatoken' });
  const order = await place(fakeAdmin(), { settings: trackingOn(), track: shopperTrack() });
  assert.equal(order.orderName, '#1047');
  await waitUntil(async () => (await orderRows())[0]?.meta_status, 'tracking status');
  const [row] = await orderRows();
  assert.equal(row.status, 'placed');
  assert.equal(row.ga4_status, 'rejected');
  assert.equal(row.meta_status, 'rejected');
});

/* ── Shopify order webhooks → COD lifecycle ─────────────────────────────────── */

const orderPayload = (patch = {}) => ({
  id: 1047, tags: 'COD, BRIX-COD, brix-src-drawer', financial_status: 'pending', fulfillment_status: null,
  cancelled_at: null, fulfillments: [], refunds: [], ...patch,
});

test('webhooks: shipped → delivered → cash collected, from Shopify order payloads', async () => {
  await place(fakeAdmin());
  const shipped = await cod.syncCodOrderFromWebhook(SHOP, orderPayload({
    fulfillment_status: 'fulfilled', fulfillments: [{ status: 'success', shipment_status: 'in_transit', updated_at: '2026-10-06T10:00:00Z' }],
  }));
  assert.equal(shipped.lifecycle, 'shipped');
  const delivered = await cod.syncCodOrderFromWebhook(SHOP, orderPayload({
    fulfillment_status: 'fulfilled',
    fulfillments: [
      { status: 'success', shipment_status: 'in_transit', updated_at: '2026-10-06T10:00:00Z' },
      { status: 'success', shipment_status: 'delivered', updated_at: '2026-10-07T10:00:00Z' },
    ],
  }));
  assert.equal(delivered.lifecycle, 'delivered', 'latest fulfillment wins');
  const paid = await cod.syncCodOrderFromWebhook(SHOP, orderPayload({ financial_status: 'paid', fulfillment_status: 'fulfilled' }));
  assert.equal(paid.lifecycle, 'paid');
  const [row] = await orderRows();
  assert.equal(row.lifecycle, 'paid');
  assert.equal(row.financial_status, 'paid');
  const failed = await cod.syncCodOrderFromWebhook(SHOP, orderPayload({ financial_status: 'pending', fulfillments: [{ status: 'success', shipment_status: 'failure' }] }));
  assert.equal(failed.lifecycle, 'rto');
});

test('webhooks: only BRIX COD orders are touched; unknown ids match nothing', async () => {
  await place(fakeAdmin());
  assert.equal(await cod.syncCodOrderFromWebhook(SHOP, orderPayload({ tags: 'wholesale' })), null, 'non-COD order: no call');
  assert.equal((await cod.syncCodOrderFromWebhook(SHOP, orderPayload({ id: 999 }))).matched, false);
  assert.equal((await cod.syncCodOrderFromWebhook('other.myshopify.com', orderPayload())).matched, false, 'other shops never match');
  assert.equal((await orderRows())[0].lifecycle, 'placed');
});

test('webhooks: cancelled / refunded orders send one GA4 refund, even when two webhooks arrive', async () => {
  okAds();
  await cod.saveCodSettings(SHOP, { enabled: true, tracking: { ga4Id: 'G-TEST123' } });
  await cod.saveCodSecrets(SHOP, { ga4ApiSecret: 'ga4secret' });
  await place(fakeAdmin());
  const cancelled = orderPayload({ cancelled_at: '2026-10-06T12:00:00+05:30', financial_status: 'voided' });
  // orders/cancelled and orders/updated arrive together for one cancellation.
  const [a, b] = await Promise.all([cod.syncCodOrderFromWebhook(SHOP, cancelled), cod.syncCodOrderFromWebhook(SHOP, cancelled)]);
  assert.deepEqual([a.lifecycle, b.lifecycle], ['cancelled', 'cancelled']);
  const refunds = adsRequests().filter((r) => r.body?.events?.[0]?.name === 'refund');
  assert.equal(refunds.length, 1, 'refund sent once');
  assert.equal(refunds[0].body.events[0].params.transaction_id, '#1047');
  assert.equal(refunds[0].body.events[0].params.value, 1847);
  await cod.syncCodOrderFromWebhook(SHOP, cancelled);
  assert.equal(adsRequests().filter((r) => r.body?.events?.[0]?.name === 'refund').length, 1, 'retried webhook: still once');
});

test('webhooks: a full refund on a paid COD order', async () => {
  okAds();
  await place(fakeAdmin());
  const refunded = await cod.syncCodOrderFromWebhook(SHOP, orderPayload({
    financial_status: 'refunded',
    refunds: [{ transactions: [{ kind: 'refund', status: 'success', amount: '1847.00' }, { kind: 'refund', status: 'failure', amount: '5.00' }] }],
  }));
  assert.equal(refunded.lifecycle, 'refunded');
  assert.equal(Number((await orderRows())[0].refunded_total), 1847);
  assert.equal(adsRequests().length, 0, 'no GA4 set up → no refund event');
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
    productButton: { replaceBuyNow: false, marginTop: 4, paddingY: 18, radius: 0 },
    sheet: { logo: 'data:image/png;base64,iVBORw0KGgo=', radius: 'soft', accent: '#7c3aed', showTrust: false, thankYouText: 'Thank you for shopping with us!',
      couponLabel: 'Got a code?', couponOpen: true, offers: [{ code: 'SAVE10', text: '10% off above ₹999' }, { code: 'bad code!', text: 'x' }] },
  });
  const { json } = await storefront(`action=config&shop=${SHOP}`);
  assert.equal(json.codFee, 49);
  assert.equal(json.showCodFee, true);
  assert.equal(json.codFeeLabel, 'Cash on Delivery Fee');
  assert.equal(json.drawerPlacement, 'above');
  assert.equal(json.drawerSelector, '');
  assert.equal(json.excludedBehavior, 'unavailable');
  assert.equal(json.buttons.style, 'filled');
  assert.equal(json.buttons.radius, 12);
  assert.equal(json.minOrder, 299);
  assert.deepEqual(json.blockedPincodes, ['744101']);
  assert.deepEqual(json.surfaces, { drawer: true, product: true, combo: false });
  assert.equal(json.buttons.drawerText, 'Pay cash on delivery');
  assert.deepEqual(json.productButton, { replaceBuyNow: false, marginTop: 4, marginBottom: 0, paddingY: 18, paddingX: 16, radius: 0 });
  assert.equal(json.otpRequired, true, 'COD_OTP_DEV_LOG counts as an SMS provider in tests');
  assert.equal('_runtime' in json, false);
  assert.equal('orderTags' in json, false, 'merchant-only fields are not exposed');
  assert.deepEqual(json.tracking, { ga4Id: '', metaPixelId: '', metaContentId: 'shopify', dataLayer: true });
  assert.deepEqual(json.sheet, {
    logo: 'data:image/png;base64,iVBORw0KGgo=', logoSize: 'md', accent: '#7c3aed', radius: 'soft',
    showSummary: true, showTrust: false, thankYouText: 'Thank you for shopping with us!',
    showCoupon: true, couponLabel: 'Got a code?', couponOpen: true, offers: [{ code: 'SAVE10', text: '10% off above ₹999' }],
  }, 'popup look + coupon options reach the storefront (bad offer codes dropped)');
  // A bad logo that somehow got into storage never reaches the shopper's <img src>.
  const stored = JSON.parse((await sql('SELECT settings_json FROM cod_settings WHERE shop = ?', [SHOP]))[0].settings_json);
  await sql('UPDATE cod_settings SET settings_json = ? WHERE shop = ?', [JSON.stringify({ ...stored, sheet: { ...stored.sheet, logo: 'javascript:alert(1)' } }), SHOP]);
  assert.equal((await storefront(`action=config&shop=${SHOP}`)).json.sheet.logo, '', 'PHP re-checks the logo');
  await sql('UPDATE cod_settings SET settings_json = ? WHERE shop = ?', [JSON.stringify(stored), SHOP]);

  process.env.COD_OTP_DEV_LOG = '0';
  try {
    await cod.syncCodRuntime(SHOP);
    assert.equal((await storefront(`action=config&shop=${SHOP}`)).json.otpRequired, false, 'no SMS provider → no OTP step');
  } finally {
    process.env.COD_OTP_DEV_LOG = '1';
    await cod.syncCodRuntime(SHOP);
  }
});

test('storefront config: each place gets its own button look; turning the drawer off leaves the rest on', async () => {
  await setPlan('pro');
  await cod.saveCodSettings(SHOP, {
    enabled: true, surfaces: { drawer: false, product: true, combo: true },
    buttons: {
      bg: '#0c7a43', style: 'filled', radius: 20, fontSize: 17,
      product: { same: false, style: 'outline', bg: '#1d4ed8', icon: false },
      combo: { same: false, style: 'minimal', bg: '#be185d', radius: 4, uppercase: true },
      comboText: 'Pay cash',
    },
    productButton: { radius: 6 },
  });
  const { json } = await storefront(`action=config&shop=${SHOP}`);
  assert.deepEqual(json.surfaces, { drawer: false, product: true, combo: true }, 'only the drawer is off');
  assert.equal(json.enabled, true);
  const { looks } = json.buttons;
  assert.deepEqual(looks.drawer, { style: 'filled', bg: '#0c7a43', color: '#ffffff', fontSize: 17, bold: true, uppercase: false, icon: true, radius: 20 });
  assert.deepEqual([looks.product.style, looks.product.bg, looks.product.icon, looks.product.radius], ['outline', '#1d4ed8', false, 6]);
  assert.deepEqual([looks.combo.style, looks.combo.bg, looks.combo.radius, looks.combo.uppercase], ['minimal', '#be185d', 4, true]);
  assert.equal(json.buttons.comboText, 'Pay cash');

  // A look stored by anything else is re-checked by PHP.
  const stored = JSON.parse((await sql('SELECT settings_json FROM cod_settings WHERE shop = ?', [SHOP]))[0].settings_json);
  stored.buttons.combo = { same: false, style: '<b>', bg: 'red;x', fontSize: 400 };
  await sql('UPDATE cod_settings SET settings_json = ? WHERE shop = ?', [JSON.stringify(stored), SHOP]);
  const again = (await storefront(`action=config&shop=${SHOP}`)).json.buttons.looks.combo;
  assert.deepEqual([again.style, again.bg, again.fontSize], ['outline', '#111827', 22]);

  // Settings saved before per-place looks: combo keeps its old look, product follows the drawer.
  delete stored.buttons.combo;
  delete stored.buttons.product;
  await sql('UPDATE cod_settings SET settings_json = ? WHERE shop = ?', [JSON.stringify(stored), SHOP]);
  const old = (await storefront(`action=config&shop=${SHOP}`)).json.buttons.looks;
  assert.deepEqual([old.combo.style, old.combo.icon, old.combo.radius], ['outline', false, 8]);
  assert.equal(old.product.bg, '#0c7a43');
  await cod.saveCodSettings(SHOP, { surfaces: { drawer: true }, buttons: { product: { same: true }, combo: { same: true } } });
});

test('storefront config: drawer placement, button style, fee switch / title / visibility and excluded behaviour', async () => {
  await setPlan('pro');
  await cod.saveCodSettings(SHOP, {
    enabled: true, codFeeEnabled: true, codFee: 40, codFeeLabel: 'Handling fee', showCodFee: false,
    drawerPlacement: 'replace', drawerSelector: '#CartDrawer-Checkout', excludedBehavior: 'hide',
    excludedProductTags: ['no-cod', 'pre-order'], buttons: { style: 'minimal', radius: 4 },
  });
  let { json } = await storefront(`action=config&shop=${SHOP}`);
  assert.equal(json.codFee, 40);
  assert.equal(json.codFeeLabel, 'Handling fee');
  assert.equal(json.showCodFee, false);
  assert.equal(json.drawerPlacement, 'replace');
  assert.equal(json.drawerSelector, '#CartDrawer-Checkout');
  assert.equal(json.excludedBehavior, 'hide');
  assert.deepEqual(json.excludedProductTags, ['no-cod', 'pre-order']);
  assert.equal(json.buttons.style, 'minimal');
  assert.equal(json.buttons.radius, 4);

  await cod.saveCodSettings(SHOP, { codFeeEnabled: false });
  ({ json } = await storefront(`action=config&shop=${SHOP}`));
  assert.equal(json.codFee, 0, 'fee switched off: nothing is charged or shown');
  const stored = JSON.parse((await sql('SELECT settings_json FROM cod_settings WHERE shop = ?', [SHOP]))[0].settings_json);
  assert.equal(stored.codFee, 40, 'the amount is kept for when it is turned back on');

  // Settings saved before the switch existed (codFee only) keep charging the fee,
  // and junk in the new fields never reaches the storefront.
  const legacy = { ...stored, codFee: 49, buttons: { ...stored.buttons, style: 'neon', radius: 'x' }, drawerPlacement: 'sideways', drawerSelector: '<script>' };
  delete legacy.codFeeEnabled;
  delete legacy.codFeeLabel;
  await sql('UPDATE cod_settings SET settings_json = ? WHERE shop = ?', [JSON.stringify(legacy), SHOP]);
  ({ json } = await storefront(`action=config&shop=${SHOP}`));
  assert.equal(json.codFee, 49);
  assert.equal(json.codFeeLabel, 'Cash on Delivery Fee');
  assert.equal(json.buttons.style, 'filled');
  assert.equal(json.buttons.radius, 12);
  assert.equal(json.drawerPlacement, 'above');
  assert.equal(json.drawerSelector, '');
  assert.equal((await cod.getCodSettings(SHOP)).codFeeEnabled, true, 'Node reads the legacy fee as on too');

  await cod.saveCodSettings(SHOP, { codFeeEnabled: false, codFee: 0, codFeeLabel: '', showCodFee: true, drawerPlacement: 'above', drawerSelector: '', excludedBehavior: 'unavailable', excludedProductTags: [], buttons: { style: 'filled', radius: 12 } });
});

test('storefront config: GA4 / Meta Pixel IDs reach the popup, the API secret and token never do', async () => {
  await setPlan('pro');
  await sql('UPDATE shops SET plan_key = ? WHERE shop_domain = ?', ['pro', SHOP]);
  await cod.saveCodSettings(SHOP, { enabled: true, tracking: { ga4Id: 'G-TEST123', metaPixelId: '123456789012345', metaContentId: 'variant' } });
  await cod.saveCodSecrets(SHOP, { ga4ApiSecret: 'ga4secretVALUE', metaCapiToken: 'metatokenVALUE', metaTestCode: 'XTESTCODE9' });
  const res = await storefront(`action=config&shop=${SHOP}`);
  assert.deepEqual(res.json.tracking, { ga4Id: 'G-TEST123', metaPixelId: '123456789012345', metaContentId: 'variant', dataLayer: true });
  const text = JSON.stringify(res.json);
  assert.ok(!/secretVALUE|tokenVALUE|XTESTCODE9/.test(text), 'no secret in the public config');
  // A bad ID that somehow got into storage is dropped by PHP too.
  const stored = JSON.parse((await sql('SELECT settings_json FROM cod_settings WHERE shop = ?', [SHOP]))[0].settings_json);
  await sql('UPDATE cod_settings SET settings_json = ? WHERE shop = ?', [JSON.stringify({ ...stored, tracking: { ga4Id: '"><script>', metaPixelId: 'abc' } }), SHOP]);
  const again = (await storefront(`action=config&shop=${SHOP}`)).json.tracking;
  assert.equal(again.ga4Id, '');
  assert.equal(again.metaPixelId, '');
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

/* ── order relay: php_backend/cod_checkout.php ──────────────────────────────── */

const relay = (body, headers = {}) => fetch(`${harness.baseUrl}/cod_checkout.php`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
}).then(async (res) => ({ status: res.status, cors: res.headers.get('access-control-allow-origin'), json: await res.json() }));

test('relay: forwards otp/quote/order to the app server with the secret and the shopper IP', async () => {
  harness.app.requests.length = 0;
  harness.app.reply = () => ({ status: 200, body: { success: true, quote: { total: 948 } } });
  const res = await relay({ endpoint: 'quote', shop: SHOP, surface: 'drawer', items: [{ variantId: 11, quantity: 1 }] }, { 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': 'Mozilla/5.0 (shopper phone)' });
  assert.equal(res.status, 200);
  assert.equal(res.cors, '*');
  assert.deepEqual(res.json, { success: true, quote: { total: 948 } });
  const sent = harness.app.requests[0];
  assert.equal(sent.path, '/api/cod/quote');
  assert.equal(sent.headers['x-forge-secret'], harness.secret);
  assert.equal(sent.headers['x-brix-client-ip'], '203.0.113.9');
  assert.equal(sent.headers['x-brix-client-ua'], 'Mozilla/5.0 (shopper phone)', 'User-Agent forwarded for Meta CAPI');
  assert.equal('endpoint' in sent.body, false, 'routing field is not forwarded');
  assert.equal(sent.body.shop, SHOP);
});

test('relay: passes the app server\'s errors through unchanged', async () => {
  harness.app.reply = () => ({ status: 422, body: { success: false, code: 'below_min', error: 'Cash on Delivery is available on orders from ₹299.' } });
  const res = await relay({ endpoint: 'order', shop: SHOP });
  assert.equal(res.status, 422);
  assert.equal(res.json.code, 'below_min');
});

test('relay: a missing or broken app server becomes a clean shopper message', async () => {
  harness.app.reply = () => ({ status: 404, body: '<html>404 Not Found</html>' });
  const res = await relay({ endpoint: 'quote', shop: SHOP });
  assert.equal(res.status, 503);
  assert.equal(res.json.code, 'app_unavailable');
  assert.match(res.json.error, /pay online/);
});

test('relay: only otp, quote and order can be reached', async () => {
  harness.app.requests.length = 0;
  for (const endpoint of ['admin', '../settings', '', 'quote/../../app']) {
    assert.equal((await relay({ endpoint, shop: SHOP })).json.code, 'invalid_request', endpoint);
  }
  assert.equal(harness.app.requests.length, 0);
});

test('Node trusts the relayed shopper IP only with the Forge secret', () => {
  const req = (headers) => new Request('https://x.test', { headers });
  const key = process.env.SHOPIFY_API_KEY;
  assert.equal(cod.clientIp(req({ 'x-forge-secret': key, 'x-brix-client-ip': '203.0.113.9', 'fly-client-ip': '10.0.0.1' })), '203.0.113.9');
  assert.equal(cod.clientIp(req({ 'x-forge-secret': 'nope', 'x-brix-client-ip': '203.0.113.9', 'fly-client-ip': '10.0.0.1' })), '10.0.0.1');
  assert.equal(cod.clientIp(req({ 'x-brix-client-ip': '203.0.113.9', 'fly-client-ip': '10.0.0.1' })), '10.0.0.1');
});

test('Node trusts the relayed shopper User-Agent only with the Forge secret', () => {
  const req = (headers) => new Request('https://x.test', { headers });
  const key = process.env.SHOPIFY_API_KEY;
  assert.equal(cod.clientUa(req({ 'x-forge-secret': key, 'x-brix-client-ua': 'Shopper UA', 'user-agent': 'PHP curl' })), 'Shopper UA');
  assert.equal(cod.clientUa(req({ 'x-forge-secret': 'nope', 'x-brix-client-ua': 'Shopper UA', 'user-agent': 'PHP curl' })), 'PHP curl');
});

test('PHP: tracking secrets need the Forge secret and look like keys', async () => {
  assert.equal((await callPhp('cod_settings.php', { action: 'secrets_get', shop: SHOP }, 'wrong')).status, 403);
  assert.equal((await callPhp('cod_settings.php', { action: 'secrets_save', shop: SHOP, secrets: { metaCapiToken: 'a b' } })).json.code, 'invalid_metaCapiToken');
  assert.equal((await callPhp('cod_orders.php', { action: 'sync', shop: SHOP, order_id: 'gid://x' })).json.code, 'invalid_order_id');
});

/* ── product page payment options + prepaid discount ───────────────────────── */

test('order: a shopper cannot remove or fake the COD marker through order attributes', async () => {
  const admin = fakeAdmin();
  await place(admin, { attributes: { _brixCod: '', _brixCodX: 'no', note_key: 'kept' } });
  const create = admin.calls.find((c) => c.op === 'CodCreate').variables.input;
  assert.deepEqual(create.customAttributes.filter((a) => a.key.startsWith('_brix')), [{ key: '_brixCod', value: 'true' }]);
  assert.ok(create.customAttributes.some((a) => a.key === 'note_key'));
});

test('settings: productPayment is saved, sanitized, and old settings get safe defaults (off)', async () => {
  await cod.saveCodSettings(SHOP, { enabled: true, codFee: 49 });
  let s = await cod.getCodSettings(SHOP);
  assert.equal(s.productPayment.enabled, false, 'existing merchants: product pages unchanged');
  assert.equal(s.codFee, 49, 'existing COD settings unchanged');
  s = await cod.saveCodSettings(SHOP, { productPayment: { enabled: true, prepaid: { enabled: true, percent: 75 } } });
  assert.equal(s.productPayment.enabled, true);
  assert.equal(s.productPayment.prepaid.percent, 10, 'out of range percent keeps the previous valid value');
  assert.equal(s.enabled, true);
});

test('settings: the prepaid sync result is kept in _runtime, and survives later saves and syncCodRuntime', async () => {
  const runtime = { verified: true, percent: 10, minSubtotal: 0, currency: 'INR', state: 'active' };
  await cod.saveCodSettings(SHOP, { enabled: true, productPayment: { enabled: true, prepaid: { enabled: true } } }, {
    syncPrepaid: async (next) => {
      assert.equal(next.productPayment.prepaid.enabled, true, 'sync sees the new settings before they are stored');
      return runtime;
    },
  });
  const stored = () => sql('SELECT settings_json FROM cod_settings WHERE shop = ?', [SHOP]).then((r) => JSON.parse(r[0].settings_json));
  assert.deepEqual((await stored())._runtime.prepaid, runtime);
  await cod.saveCodSettings(SHOP, { codFee: 20 });
  assert.deepEqual((await stored())._runtime.prepaid, runtime, 'a save without a sync keeps it');
  process.env.COD_OTP_DEV_LOG = '0';
  try {
    await cod.syncCodRuntime(SHOP);
    const after = await stored();
    assert.equal(after._runtime.otpAvailable, false);
    assert.deepEqual(after._runtime.prepaid, runtime, 'syncCodRuntime keeps it');
  } finally {
    process.env.COD_OTP_DEV_LOG = '1';
    await cod.syncCodRuntime(SHOP);
  }
  const { runtime: rt } = await cod.getCodSettingsWithRuntime(SHOP);
  assert.equal(rt.prepaid.verified, true);
});

/* ── weight combo boxes: COD charges what Shopify checkout charges ──────────── */

const boxLine = (variantId, quantity, extra = {}) => ({ variantId, quantity, properties: { _brix_combo_id: '12', _brix_combo_group: 'box-1', _brix_combo_version: 'h1', ...extra } });
const boxAdmin = (opts = {}) => fakeAdmin({ variants: BOOKS, ...opts });
const boxQuote = (admin, lines, extra = {}) => cod.quoteCod(admin, { settings: settingsOn(), lines, surface: 'combo', comboWeightLive: true, ...extra });

test('combo box: the 10% tier as a line discount; markers stripped; other automatic discounts still accepted', async () => {
  const admin = boxAdmin();
  const { quote, input } = await boxQuote(admin, [boxLine('21', 4)]); // 1.2 kg of ₹110 books
  assert.equal(quote.itemsTotal, 440);
  assert.equal(quote.comboDiscount, 44);
  assert.deepEqual(quote.comboDiscounts, [{ templateId: '12', title: '1 kg box: 10% off', weight: '1.2 kg', amount: 44 }]);
  assert.equal(quote.discounts, 0, 'nothing else taken off');
  assert.equal(quote.total, 440 - 44 + 49);
  const [li] = input.lineItems;
  assert.deepEqual(li.appliedDiscount, { valueType: 'FIXED_AMOUNT', value: 11, title: '1 kg box: 10% off', description: 'BRIX combo box' });
  assert.deepEqual(li.customAttributes, [{ key: '_brixCod', value: 'true' }], '_brix_combo_* never reach the draft, so the Function cannot discount twice');
  assert.equal(input.acceptAutomaticDiscounts, true, 'automatic order/shipping discounts apply, as in checkout');
});

test('combo box: an automatic discount on the other items applies, as in checkout', async () => {
  // 1.2 kg box of novels + an Atlas outside the box; automatic 5% that Shopify keeps off manually discounted lines
  const admin = boxAdmin({ autoPercent: 5, autoSkipsManual: true });
  const { quote, input } = await boxQuote(admin, [boxLine('21', 4), { variantId: '22', quantity: 1, properties: {} }]);
  assert.equal(input.acceptAutomaticDiscounts, true);
  assert.equal(quote.comboDiscount, 44);
  assert.equal(quote.discounts, 6, '5% of the ₹120 Atlas');
  assert.equal(quote.total, 440 + 120 - 44 - 6 + 49);
});

test('combo box: if Shopify stacks an automatic discount on a box line, COD leaves automatic discounts off', async () => {
  const admin = boxAdmin({ autoPercent: 5 });
  const { quote, input } = await boxQuote(admin, [boxLine('21', 4)]);
  assert.equal(input.acceptAutomaticDiscounts, false, 'checkout never stacks a product discount on the box');
  assert.equal(quote.discounts, 0);
  assert.equal(quote.total, 440 - 44 + 49);
  const calcs = admin.calls.filter((c) => c.op === 'CodCalculate').map((c) => c.variables.input.acceptAutomaticDiscounts);
  // (the box probes run without; then tried with, then without, then again with the COD fee)
  assert.deepEqual(calcs.slice(calcs.indexOf(true)), [true, false, false], 'tried with automatic discounts, then without');
});

test('combo box: collection membership is asked per counted collection, not read from a capped list', async () => {
  const admin = boxAdmin();
  await boxQuote(admin, [boxLine('21', 4)]);
  const call = admin.calls.find((c) => c.op === 'CodComboVariants');
  assert.ok(Object.values(call.variables).includes('gid://shopify/Collection/900'));
});

test('combo box: a fixed box price split exactly across lines (uneven units split the line)', async () => {
  // 3 × 500 g box sets (₹1000) + 2 × 300 g novels (₹110) = 2.1 kg, ₹3220 → box price ₹1700
  const { quote, input } = await boxQuote(boxAdmin(), [boxLine('25', 3), boxLine('21', 2)]);
  assert.equal(quote.comboDiscount, 1520);
  assert.equal(quote.total, 1700 + 49);
  const off = input.lineItems.reduce((sum, li) => sum + (li.appliedDiscount ? Math.round(li.appliedDiscount.value * 100) * li.quantity : 0), 0);
  assert.equal(off, 152000, 'units add up to exactly the box discount');
  assert.deepEqual(input.lineItems.map((li) => [li.variantId.split('/').pop(), li.quantity]), [['25', 3], ['21', 1], ['21', 1]]);
});

test('combo box: if Shopify reads line discounts per line, that is detected; if it applies neither way, COD is refused', async () => {
  const perLine = await boxQuote(boxAdmin({ lineDiscountPer: 'line' }), [boxLine('21', 4)]);
  assert.equal(perLine.quote.total, 440 - 44 + 49);
  assert.equal(perLine.input.lineItems[0].appliedDiscount.value, 44);
  await assert.rejects(boxQuote(boxAdmin({ lineDiscountPer: 'none' }), [boxLine('21', 4)]), (e) => e.code === 'combo_price_mismatch');
  // back to per-unit
  const perUnit = await boxQuote(boxAdmin(), [boxLine('21', 4)]);
  assert.equal(perUnit.quote.total, 440 - 44 + 49);
});

test('combo box: locked, over the max, not Pro, discount inactive, unknown template → full price', async () => {
  const fullPrice = async (lines, opts = {}, extra = {}) => {
    const admin = boxAdmin(opts);
    const { quote, input } = await boxQuote(admin, lines, extra);
    assert.equal(quote.comboDiscount, 0);
    assert.ok(input.lineItems.every((li) => !li.appliedDiscount));
    assert.equal(input.acceptAutomaticDiscounts, true);
    return admin;
  };
  await fullPrice([boxLine('21', 3)]); // 0.9 kg
  await fullPrice([boxLine('25', 4), boxLine('21', 1)]); // 2.3 kg > 2.2 kg
  const notPro = await fullPrice([boxLine('21', 4)], {}, { comboWeightLive: false });
  assert.ok(!notPro.calls.some((c) => c.op === 'CodComboWeight'), 'no extra Shopify calls when the plan does not have it');
  await fullPrice([boxLine('21', 4)], { comboStatus: 'EXPIRED' });
  await fullPrice([boxLine('21', 4, { _brix_combo_id: '99' })]);
  await fullPrice([boxLine('21', 4)], { comboConfig: null });
  const plain = await fullPrice([{ variantId: '21', quantity: 4, properties: {} }]);
  assert.ok(!plain.calls.some((c) => c.op === 'CodComboWeight'), 'ordinary carts make no extra calls');
});

test('combo box: products that do not qualify or have no weight do not count and are not discounted', async () => {
  // the 2 kg lamp is outside the combo's collections; the poster has no weight
  const { quote, input } = await boxQuote(boxAdmin(), [boxLine('21', 2), boxLine('24', 1), boxLine('23', 5)]);
  assert.equal(quote.comboDiscount, 0, '600 g of books: locked');
  const unlocked = await boxQuote(boxAdmin(), [boxLine('21', 4), boxLine('24', 1), boxLine('23', 1)]);
  assert.equal(unlocked.quote.comboDiscount, 44, 'only the novels are discounted');
  assert.deepEqual(unlocked.input.lineItems.map((li) => Boolean(li.appliedDiscount)), [true, false, false]);
  assert.equal(input.lineItems.length, 3);
});

test('combo box: a coupon still goes to Shopify and is shown apart from the box discount', async () => {
  const { quote } = await boxQuote(boxAdmin(), [boxLine('21', 4)], { coupon: 'SAVE10' });
  assert.equal(quote.comboDiscount, 44);
  assert.deepEqual(quote.coupon, { code: 'SAVE10', applied: true });
  assert.equal(quote.discounts, 40, 'SAVE10 on the ₹396 box');
  assert.equal(quote.total, 440 - 44 - 40 + 49);
});

test('combo box order: tagged brix-combo-weight with what was applied; the attribute cannot be forged', async () => {
  const admin = boxAdmin();
  await place(admin, { lines: [boxLine('21', 4)], surface: 'combo', comboWeightLive: true, attributes: { brix_combo_weight: 'forged' } });
  const create = admin.calls.find((c) => c.op === 'CodCreate').variables.input;
  assert.ok(create.tags.includes('brix-combo-weight'));
  const attrs = create.customAttributes.filter((a) => a.key === 'brix_combo_weight');
  assert.deepEqual(attrs, [{ key: 'brix_combo_weight', value: 'combo 12: 1 kg box: 10% off, 1.2 kg, -44.00' }]);
  assert.equal(create.lineItems[0].appliedDiscount.title, '1 kg box: 10% off');
  assert.equal(create.acceptAutomaticDiscounts, true);
});

const paymentOn = (patch = {}) => ({
  enabled: true, codFee: 50, codFeeEnabled: true,
  productPayment: { enabled: true, prepaid: { enabled: true, percent: 10, minSubtotal: 999 }, ...patch },
});
const verified = { verified: true, percent: 10, minSubtotal: 999, currency: 'INR', state: 'active' };

test('storefront config: payment options only when on, on a plan that publishes COD', async () => {
  await setPlan('pro');
  await cod.saveCodSettings(SHOP, { enabled: true });
  assert.equal((await storefront(`action=config&shop=${SHOP}`)).json.productPayment, null, 'off by default');

  await cod.saveCodSettings(SHOP, paymentOn(), { syncPrepaid: async () => verified });
  const { json } = await storefront(`action=config&shop=${SHOP}`);
  assert.equal(json.enabled, true);
  const pp = json.productPayment;
  assert.equal(pp.online.enabled, true);
  assert.equal(pp.cod.enabled, true);
  assert.equal(pp.heading, 'Choose payment method');
  assert.deepEqual(
    { percent: pp.prepaid.percent, minSubtotal: pp.prepaid.minSubtotal, currency: pp.prepaid.currency },
    { percent: 10, minSubtotal: 999, currency: 'INR' },
  );
  assert.equal(pp.layout.placement, 'before_purchase_buttons');
  assert.equal(pp.appearance.onlineColor, '#008060');
  assert.equal('_runtime' in json, false);

  await setPlan('free');
  const free = (await storefront(`action=config&shop=${SHOP}`)).json;
  assert.equal(free.enabled, false);
  assert.equal(free.productPayment, undefined, 'Free plan = preview only, nothing for shoppers');
});

test('storefront config: the prepaid offer is sent only when the server verified it, with the numbers Shopify has', async () => {
  await setPlan('pro');
  await cod.saveCodSettings(SHOP, paymentOn(), { syncPrepaid: async () => ({ verified: false, state: 'not_deployed' }) });
  let pp = (await storefront(`action=config&shop=${SHOP}`)).json.productPayment;
  assert.equal(pp.prepaid, null, 'not verified → no "Save 10%" on the storefront');
  assert.equal(pp.online.enabled, true, 'Pay Online still offered');

  await cod.saveCodSettings(SHOP, { productPayment: { prepaid: { percent: 15 } } });
  pp = (await storefront(`action=config&shop=${SHOP}`)).json.productPayment;
  assert.equal(pp.prepaid, null, 'a save without a successful sync never makes the offer appear');

  await cod.saveCodSettings(SHOP, {}, { syncPrepaid: async () => ({ ...verified, percent: 15 }) });
  pp = (await storefront(`action=config&shop=${SHOP}`)).json.productPayment;
  assert.equal(pp.prepaid.percent, 15);

  await cod.saveCodSettings(SHOP, { productPayment: { prepaid: { enabled: false } } }, { syncPrepaid: async () => ({ verified: false, state: 'not_needed' }) });
  assert.equal((await storefront(`action=config&shop=${SHOP}`)).json.productPayment.prepaid, null, 'prepaid off');
});

test('storefront config: which payment cards are offered', async () => {
  await setPlan('pro');
  const cards = async () => {
    const { json } = await storefront(`action=config&shop=${SHOP}`);
    return json.productPayment ? { online: json.productPayment.online.enabled, cod: json.productPayment.cod.enabled } : null;
  };
  await cod.saveCodSettings(SHOP, paymentOn(), { syncPrepaid: async () => verified });
  assert.deepEqual(await cards(), { online: true, cod: true }, 'both');
  await cod.saveCodSettings(SHOP, { productPayment: { cod: { enabled: false } } });
  assert.deepEqual(await cards(), { online: true, cod: false }, 'online only');
  await cod.saveCodSettings(SHOP, { productPayment: { cod: { enabled: true }, online: { enabled: false } } });
  assert.deepEqual(await cards(), { online: false, cod: true }, 'COD only');
  assert.equal((await storefront(`action=config&shop=${SHOP}`)).json.productPayment.prepaid, null, 'no Pay Online → no prepaid offer');
  await cod.saveCodSettings(SHOP, { productPayment: { cod: { enabled: false } } });
  assert.deepEqual(await cards(), { online: false, cod: false }, 'both off → sent as both off, so the storefront shows nothing (not the plain COD button)');

  await cod.saveCodSettings(SHOP, { productPayment: { online: { enabled: true }, cod: { enabled: true } }, surfaces: { product: false } });
  assert.deepEqual(await cards(), { online: true, cod: false }, 'COD hidden on product pages → no COD card');
  await cod.saveCodSettings(SHOP, { enabled: false, surfaces: { product: true } });
  const off = (await storefront(`action=config&shop=${SHOP}`)).json;
  assert.equal(off.enabled, false, 'COD off');
  assert.deepEqual({ online: off.productPayment.online.enabled, cod: off.productPayment.cod.enabled }, { online: true, cod: false }, 'COD off → Pay Online (and its offer) still shown');
  assert.equal(off.productPayment.prepaid.percent, 10);
});

test('storefront config: PHP re-checks payment option values stored by anything else', async () => {
  await setPlan('pro');
  await cod.saveCodSettings(SHOP, paymentOn(), { syncPrepaid: async () => verified });
  const stored = JSON.parse((await sql('SELECT settings_json FROM cod_settings WHERE shop = ?', [SHOP]))[0].settings_json);
  stored.productPayment.appearance.onlineColor = 'red;background:url(x)';
  stored.productPayment.layout.placement = '<script>';
  stored.productPayment.layout.radius = 900;
  stored.productPayment.online.label = 'x'.repeat(500);
  stored._runtime.prepaid.percent = 90;
  await sql('UPDATE cod_settings SET settings_json = ? WHERE shop = ?', [JSON.stringify(stored), SHOP]);
  const pp = (await storefront(`action=config&shop=${SHOP}`)).json.productPayment;
  assert.equal(pp.appearance.onlineColor, '#008060');
  assert.equal(pp.layout.placement, 'before_purchase_buttons');
  assert.equal(pp.layout.radius, 24);
  assert.equal(pp.online.label.length, 40);
  assert.equal(pp.prepaid, null, 'a percentage outside 1–50 is never offered');
});

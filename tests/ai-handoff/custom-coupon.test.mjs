// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff/custom-coupon.test.mjs
// Coupon Banner "+ Custom Coupon" storage (app/services/coupon-banner.server.js)
// against an in-memory emulation of coupon_slider_settings behind db_proxy and
// a fake Shopify admin. Never touches a real database or store.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

process.env.SHOPIFY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// One row per shop; `hasColumn` models whether custom_coupons exists yet. It
// starts false and, like the real table, stays added once the app adds it
// (the app also caches that check per process).
let rows; let hasColumn = false; let alters = []; let writes; let failWrites;
const reset = () => { rows = {}; writes = []; failWrites = false; };
reset();

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql, params } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT COLUMN_NAME FROM information_schema.COLUMNS')) {
    const cols = ['shop_domain', 'is_enabled', 'selected_coupons', ...(hasColumn ? ['custom_coupons'] : [])];
    return json({ success: true, rows: cols.map((c) => ({ COLUMN_NAME: c })) });
  }
  if (q.startsWith('ALTER TABLE `coupon_slider_settings`')) { alters.push(q); hasColumn = true; return json({ success: true, affectedRows: 0 }); }
  if (q.startsWith('SELECT custom_coupons FROM coupon_slider_settings')) {
    if (!hasColumn) return json({ success: false, error: "Unknown column 'custom_coupons'" });
    const row = rows[params[0]];
    return json({ success: true, rows: row ? [{ custom_coupons: row.custom_coupons ?? null }] : [] });
  }
  if (q.startsWith('INSERT INTO coupon_slider_settings (shop_domain, custom_coupons)')) {
    if (failWrites) return json({ success: false, error: 'SQLSTATE[HY000] DB Connection Failed at 10.0.0.5' });
    writes.push(params);
    rows[params[0]] = { ...(rows[params[0]] || { is_enabled: 1, selected_coupons: '[{"id":"keep"}]' }), custom_coupons: params[1] };
    return json({ success: true, affectedRows: 1 });
  }
  throw new Error(`unhandled SQL in test: ${q.slice(0, 80)}`);
};

const { addCustomCoupon, listCustomCoupons } = await import('../../app/services/coupon-banner.server.js');
const { validateCustomCouponCode, customCouponId, isCustomCouponId } = await import('../../app/config/coupon-banner.js');

const SHOP = 'demo.myshopify.com';
let shopifyCodes = ['SAVE10'];
const fakeAdmin = {
  graphql: async () => {
    return { json: async () => ({ data: { discountNodes: { edges: shopifyCodes.map((code, i) => ({ node: { id: `gid://shopify/DiscountCodeNode/${i + 1}`, discount: { title: code, status: 'ACTIVE', codes: { edges: [{ node: { code } }] } } } })) } } }) };
  },
  // Any discount mutation here would mean BRIX created/changed a discount.
  mutations: [],
};
const ctx = { shop: SHOP, admin: fakeAdmin };

beforeEach(() => { reset(); shopifyCodes = ['SAVE10']; });

test('validation: empty / whitespace rejected, trimmed, case kept, duplicates case-insensitive', () => {
  assert.equal(validateCustomCouponCode('').error, 'empty');
  assert.equal(validateCustomCouponCode('   ').error, 'empty');
  assert.deepEqual(validateCustomCouponCode('  ShipRocket10 '), { code: 'ShipRocket10' });
  assert.equal(validateCustomCouponCode('save10', ['SAVE10']).message, 'Coupon already exists.');
  assert.equal(validateCustomCouponCode('x'.repeat(256)).error, 'too_long');
  assert.equal(customCouponId('SHIPROCKET10'), 'custom:SHIPROCKET10');
  assert.equal(isCustomCouponId('custom:A'), true);
  assert.equal(isCustomCouponId('gid://shopify/DiscountCodeNode/1'), false);
});

test('adds an external code: self-heals the column, stores only custom_coupons, returns a selectable coupon', async () => {
  const r = await addCustomCoupon(ctx, '  SHIPROCKET10 ');
  assert.equal(r.success, true);
  assert.deepEqual({ id: r.coupon.id, code: r.coupon.code, type: r.coupon.type, source: r.coupon.source }, { id: 'custom:SHIPROCKET10', code: 'SHIPROCKET10', type: 'custom', source: 'external' });
  assert.equal(alters.length, 1);
  assert.match(alters[0], /ADD COLUMN `custom_coupons` LONGTEXT NULL/);
  assert.equal(rows[SHOP].is_enabled, 1, 'other columns untouched');
  assert.equal(rows[SHOP].selected_coupons, '[{"id":"keep"}]', 'cart drawer coupon slider column untouched');
  const list = await listCustomCoupons(SHOP);
  assert.deepEqual(list.map((c) => c.code), ['SHIPROCKET10']);
});

test('duplicate of a custom code or an active Shopify code is refused and nothing is written', async () => {
  await addCustomCoupon(ctx, 'SHIPROCKET10');
  const again = await addCustomCoupon(ctx, 'shiprocket10');
  assert.deepEqual([again.success, again.error, again.message], [false, 'duplicate', 'Coupon already exists.']);
  const shopifyDup = await addCustomCoupon(ctx, 'save10');
  assert.equal(shopifyDup.error, 'duplicate');
  assert.equal(writes.length, 1);
  assert.equal((await listCustomCoupons(SHOP)).length, 1);
});

test('newest custom coupon first; list survives a "refresh" (fresh read)', async () => {
  await addCustomCoupon(ctx, 'FIRST5');
  await addCustomCoupon(ctx, 'SECOND15');
  assert.deepEqual((await listCustomCoupons(SHOP)).map((c) => c.code), ['SECOND15', 'FIRST5']);
});

test('no discount is created: only the read-only DiscountList query is sent to Shopify', async () => {
  const queries = [];
  const spyAdmin = { graphql: async (q) => { queries.push(q); return fakeAdmin.graphql(q); } };
  await addCustomCoupon({ shop: SHOP, admin: spyAdmin }, 'EXTERNAL1');
  assert.ok(queries.length >= 1);
  assert.ok(queries.every((q) => q.includes('DiscountList') && !/mutation/i.test(q)));
});

test('storage failure -> friendly message, no SQL or host leaked', async () => {
  failWrites = true;
  const r = await addCustomCoupon(ctx, 'FAILME');
  assert.equal(r.success, false);
  assert.equal(r.message, 'Couldn’t add the coupon right now. Please try again.');
  assert.doesNotMatch(r.message, /SQL|10\.0|Connection/);
});

test('shop with no custom coupons (or no row) lists nothing', async () => {
  assert.deepEqual(await listCustomCoupons('other.myshopify.com'), []);
});

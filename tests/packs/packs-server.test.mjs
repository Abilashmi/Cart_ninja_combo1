// Run with: node --import ./tests/packs/register.mjs --test tests/packs
// Exercises app/services/packs.server.js and packs-shopify.server.js WITHOUT
// touching any real database or Shopify store: global fetch is replaced by an
// in-memory emulation of php_backend/db_proxy.php, and Admin API calls go to a
// fake `admin` object.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSaveStatus } from '../../app/utils/packs.shared.js';

process.env.SHOPIFY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;

// ── in-memory brix_packs table behind a fake db_proxy ──────────────────────────
let rows = [];
let nextId = 1;
let mode = 'ok'; // 'ok' | 'missing_table' | 'db_down'
const COLS = ['shop_domain', 'product_id', 'variant_id', 'product_title', 'variant_title', 'product_image', 'base_price', 'status', 'enabled', 'template', 'tiers_json', 'customization_json'];

function respond(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

globalThis.fetch = async (url, init) => {
  if (!String(url).endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql, params } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  if (mode === 'missing_table') return respond({ success: false, error: "SQLSTATE[42S02]: Base table or view not found: 1146 Table 'u123_secretdb.brix_packs' doesn't exist" }, 500);
  if (mode === 'db_down') return respond({ success: false, error: 'DB Connection Failed: Access denied for user u123@10.0.0.9 (password: YES)' }, 500);
  const live = (predicate) => rows.filter(predicate);
  const dupe = (candidate, ignoreId) => rows.some((row) => row.id !== ignoreId && row.shop_domain === candidate.shop_domain && row.product_id === candidate.product_id && row.variant_id === candidate.variant_id);

  if (q.startsWith('SELECT * FROM brix_packs WHERE shop_domain = ? ORDER BY')) return respond({ success: true, rows: live((r) => r.shop_domain === params[0]) });
  if (q.startsWith('SELECT * FROM brix_packs WHERE id = ? AND shop_domain = ?')) return respond({ success: true, rows: live((r) => r.id === params[0] && r.shop_domain === params[1]) });
  if (q.includes("status = 'active' AND enabled = 1 AND product_id IN (?, ?)")) return respond({ success: true, rows: live((r) => r.shop_domain === params[0] && r.status === 'active' && r.enabled === 1 && [params[1], params[2]].includes(r.product_id)) });
  if (q.includes("status = 'active' AND enabled = 1") && q.startsWith('SELECT * FROM brix_packs WHERE shop_domain = ?')) return respond({ success: true, rows: live((r) => r.shop_domain === params[0] && r.status === 'active' && r.enabled === 1) });
  if (q.startsWith('SELECT id FROM brix_packs WHERE shop_domain = ? AND product_id IN')) return respond({ success: true, rows: live((r) => r.shop_domain === params[0] && [params[1], params[2]].includes(r.product_id) && [params[3], params[4]].includes(r.variant_id)) });
  if (q.startsWith('INSERT INTO brix_packs')) {
    const row = { id: nextId, version: 1, created_at: 'now', updated_at: 'now' };
    COLS.forEach((col, index) => { row[col] = params[index]; });
    if (dupe(row, null)) return respond({ success: false, error: "SQLSTATE[23000]: Integrity constraint violation: 1062 Duplicate entry 'shop-1-2' for key 'brix_packs_shop_variant'" }, 500);
    rows.push(row);
    nextId += 1;
    return respond({ success: true, insertId: row.id, affectedRows: 1 });
  }
  if (q.startsWith('UPDATE brix_packs SET product_id=?')) {
    const target = rows.find((r) => r.id === params[11] && r.shop_domain === params[12]);
    if (!target) return respond({ success: true, affectedRows: 0 });
    const next = { ...target, product_id: params[0], variant_id: params[1] };
    if (dupe(next, target.id)) return respond({ success: false, error: 'Duplicate entry for key brix_packs_shop_variant' }, 500);
    ['product_id', 'variant_id', 'product_title', 'variant_title', 'product_image', 'base_price', 'status', 'enabled', 'template'].forEach((col, i) => { target[col] = params[i]; });
    target.tiers_json = params[9]; target.customization_json = params[10]; target.version += 1;
    return respond({ success: true, affectedRows: 1 });
  }
  if (q.startsWith('UPDATE brix_packs SET status=?')) {
    const target = rows.find((r) => r.id === params[2] && r.shop_domain === params[3]);
    if (target) { target.status = params[0]; target.enabled = params[1]; target.version += 1; }
    return respond({ success: true, affectedRows: target ? 1 : 0 });
  }
  if (q.startsWith('DELETE FROM brix_packs')) {
    const before = rows.length;
    rows = rows.filter((r) => !(r.id === params[0] && r.shop_domain === params[1]));
    return respond({ success: true, affectedRows: before - rows.length });
  }
  return respond({ success: false, error: `unhandled SQL in test: ${q}` }, 500);
};

const { PackError, savePack, getPack, listPacks, listActivePacksForProduct, deletePack, setPackStatus, findDuplicatePack, packErrorResponse } = await import('../../app/services/packs.server.js');
const shopify = await import('../../app/services/packs-shopify.server.js');

const base = (over = {}) => ({ productId: '100', variantId: '200', productTitle: 'Tee', variantTitle: 'M', productImage: '', basePrice: 80, status: 'draft', template: 'same_variant', tiers: [{ name: '', quantity: 1, discountType: 'none', discountValue: 0, badge: '' }, { name: '', quantity: 3, discountType: 'percentage', discountValue: 10, badge: 'Best' }], customization: {}, ...over });
beforeEach(() => { rows = []; nextId = 1; mode = 'ok'; });

test('resolveSaveStatus: server-side plan gate (Free/Starter/Pro)', () => {
  // Free plan = 'preview': drafts OK, activating (even via action=save) is refused
  assert.deepEqual(resolveSaveStatus({ requested: 'draft', planState: 'preview' }), { status: 'draft' });
  assert.deepEqual(resolveSaveStatus({ requested: 'active', planState: 'preview' }), { error: 'plan_restricted' });
  assert.deepEqual(resolveSaveStatus({ requested: 'keep', existingStatus: 'active', planState: 'preview' }), { status: 'inactive' }); // downgraded shop can't stay live
  assert.deepEqual(resolveSaveStatus({ requested: 'keep', existingStatus: 'draft', planState: 'preview' }), { status: 'draft' });
  // Starter / Pro = 'enabled'
  assert.deepEqual(resolveSaveStatus({ requested: 'active', planState: 'enabled' }), { status: 'active' });
  assert.deepEqual(resolveSaveStatus({ requested: 'keep', existingStatus: 'active', planState: 'enabled' }), { status: 'active' });
  assert.deepEqual(resolveSaveStatus({ requested: 'hacked', planState: 'enabled' }), { error: 'invalid_status' });
});

test('plans config: Free=preview, Starter/Pro=enabled', async () => {
  const { getFeatureState } = await import('../../app/config/plans.js');
  assert.equal(getFeatureState('free', 'packs'), 'preview');
  assert.equal(getFeatureState('starter', 'packs'), 'enabled');
  assert.equal(getFeatureState('pro', 'packs'), 'enabled');
});

test('save + read round trip; ids stored numeric; customization deep-merged with defaults', async () => {
  const pack = await savePack('a.myshopify.com', base({ productId: 'gid://shopify/Product/100', variantId: 'gid://shopify/ProductVariant/200', customization: { colors: { primary: '#ff0000' } } }));
  assert.equal(pack.productId, '100');
  assert.equal(pack.variantId, '200');
  assert.equal(pack.customization.colors.primary, '#ff0000');
  assert.equal(pack.customization.colors.text, '#202223'); // untouched default survived
  assert.equal(pack.customization.typography.headingSize, 20);
  assert.equal(pack.customization.spacing.cardGap, 10);
  // update touching a different group must not reset colors
  const updated = await savePack('a.myshopify.com', base({ id: pack.id, customization: { typography: { headingSize: 30 } } }));
  assert.equal(updated.customization.colors.primary, '#ff0000');
  assert.equal(updated.customization.typography.headingSize, 30);
  assert.equal(updated.version, 2);
});

test('duplicate product+variant is a clear PackError with the existing id; other shops/variants are fine', async () => {
  const first = await savePack('a.myshopify.com', base());
  await assert.rejects(() => savePack('a.myshopify.com', base()), (error) => error instanceof PackError && error.code === 'duplicate' && error.status === 409 && error.details.existingId === first.id && !/SQL|Duplicate entry/.test(error.message));
  await savePack('b.myshopify.com', base());
  await savePack('a.myshopify.com', base({ variantId: '201' }));
  // editing pack #2 into pack #1's variant is refused, editing in place is not
  const other = await savePack('a.myshopify.com', base({ variantId: '202' }));
  await assert.rejects(() => savePack('a.myshopify.com', base({ id: other.id, variantId: '200' })), (error) => error.code === 'duplicate');
  await savePack('a.myshopify.com', base({ id: other.id, variantId: '202', productTitle: 'Renamed' }));
  assert.equal(await findDuplicatePack('a.myshopify.com', '100', '200', first.id), null);
});

test('shop isolation: another shop cannot read, edit, delete or activate a pack', async () => {
  const pack = await savePack('a.myshopify.com', base());
  assert.equal(await getPack('b.myshopify.com', pack.id), null);
  await assert.rejects(() => savePack('b.myshopify.com', base({ id: pack.id })), (error) => error.code === 'not_found');
  assert.equal(await deletePack('b.myshopify.com', pack.id), false);
  await assert.rejects(() => setPackStatus('b.myshopify.com', pack.id, 'active'), (error) => error.code === 'not_found');
  assert.equal((await listPacks('b.myshopify.com')).length, 0);
});

test('active-pack lookup matches product ids exactly (123 never matches 1123), both id spellings', async () => {
  await savePack('a.myshopify.com', base({ productId: '1123', variantId: '5', status: 'active' }));
  await savePack('a.myshopify.com', base({ productId: '123', variantId: '6', status: 'active' }));
  rows.push({ ...rows[0], id: 99, product_id: 'gid://shopify/Product/777', variant_id: '7' }); // legacy GID-format row from the prototype
  const hit = await listActivePacksForProduct('a.myshopify.com', '123');
  assert.deepEqual(hit.map((pack) => pack.productId), ['123']);
  assert.equal((await listActivePacksForProduct('a.myshopify.com', 'gid://shopify/Product/777')).length, 1);
  assert.equal((await listActivePacksForProduct('a.myshopify.com', '23')).length, 0);
  await assert.rejects(() => listActivePacksForProduct('a.myshopify.com', 'abc'), (error) => error.code === 'invalid_product');
});

test('draft packs are never returned to the storefront lookup; status changes and delete work', async () => {
  const pack = await savePack('a.myshopify.com', base());
  assert.equal((await listActivePacksForProduct('a.myshopify.com', '100')).length, 0);
  const active = await setPackStatus('a.myshopify.com', pack.id, 'active');
  assert.equal(active.status, 'active');
  assert.equal((await listActivePacksForProduct('a.myshopify.com', '100')).length, 1);
  await setPackStatus('a.myshopify.com', pack.id, 'inactive');
  assert.equal((await listActivePacksForProduct('a.myshopify.com', '100')).length, 0);
  assert.equal(await deletePack('a.myshopify.com', pack.id), true);
  assert.equal(await getPack('a.myshopify.com', pack.id), null);
});

test('invalid pack ids are rejected before touching the database', async () => {
  for (const bad of ['abc', '1; DROP TABLE brix_packs', '', null, '-1']) {
    await assert.rejects(() => getPack('a.myshopify.com', bad), (error) => error.code === 'invalid_id');
  }
});

test('database failures never leak SQL, hosts or credentials', async () => {
  mode = 'missing_table';
  await assert.rejects(() => listPacks('a.myshopify.com'), (error) => error.code === 'storage_not_ready' && /create_brix_packs\.sql/.test(error.message) && !/u123|secretdb|SQLSTATE/.test(error.message));
  mode = 'db_down';
  const failure = await listPacks('a.myshopify.com').catch((error) => error);
  assert.equal(failure.code, 'database_error');
  assert.doesNotMatch(failure.message, /u123|10\.0\.0\.9|password|Access denied/i);
  const response = packErrorResponse(failure);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'success']);
  const generic = packErrorResponse(new Error('SELECT secret FROM users; token shpat_abc'));
  assert.equal(generic.status, 500);
  assert.doesNotMatch(JSON.stringify(await generic.json()), /shpat|SELECT/);
});

// ── Shopify layer (fake admin) ─────────────────────────────────────────────────
function fakeAdmin(handler) {
  return { graphql: async (query, options) => ({ json: async () => handler(query, options?.variables || {}) }) };
}

test('verifyProductVariant trusts only Shopify data and explains failures', async () => {
  const product = { id: 'gid://shopify/Product/100', title: 'Tee', handle: 'tee', status: 'ACTIVE', featuredImage: { url: 'x.png' }, variants: { nodes: [{ id: 'gid://shopify/ProductVariant/200', title: 'M', price: '80.00', availableForSale: true, inventoryQuantity: 5, inventoryPolicy: 'DENY', image: null }, { id: 'gid://shopify/ProductVariant/201', title: 'L', price: '90.00', availableForSale: false, inventoryQuantity: 0, inventoryPolicy: 'DENY', image: null }] } };
  const admin = fakeAdmin(() => ({ data: { product } }));
  const ok = await shopify.verifyProductVariant(admin, '100', '200');
  assert.equal(ok.variant.price, 80);
  assert.equal(ok.variant.maxQuantity, 5);
  await assert.rejects(() => shopify.verifyProductVariant(admin, '100', '999'), (error) => error.code === 'variant_not_found');
  await assert.rejects(() => shopify.verifyProductVariant(admin, '100', '201', { requireAvailable: true }), (error) => error.code === 'variant_unavailable');
  await assert.rejects(() => shopify.verifyProductVariant(fakeAdmin(() => ({ data: { product: null } })), '100', '200'), (error) => error.code === 'product_not_found');
  await assert.rejects(() => shopify.verifyProductVariant(fakeAdmin(() => ({ errors: [{ message: 'token shpat_secret invalid' }] })), '100', '200'), (error) => error.code === 'shopify_error' && !/shpat/.test(error.message));
});

test('hydratePacks recalculates every tier from the LIVE price and flags broken packs', async () => {
  const stored = await savePack('a.myshopify.com', base({ basePrice: 1 })); // stale cached price of 1
  const missing = await savePack('a.myshopify.com', base({ variantId: '999' }));
  const admin = fakeAdmin(() => ({ data: { nodes: [{ id: 'gid://shopify/ProductVariant/200', title: 'M', price: '80.00', availableForSale: true, inventoryQuantity: 0, inventoryPolicy: 'CONTINUE', image: null, product: { id: 'gid://shopify/Product/100', title: 'Tee', handle: 'tee', status: 'ACTIVE', featuredImage: null } }] } }));
  const [fresh, broken] = await shopify.hydratePacks(admin, [stored, missing], { code: 'INR', locale: 'en-IN' });
  const three = fresh.tiers.find((tier) => tier.quantity === 3);
  assert.equal(fresh.priceVerified, true);
  assert.equal(three.price, 216);
  assert.equal(three.savings, 24);
  assert.equal(three.effectiveUnitPrice, 72);
  assert.match(three.formatted.price, /₹/);
  assert.equal(broken.priceVerified, false);
  assert.equal(broken.displayStatus, 'draft'); // only ACTIVE packs escalate to configuration_error
  const activeBroken = { ...missing, status: 'active' };
  assert.equal((await shopify.hydratePacks(admin, [activeBroken], { code: 'INR' }))[0].displayStatus, 'configuration_error');
  // a Shopify outage must not throw and must not present a price as verified
  const down = await shopify.hydratePacks(fakeAdmin(() => { throw new Error('boom'); }), [stored], { code: 'INR' });
  assert.equal(down[0].priceVerified, false);
});

test('checkout discount status is only "verified" when discount is ACTIVE and config is in sync', async () => {
  const pack = { id: 7, version: 2, variantId: '200' };
  const discount = (status) => ({ data: { automaticDiscountNodes: { nodes: [{ id: 'gid://shopify/DiscountAutomaticNode/1', automaticDiscount: { __typename: 'DiscountAutomaticApp', title: 'BRIX Packs', status } }] } } });
  const config = (packs) => ({ data: { shop: { metafield: { jsonValue: { version: 1, packs } } } } });
  const make = (disc, cfg) => fakeAdmin((query) => (query.includes('PackDiscounts') ? disc : cfg));
  assert.equal((await shopify.getCheckoutDiscountStatus(make({ data: { automaticDiscountNodes: { nodes: [] } } }, config({})), [pack])).state, 'discount_missing');
  assert.equal((await shopify.getCheckoutDiscountStatus(make(discount('EXPIRED'), config({})), [pack])).state, 'discount_inactive');
  assert.equal((await shopify.getCheckoutDiscountStatus(make(discount('ACTIVE'), config({})), [pack])).state, 'config_out_of_date');
  assert.equal((await shopify.getCheckoutDiscountStatus(make(discount('ACTIVE'), config({ 7: { id: 7, version: 1 } })), [pack])).state, 'config_out_of_date'); // stale version
  const good = await shopify.getCheckoutDiscountStatus(make(discount('ACTIVE'), config({ 7: { id: 7, version: 2 } })), [pack]);
  assert.equal(good.verified, true);
  assert.equal((await shopify.getCheckoutDiscountStatus(fakeAdmin(() => { throw new Error('down'); }), [pack])).verified, false);
});

test('ensurePacksDiscount reports an undeployed function instead of pretending it worked', async () => {
  const admin = fakeAdmin((query) => (query.includes('PackDiscounts')
    ? { data: { automaticDiscountNodes: { nodes: [] } } }
    : { data: { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: [{ field: ['automaticAppDiscount', 'functionHandle'], message: 'Could not find Function brix-packs-discount', code: 'INVALID' }] } } }));
  await assert.rejects(() => shopify.ensurePacksDiscount(admin), (error) => error.code === 'function_not_deployed');
  const sync = await shopify.syncCheckoutDiscount(fakeAdmin((query) => {
    if (query.includes('PackShopId')) return { data: { shop: { id: 'gid://shopify/Shop/1' } } };
    if (query.includes('PackConfig')) return { data: { metafieldsSet: { metafields: [{ id: 'm' }], userErrors: [] } } };
    if (query.includes('PackDiscounts')) return { data: { automaticDiscountNodes: { nodes: [] } } };
    return { data: { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: [{ message: 'Could not find Function', code: 'INVALID' }] } } };
  }), [{ id: 1, version: 1, productId: '1', variantId: '2', template: 'same_variant', tiers: [] }], { currencyCode: 'INR' });
  assert.equal(sync.ok, false);
  assert.equal(sync.warning.code, 'function_not_deployed');
});

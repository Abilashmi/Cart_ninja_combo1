/* global globalThis */
// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight
// app/services/combo-weight-shopify.server.js against a fake Admin API and a
// fake DB proxy (no store, no database). Proves what BRIX writes to Shopify
// and what it reports; not that Shopify then applies the discount.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeightPricing } from '../../app/utils/combo-weight.shared.js';

/* ── fake DB proxy (php_backend/db_proxy.php) ─────────────────────────────── */
const db = { plan: 'pro', templates: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('db_proxy.php')) return realFetch(url, init);
  const { sql } = JSON.parse(init.body);
  let rows = [];
  if (/FROM shops/i.test(sql) && /^\s*SELECT/i.test(sql)) rows = [{ plan_key: db.plan, plan_name: db.plan, subscription_id: 'x', plan_synced_at: new Date().toISOString() }];
  else if (/FROM combo_templates/i.test(sql)) rows = db.templates;
  return new Response(JSON.stringify({ success: true, rows, insertId: 0, affectedRows: 0 }));
};

const sync = await import('../../app/services/combo-weight-shopify.server.js');

let shopNo = 0;
const nextShop = () => `shop${++shopNo}.myshopify.com`; // getShopPlan caches per shop

const pricing = (patch = {}) => ({
  unit: 'kg', max_grams: 2200,
  tiers: [{ min_grams: 1000, type: 'percentage', value: 10 }, { min_grams: 2000, type: 'fixed_price', value: 1700 }],
  ...patch,
});
const row = (id, { active = 1, layout = 'layout1', weight = pricing(), mode = 'weight', extra = {} } = {}) => ({
  id, is_active: active,
  customization_data: JSON.stringify({ layout, step_1_collection: 'books', pricing_mode: mode, weight_pricing: weight, ...extra }),
});

function fakeAdmin({ discount = null, createErrors = [], activateErrors = [], storedConfig = null, collections = { books: 'gid://shopify/Collection/900' } } = {}) {
  const calls = [];
  const state = { discount, config: storedConfig, metafields: [] };
  return {
    calls, state,
    async graphql(query, { variables } = {}) {
      const op = /(query|mutation)\s+(\w+)/.exec(query)[2];
      calls.push({ op, variables });
      let data;
      if (op === 'ComboWeightShop') {
        data = { shop: { id: 'gid://shopify/Shop/1', currencyCode: 'INR', metafield: state.config ? { jsonValue: state.config } : null } };
      } else if (op === 'ComboWeightCollections') {
        data = Object.fromEntries(Object.entries(variables).map(([k, handle]) => [`c${k.slice(1)}`, collections[handle] ? { id: collections[handle] } : null]));
      } else if (op === 'ComboWeightMetafields') {
        for (const m of variables.metafields) {
          state.metafields.push(m);
          if (m.key === 'combo_weight_config') state.config = JSON.parse(m.value);
        }
        data = { metafieldsSet: { metafields: [], userErrors: [] } };
      } else if (op === 'ComboWeightDiscounts') {
        data = { discountNodes: { nodes: state.discount ? [{ id: 'gid://shopify/DiscountAutomaticNode/5', discount: { __typename: 'DiscountAutomaticApp', title: 'BRIX Combo Weight', status: state.discount } }] : [] } };
      } else if (op === 'ComboWeightDiscountCreate') {
        if (createErrors.length) data = { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: createErrors } };
        else {
          state.discount = 'ACTIVE';
          data = { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: 'gid://shopify/DiscountAutomaticNode/5', status: 'ACTIVE' }, userErrors: [] } };
        }
      } else if (op === 'ComboWeightDiscountActivate') {
        if (!activateErrors.length) state.discount = 'ACTIVE';
        data = { discountAutomaticActivate: {
          automaticDiscountNode: { id: variables.id, automaticDiscount: { __typename: 'DiscountAutomaticApp', status: state.discount } },
          userErrors: activateErrors,
        } };
      } else {
        throw new Error(`fake admin: unhandled op ${op}`);
      }
      return new Response(JSON.stringify({ data }));
    },
  };
}

beforeEach(() => { db.plan = 'pro'; db.templates = []; });

test('build: only active, valid weight templates on a plan that has it', () => {
  const t = (id, patch = {}) => ({ id, active: true, config: { layout: 'layout1', step_1_collection: 'books' }, ...normalizeWeightPricing(pricing()), ...patch });
  const templates = [
    { ...t(1) , pricing: normalizeWeightPricing(pricing()).value },
    { ...t(2), active: false, pricing: normalizeWeightPricing(pricing()).value },
    { ...t(3), pricing: normalizeWeightPricing(pricing()).value, errors: [{ field: 'tiers' }] },
    { ...t(4), pricing: normalizeWeightPricing(pricing()).value, config: { layout: 'layout1', step_1_collection: 'missing' } },
  ];
  templates.forEach((x) => { x.errors = x.errors || []; });
  const built = sync.buildComboWeightFunctionConfig({ templates, planLive: true, currencyCode: 'INR', collectionIdsByHandle: { books: 'gid://shopify/Collection/900' } });
  assert.deepEqual(built.included, [1]);
  assert.deepEqual(built.skipped.map((s) => [s.id, s.reason]), [[2, 'inactive'], [3, 'invalid'], [4, 'no_products']]);
  const entry = built.config.templates['1'];
  assert.equal(entry.hash, normalizeWeightPricing(pricing()).value.hash);
  assert.deepEqual(entry.collection_ids, ['900']);
  assert.deepEqual(entry.tiers.map((x) => x.label), ['1 kg box discount', '2 kg box discount'], 'labels filled in for the checkout message');
  assert.deepEqual(built.variables, { collectionIds: ['gid://shopify/Collection/900'] });
  assert.equal(built.config.currency, 'INR');

  const notPro = sync.buildComboWeightFunctionConfig({ templates, planLive: false });
  assert.deepEqual(notPro.included, []);
  assert.deepEqual(notPro.config.templates, {});
});

test('build: "selected" products and collections are used as chosen', () => {
  const value = normalizeWeightPricing(pricing({ qualify: { mode: 'selected', product_ids: ['gid://shopify/Product/5'], collection_ids: ['gid://shopify/Collection/7'] } })).value;
  const built = sync.buildComboWeightFunctionConfig({ templates: [{ id: 9, active: true, config: {}, pricing: value, errors: [] }], planLive: true });
  assert.deepEqual(built.config.templates['9'].product_ids, ['5']);
  assert.deepEqual(built.config.templates['9'].collection_ids, ['7']);
});

test('weightPricingLive: only Pro + active + ACTIVE discount + matching hash', () => {
  const status = { discountActive: true, hashes: { 12: 'abc' } };
  assert.equal(sync.weightPricingLive({ planLive: true, active: true, hash: 'abc', templateId: 12, status }), true);
  assert.equal(sync.weightPricingLive({ planLive: false, active: true, hash: 'abc', templateId: 12, status }), false);
  assert.equal(sync.weightPricingLive({ planLive: true, active: false, hash: 'abc', templateId: 12, status }), false);
  assert.equal(sync.weightPricingLive({ planLive: true, active: true, hash: 'old', templateId: 12, status }), false);
  assert.equal(sync.weightPricingLive({ planLive: true, active: true, hash: 'abc', templateId: 12, status: { ...status, discountActive: false } }), false);
});

test('weightPricingReason: says exactly why the box discount is not live', () => {
  const status = { discountActive: true, discountState: 'active', hashes: { 12: 'abc' } };
  const base = { planLive: true, active: true, hash: 'abc', templateId: 12, status };
  assert.equal(sync.weightPricingReason(base), null);
  assert.equal(sync.weightPricingReason({ ...base, planLive: false }), 'plan_locked');
  assert.equal(sync.weightPricingReason({ ...base, invalid: true }), 'invalid');
  assert.equal(sync.weightPricingReason({ ...base, active: false }), 'inactive');
  assert.equal(sync.weightPricingReason({ ...base, status: { discountActive: false, discountState: 'missing', hashes: {} } }), 'discount_missing');
  assert.equal(sync.weightPricingReason({ ...base, status: { discountActive: false, discountState: 'expired', hashes: {} } }), 'discount_expired');
  assert.equal(sync.weightPricingReason({ ...base, status: { discountActive: false, discountState: 'error', hashes: {} } }), 'discount_unknown');
  assert.equal(sync.weightPricingReason({ ...base, hash: 'new' }), 'out_of_date');
});

test('sync on Pro: writes the config, creates the discount with its input variables, verified', async () => {
  db.templates = [row(12), row(13, { mode: 'count' })];
  const admin = fakeAdmin();
  const result = await sync.syncComboWeightDiscount(admin, nextShop());
  assert.equal(result.state, 'active');
  assert.equal(result.verified, true);
  assert.deepEqual(result.included, [12]);
  assert.equal(result.templates[12].verified, true);
  assert.deepEqual(Object.keys(admin.state.config.templates), ['12'], 'count combos never reach the Function');

  const create = admin.calls.find((c) => c.op === 'ComboWeightDiscountCreate').variables.discount;
  assert.equal(create.title, 'BRIX Combo Weight');
  assert.equal(create.functionHandle, 'brix-combo-weight-discount');
  assert.deepEqual(create.discountClasses, ['PRODUCT']);
  assert.deepEqual(create.combinesWith, { productDiscounts: false, orderDiscounts: true, shippingDiscounts: true });
  assert.deepEqual(create.metafields, [{ namespace: '$app', key: 'combo_weight_vars', type: 'json', value: JSON.stringify({ collectionIds: ['gid://shopify/Collection/900'] }) }]);

  // A second sync updates the variables on the existing discount instead of creating another.
  const again = fakeAdmin({ discount: 'ACTIVE' });
  await sync.syncComboWeightDiscount(again, nextShop());
  assert.ok(!again.calls.some((c) => c.op === 'ComboWeightDiscountCreate'));
  assert.ok(again.state.metafields.some((m) => m.ownerId === 'gid://shopify/DiscountAutomaticNode/5' && m.key === 'combo_weight_vars'));
});

test('sync not on Pro: the Function config is emptied and nothing is created', async () => {
  db.plan = 'starter';
  db.templates = [row(12)];
  const admin = fakeAdmin({ storedConfig: { version: 1, templates: { 12: { hash: 'x' } } } });
  const result = await sync.syncComboWeightDiscount(admin, nextShop());
  assert.equal(result.state, 'plan_locked');
  assert.equal(result.verified, false);
  assert.deepEqual(admin.state.config.templates, {});
  assert.ok(!admin.calls.some((c) => c.op === 'ComboWeightDiscountCreate'));
  assert.match(result.templates[12].message, /Pro plan/);
});

test('sync: inactive templates are dropped; nothing stored and nothing wanted → no writes', async () => {
  db.templates = [row(12, { active: 0 })];
  const admin = fakeAdmin();
  const result = await sync.syncComboWeightDiscount(admin, nextShop());
  assert.equal(result.state, 'not_needed');
  assert.equal(result.templates[12].verified, false);
  assert.ok(!admin.calls.some((c) => c.op === 'ComboWeightMetafields'), 'no config to clear, no write');
});

test('sync: an expired box discount (deactivated in Shopify admin) is turned back on', async () => {
  db.templates = [row(12)];
  const admin = fakeAdmin({ discount: 'EXPIRED' });
  const result = await sync.syncComboWeightDiscount(admin, nextShop());
  assert.ok(admin.calls.some((c) => c.op === 'ComboWeightDiscountActivate' && c.variables.id === 'gid://shopify/DiscountAutomaticNode/5'));
  assert.equal(result.state, 'active');
  assert.equal(result.verified, true);
});

test('sync: Function not deployed, discount turned off, and too-large configs are reported honestly', async () => {
  db.templates = [row(12)];
  const notDeployed = await sync.syncComboWeightDiscount(fakeAdmin({ createErrors: [{ field: ['functionHandle'], message: 'Function not found', code: 'INVALID' }] }), nextShop());
  assert.equal(notDeployed.state, 'not_deployed');
  assert.equal(notDeployed.verified, false);
  assert.match(notDeployed.message, /deployed/);

  const scheduled = await sync.syncComboWeightDiscount(fakeAdmin({ discount: 'SCHEDULED' }), nextShop());
  assert.equal(scheduled.state, 'inactive', 'a scheduled discount is left alone');
  assert.equal(scheduled.verified, false);

  const refused = fakeAdmin({ discount: 'EXPIRED', activateErrors: [{ field: null, message: 'nope', code: 'INVALID' }] });
  const off = await sync.syncComboWeightDiscount(refused, nextShop());
  assert.equal(off.state, 'inactive', 'still reported when Shopify will not reactivate it');
  assert.equal(off.verified, false);

  const many = Array.from({ length: 50 }, (_, i) => `gid://shopify/Product/${1000000000000 + i}`);
  db.templates = Array.from({ length: 12 }, (_, i) => row(100 + i, { weight: pricing({ qualify: { mode: 'selected', product_ids: many } }) }));
  const big = fakeAdmin();
  const tooLarge = await sync.syncComboWeightDiscount(big, nextShop());
  assert.equal(tooLarge.state, 'too_large');
  assert.ok(!big.calls.some((c) => c.op === 'ComboWeightMetafields'), 'an oversized config is never written');
});

test('sync: too large still stops discounting combos that were deleted, turned off or changed', async () => {
  const many = Array.from({ length: 50 }, (_, i) => `gid://shopify/Product/${1000000000000 + i}`);
  db.templates = Array.from({ length: 12 }, (_, i) => row(100 + i, { weight: pricing({ qualify: { mode: 'selected', product_ids: many } }) }));
  const shop = nextShop();
  const current = sync.buildComboWeightFunctionConfig({ templates: await sync.loadWeightTemplates(shop), planLive: true, currencyCode: 'INR' });
  const stored = { version: 1, currency: 'INR', templates: {
    100: current.config.templates[100], // unchanged: stays
    101: { ...current.config.templates[101], hash: 'old-pricing' }, // changed since: dropped
    999: { id: 999, hash: 'deleted', tiers: [{ min_grams: 1, type: 'percentage', value: 50 }] }, // deleted: dropped
  } };
  const admin = fakeAdmin({ discount: 'ACTIVE', storedConfig: stored });
  const result = await sync.syncComboWeightDiscount(admin, shop);
  assert.equal(result.state, 'too_large');
  assert.deepEqual(Object.keys(admin.state.config.templates), ['100']);
  assert.deepEqual(admin.state.config.templates[100], current.config.templates[100]);

  const again = fakeAdmin({ discount: 'ACTIVE', storedConfig: admin.state.config });
  await sync.syncComboWeightDiscount(again, shop);
  assert.ok(!again.calls.some((c) => c.op === 'ComboWeightMetafields'), 'nothing to drop, no write');
});

test('sync never throws when Shopify is unreachable', async () => {
  db.templates = [row(12)];
  const broken = { graphql: async () => { throw new Error('network down'); } };
  const result = await sync.syncComboWeightDiscount(broken, nextShop());
  assert.equal(result.state, 'failed');
  assert.equal(result.verified, false);
});

test('syncComboWeightIfNeeded: only weight combos cause Shopify calls', async () => {
  const admin = fakeAdmin();
  assert.equal(await sync.syncComboWeightIfNeeded(admin, nextShop(), JSON.stringify({ pricing_mode: 'count' }), null), null);
  assert.equal(admin.calls.length, 0);
  db.templates = [];
  const result = await sync.syncComboWeightIfNeeded(admin, nextShop(), null, { pricing_mode: 'weight' });
  assert.equal(result.state, 'not_needed', 'a template switched away from weight still clears the Function');
});

test('status: verified only when the discount is ACTIVE and the hash matches; storefront status is cached', async () => {
  const admin = fakeAdmin({ discount: 'ACTIVE', storedConfig: { version: 1, templates: { 12: { hash: 'abc' } } } });
  assert.equal((await sync.getComboWeightDiscountStatus(admin, [{ id: 12, hash: 'abc' }])).verified, true);
  assert.equal((await sync.getComboWeightDiscountStatus(admin, [{ id: 12, hash: 'new' }])).state, 'config_out_of_date');
  assert.equal((await sync.getComboWeightDiscountStatus(fakeAdmin(), [{ id: 12, hash: 'abc' }])).state, 'discount_missing');

  const shop = nextShop();
  const first = await sync.getStorefrontWeightStatus(shop, admin, 1000);
  assert.deepEqual(first, { discountActive: true, discountState: 'active', hashes: { 12: 'abc' } });
  const callsBefore = admin.calls.length;
  await sync.getStorefrontWeightStatus(shop, admin, 30_000);
  assert.equal(admin.calls.length, callsBefore, 'served from the 60 s cache');
  await sync.getStorefrontWeightStatus(shop, admin, 62_000);
  assert.ok(admin.calls.length > callsBefore, 'refreshed after 60 s');
});

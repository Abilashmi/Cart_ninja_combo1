/* eslint-env node */
/* global globalThis */
// Run with: node --import ./tests/packs/register.mjs --test tests/fbt-offer/*.test.mjs
// syncFbtOfferDiscount against an in-memory db_proxy.php (FBT tables, plan)
// and a fake Shopify Admin API — no database, store or checkout is touched.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SHOPIFY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let db;
const G = (n) => ({ id: `gid://shopify/Product/${n}`, title: `P${n}` });
function reset() {
  db = {
    plan: 'pro',
    settings: { mode: 'manual', offer_enabled: 1, offer_type: 'percentage', offer_value: '10.00', offer_text: 'Save {discount} on all {count}' },
    rules: [
      { id: 1, source: 'manual', is_active: 1, sort_order: 0, trigger_scope: 'specific_products', trigger_products: JSON.stringify([G(10)]), fbt_products: JSON.stringify([G(20), G(30)]), offer_mode: 'widget', offer_value: '0.00' },
      { id: 2, source: 'manual', is_active: 1, sort_order: 1, trigger_scope: 'specific_products', trigger_products: JSON.stringify([G(11)]), fbt_products: JSON.stringify([G(21)]), offer_mode: 'none', offer_value: '0.00' },
      { id: 3, source: 'ai', is_active: 1, sort_order: 0, trigger_scope: 'specific_products', trigger_products: JSON.stringify([G(12)]), fbt_products: JSON.stringify([G(22)]), offer_mode: 'widget', offer_value: '0.00' },
    ],
    condition: [{ id: '1', fbtProducts: [G(20), G(30)] }, { id: '2', fbtProducts: [G(21)], offer: { type: 'percentage', value: 99 } }],
    state: null,
  };
}
reset();

globalThis.fetch = async (url, init) => {
  if (!String(url).endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql, params } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  const ok = (rows) => json({ success: true, rows });
  if (q.startsWith('SELECT COLUMN_NAME FROM information_schema.COLUMNS')) {
    const cols = { fbt_rules: ['source', 'offer_mode', 'offer_value'], fbt_widget_settings: ['offer_enabled', 'offer_type', 'offer_value', 'offer_text', 'offer_state', 'offer_message'] };
    return ok((cols[params[0]] || []).map((c) => ({ COLUMN_NAME: c })));
  }
  if (q.startsWith('SELECT mode, offer_enabled')) return ok(db.settings ? [db.settings] : []);
  if (q.startsWith('SELECT * FROM fbt_rules')) return ok(db.rules.filter((r) => r.source === params[1] && r.is_active));
  if (q.startsWith('SELECT `condition` FROM fbt_widget')) return ok([{ condition: JSON.stringify(db.condition) }]);
  if (q.startsWith('UPDATE fbt_widget SET `condition`')) { db.condition = JSON.parse(params[0]); return json({ success: true, affectedRows: 1 }); }
  if (q.startsWith('UPDATE fbt_widget_settings SET offer_state')) { db.state = { state: params[0], message: params[1] }; return json({ success: true, affectedRows: 1 }); }
  if (q.startsWith('SELECT plan_key')) return ok([{ plan_key: db.plan, plan_name: db.plan, subscription_id: null, plan_synced_at: new Date().toISOString() }]);
  if (/^SHOW/i.test(q)) return ok([]); // plan tables: SHOW COLUMNS
  if (/^SELECT/i.test(q)) return ok([{ n: 1 }]);
  return json({ success: true, affectedRows: 0 });
};

const { syncFbtOfferDiscount, FBT_OFFER_DISCOUNT_TITLE } = await import('../../app/services/fbt-offer-shopify.server.js');

function fakeAdmin({ discount = null, createError = null } = {}) {
  const log = { metafield: null, created: null };
  let existing = discount;
  return {
    log,
    graphql: async (query, { variables } = {}) => {
      if (query.includes('FbtOfferShop')) return json({ data: { shop: { id: 'gid://shopify/Shop/1', currencyCode: 'INR' } } });
      if (query.includes('FbtOfferConfig')) { log.metafield = variables.metafields[0]; return json({ data: { metafieldsSet: { metafields: [{ id: 'm' }], userErrors: [] } } }); }
      if (query.includes('FbtOfferDiscounts')) {
        return json({ data: { discountNodes: { nodes: existing ? [{ id: 'gid://shopify/DiscountAutomaticNode/1', discount: { __typename: 'DiscountAutomaticApp', title: FBT_OFFER_DISCOUNT_TITLE, status: existing } }] : [] } } });
      }
      if (query.includes('FbtOfferDiscountCreate')) {
        log.created = variables.discount;
        if (createError) return json({ data: { discountAutomaticAppCreate: { automaticAppDiscount: null, userErrors: [{ field: ['functionHandle'], message: createError, code: 'INVALID' }] } } });
        existing = 'ACTIVE';
        return json({ data: { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: 'd1', status: 'ACTIVE' }, userErrors: [] } } });
      }
      throw new Error(`unexpected query ${query.slice(0, 60)}`);
    },
  };
}

beforeEach(reset);

test('first save: writes the trusted config, creates the discount, puts the offer on live rules only', async () => {
  const admin = fakeAdmin();
  const r = await syncFbtOfferDiscount(admin, 'shop-a.myshopify.com');
  assert.equal(r.verified, true);
  assert.equal(r.state, 'active');
  assert.equal(admin.log.metafield.key, 'fbt_offer_config');
  const config = JSON.parse(admin.log.metafield.value);
  assert.deepEqual(config.sets, [{ id: '1', t: ['10'], o: ['20', '30'], k: 'p', v: 10 }], 'manual rules only (mode manual); rule 2 has no offer');
  assert.equal(admin.log.created.functionHandle, 'brix-fbt-discount');
  assert.deepEqual(admin.log.created.discountClasses, ['PRODUCT']);
  assert.deepEqual(db.condition[0].offer, { type: 'percentage', value: 10, text: 'Save {discount} on all {count}' });
  assert.equal(db.condition[1].offer, undefined, 'a stale offer on a rule without one is removed');
  assert.equal(db.state.state, 'active');
});

test('discount not deployed: honest state and no offer shown on the storefront', async () => {
  const r = await syncFbtOfferDiscount(fakeAdmin({ createError: 'Function not found' }), 'shop-b.myshopify.com');
  assert.equal(r.verified, false);
  assert.equal(r.state, 'not_deployed');
  assert.ok(db.condition.every((e) => !e.offer));
});

test('discount switched off in Shopify: inactive, no offer shown', async () => {
  const r = await syncFbtOfferDiscount(fakeAdmin({ discount: 'EXPIRED' }), 'shop-c.myshopify.com');
  assert.equal(r.state, 'inactive');
  assert.ok(db.condition.every((e) => !e.offer));
});

test('offer off and no rule offers: config emptied, nothing shown, no discount created', async () => {
  db.settings.offer_enabled = 0;
  const admin = fakeAdmin();
  const r = await syncFbtOfferDiscount(admin, 'shop-d.myshopify.com');
  assert.equal(r.state, 'not_needed');
  assert.deepEqual(JSON.parse(admin.log.metafield.value).sets, []);
  assert.equal(admin.log.created, null);
  assert.ok(db.condition.every((e) => !e.offer));
});

test('AI mode uses the AI rules', async () => {
  db.settings.mode = 'ai';
  db.condition = [{ id: '3', fbtProducts: [G(22)] }];
  const admin = fakeAdmin({ discount: 'ACTIVE' });
  await syncFbtOfferDiscount(admin, 'shop-e.myshopify.com');
  assert.deepEqual(JSON.parse(admin.log.metafield.value).sets.map((s) => s.id), ['3']);
  assert.equal(db.condition[0].offer.value, 10);
});

test('plan without FBT: nothing goes live', async () => {
  db.plan = 'free';
  const admin = fakeAdmin({ discount: 'ACTIVE' });
  const r = await syncFbtOfferDiscount(admin, 'shop-f.myshopify.com');
  assert.equal(r.verified, false);
  assert.deepEqual(JSON.parse(admin.log.metafield.value).sets, []);
  assert.match(r.message, /plan/);
});

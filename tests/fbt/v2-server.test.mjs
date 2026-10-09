/* global globalThis */
// Run with: node --import ./tests/packs/register.mjs --test tests/fbt/v2-server.test.mjs
// app/services/fbt-v2.server.js against a fake DB proxy (php_backend/db_proxy.php):
// load (v2, converted, none), save (pairs kept), BrixBar's rule operations,
// and the pairs builder's shape.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const db = { widget: null, settings: null, column: false, sql: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('db_proxy.php')) return realFetch(url, init);
  const { sql, params = [] } = JSON.parse(init.body);
  db.sql.push(sql);
  let rows = [];
  if (/information_schema\.COLUMNS/i.test(sql) && /config_v2/.test(sql)) rows = db.column ? [{ COLUMN_NAME: 'config_v2' }] : [];
  else if (/ALTER TABLE fbt_widget ADD COLUMN config_v2/i.test(sql)) db.column = true;
  else if (/^\s*SELECT \* FROM fbt_widget WHERE/i.test(sql)) rows = db.widget ? [db.widget] : [];
  else if (/FROM fbt_widget_settings/i.test(sql)) rows = db.settings ? [db.settings] : [];
  else if (/^\s*INSERT INTO fbt_widget \(shopDomain, config_v2/i.test(sql)) db.widget = { ...(db.widget || {}), shopDomain: params[0], config_v2: params[1] };
  else if (/^\s*INSERT INTO fbt_widget_settings/i.test(sql)) db.settings = { is_enabled: params[1], widget_placement: params[2] };
  return new Response(JSON.stringify({ success: true, rows, insertId: 0, affectedRows: 1 }));
};

const v2 = await import('../../app/services/fbt-v2.server.js');
const SHOP = 'demo.myshopify.com';
beforeEach(() => { db.widget = null; db.settings = null; db.sql = []; });

test('load: nothing saved yet → defaults, off', async () => {
  const s = await v2.loadFbtV2(SHOP);
  assert.equal(s.saved, false);
  assert.equal(s.enabled, false);
  assert.equal(s.config.style, 'bundle');
  assert.ok(db.column, 'config_v2 column added when missing');
});

test('load: a store with only the old settings → converted, nothing lost', async () => {
  db.widget = {
    selectedTemp: 'fbt2', temp2: JSON.stringify({ interactionType: 'bundle', bgColor: '#fafafa' }),
    condition: JSON.stringify([{ name: 'R', displayScope: 'per_product', triggerProducts: [{ id: 1, handle: 'tee' }], fbtProducts: [{ id: 2, handle: 'cap' }] }]),
  };
  db.settings = { is_enabled: 1, widget_placement: 'above_cart' };
  const s = await v2.loadFbtV2(SHOP);
  assert.deepEqual([s.saved, s.enabled, s.config.theme.bg, s.config.placement, s.config.rules.length], [false, true, '#fafafa', 'above_cart', 1]);
});

test('save: writes config_v2 and the on/off switch; automatic pairs are kept unless rebuilt', async () => {
  db.widget = { config_v2: JSON.stringify({ pairs: { 1: [{ id: 2, handle: 'cap', source: 'orders' }] }, pairsUpdatedAt: '2026-10-01T00:00:00.000Z' }) };
  const { config, enabled } = await v2.saveFbtV2(SHOP, { title: 'Goes with', pairs: { 9: [{ id: 8, handle: 'x' }] } }, { enabled: true });
  assert.equal(enabled, true);
  assert.equal(config.title, 'Goes with');
  assert.deepEqual(Object.keys(config.pairs), ['1'], 'pairs from the page are ignored; stored ones kept');
  assert.equal(JSON.parse(db.widget.config_v2).title, 'Goes with');
  assert.equal(db.settings.is_enabled, 1);
  const rebuilt = await v2.saveFbtV2(SHOP, {}, { pairs: { 5: [{ id: 6, handle: 'socks', source: 'orders' }] } });
  assert.deepEqual(Object.keys(rebuilt.config.pairs), ['5']);
  assert.notEqual(rebuilt.config.pairsUpdatedAt, '2026-10-01T00:00:00.000Z');
});

test('BrixBar: create, list, update and remove rules in the v2 settings (so they show on the storefront)', async () => {
  const { id } = await v2.appendFbtRuleV2(SHOP, {
    name: 'Chat rule',
    triggerProducts: [{ id: 'gid://shopify/Product/1', handle: 'tee', title: 'Tee' }],
    offerProducts: [{ id: 'gid://shopify/Product/2', handle: 'cap', title: 'Cap', image: 'https://cdn.shopify.com/cap.jpg', price: '199.00' }],
  });
  assert.equal(db.settings.is_enabled, 1, 'creating a rule turns FBT on, like before');
  const listed = await v2.listFbtRulesV2(SHOP);
  assert.deepEqual(listed.map((r) => [r.id, r.trigger_scope, r.trigger_products[0].id, r.fbt_products[0].handle]), [[id, 'specific_products', '1', 'cap']]);
  await v2.updateFbtRuleV2(SHOP, id, { triggerProducts: [], offerProducts: [{ id: 3, handle: 'mug', title: 'Mug' }] });
  const rule = await v2.fetchFbtRuleV2(SHOP, id);
  assert.deepEqual([rule.trigger_scope, rule.fbt_products[0].handle], ['all', 'mug']);
  const summary = await v2.fbtSummaryForAgent(SHOP);
  assert.equal(summary.rules[0].showsOn, 'all product pages');
  assert.deepEqual(summary.rules[0].offers, ['Mug']);
  assert.deepEqual(await v2.removeFbtRuleV2(SHOP, 'nope'), { removed: false });
  assert.deepEqual(await v2.removeFbtRuleV2(SHOP, id), { removed: true });
  assert.equal((await v2.listFbtRulesV2(SHOP)).length, 0);
});

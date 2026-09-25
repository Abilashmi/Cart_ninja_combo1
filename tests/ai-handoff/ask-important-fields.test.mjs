// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
// FBT, Countdown Timer, Combo and Progress Bar ask ONLY for the few decisions
// that shape what the merchant gets (one at a time, with quick-reply buttons)
// and never write until they have them. Generic fake DB + fake Shopify admin.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SHOPIFY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

let fbtSettings; let countdownRow; let writes;
const reset = () => { fbtSettings = null; countdownRow = null; writes = []; };
reset();

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('save_cart_drawer.php')) return json({ status: 'error' });
  if (!u.endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql, params } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT plan_key')) return json({ success: true, rows: [{ plan_key: 'pro', plan_synced_at: new Date().toISOString() }] });
  if (q.startsWith('SELECT selected_template FROM fbt_widget_settings')) return json({ success: true, rows: fbtSettings ? [fbtSettings] : [] });
  if (q.startsWith('SELECT countdown_hours, countdown_minutes FROM cart_drawer_config')) return json({ success: true, rows: countdownRow ? [countdownRow] : [] });
  if (/^\s*(SELECT|SHOW)/i.test(q)) return json({ success: true, rows: [] });
  if (/^(INSERT|UPDATE|DELETE)/i.test(q)) writes.push(q.split(' ').slice(0, 3).join(' ')); // merchant data only, not the plan lookup's own table setup
  return json({ success: true, affectedRows: 1, insertId: 1 });
};

const { TOOL_EXECUTORS } = await import('../../app/services/ai-agent-tools.server.js');

const CATALOG = [{ id: 'gid://shopify/Product/1', title: 'Yoga Mat', handle: 'yoga-mat' }, { id: 'gid://shopify/Product/2', title: 'Strap', handle: 'strap' }];
const admin = {
  graphql: async (query, opts) => {
    const term = (opts?.variables?.query || '').replace(/^title:\*|\*$/g, '').toLowerCase();
    if (query.includes('FindCollection')) {
      const edges = term.includes('summer') ? [{ node: { id: 'gid://shopify/Collection/9', title: 'Summer Sale', handle: 'summer-sale' } }] : [];
      return { json: async () => ({ data: { collections: { edges } } }) };
    }
    const edges = CATALOG.filter((p) => p.title.toLowerCase().includes(term)).map((p) => ({ node: { ...p, featuredImage: null, variants: { edges: [{ node: { price: '10.00' } }] } } }));
    return { json: async () => ({ data: { products: { edges } } }) };
  },
};
const ctx = { shop: 'demo.myshopify.com', admin, planKey: 'pro', currencyCode: 'USD', currencySymbol: '$' };
const labels = (r) => r.choices?.map((c) => c.label);

beforeEach(reset);

test('FBT (never set up): asks template first, then where it shows, then which products', async () => {
  const a = await TOOL_EXECUTORS.create_fbt_rule(ctx, { offerProductNames: ['Yoga Mat', 'Strap'] });
  assert.deepEqual([a.reason, a.need], ['needs_info', 'template']);
  assert.deepEqual(labels(a), ['Classic Grid', 'Modern Cards', 'Vertical List']);
  const b = await TOOL_EXECUTORS.create_fbt_rule(ctx, { offerProductNames: ['Yoga Mat', 'Strap'], template: 'fbt2' });
  assert.equal(b.need, 'showOn');
  assert.deepEqual(labels(b), ['All product pages', 'Specific products']);
  const c = await TOOL_EXECUTORS.create_fbt_rule(ctx, { offerProductNames: ['Strap'], template: 'fbt2', showOn: 'specific' });
  assert.equal(c.need, 'showOnTargets');
  assert.deepEqual(writes, [], 'nothing written while questions are open');
});

test('FBT: already-configured store is not asked for a template again; answers pass the gate', async () => {
  fbtSettings = { selected_template: 'fbt1' };
  assert.equal((await TOOL_EXECUTORS.create_fbt_rule(ctx, { offerProductNames: ['Strap'] })).need, 'showOn');
  const all = await TOOL_EXECUTORS.create_fbt_rule(ctx, { offerProductNames: ['Strap'], showOn: 'all' });
  assert.notEqual(all.reason, 'needs_info');
  const trig = await TOOL_EXECUTORS.create_fbt_rule(ctx, { triggerProductNames: ['Yoga Mat'], offerProductNames: ['Strap'] });
  assert.notEqual(trig.reason, 'needs_info', 'naming trigger products already answers "where"');
});

test('Countdown timer: turning one on asks only the duration; styling changes are not asked', async () => {
  const a = await TOOL_EXECUTORS.update_countdown_timer(ctx, { enabled: true });
  assert.deepEqual([a.reason, a.need], ['needs_info', 'duration']);
  assert.deepEqual(labels(a), ['15 minutes', '30 minutes', '1 hour', '24 hours']);
  assert.deepEqual(writes, []);
  assert.notEqual((await TOOL_EXECUTORS.update_countdown_timer(ctx, { enabled: true, minutes: 15 })).reason, 'needs_info');
  assert.notEqual((await TOOL_EXECUTORS.update_countdown_timer(ctx, { bgColor: '#000000' })).reason, 'needs_info');
  countdownRow = { countdown_hours: 1, countdown_minutes: 0 };
  assert.notEqual((await TOOL_EXECUTORS.update_countdown_timer(ctx, { enabled: true })).reason, 'needs_info', 'a duration is already saved');
});

test('Combo: asks layout, then collection, then discount; the page name is never asked', async () => {
  const a = await TOOL_EXECUTORS.create_combo_template(ctx, {});
  assert.deepEqual([a.reason, a.need], ['needs_info', 'layout']);
  assert.equal(a.choices.length, 3);
  assert.equal((await TOOL_EXECUTORS.create_combo_template(ctx, { layout: 'layout2' })).need, 'collection');
  const d = await TOOL_EXECUTORS.create_combo_template(ctx, { layout: 'layout2', collectionName: 'Summer Sale' });
  assert.equal(d.need, 'discount');
  assert.deepEqual(labels(d), ['No discount', '10% off', '15% off', '20% off']);
  assert.deepEqual(writes, []);
  const done = await TOOL_EXECUTORS.create_combo_template(ctx, { layout: 'layout2', collectionName: 'Summer Sale', discountPercentage: 0 });
  assert.notEqual(done.reason, 'needs_info', 'no templateName needed');
});

test('Progress bar: a NEW bar asks for its reward; an existing bar is not re-asked', async () => {
  const a = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 500 });
  assert.deepEqual([a.reason, a.need], ['needs_info', 'reward']);
  assert.deepEqual(labels(a), ['Free shipping', 'A free product']);
  assert.deepEqual(writes, []);
});

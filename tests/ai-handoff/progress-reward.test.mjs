// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
// Exercises the AI progress-bar tools' free-product reward handling against an
// in-memory emulation of db_proxy.php (progress bar tables only) and a fake
// Shopify admin — no database, store or LLM is touched.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SHOPIFY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;

let settings; let tiers; let nextTierId;
const reset = () => { settings = null; tiers = []; nextTierId = 1; };
reset();
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('save_cart_drawer.php')) return json({ status: 'error' }); // legacy mirror: not available, never writes the local file
  if (!u.endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql, params } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  const ok = (rows) => json({ success: true, rows });
  const done = (extra = {}) => json({ success: true, affectedRows: 1, ...extra });

  if (q.startsWith('SELECT * FROM progress_bar_settings')) return ok(settings ? [settings] : []);
  if (q.startsWith('SELECT id FROM progress_bar_settings')) return ok(settings ? [{ id: settings.id }] : []);
  if (q.startsWith('INSERT INTO progress_bar_settings')) {
    const [shop, is_enabled, mode, show_on_empty] = params;
    settings = { id: 1, shop_domain: shop, is_enabled, mode, show_on_empty, placement: 'top', enable_confetti: 1 };
    return done();
  }
  if (q.startsWith('SELECT * FROM progress_bar_tiers')) return ok(tiers.filter((t) => t.is_active).sort((a, b) => a.sort_order - b.sort_order));
  if (q.startsWith('ALTER TABLE progress_bar_tiers')) return done();
  if (q.startsWith('SELECT id, reward_type, icon_preset')) return ok(tiers.slice(0, 1));
  if (q.startsWith('DELETE FROM progress_bar_tiers')) { tiers = []; return done(); }
  if (q.startsWith('UPDATE progress_bar_tiers')) {
    const t = tiers.find((x) => x.id === params[params.length - 1]);
    const withProducts = q.includes('reward_products = ?');
    [t.min_value, t.reward_type, t.icon_preset, t.reward_pricing] = params;
    if (withProducts) t.reward_products = params[4];
    return done();
  }
  if (q.startsWith('INSERT INTO progress_bar_tiers')) {
    if (q.includes('min_quantity')) {
      const [shop, settings_id, min_value, min_quantity, description, reward_type, icon_type, icon_preset, icon_custom_svg, reward_products, reward_pricing, sort_order] = params;
      tiers.push({ id: nextTierId++, shop_domain: shop, settings_id, min_value, min_quantity, description, reward_type, icon_type, icon_preset, icon_custom_svg, reward_products, reward_pricing, is_active: 1, sort_order });
    } else {
      const [shop, settings_id, min_value, reward_type, icon_preset, reward_products, reward_pricing] = params;
      tiers.push({ id: nextTierId++, shop_domain: shop, settings_id, min_value, reward_type, icon_preset, reward_products, reward_pricing, is_active: 1, sort_order: 0 });
    }
    return done({ insertId: nextTierId - 1 });
  }
  throw new Error(`unhandled SQL in test: ${q.slice(0, 80)}`);
};

const { TOOL_EXECUTORS } = await import('../../app/services/ai-agent-tools.server.js');

const CATALOG = [
  { id: 'gid://shopify/Product/11', title: 'Canvas Tote Bag' },
  { id: 'gid://shopify/Product/12', title: 'Denim Shirt Blue' },
  { id: 'gid://shopify/Product/13', title: 'Denim Shirt Black' },
];
// The free-gift discount sync talks to Shopify too. Behaviour is switchable:
// giftFunctionDeployed=false makes creating the app discount fail like a store
// where the extension was never deployed.
let giftFunctionDeployed = false;
let metafieldWrites = [];
const fakeAdmin = {
  graphql: async (query, opts) => {
    const reply = (data) => ({ json: async () => ({ data }) });
    if (query.includes('RewardShopId')) return reply({ shop: { id: 'gid://shopify/Shop/1' } });
    if (query.includes('RewardConfig')) { metafieldWrites.push(JSON.parse(opts.variables.metafields[0].value)); return reply({ metafieldsSet: { metafields: [{ id: 'm' }], userErrors: [] } }); }
    if (query.includes('RewardDiscounts')) return reply({ automaticDiscountNodes: { nodes: [] } });
    if (query.includes('RewardDiscountCreate')) {
      return reply({ discountAutomaticAppCreate: giftFunctionDeployed
        ? { automaticAppDiscount: { discountId: 'gid://shopify/DiscountAutomaticNode/1', status: 'ACTIVE' }, userErrors: [] }
        : { automaticAppDiscount: null, userErrors: [{ field: ['functionHandle'], message: 'Function brix-reward-discount not found.', code: 'INVALID' }] } });
    }
    const term = (opts?.variables?.query || '').replace(/^title:\*|\*$/g, '').toLowerCase();
    const edges = CATALOG.filter((p) => p.title.toLowerCase().includes(term))
      .map((p) => ({ node: { ...p, handle: p.title.toLowerCase().replace(/ /g, '-'), featuredImage: null, variants: { edges: [{ node: { price: '10.00' } }] } } }));
    return { json: async () => ({ data: { products: { edges } } }) };
  },
};
const ctx = { shop: 'demo.myshopify.com', admin: fakeAdmin, planKey: 'pro', currencyCode: 'USD', currencySymbol: '$' };
const storedProducts = () => JSON.parse(tiers[0].reward_products || 'null');

beforeEach(() => { reset(); giftFunctionDeployed = false; metafieldWrites = []; });

test('free product goal: product is resolved and saved as the tier Reward Product', async () => {
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardType: 'product', rewardProductNames: ['canvas tote bag'], rewardPricing: 'free' });
  assert.equal(r.success, true);
  assert.deepEqual(storedProducts(), ['gid://shopify/Product/11']);
  assert.equal(tiers[0].reward_type, 'product');
  assert.equal(tiers[0].min_value, 3000);
  assert.deepEqual(r.changed.rewardProducts, ['Canvas Tote Bag']);
  assert.equal(r.changed.rewardType, undefined, 'products stand in for the type change');
});

test('naming a product implies a product reward even if the type was omitted', async () => {
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 50, rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'free' });
  assert.equal(r.success, true);
  assert.equal(tiers[0].reward_type, 'product');
});

test('a free-product reward with no product is refused, nothing written, asks which product', async () => {
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardType: 'product' });
  assert.equal(r.success, false);
  assert.equal(r.reason, 'needs_reward_product');
  assert.equal(settings, null);
  assert.equal(tiers.length, 0);
});

test('unknown / ambiguous product names fail before any write', async () => {
  const none = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardType: 'product', rewardProductNames: ['Unicorn Poster'] });
  assert.equal(none.reason, 'not_found');
  const amb = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardType: 'product', rewardProductNames: ['Denim Shirt'] });
  assert.equal(amb.reason, 'ambiguous');
  assert.deepEqual(amb.candidates.sort(), ['Denim Shirt Black', 'Denim Shirt Blue']);
  assert.equal(settings, null);
});

test('changing only the goal keeps the existing reward product', async () => {
  await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardType: 'product', rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'free' });
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 4000 });
  assert.equal(r.success, true);
  assert.equal(tiers[0].min_value, 4000);
  assert.deepEqual(storedProducts(), ['gid://shopify/Product/11']);
});

test('switching the reward away from a product clears the products', async () => {
  await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardType: 'product', rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'free' });
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { rewardType: 'free_shipping' });
  assert.equal(r.success, true);
  assert.equal(tiers[0].reward_type, 'free_shipping');
  assert.equal(storedProducts(), null);
});

test('tiers tool: per-tier reward products saved; unresolved product blocks the whole replace', async () => {
  await TOOL_EXECUTORS.update_progress_bar_tiers(ctx, { tiers: [{ min_value: 500, reward_type: 'free_shipping' }] });
  const bad = await TOOL_EXECUTORS.update_progress_bar_tiers(ctx, { tiers: [
    { min_value: 500, reward_type: 'free_shipping' },
    { min_value: 3000, reward_type: 'product', rewardProductNames: ['Unicorn Poster'] },
  ] });
  assert.equal(bad.success, false);
  assert.equal(tiers.length, 1, 'existing ladder untouched by a failed replace');

  const good = await TOOL_EXECUTORS.update_progress_bar_tiers(ctx, { tiers: [
    { min_value: 500, reward_type: 'free_shipping', description: 'Free shipping' },
    { min_value: 3000, reward_type: 'product', description: 'Free tote at $3,000', rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'free' },
  ] });
  assert.equal(good.success, true);
  assert.equal(tiers.length, 2);
  assert.equal(tiers[0].reward_products, null);
  assert.deepEqual(JSON.parse(tiers[1].reward_products), ['gid://shopify/Product/11']);
  assert.deepEqual(good.tiers[1].rewardProducts, ['Canvas Tote Bag']);

  // an amount-only edit of that tier keeps its product; a product tier with none is refused
  const keep = await TOOL_EXECUTORS.update_progress_bar_tiers(ctx, { tiers: [
    { min_value: 500, reward_type: 'free_shipping' },
    { min_value: 3500, reward_type: 'product' },
  ] });
  assert.equal(keep.success, true);
  assert.deepEqual(JSON.parse(tiers[1].reward_products), ['gid://shopify/Product/11']);
  const missing = await TOOL_EXECUTORS.update_progress_bar_tiers(ctx, { tiers: [{ min_value: 100, reward_type: 'product' }] });
  assert.equal(missing.reason, 'needs_reward_product');
});

// ── Free or regular price: asked before anything is saved ──────────────────
test('a reward product without a pricing choice asks the free-or-regular question and writes nothing', async () => {
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardProductNames: ['Canvas Tote Bag'] });
  assert.equal(r.success, false);
  assert.equal(r.reason, 'needs_info');
  assert.equal(r.need, 'rewardPricing');
  assert.deepEqual(r.choices.map((c) => c.label), ['Make it free (auto discount)', 'Keep the regular price']);
  assert.equal(settings, null);
  assert.equal(tiers.length, 0);
  const t = await TOOL_EXECUTORS.update_progress_bar_tiers(ctx, { tiers: [{ min_value: 3000, reward_type: 'product', rewardProductNames: ['Canvas Tote Bag'] }] });
  assert.equal(t.need, 'rewardPricing');
  assert.equal(tiers.length, 0);
});

test('regular price: saved as regular, no free-gift discount is set up', async () => {
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'regular' });
  assert.equal(r.success, true);
  assert.equal(tiers[0].reward_pricing, 'regular');
  assert.equal(r.rewardPricing, 'regular');
  assert.equal(r.giftDiscount.state, 'not_needed');
  assert.deepEqual(metafieldWrites.at(-1).tiers, []);
});

test('free but the extension is not deployed: saved, config written, and it says plainly it is not free yet', async () => {
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'free' });
  assert.equal(r.success, true);
  assert.equal(tiers[0].reward_pricing, 'free');
  assert.equal(r.giftDiscount.verified, false);
  assert.equal(r.giftDiscount.state, 'not_deployed');
  assert.deepEqual(metafieldWrites.at(-1).tiers, [{ id: '1', mode: 'amount', min: 3000, productIds: ['11'] }]);
});

test('free with the extension deployed: verified active', async () => {
  giftFunctionDeployed = true;
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'free' });
  assert.equal(r.giftDiscount.verified, true);
  assert.equal(r.giftDiscount.state, 'active');
});

test('changing only the goal keeps the pricing choice', async () => {
  await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 3000, rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'free' });
  await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 4000 });
  assert.equal(tiers[0].reward_pricing, 'free');
  assert.equal(tiers[0].min_value, 4000);
});

test('not-free-yet result carries the exact reason and forbids the manual-steps fallback', async () => {
  const r = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 500, rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'free' });
  assert.equal(r.success, true);
  assert.match(r.responseHint, /NOT free at checkout yet/);
  assert.match(r.responseHint, /not installed on this store yet/);
  assert.match(r.responseHint, /Do not offer to create a discount manually/);
  giftFunctionDeployed = true;
  const ok = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 500, rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'free' });
  assert.match(ok.responseHint, /free at checkout once the goal is reached/);
  const reg = await TOOL_EXECUTORS.set_progress_bar_goal(ctx, { goalAmount: 500, rewardProductNames: ['Canvas Tote Bag'], rewardPricing: 'regular' });
  assert.match(reg.responseHint, /regular price/);
});

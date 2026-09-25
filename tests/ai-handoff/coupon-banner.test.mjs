// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
// The AI Coupon Banner tool against in-memory emulations of
// save_coupon_slider_widget.php (whole-row replace, like the real one),
// coupon_slider_settings (via db_proxy) and a fake Shopify admin.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SHOPIFY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

let widget; let settings; let widgetPosts;
const reset = () => { widget = null; settings = null; widgetPosts = 0; };
reset();

const SETTINGS_COLS = ['shop_domain', 'is_enabled', 'selected_template', 'title_text', 'title_color', 'title_font_size', 'title_font_weight', 'title_alignment', 'section_bg_color', 'card_bg_color', 'card_border_color', 'card_border_width', 'card_border_radius', 'card_shadow', 'auto_slide', 'slide_interval', 'position', 'layout', 'selected_coupons'];

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('save_coupon_slider_widget.php')) {
    if (init?.method === 'POST') {
      widgetPosts += 1;
      const p = JSON.parse(init.body);
      // Emulates the PHP: each column is replaced by what the payload carries (null when absent).
      const col = (n, k) => (p[`template${n}`]?.[k] ?? null);
      widget = {
        shopDomain: p.shop, selectedTemplate: p.selectedTemplate, selectedCouponsGlobal: p.selectedCouponsGlobal,
        temp1DefaultStyle: col(1, 'styles'), temp2DefaultStyle: col(2, 'styles'), temp3DefaultStyle: col(3, 'styles'),
        temp1CouponStyle: col(1, 'couponStyles'), temp2CouponStyle: col(2, 'couponStyles'), temp3CouponStyle: col(3, 'couponStyles'),
        temp1CouponCondition: col(1, 'couponConditions'), temp2CouponCondition: col(2, 'couponConditions'), temp3CouponCondition: col(3, 'couponConditions'),
      };
      return json({ status: 'success' });
    }
    return json(widget ? { status: 'success', data: widget } : { status: 'error', message: 'No data found for this shop' });
  }
  if (!u.endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql, params } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT * FROM coupon_slider_settings')) return json({ success: true, rows: settings ? [settings] : [] });
  if (q.startsWith('INSERT INTO coupon_slider_settings')) {
    settings = Object.fromEntries(SETTINGS_COLS.map((c, i) => [c, params[i]]));
    return json({ success: true, affectedRows: 1 });
  }
  throw new Error(`unhandled SQL in test: ${q.slice(0, 80)}`);
};

const { TOOL_EXECUTORS } = await import('../../app/services/ai-agent-tools.server.js');

const DISCOUNTS = [ // newest first, like discountNodes(reverse: true)
  { id: 'gid://shopify/DiscountCodeNode/3', code: 'NEWEST10', status: 'ACTIVE' },
  { id: 'gid://shopify/DiscountCodeNode/2', code: 'OLDER20', status: 'ACTIVE' },
  { id: 'gid://shopify/DiscountCodeNode/1', code: 'EXPIRED5', status: 'EXPIRED' },
];
let discounts = DISCOUNTS;
const PRODUCTS = [{ id: 'gid://shopify/Product/11', title: 'Canvas Tote Bag', handle: 'canvas-tote-bag' }, { id: 'gid://shopify/Product/12', title: 'Denim Shirt Blue', handle: 'denim-shirt-blue' }, { id: 'gid://shopify/Product/13', title: 'Denim Shirt Black', handle: 'denim-shirt-black' }];
const COLLECTIONS = [{ id: 'gid://shopify/Collection/1', title: 'Summer Sale', handle: 'summer-sale' }];
const term = (o) => (o?.variables?.query || '').replace(/^title:\*|\*$/g, '').toLowerCase();
const fakeAdmin = {
  graphql: async (query, opts) => {
    if (query.includes('DiscountList')) {
      return { json: async () => ({ data: { discountNodes: { edges: discounts.map((d) => ({ node: { id: d.id, discount: { title: d.code, status: d.status, codes: { edges: [{ node: { code: d.code } }] } } } })) } } }) };
    }
    if (query.includes('FindCollection')) {
      const edges = COLLECTIONS.filter((c) => c.title.toLowerCase().includes(term(opts))).map((c) => ({ node: c }));
      return { json: async () => ({ data: { collections: { edges } } }) };
    }
    const edges = PRODUCTS.filter((p) => p.title.toLowerCase().includes(term(opts))).map((p) => ({ node: { ...p, featuredImage: null, variants: { edges: [{ node: { price: '10.00' } }] } } }));
    return { json: async () => ({ data: { products: { edges } } }) };
  },
};
const ctx = (planKey = 'pro') => ({ shop: 'demo.myshopify.com', admin: fakeAdmin, planKey, currencyCode: 'USD', currencySymbol: '$' });
const run = (args, planKey) => TOOL_EXECUTORS.update_coupon_banner(ctx(planKey), args);

beforeEach(() => { reset(); discounts = DISCOUNTS; });

test('a new banner asks for template, then coupons, then where — nothing written until all three', async () => {
  const a = await run({});
  assert.deepEqual([a.success, a.reason, a.need], [false, 'needs_info', 'template']);
  const b = await run({ template: 'minimal-card' });
  assert.equal(b.need, 'coupons');
  const c = await run({ template: 'minimal-card', latestCouponCount: 1 });
  assert.equal(c.need, 'showOn');
  const d = await run({ template: 'minimal-card', latestCouponCount: 1, showOn: 'products' });
  assert.equal(d.need, 'showOnTargets');
  assert.equal(widgetPosts, 0);
  assert.equal(settings, null);
});

test('full setup: latest coupon, all pages -> saved, read back, reported truthfully', async () => {
  const r = await run({ template: 'classic-banner', latestCouponCount: 1, showOn: 'all' });
  assert.equal(r.success, true);
  assert.equal(widget.selectedTemplate, 'template1');
  assert.deepEqual(widget.selectedCouponsGlobal, ['gid://shopify/DiscountCodeNode/3'], 'newest ACTIVE coupon, not the expired one');
  assert.equal(widget.temp1CouponStyle['gid://shopify/DiscountCodeNode/3'].couponCode, 'NEWEST10');
  assert.deepEqual(widget.temp1CouponCondition, []);
  assert.equal(widget.temp1DefaultStyle.headingText, 'GET 10% OFF!');
  assert.equal(settings.is_enabled, 1);
  assert.equal(settings.selected_template, 'template1');
  assert.equal(settings.position, 'above_cart');
  assert.equal(settings.layout, 'list');
  assert.deepEqual(r.banner.coupons, ['NEWEST10']);
  assert.equal(r.banner.showOn, 'all product pages');
  assert.equal(r.liveOnStorefront, true);
});

test('template default text uses the store currency symbol, not a hardcoded rupee', async () => {
  await run({ template: 'minimal-card', latestCouponCount: 1, showOn: 'all' });
  assert.equal(widget.temp2DefaultStyle.subtextText, 'Free shipping on orders over $500');
});

test('specific products / collections become per-coupon conditions with real handles', async () => {
  const p = await run({ template: 'bold-vibrant', couponCodes: ['older20', 'NEWEST10'], showOn: 'products', productNames: ['Canvas Tote Bag'] });
  assert.equal(p.success, true);
  assert.deepEqual(widget.temp3CouponCondition.map((c) => [c.couponId, c.displayCondition, c.productHandles]), [
    ['gid://shopify/DiscountCodeNode/2', 'product_handle', ['canvas-tote-bag']],
    ['gid://shopify/DiscountCodeNode/3', 'product_handle', ['canvas-tote-bag']],
  ]);
  assert.match(p.banner.showOn, /specific products: canvas-tote-bag/);
  const c = await run({ showOn: 'collections', collectionNames: ['Summer Sale'] });
  assert.equal(c.success, true);
  assert.equal(widget.temp3CouponCondition[0].displayCondition, 'collection_handle');
  assert.deepEqual(widget.temp3CouponCondition[0].collectionHandles, ['summer-sale']);
});

test('bad input fails before any write: unknown/ambiguous product, unknown coupon, no coupons', async () => {
  assert.equal((await run({ template: 'classic-banner', latestCouponCount: 1, showOn: 'products', productNames: ['Unicorn'] })).reason, 'not_found');
  const amb = await run({ template: 'classic-banner', latestCouponCount: 1, showOn: 'products', productNames: ['Denim Shirt'] });
  assert.equal(amb.reason, 'ambiguous');
  assert.equal((await run({ template: 'classic-banner', couponCodes: ['NOPE99'], showOn: 'all' })).reason, 'coupon_not_found');
  discounts = [];
  assert.equal((await run({ template: 'classic-banner', latestCouponCount: 1, showOn: 'all' })).reason, 'no_coupons');
  assert.equal((await run({ template: 'fancy', latestCouponCount: 1, showOn: 'all' })).reason, 'invalid_template');
  assert.equal(widgetPosts, 0);
});

test('free plan: designed but honestly reported as not live', async () => {
  const r = await run({ template: 'classic-banner', latestCouponCount: 1, showOn: 'all' }, 'free');
  assert.equal(r.success, true);
  assert.equal(settings.is_enabled, 0);
  assert.equal(r.liveOnStorefront, false);
  assert.match(r.note, /not show on the storefront/);
});

test('changing only the layout keeps coupons, conditions, styles and other templates', async () => {
  await run({ template: 'classic-banner', latestCouponCount: 1, showOn: 'products', productNames: ['Canvas Tote Bag'] });
  widget.temp2DefaultStyle = { headingText: 'KEEP ME' }; // another template's saved data
  widget.temp1DefaultStyle = { ...widget.temp1DefaultStyle, headingText: 'Custom heading' };
  const r = await run({ layout: 'grid' });
  assert.equal(r.success, true);
  assert.equal(settings.layout, 'grid');
  assert.deepEqual(widget.selectedCouponsGlobal, ['gid://shopify/DiscountCodeNode/3']);
  assert.equal(widget.temp1CouponCondition[0].productHandles[0], 'canvas-tote-bag');
  assert.equal(widget.temp1DefaultStyle.headingText, 'Custom heading');
  assert.equal(widget.temp2DefaultStyle.headingText, 'KEEP ME');
  assert.equal(widget.temp1CouponStyle['gid://shopify/DiscountCodeNode/3'].couponCode, 'NEWEST10');
});

test('a cart-drawer style position ("top") is corrected to a valid banner placement', async () => {
  settings = { shop_domain: 'demo.myshopify.com', is_enabled: 0, selected_template: 'template1', position: 'top', layout: 'grid' };
  const r = await run({ template: 'classic-banner', latestCouponCount: 1, showOn: 'all' });
  assert.equal(r.success, true);
  assert.equal(settings.position, 'above_cart');
  assert.equal(settings.layout, 'grid', 'existing layout is kept when not asked to change');
});

test('needs_info results carry quick-reply buttons for the merchant', async () => {
  const t = await run({});
  assert.deepEqual(t.choices.map((c) => c.label), ['Classic Banner', 'Minimal Card', 'Bold & Vibrant']);
  const w = await run({ template: 'classic-banner', latestCouponCount: 1 });
  assert.deepEqual(w.choices.map((c) => c.label), ['All product pages', 'Specific products', 'Specific collections']);
});

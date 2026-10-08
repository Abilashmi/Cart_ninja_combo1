// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
// BRIX "Image Banner": turning it on/off just does it, an image-less banner
// asks for the link next, bad links are refused, images never reach the model.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SHOPIFY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

let row; let lastInsertParams;
const DATA_URL = `data:image/png;base64,${'A'.repeat(4000)}`;
beforeEach(() => { row = null; lastInsertParams = null; });

const COLS = ['banner_enabled', 'banner_desktop_image', 'banner_mobile_image', 'banner_placement', 'banner_alt', 'banner_margin_top', 'banner_margin_bottom'];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql, params } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT plan_key')) return json({ success: true, rows: [{ plan_key: 'pro', plan_synced_at: new Date().toISOString() }] });
  if (q.startsWith('SELECT * FROM cart_drawer_config')) return json({ success: true, rows: row ? [row] : [] });
  if (q.startsWith('INSERT INTO cart_drawer_config')) {
    lastInsertParams = params;
    // The banner columns are the last values of the upsert.
    const vals = params.slice(-COLS.length);
    row = { shop_domain: params[0], ...Object.fromEntries(COLS.map((c, i) => [c, vals[i]])) };
    return json({ success: true, affectedRows: 1 });
  }
  if (/^\s*(SELECT|SHOW)/i.test(q)) return json({ success: true, rows: [] });
  return json({ success: true, affectedRows: 1, insertId: 1 });
};

const { TOOL_EXECUTORS } = await import('../../app/services/ai-agent-tools.server.js');
const { TOOL_REGISTRY } = await import('../../app/config/ai-tool-schemas.js');
const { detectAiModule } = await import('../../app/config/ai-module-routes.js');
const ctx = { shop: 'demo.myshopify.com', planKey: 'pro', currencyCode: 'USD', currencySymbol: '$' };

test('the tool is registered', () => {
  assert.ok(TOOL_REGISTRY.some((t) => t.name === 'update_image_banner'));
});

test('turn on with no image: saved on, then asks for the image link', async () => {
  const r = await TOOL_EXECUTORS.update_image_banner(ctx, { enabled: true });
  assert.equal(r.success, true);
  assert.equal(row.banner_enabled, 1);
  assert.equal(r.imageBanner.enabled, true);
  assert.equal(r.imageBanner.visibleOnStorefront, false);
  assert.match(r.next_step, /image link/);
});

test('an image link makes it visible; turning off keeps the image', async () => {
  await TOOL_EXECUTORS.update_image_banner(ctx, { enabled: true });
  const r = await TOOL_EXECUTORS.update_image_banner(ctx, { desktopImageUrl: 'https://cdn.example.com/sale.jpg' });
  assert.equal(r.imageBanner.visibleOnStorefront, true);
  assert.equal(r.next_step, undefined);
  const off = await TOOL_EXECUTORS.update_image_banner(ctx, { enabled: false });
  assert.equal(off.imageBanner.enabled, false);
  assert.equal(row.banner_desktop_image, 'https://cdn.example.com/sale.jpg');
});

test('space above / below: set from chat, clamped, other fields kept', async () => {
  await TOOL_EXECUTORS.update_image_banner(ctx, { enabled: true, desktopImageUrl: 'https://cdn.example.com/sale.jpg' });
  const r = await TOOL_EXECUTORS.update_image_banner(ctx, { spaceAbove: 0, spaceBelow: 90 });
  assert.equal(row.banner_margin_top, 0);
  assert.equal(row.banner_margin_bottom, 40);
  assert.equal(r.imageBanner.spaceAbovePx, 0);
  assert.equal(r.imageBanner.spaceBelowPx, 40);
  assert.equal(row.banner_desktop_image, 'https://cdn.example.com/sale.jpg');
  await TOOL_EXECUTORS.update_image_banner(ctx, { alt: 'Sale' });
  assert.equal(row.banner_margin_top, 0, 'a later change keeps the spacing');
});

test('a non-https / non-image link is refused and nothing is written', async () => {
  const r = await TOOL_EXECUTORS.update_image_banner(ctx, { desktopImageUrl: 'http://x.com/a.png' });
  assert.equal(r.success, false);
  assert.equal(r.reason, 'invalid_image_link');
  assert.equal(lastInsertParams, null);
});

test('uploaded (data URL) images never reach the model', async () => {
  row = { shop_domain: ctx.shop, banner_enabled: 1, banner_desktop_image: DATA_URL, banner_mobile_image: null, banner_placement: 'above_products', banner_alt: '' };
  const cfg = await TOOL_EXECUTORS.get_current_config(ctx);
  assert.equal(cfg.cartDrawerConfig.banner_desktop_image, 'uploaded image');
  assert.equal(cfg.imageBanner.desktopImage, 'uploaded image');
  assert.equal(cfg.imageBanner.placementLabel, 'Above Products');
  assert.ok(!JSON.stringify(cfg).includes('base64'));
});

test('image banner requests route to the Cart Editor, not the Coupon Banner', () => {
  for (const msg of ['enable the image banner', 'turn off the mage banner', 'disable img banner', 'change the banner image']) {
    assert.deepEqual(detectAiModule(msg), { module: 'cart_editor', features: ['image_banner'] }, msg);
  }
  assert.equal(detectAiModule('enable coupon banner').module, 'coupon_banner');
});

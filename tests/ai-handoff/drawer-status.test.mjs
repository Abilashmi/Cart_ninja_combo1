/* eslint-env node */
/* global globalThis */
// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
// BRIX AI and the Cart Drawer's on/off: the real switch is the legacy
// cart_drawer.cartStatus (what the storefront and the Cart Editor's Active /
// Inactive pill use). cart_drawer_config.is_enabled is the admin preview's copy
// and the pill doesn't update it, so BRIX used to say "already enabled" for a
// drawer that was off. PHP and the database are faked; nothing is written anywhere.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SHOPIFY_API_KEY = 'test-key';
const realFetch = globalThis.fetch;
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// The two copies, set up out of step like a drawer switched off in the Cart Editor.
let legacy; let configRow; let legacyWrites; let legacyRefuses;
beforeEach(() => {
  legacy = { cartStatus: 0, cart_status: 0, shop: 'demo.myshopify.com' };
  configRow = { shop_domain: 'demo.myshopify.com', is_enabled: 1 };
  legacyWrites = [];
  legacyRefuses = false;
});

globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/save_cart_drawer.php')) {
    if (!init || !init.method || init.method === 'GET') return json(legacy ? { status: 'success', data: legacy } : { status: 'error' });
    const body = JSON.parse(init.body);
    legacyWrites.push(body);
    if (legacyRefuses) return json({ status: 'error', message: 'db down' });
    legacy = body;
    return json({ status: 'success' });
  }
  if (!u.endsWith('/db_proxy.php')) return realFetch(url, init);
  const { sql, params } = JSON.parse(init.body);
  const q = sql.replace(/\s+/g, ' ').trim();
  if (q.startsWith('SELECT plan_key')) return json({ success: true, rows: [{ plan_key: 'pro', plan_synced_at: new Date().toISOString() }] });
  if (q.startsWith('SELECT * FROM cart_drawer_config') || q.startsWith('SELECT is_enabled FROM cart_drawer_config')) return json({ success: true, rows: configRow ? [configRow] : [] });
  if (q.startsWith('INSERT INTO cart_drawer_config')) {
    const i = q.slice(q.indexOf('(') + 1, q.indexOf(')')).split(',').map((c) => c.trim()).indexOf('is_enabled');
    if (i >= 0) configRow = { ...configRow, is_enabled: params[i] };
    return json({ success: true, affectedRows: 1 });
  }
  if (/^\s*(SELECT|SHOW)/i.test(q)) return json({ success: true, rows: [] });
  return json({ success: true, affectedRows: 1, insertId: 1 });
};

// A saved record is also copied to ./cartdrawer-config-data.json (resolved when the
// module loads): load it from a temporary folder so the repo's copy is never touched.
const repoDir = process.cwd();
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'brix-drawer-status-')));
const { TOOL_EXECUTORS } = await import('../../app/services/ai-agent-tools.server.js');
const { getStoreConfigSnapshot } = await import('../../app/services/store-config-snapshot.server.js');
const { fetchDrawerEnabled } = await import('../../app/services/cart-drawer-record.server.js');
process.chdir(repoDir);
const ctx = { shop: 'demo.myshopify.com', planKey: 'pro', currencyCode: 'USD', currencySymbol: '$' };

test('a drawer switched off in the Cart Editor reads as off everywhere BRIX looks', async () => {
  assert.equal(configRow.is_enabled, 1, 'the preview copy still says on');
  assert.equal(await fetchDrawerEnabled(ctx.shop), false);
  const snapshot = await getStoreConfigSnapshot(ctx.shop);
  assert.equal(snapshot.cartDrawer, false, 'the "Current state" line in the prompt');
  const config = await TOOL_EXECUTORS.get_current_config(ctx);
  assert.equal(config.cartDrawerEnabled, false);
  assert.equal(config.cartDrawerConfig.is_enabled, 0, 'never the stale preview copy');
});

test('"enable the cart drawer" switches it on for real and says so', async () => {
  const r = await TOOL_EXECUTORS.set_cart_drawer_enabled(ctx, { enabled: true });
  assert.equal(r.success, true);
  assert.equal(r.enabled, true);
  assert.equal(legacyWrites.at(-1).cartStatus, 1, 'the storefront switch');
  assert.equal(legacyWrites.at(-1).cart_status, 1);
  assert.equal(configRow.is_enabled, 1, 'the preview copy follows');
  assert.equal((await TOOL_EXECUTORS.get_current_config(ctx)).cartDrawerEnabled, true);
});

test('a save that does not reach the storefront is never reported as done', async () => {
  legacyRefuses = true;
  const r = await TOOL_EXECUTORS.set_cart_drawer_enabled(ctx, { enabled: true });
  assert.equal(r.success, false);
  assert.equal(r.enabled, false);
  assert.match(r.message, /still off/);
});

test('a store that never saved the drawer has it on (the Cart Editor default)', async () => {
  legacy = null;
  assert.equal(await fetchDrawerEnabled(ctx.shop), true);
});

// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff/upsell-ai-mode.test.mjs
// Cart Editor → Upsell → AI Recommendations → Generate: the AI mode is saved
// with the rules (cart-config-writes.server.js saveUpsellAiMode). It used to
// live only in the editor's unsaved state, so after a refresh the editor and
// the storefront were back on Manual. The drawer record can only be written
// back whole, from a copy the storefront GET may have trimmed for the plan,
// so it is written only when nothing in that copy can have been trimmed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

// persistCartDrawerRecord keeps a local copy in the working directory: a
// throwaway one here, never the repo.
const home = process.cwd();
process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), 'brix-upsell-ai-')));
const { saveUpsellAiMode } = await import('../../app/services/cart-config-writes.server.js');
process.chdir(home);

const RULES = [{ id: 'ai-1', aiGenerated: true, triggerProductIds: ['gid://shopify/Product/1'], upsellProductIds: ['gid://shopify/Product/2'] }];

function fakePhp(record) {
  const posts = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (/save_cart_drawer\.php/.test(u) && (init.method || 'GET') === 'GET') {
      return new Response(JSON.stringify(record ? { status: 'success', data: record } : { status: 'error' }));
    }
    if (/save_cart_drawer\.php/.test(u) && init.method === 'POST') {
      posts.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ status: 'success' }));
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  return posts;
}

const RECORD = {
  cartStatus: 1, upsell_status: 1, progress_status: 1,
  upsell_data: JSON.stringify({ enabled: true, useAI: false, limit: 3, title: 'You may also like' }),
  progress_data: JSON.stringify({ enabled: true, tiers: [] }),
};

test('generating on a paid plan saves AI mode (and the rules) in the drawer record, keeping the rest', async () => {
  const posts = fakePhp(RECORD);
  assert.equal(await saveUpsellAiMode('demo.myshopify.com', 'growth', RULES), true);
  assert.equal(posts.length, 1);
  const up = JSON.parse(posts[0].upsell_data);
  assert.equal(up.useAI, true);
  assert.deepEqual(up.manualRules, RULES);
  assert.equal(up.title, 'You may also like', 'the merchant\'s other upsell settings stay');
  assert.equal(posts[0].progress_data, RECORD.progress_data, 'other blobs written back unchanged');
});

test('Free plan: every plan publishes every drawer feature, so its copy is whole and AI mode is saved', async () => {
  const posts = fakePhp(RECORD);
  assert.equal(await saveUpsellAiMode('demo.myshopify.com', 'free', RULES), true);
  assert.equal(posts.length, 1);
  assert.equal(JSON.parse(posts[0].upsell_data).useAI, true);
});

test('never writes back while the drawer reads as off (a paused order cap looks the same)', async () => {
  const posts = fakePhp({ ...RECORD, cartStatus: 0 });
  assert.equal(await saveUpsellAiMode('demo.myshopify.com', 'pro', RULES), false);
  assert.equal(posts.length, 0);
});

// A shop never saved before (no local copy of its record either).
test('no drawer record yet, or the backend failing: nothing written, never throws', async () => {
  const posts = fakePhp(null);
  assert.equal(await saveUpsellAiMode('new-shop.myshopify.com', 'pro', RULES), false);
  assert.equal(posts.length, 0);
  globalThis.fetch = async () => { throw new Error('network'); };
  assert.equal(await saveUpsellAiMode('new-shop.myshopify.com', 'pro', RULES), false);
});

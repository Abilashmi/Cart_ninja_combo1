// Run with: node --import ./tests/packs/register.mjs --test tests/ai-handoff
import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmbedEnabledInSettings, getEmbedStatus } from '../../app/services/theme-embed.server.js';
import { cartDrawerEmbedEditorUrl, EXTENSION_UUID } from '../../app/config/theme-extension.js';
import fs from 'node:fs';

const EMBED = 'shopify://apps/cart-ninja/blocks/cart_drawer/c57aa0a4-9f48-795d-3a28-d57b2bbe1419dcaa27cf';

test('embed detection reads settings_data.json blocks', () => {
  assert.equal(isEmbedEnabledInSettings({ current: { blocks: { a: { type: EMBED, disabled: false } } } }, 'cart_drawer'), true);
  assert.equal(isEmbedEnabledInSettings({ current: { blocks: { a: { type: EMBED } } } }, 'cart_drawer'), true, 'disabled flag absent = on');
  assert.equal(isEmbedEnabledInSettings({ current: { blocks: { a: { type: EMBED, disabled: true } } } }, 'cart_drawer'), false, 'switched off');
  assert.equal(isEmbedEnabledInSettings({ current: { blocks: { a: { type: 'shopify://apps/cart-ninja/blocks/fbt/x' } } } }, 'cart_drawer'), false, 'a different embed does not count');
  assert.equal(isEmbedEnabledInSettings({ current: { sections: { s: { blocks: { b: { type: EMBED } } } } } }, 'cart_drawer'), true);
  assert.equal(isEmbedEnabledInSettings({ current: {} }, 'cart_drawer'), false);
  assert.equal(isEmbedEnabledInSettings({}, 'cart_drawer'), false);
  assert.equal(isEmbedEnabledInSettings(null, 'cart_drawer'), false);
});

const realFetch = globalThis.fetch;
const themeFetch = ({ themes = { themes: [{ id: 7, role: 'main' }] }, asset, assetStatus = 200, themesStatus = 200, throwOn }) => async (url) => {
  const u = String(url);
  if (throwOn && u.includes(throwOn)) throw new Error('network down');
  const res = (body, status) => new Response(JSON.stringify(body), { status });
  if (u.includes('themes.json')) return res(themes, themesStatus);
  if (u.includes('assets.json')) return res({ asset }, assetStatus);
  return realFetch(url);
};

test('getEmbedStatus: warns only when the theme was read and the embed is confirmed off', async () => {
  try {
    globalThis.fetch = themeFetch({ asset: { value: JSON.stringify({ current: { blocks: {} } }) } });
    assert.deepEqual(await getEmbedStatus('s.myshopify.com', 'tok', 'cart_drawer'), { checked: true, enabled: false });
    globalThis.fetch = themeFetch({ asset: { value: JSON.stringify({ current: { blocks: { a: { type: EMBED } } } }) } });
    assert.deepEqual(await getEmbedStatus('s.myshopify.com', 'tok', 'cart_drawer'), { checked: true, enabled: true });
  } finally { globalThis.fetch = realFetch; }
});

test('getEmbedStatus: any failure to read the theme is "unknown", never a false warning', async () => {
  const unknown = { checked: false, enabled: true };
  try {
    globalThis.fetch = themeFetch({ themesStatus: 403 });
    assert.deepEqual(await getEmbedStatus('s.myshopify.com', 'tok', 'cart_drawer'), unknown);
    globalThis.fetch = themeFetch({ themes: { themes: [] }, asset: {} });
    assert.deepEqual(await getEmbedStatus('s.myshopify.com', 'tok', 'cart_drawer'), unknown);
    globalThis.fetch = themeFetch({ assetStatus: 404, asset: {} });
    assert.deepEqual(await getEmbedStatus('s.myshopify.com', 'tok', 'cart_drawer'), unknown);
    globalThis.fetch = themeFetch({ asset: { value: '{not json' } });
    assert.deepEqual(await getEmbedStatus('s.myshopify.com', 'tok', 'cart_drawer'), unknown);
    globalThis.fetch = themeFetch({ asset: {}, throwOn: 'assets.json' });
    assert.deepEqual(await getEmbedStatus('s.myshopify.com', 'tok', 'cart_drawer'), unknown);
    globalThis.fetch = themeFetch({ asset: { value: '' } });
    assert.deepEqual(await getEmbedStatus('s.myshopify.com', 'tok', 'cart_drawer'), unknown);
  } finally { globalThis.fetch = realFetch; }
});

test('the embed handle and deep link match the real extension', () => {
  const toml = fs.readFileSync('extensions/cart-drawer/shopify.extension.toml', 'utf8');
  assert.ok(toml.includes(EXTENSION_UUID), 'uid matches the extension toml');
  assert.ok(fs.existsSync('extensions/cart-drawer/blocks/cart_drawer.liquid'), 'the embed block file exists');
  assert.equal(
    cartDrawerEmbedEditorUrl('demo.myshopify.com'),
    `https://demo.myshopify.com/admin/themes/current/editor?context=apps&activateAppId=${EXTENSION_UUID}/cart_drawer`,
  );
  const liquid = fs.readFileSync('extensions/cart-drawer/blocks/cart_drawer.liquid', 'utf8');
  assert.match(liquid, /combo-page\.js/, 'this embed is what loads the combo page script');
});

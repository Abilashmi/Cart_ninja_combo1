// Run with: node --import ./tests/packs/register.mjs --test tests/combo-weight
// The combo page preloader (app/utils/combo-loader.shared.js): settings,
// checks and HTML shared by the storefront, the builder and api.combo-loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createComboLoader } from '../../app/utils/combo-loader.shared.js';

const Loader = createComboLoader();

test('defaults: a round spinner on white, on', () => {
  const s = Loader.pick({});
  assert.equal(s.enabled, true);
  assert.equal(s.style, 'ring');
  assert.equal(s.color, '#111827');
  assert.equal(s.bg, '#ffffff');
  assert.equal(s.logo, '');
  const html = Loader.html(s);
  assert.match(html, /class="bxl bxl--ring"/);
  assert.match(html, /bxl-ring/);
  assert.match(html, /min-height:60vh/);
  assert.doesNotMatch(html, /<img/);
});

test('merchant settings are checked: bad colours, sizes and styles fall back', () => {
  const s = Loader.pick({ loader_style: 'spin-wheel', loader_color: 'red;}', loader_size: 9999, loader_height: 5, loader_text: '  Packing\n your   box…  ' });
  assert.equal(s.style, 'ring');
  assert.equal(s.color, '#111827');
  assert.equal(s.size, 120);
  assert.equal(s.height, 20);
  assert.equal(s.text, 'Packing your box…');
  assert.equal(Loader.pick({ loader_enabled: false }).enabled, false);
});

test('logo: https links and small raster uploads only', () => {
  assert.equal(Loader.isValidLogo('https://cdn.shopify.com/logo.png'), true);
  assert.equal(Loader.isValidLogo('http://cdn.shopify.com/logo.png'), false);
  assert.equal(Loader.isValidLogo('https://x.com/a.png" onerror="alert(1)'), false);
  assert.equal(Loader.isValidLogo('data:image/png;base64,iVBORw0KGgo='), true);
  assert.equal(Loader.isValidLogo('data:image/svg+xml;base64,PHN2Zz4='), false, 'never SVG');
  assert.equal(Loader.isValidLogo(`data:image/png;base64,${'A'.repeat(Loader.LOGO_MAX_CHARS)}`), false, 'too big');
  assert.equal(Loader.pick({ loader_logo: 'javascript:alert(1)' }).logo, '');
});

test('logo inside the ring: the ring grows round it; above: logo first', () => {
  const inside = Loader.html(Loader.pick({ loader_logo: 'https://cdn.example.com/l.png', loader_logo_size: 80 }));
  assert.match(inside, /--bxl-size:108px/, 'logo 80 + 28');
  assert.match(inside, /bxl-ring-wrap"><span class="bxl-ring"><\/span><div class="bxl-inside"><img class="bxl-logo" src="https:\/\/cdn.example.com\/l.png"/);
  const above = Loader.html(Loader.pick({ loader_logo: 'https://cdn.example.com/l.png', loader_logo_place: 'above', loader_style: 'dots' }));
  assert.match(above, /^<div class="bxl bxl--dots"[^>]*><div class="bxl-above"><img/);
  assert.match(above, /bxl-dots"><span><\/span><span><\/span><span><\/span>/);
  const pulse = Loader.html(Loader.pick({ loader_style: 'pulse' }));
  assert.match(pulse, /bxl-pulse"><span class="bxl-blob">/);
});

test('text is escaped', () => {
  const html = Loader.html(Loader.pick({ loader_text: '<b>Hi</b> & "you"' }));
  assert.match(html, /&lt;b&gt;Hi&lt;\/b&gt; &amp; &quot;you&quot;/);
  assert.doesNotMatch(html, /<b>/);
});

test('subset keeps only the loader keys (what the endpoint and the browser cache hold)', () => {
  assert.deepEqual(Loader.subset({ layout: 'layout7', loader_style: 'dots', loader_logo: 'https://a.com/l.png', qs_accent: '#000' }), { loader_style: 'dots', loader_logo: 'https://a.com/l.png' });
});

test('the builder preview is drawn inline at its own height', () => {
  assert.match(Loader.html(Loader.pick({}), { inline: true, minHeight: 180 }), /min-height:180px/);
});

// "Continue shopping" next to Checkout (Cart Editor) and next to Pay now +
// COD (COD → Customize → Cart drawer): shared rules and their copies in
// cart_drawer_inline.js / brix_cod.js. Pure functions, no network.
// Run with: node --import ./tests/packs/register.mjs --test tests/cart-drawer/continue-shopping.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_CONTINUE_SHOPPING, continueHref, continueShoppingStyle, isValidContinueUrl, sanitizeContinueShopping,
} from '../../app/utils/continue-shopping.shared.js';
import { DEFAULT_COD_SETTINGS, sanitizeCodSettings } from '../../app/utils/cod.shared.js';

test('off by default, below, outline, closes the cart', () => {
  const cs = sanitizeContinueShopping(undefined);
  assert.deepEqual(cs, { ...DEFAULT_CONTINUE_SHOPPING });
  assert.equal(cs.enabled, false);
  assert.equal(continueHref(cs), '/collections/all');
});

test('bad values fall back, numbers are clamped, text is trimmed', () => {
  const cs = sanitizeContinueShopping({
    enabled: 'yes', text: '   Keep   browsing  ', placement: 'left', style: 'ghost', bg: 'red', color: '#ABC',
    fontSize: 99, radius: -4, paddingY: '7.6', action: 'go', url: 'javascript:alert(1)',
  });
  assert.equal(cs.enabled, false); // only a real true
  assert.equal(cs.text, 'Keep browsing');
  assert.equal(cs.placement, 'below');
  assert.equal(cs.style, 'outline');
  assert.equal(cs.bg, '#111827');
  assert.equal(cs.color, '#abc');
  assert.equal(cs.fontSize, 20);
  assert.equal(cs.radius, 0);
  assert.equal(cs.paddingY, 8);
  assert.equal(cs.action, 'close');
  assert.equal(cs.url, '');
  assert.equal(sanitizeContinueShopping({ text: '   ' }).text, 'Continue shopping');
});

test('a patch keeps what it does not name', () => {
  const base = sanitizeContinueShopping({ enabled: true, placement: 'above', style: 'filled', bg: '#008060' });
  const next = sanitizeContinueShopping({ text: 'Back to shop' }, base);
  assert.equal(next.enabled, true);
  assert.equal(next.placement, 'above');
  assert.equal(next.style, 'filled');
  assert.equal(next.bg, '#008060');
  assert.equal(next.text, 'Back to shop');
});

test('links: store paths and https only', () => {
  for (const ok of ['/collections/new', '/', '/pages/sale?x=1', 'https://shop.example.com/collections/all']) assert.equal(isValidContinueUrl(ok), true, ok);
  for (const bad of ['', '//evil.com', 'http://x.com', 'javascript:alert(1)', 'collections/all', '/a b', '/x"y']) assert.equal(isValidContinueUrl(bad), false, bad);
  assert.equal(continueHref(sanitizeContinueShopping({ action: 'link', url: '/collections/new' })), '/collections/new');
});

test('preview style: outline = inset border in the colour, link = underlined, filled = colours', () => {
  const outline = continueShoppingStyle({ bg: '#123456' });
  assert.equal(outline.background, 'transparent');
  assert.equal(outline.color, '#123456');
  assert.match(outline.boxShadow, /inset 0 0 0 1\.5px #123456/);
  const link = continueShoppingStyle({ style: 'link' });
  assert.equal(link.textDecoration, 'underline');
  assert.equal(link.boxShadow, 'none');
  const filled = continueShoppingStyle({ style: 'filled', bg: '#000000', color: '#ffffff' }, 13 / 15);
  assert.equal(filled.background, '#000000');
  assert.equal(filled.color, '#ffffff');
  assert.equal(filled.fontSize, 12.1);
});

test('COD settings: drawerContinue defaults off and is sanitized on save', () => {
  assert.equal(sanitizeCodSettings({}).drawerContinue.enabled, false);
  const saved = sanitizeCodSettings({ drawerContinue: { enabled: true, placement: 'above', url: '//x' } });
  assert.equal(saved.drawerContinue.enabled, true);
  assert.equal(saved.drawerContinue.placement, 'above');
  assert.equal(saved.drawerContinue.url, '');
  // A later patch without it keeps it.
  const again = sanitizeCodSettings({ codFee: 40 }, saved);
  assert.equal(again.drawerContinue.enabled, true);
  assert.equal(again.drawerContinue.placement, 'above');
  assert.equal(DEFAULT_COD_SETTINGS.drawerContinue.enabled, false);
});

// The storefront copies (ES5 / browser) must accept and refuse the same values.
function loadFn(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `${name} in ${file}`);
  let depth = 0;
  let end = src.indexOf('{', start);
  for (let i = end; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  return new Function(`${src.slice(start, end)}; return ${name};`)();
}

test('cart_drawer_inline.js ccContinueShopping matches the shared rules', () => {
  const cc = loadFn('extensions/cart-drawer/assets/cart_drawer_inline.js', 'ccContinueShopping');
  const cases = [
    null,
    { enabled: true },
    { enabled: true, text: '  Shop   more ', placement: 'above', style: 'link', bg: '#ff0000', fontSize: 3, radius: 50, paddingY: 30, action: 'link', url: '/collections/new' },
    { enabled: true, style: 'filled', url: '//evil.com', action: 'link', bg: 'blue' },
    { enabled: true, url: 'https://shop.example.com/pages/x' },
  ];
  for (const c of cases) assert.deepEqual(cc(c), sanitizeContinueShopping(c), JSON.stringify(c));
});

test('brix_cod.js continueLook: null when off, same rules when on', () => {
  const look = loadFn('extensions/cart-drawer/assets/brix_cod.js', 'continueLook');
  assert.equal(look({}), null);
  assert.equal(look({ drawerContinue: { enabled: false } }), null);
  const c = { enabled: true, text: 'Shop more', placement: 'above', style: 'filled', bg: '#ff0000', color: '#000000', fontSize: 16, radius: 4, paddingY: 10, action: 'link', url: '/collections/new' };
  const { enabled, ...rest } = sanitizeContinueShopping(c);
  assert.equal(enabled, true);
  assert.deepEqual(look({ drawerContinue: c }), rest);
  assert.equal(look({ drawerContinue: { enabled: true, url: '//x', fontSize: 99 } }).url, '');
  assert.equal(look({ drawerContinue: { enabled: true, fontSize: 99 } }).fontSize, 20);
});

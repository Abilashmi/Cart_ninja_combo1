// Run with: node --test tests/i18n
// Shopper-language text in the storefront scripts: the generated
// brix_i18n_<lang>.js files, the shim each script carries, and the English
// written at every call site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildStorefront, storefrontCallSites, loadCatalogs, STOREFRONT_SCRIPTS } from '../../scripts/i18n-tools.mjs';
import { I18N_SHIM, isStorefrontKey } from '../../app/i18n/storefront.shared.js';
import { formatMessage, placeholders } from '../../app/i18n/i18n.shared.js';
import { LOCALES, BETA_LOCALES } from '../../app/i18n/config.js';

const ASSETS = path.resolve('extensions/cart-drawer/assets');
const read = (file) => fs.readFileSync(path.join(ASSETS, file), 'utf8');
const en = JSON.parse(fs.readFileSync('app/i18n/en.json', 'utf8'));

// Runs a generated language file in a fake window; returns window.BrixI18n.
function loadLocale(locale) {
  const window = {};
  new Function('window', read(`brix_i18n_${locale}.js`))(window);
  return window.BrixI18n;
}

// The shim's functions on their own, with or without window.BrixI18n.
function shim(brixI18n) {
  const window = brixI18n ? { BrixI18n: brixI18n } : {};
  return new Function('window', `${I18N_SHIM}\nreturn { bxT, bxText, bxDir };`)(window);
}

test('the committed brix_i18n_<lang>.js files match the catalogues (run npm run i18n:storefront)', () => {
  const fresh = buildStorefront(ASSETS, undefined, { write: false });
  assert.deepEqual(Object.keys(fresh).sort(), LOCALES.filter((l) => l !== 'en').map((l) => `brix_i18n_${l}.js`).sort());
  for (const [file, text] of Object.entries(fresh)) assert.equal(read(file), text, `${file} is out of date`);
});

test('every storefront script carries the same shim', () => {
  for (const file of STOREFRONT_SCRIPTS) assert.ok(read(file).includes(I18N_SHIM), `${file}: copy I18N_SHIM from app/i18n/storefront.shared.js`);
});

test('the English at every call site is en.json, and en.json has no unused storefront keys', () => {
  const { sites, conflicts } = storefrontCallSites(ASSETS);
  assert.deepEqual(conflicts, []);
  for (const [key, { en: text, file }] of sites) assert.equal(en[key], text, `${file}: ${key} (run node scripts/i18n-tools.mjs extract)`);
  const unused = Object.keys(en).filter((k) => isStorefrontKey(k) && !sites.has(k));
  assert.deepEqual(unused, []);
});

test('the Liquid snippet loads exactly the live languages (not English, not beta)', () => {
  const liquid = fs.readFileSync('extensions/cart-drawer/snippets/brix-i18n.liquid', 'utf8');
  const live = /assign bx_live = '([^']*)'/.exec(liquid)[1].split(',');
  assert.deepEqual(live.sort(), LOCALES.filter((l) => l !== 'en' && !BETA_LOCALES.includes(l)).sort());
  for (const block of ['blocks/cart_drawer.liquid', 'blocks/Packs.liquid', 'snippets/fbt-widget-render.liquid']) {
    const src = fs.readFileSync(path.join('extensions/cart-drawer', block), 'utf8');
    const at = src.indexOf("{% render 'brix-i18n' %}");
    assert.ok(at > -1, `${block} renders brix-i18n`);
    assert.ok(at < src.search(/<script src="\{\{ '(brix_checkout|packs_widget|fbt_widget_render)\.js'/), `${block}: brix-i18n before the BRIX script`);
  }
});

test('a language file translates, falls back to the call site English, and runs once', () => {
  const hi = loadLocale('hi');
  const { catalogs } = loadCatalogs();
  assert.equal(hi.locale, 'hi');
  assert.equal(hi.dir, 'ltr');
  assert.equal(hi.t('storefront.drawer.subtotal', 'Subtotal'), catalogs.hi['storefront.drawer.subtotal']);
  assert.equal(hi.t('storefront.not.a.key', 'Only {count} left', { count: 3 }), 'Only 3 left');
  assert.match(hi.t('storefront.drawer.items_caps', 'x', { count: 2 }), /^2 /);
  assert.equal(loadLocale('ar').dir, 'rtl');
  // A second copy on the page (two blocks) keeps the first.
  const window = { BrixI18n: { first: true } };
  new Function('window', read('brix_i18n_ta.js'))(window);
  assert.equal(window.BrixI18n.first, true);
  // Only storefront keys ship (never admin text).
  assert.ok(!/"admin\.|"error\.admin\./.test(read('brix_i18n_hi.js')));
});

test('merchant texts: blank or the English default is translated, their own words stay', () => {
  const { bxText } = shim(loadLocale('es'));
  const es = loadCatalogs().catalogs.es;
  assert.equal(bxText('', 'storefront.drawer.empty', 'Your cart is empty'), es['storefront.drawer.empty']);
  assert.equal(bxText('  your cart IS empty ', 'storefront.drawer.empty', 'Your cart is empty'), es['storefront.drawer.empty']);
  assert.equal(bxText('Nada por aquí', 'storefront.drawer.empty', 'Your cart is empty'), 'Nada por aquí');
  assert.equal(bxText(null, 'storefront.drawer.empty', 'Your cart is empty'), es['storefront.drawer.empty']);
});

test('without a language file the shim shows the English, filled in like the real formatter', () => {
  const { bxT, bxText, bxDir } = shim(null);
  assert.equal(bxDir(), 'ltr');
  assert.equal(bxText('Mine', 'k', 'Default'), 'Mine');
  assert.equal(bxText('', 'k', 'Default {n}', { n: 2 }), 'Default 2');
  // Every English storefront message, with sample values, reads the same
  // through the shim's fallback as through createI18n's formatter.
  for (const [key, msg] of Object.entries(en)) {
    if (!isStorefrontKey(key)) continue;
    for (const n of [0, 1, 2, 7]) {
      const vars = Object.fromEntries((placeholders(msg) || []).map((name) => [name, n]));
      assert.equal(bxT(key, msg, vars), formatMessage(msg, vars, 'en'), `${key} with ${n}`);
    }
  }
});

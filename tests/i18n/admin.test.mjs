// Run with: node --test tests/i18n
// Admin language: which language a merchant gets, and that every admin text
// the pages ask for exists in English (en.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_LOCALES, ADMIN_LANGUAGE_CHOICES, LANGUAGE_NAMES, resolveAdminLocale, pickAdminMessages } from '../../app/i18n/admin.shared.js';
import { loadCatalogs } from '../../scripts/i18n-tools.mjs';

const en = JSON.parse(fs.readFileSync('app/i18n/en.json', 'utf8'));

test('admin languages: launch set without beta, every choice has a name', () => {
  assert.deepEqual(ADMIN_LOCALES, ['en', 'hi', 'ta', 'es']);
  assert.deepEqual(ADMIN_LANGUAGE_CHOICES, ['auto', 'en', 'hi', 'ta', 'es']);
  for (const l of ADMIN_LOCALES) assert.ok(LANGUAGE_NAMES[l], l);
});

test('the saved choice wins, then Shopify admin language, then English', () => {
  assert.equal(resolveAdminLocale({ saved: 'ta', shopifyLocale: 'es' }), 'ta');
  assert.equal(resolveAdminLocale({ saved: 'auto', shopifyLocale: 'es-ES' }), 'es');
  assert.equal(resolveAdminLocale({ saved: 'auto', shopifyLocale: 'fr' }), 'en');
  assert.equal(resolveAdminLocale({ shopifyLocale: 'hi_IN' }), 'hi');
  assert.equal(resolveAdminLocale({ saved: 'ar' }), 'en', 'beta languages are not offered in the admin');
  assert.equal(resolveAdminLocale({ saved: 'xx', shopifyLocale: '' }), 'en');
  assert.equal(resolveAdminLocale(), 'en');
});

test('admin texts: only admin keys, English fills any gap', () => {
  const catalogs = { en: { 'admin.a': 'A', 'admin.b': 'B', 'storefront.x': 'X' }, hi: { 'admin.a': 'अ' } };
  assert.deepEqual(pickAdminMessages(catalogs, 'hi'), { 'admin.a': 'अ', 'admin.b': 'B' });
  assert.deepEqual(pickAdminMessages(catalogs, 'en'), { 'admin.a': 'A', 'admin.b': 'B' });
  const { catalogs: shipped } = loadCatalogs();
  const hi = pickAdminMessages(shipped, 'hi');
  assert.equal(hi['admin.nav.home'], shipped.hi['admin.nav.home']);
  assert.ok(!Object.keys(hi).some((k) => k.startsWith('storefront.')));
});

// Every 'admin.…' / 'error.admin.…' string in admin code is a key en.json has.
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('every admin key used in app/ exists in en.json', () => {
  const missing = [];
  for (const file of walk('app')) {
    if (file.startsWith(path.join('app', 'i18n'))) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const [, key] of src.matchAll(/['"`]((?:admin|error\.admin)\.[a-z0-9_]+(?:\.[a-z0-9_]+)+)['"`]/g)) {
      if (key.startsWith('admin.shopify.')) continue; // the admin.shopify.com address, not a key
      if (!(key in en)) missing.push(`${file}: ${key}`);
    }
  }
  assert.deepEqual(missing, []);
});

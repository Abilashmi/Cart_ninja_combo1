// Run with: node --test tests/i18n
// The shipped catalogues, the validator that guards them, and the bundle build.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCatalogs, syncMeta, buildBundles, loadCatalogs } from '../../scripts/i18n-tools.mjs';
import { createTranslator, localeChain } from '../../app/i18n/i18n.shared.js';
import { LOCALES } from '../../app/i18n/config.js';

const SHIPPED = path.resolve('app/i18n');

// A throwaway copy of the catalogues so tests can break them freely.
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
  fs.cpSync(SHIPPED, dir, { recursive: true });
  return dir;
}
const edit = (dir, file, fn) => {
  const p = path.join(dir, file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(j);
  fs.writeFileSync(p, JSON.stringify(j));
};

test('shipped catalogues validate with no errors and are complete', () => {
  const { errors, stats } = validateCatalogs(SHIPPED);
  assert.deepEqual(errors, []);
  for (const l of LOCALES.filter((x) => x !== 'en')) {
    assert.equal(stats[l].missing, 0, `${l} missing keys`);
    assert.equal(stats[l].stale, 0, `${l} stale keys`);
  }
});

test('every shipped translation keeps the same placeholders (validator would flag it otherwise)', () => {
  const { catalogs } = loadCatalogs(SHIPPED);
  assert.deepEqual(Object.keys(catalogs).sort(), [...LOCALES].sort());
});

test('validator catches a changed placeholder', () => {
  const dir = sandbox();
  edit(dir, 'locales/es.json', (j) => { j['error.cod.item_sold_out'] = '{producto} está agotado.'; });
  const { errors } = validateCatalogs(dir);
  assert.ok(errors.some((e) => e.includes('es') && e.includes('error.cod.item_sold_out')), errors.join('\n'));
});

test('validator catches malformed JSON, malformed messages, unused keys, "<" and empty text', () => {
  const dir = sandbox();
  edit(dir, 'locales/hi.json', (j) => { j['error.generic'] = 'बुरा {'; j['storefront.drawer.add'] = '<b>जोड़ें</b>'; j['admin.common.save'] = ' '; j['error.not_in_english'] = 'x'; });
  fs.writeFileSync(path.join(dir, 'locales/ta.json'), '{ nope');
  const text = validateCatalogs(dir).errors.join('\n');
  assert.match(text, /hi: "error.generic" is a malformed message/);
  assert.match(text, /hi: "storefront.drawer.add" contains "<"/);
  assert.match(text, /hi: "admin.common.save" is empty/);
  assert.match(text, /hi: "error.not_in_english" is not in English/);
  assert.match(text, /ta: cannot read catalogue/);
});

test('validator rejects keys outside the known namespaces', () => {
  const dir = sandbox();
  edit(dir, 'en.json', (j) => { j['random.key'] = 'x'; });
  assert.match(validateCatalogs(dir).errors.join('\n'), /random\.key/);
});

test('a missing key is a warning (English shows), not an error', () => {
  const dir = sandbox();
  edit(dir, 'locales/ar.json', (j) => { delete j['error.generic']; });
  const r = validateCatalogs(dir);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => w.startsWith('ar: 1 key(s) missing')));
});

test('changed English marks the key needs-review and never overwrites an approved translation', () => {
  const dir = sandbox();
  edit(dir, 'meta/es.json', (j) => { j['storefront.drawer.add'] = { status: 'reviewed', srcHash: j['storefront.drawer.add'].srcHash }; });
  edit(dir, 'en.json', (j) => { j['storefront.drawer.add'] = 'Add to cart'; });
  const before = fs.readFileSync(path.join(dir, 'locales/es.json'), 'utf8');
  const meta = syncMeta(dir);
  assert.equal(meta.es['storefront.drawer.add'].status, 'needs-review');
  assert.equal(fs.readFileSync(path.join(dir, 'locales/es.json'), 'utf8'), before, 'translation text untouched');
  assert.ok(validateCatalogs(dir).warnings.some((w) => /es: 1 key\(s\) were translated from older English/.test(w)));
  // Running it again keeps the flag.
  assert.equal(syncMeta(dir).es['storefront.drawer.add'].status, 'needs-review');
});

test('new keys get an "ai" entry; reviewed keys with unchanged English stay reviewed', () => {
  const dir = sandbox();
  edit(dir, 'meta/hi.json', (j) => { j['error.generic'].status = 'reviewed'; delete j['admin.common.save']; });
  const meta = syncMeta(dir);
  assert.equal(meta.hi['error.generic'].status, 'reviewed');
  assert.equal(meta.hi['admin.common.save'].status, 'ai');
});

test('build writes one versioned file per locale plus a manifest, English included', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-out-'));
  const manifest = buildBundles(out, SHIPPED);
  assert.deepEqual(Object.keys(manifest).sort(), [...LOCALES].sort());
  for (const l of LOCALES) {
    const m = manifest[l];
    assert.match(m.file, new RegExp(`^${l}\\.[0-9a-f]{8}\\.json$`));
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(out, m.file), 'utf8'))).length, m.keys);
  }
  const again = buildBundles(fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-out-')), SHIPPED);
  assert.deepEqual(again, manifest, 'same input gives the same hashes');
  assert.ok(fs.existsSync(path.join(out, 'manifest.json')));
});

test('end to end: a shopper on Tamil with a missing key sees English, a missing locale sees English', () => {
  const { catalogs } = loadCatalogs(SHIPPED);
  const ta = { ...catalogs.ta };
  delete ta['error.generic'];
  const t = createTranslator([ta, catalogs.en], 'ta');
  assert.equal(t('storefront.cod.button'), catalogs.ta['storefront.cod.button']);
  assert.equal(t('error.generic'), catalogs.en['error.generic']);
  const chain = localeChain('fr', LOCALES, 'en').map((l) => catalogs[l]);
  assert.equal(createTranslator(chain, 'fr')('storefront.drawer.checkout'), 'Checkout');
});

test('Arabic cart count reads correctly for 0, 1, 2, 3, 11 and 100', () => {
  const { catalogs } = loadCatalogs(SHIPPED);
  const t = createTranslator([catalogs.ar, catalogs.en], 'ar');
  const got = [0, 1, 2, 3, 11, 100].map((count) => t('storefront.drawer.items', { count }));
  assert.deepEqual(got, ['لا عناصر', 'عنصر واحد', 'عنصران', '3 عناصر', '11 عنصرًا', '100 عنصر']);
});

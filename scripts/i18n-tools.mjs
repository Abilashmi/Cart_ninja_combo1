// Catalogue tools for the multi-language work.
//   node scripts/i18n-tools.mjs validate   check every catalogue (exit 1 on errors)
//   node scripts/i18n-tools.mjs meta       add missing review entries, flag stale ones
//   node scripts/i18n-tools.mjs build [out] write versioned per-locale bundles + manifest (default i18n-dist)
//   node scripts/i18n-tools.mjs extract     add the storefront scripts' new keys (and their English) to en.json
//   node scripts/i18n-tools.mjs storefront  write extensions/cart-drawer/assets/brix_i18n_<locale>.js
// Nothing here uploads or deploys anything.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { createI18n, placeholders, hashText } from '../app/i18n/i18n.shared.js';
import { createStorefrontI18n, isStorefrontKey } from '../app/i18n/storefront.shared.js';
import { DEFAULT_LOCALE, LOCALES, KEY_NAMESPACES, HTML_ALLOWED_KEYS } from '../app/i18n/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'i18n');
const ASSETS = path.resolve(ROOT, '..', '..', 'extensions', 'cart-drawer', 'assets');

function readJson(file) {
  try {
    return { data: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (e) {
    return { error: e.code === 'ENOENT' ? 'file not found' : e.message };
  }
}

const isFlat = (o) => o && typeof o === 'object' && !Array.isArray(o) && Object.values(o).every((v) => typeof v === 'string');
const metaFile = (root, locale) => path.join(root, 'meta', `${locale}.json`);

export function loadCatalogs(root = ROOT) {
  const out = {};
  const errors = [];
  for (const locale of LOCALES) {
    const file = locale === DEFAULT_LOCALE ? path.join(root, 'en.json') : path.join(root, 'locales', `${locale}.json`);
    const { data, error } = readJson(file);
    if (error) errors.push(`${locale}: cannot read catalogue (${error})`);
    else if (!isFlat(data)) errors.push(`${locale}: catalogue must be a flat object of strings`);
    else out[locale] = data;
  }
  return { catalogs: out, errors };
}

export function validateCatalogs(root = ROOT) {
  const { catalogs, errors } = loadCatalogs(root);
  const warnings = [];
  const stats = {};
  const en = catalogs[DEFAULT_LOCALE];
  if (!en) return { errors, warnings, stats };

  for (const [key, msg] of Object.entries(en)) {
    if (!KEY_NAMESPACES.some((ns) => key.startsWith(ns))) errors.push(`en: key "${key}" is not in a known namespace`);
    if (placeholders(msg) === null) errors.push(`en: "${key}" is a malformed message`);
  }

  for (const locale of LOCALES) {
    const cat = catalogs[locale];
    if (!cat || locale === DEFAULT_LOCALE) continue;
    const meta = readJson(metaFile(root, locale));
    const metaData = meta.data || {};
    if (meta.error) warnings.push(`${locale}: no review metadata (${meta.error}); run "meta"`);
    let missing = 0;
    let stale = 0;
    let reviewed = 0;
    for (const [key, enMsg] of Object.entries(en)) {
      if (!(key in cat)) { missing++; continue; }
      const msg = cat[key];
      const want = placeholders(enMsg);
      const got = placeholders(msg);
      if (got === null) errors.push(`${locale}: "${key}" is a malformed message`);
      else if (want && want.join(',') !== got.join(',')) {
        errors.push(`${locale}: "${key}" uses {${got.join(', ')}} but English uses {${want.join(', ')}}`);
      }
      if (msg.includes('<') && !HTML_ALLOWED_KEYS.includes(key)) errors.push(`${locale}: "${key}" contains "<" (translations are plain text)`);
      if (!msg.trim()) errors.push(`${locale}: "${key}" is empty`);
      const m = metaData[key];
      if (m && m.status === 'reviewed') reviewed++;
      if (m && m.srcHash !== hashText(enMsg)) stale++;
    }
    for (const key of Object.keys(cat)) {
      if (!(key in en)) errors.push(`${locale}: "${key}" is not in English (unused key)`);
    }
    if (missing) warnings.push(`${locale}: ${missing} key(s) missing, English will show for them`);
    if (stale) warnings.push(`${locale}: ${stale} key(s) were translated from older English and need review`);
    stats[locale] = { keys: Object.keys(cat).length, of: Object.keys(en).length, missing, stale, reviewed };
  }
  return { errors, warnings, stats };
}

/** Add review entries for new keys (status "ai"), flag keys whose English changed. Never touches an approved key's text. */
export function syncMeta(root = ROOT, { write = true } = {}) {
  const { catalogs } = loadCatalogs(root);
  const en = catalogs[DEFAULT_LOCALE] || {};
  const result = {};
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE || !catalogs[locale]) continue;
    const prev = readJson(metaFile(root, locale)).data || {};
    const next = {};
    for (const key of Object.keys(catalogs[locale]).sort()) {
      if (!(key in en)) continue;
      const src = hashText(en[key]);
      const old = prev[key];
      if (!old) next[key] = { status: 'ai', srcHash: src };
      else if (old.srcHash !== src) next[key] = { status: 'needs-review', srcHash: old.srcHash };
      else next[key] = old;
    }
    result[locale] = next;
    if (write) {
      fs.mkdirSync(path.join(root, 'meta'), { recursive: true });
      fs.writeFileSync(metaFile(root, locale), JSON.stringify(next, null, 2) + '\n');
    }
  }
  return result;
}

/** Versioned bundles: <locale>.<hash>.json holds only that locale; English is baked into the scripts. */
export function buildBundles(outDir, root = ROOT) {
  const { catalogs } = loadCatalogs(root);
  fs.mkdirSync(outDir, { recursive: true });
  const manifest = {};
  for (const locale of LOCALES) {
    const cat = catalogs[locale];
    if (!cat) continue;
    const sorted = Object.fromEntries(Object.keys(cat).sort().map((k) => [k, cat[k]]));
    const body = JSON.stringify(sorted);
    const hash = hashText(body);
    const file = `${locale}.${hash}.json`;
    fs.writeFileSync(path.join(outDir, file), body);
    manifest[locale] = { file, hash, keys: Object.keys(sorted).length, bytes: Buffer.byteLength(body) };
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// Storefront scripts whose texts go through bxT / bxText (app/i18n/storefront.shared.js).
export const STOREFRONT_SCRIPTS = ['cart_drawer_inline.js', 'brix_cod.js', 'packs_widget.js', 'fbt_widget_render.js'];

// A key and its English as written at a call site: 'storefront.x', 'English'.
const CALL_SITE = /'((?:storefront|error)\.[a-z0-9_.]+)'\s*,\s*('(?:[^'\\]|\\.)*')/g;

/** Every [key, English] the storefront scripts use, with any key given two different English texts. */
export function storefrontCallSites(dir = ASSETS) {
  const sites = new Map();
  const conflicts = [];
  for (const file of STOREFRONT_SCRIPTS) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [, key, literal] of src.matchAll(CALL_SITE)) {
      const en = new Function(`return ${literal}`)();
      const seen = sites.get(key);
      if (seen && seen.en !== en) conflicts.push(`${key}: "${seen.en}" (${seen.file}) vs "${en}" (${file})`);
      else if (!seen) sites.set(key, { en, file });
    }
  }
  return { sites, conflicts };
}

/** Adds call-site keys missing from en.json (sorted); returns the keys added. Never changes an existing English text. */
export function extractStorefront(root = ROOT, dir = ASSETS) {
  const { sites, conflicts } = storefrontCallSites(dir);
  if (conflicts.length) throw new Error(`same key, different English:\n${conflicts.join('\n')}`);
  const file = path.join(root, 'en.json');
  const en = JSON.parse(fs.readFileSync(file, 'utf8'));
  const added = [...sites.keys()].filter((k) => !(k in en));
  for (const k of added) en[k] = sites.get(k).en;
  const sorted = Object.fromEntries(Object.keys(en).sort().map((k) => [k, en[k]]));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
  return added;
}

/**
 * The storefront file for one language: the message helper, the runtime and
 * that language's storefront keys, setting window.BrixI18n once per page.
 * English has no file (the scripts carry their English).
 */
export function storefrontAsset(locale, catalog) {
  const keys = Object.keys(catalog).filter(isStorefrontKey).sort();
  const own = Object.fromEntries(keys.map((k) => [k, catalog[k]]));
  return `/* BRIX shopper text, ${locale}. Generated by \`npm run i18n:storefront\` from app/i18n; do not edit. */
(function () {
  if (window.BrixI18n) return;
  var core = (${createI18n.toString()})();
  window.BrixI18n = (${createStorefrontI18n.toString()})(core, ${JSON.stringify(locale)}, ${JSON.stringify(own)});
})();
`;
}

/** Writes brix_i18n_<locale>.js for every non-English locale; returns { file: text }. */
export function buildStorefront(outDir = ASSETS, root = ROOT, { write = true } = {}) {
  const { catalogs } = loadCatalogs(root);
  const out = {};
  for (const locale of LOCALES) {
    if (locale === DEFAULT_LOCALE || !catalogs[locale]) continue;
    out[`brix_i18n_${locale}.js`] = storefrontAsset(locale, catalogs[locale]);
  }
  if (write) for (const [file, text] of Object.entries(out)) fs.writeFileSync(path.join(outDir, file), text);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'validate') {
    const { errors, warnings, stats } = validateCatalogs();
    warnings.forEach((w) => console.log('warning:', w));
    errors.forEach((e) => console.log('ERROR:', e));
    console.log(JSON.stringify(stats));
    process.exit(errors.length ? 1 : 0);
  } else if (cmd === 'meta') {
    const r = syncMeta();
    console.log('meta written for', Object.keys(r).join(', '));
  } else if (cmd === 'build') {
    console.log(JSON.stringify(buildBundles(path.resolve(arg || 'i18n-dist')), null, 2));
  } else if (cmd === 'extract') {
    const added = extractStorefront();
    console.log(added.length ? `added to en.json: ${added.join(', ')}` : 'en.json already has every storefront key');
  } else if (cmd === 'storefront') {
    const files = buildStorefront();
    for (const [file, text] of Object.entries(files)) console.log(`${file} ${Buffer.byteLength(text)} bytes`);
  } else {
    console.log('usage: node scripts/i18n-tools.mjs validate | meta | build [outDir] | storefront');
    process.exit(2);
  }
}

/* eslint-env node */
// Browser check for the FBT settings page (app/routes/app.fbt.jsx), outside
// Shopify: server modules are stubbed, loader data is mocked, the Shopify
// resource picker is faked, then Playwright renders it.
// Run from the repo root: node tests/fbt/admin-page-browser-check.mjs
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { normalizeConfig } from '../../app/utils/fbt-core.shared.js';

const ROOT = process.cwd();
const OUT = path.join(os.tmpdir(), 'brix-fbt-admin-check');
fs.mkdirSync(OUT, { recursive: true });

const STUBS = {
  'shopify.server': 'export const authenticate = {};',
  'plan-permissions.server': 'export const getShopPlan = () => {};',
  'fbt-v2.server': 'export const loadFbtV2 = () => {}, saveFbtV2 = () => {};',
  'fbt-pairs.server': 'export const buildFbtPairs = () => {};',
};
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /\.server$/ }, (args) => ({ path: path.basename(args.path), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path] || '', loader: 'js' }));
    b.onResolve({ filter: /ai-agent\/BrixBar$/ }, () => ({ path: 'brixbar', namespace: 'brixbar' }));
    b.onLoad({ filter: /.*/, namespace: 'brixbar' }, () => ({ contents: 'export default function BrixBar() { return null; }', loader: 'js' }));
    b.onResolve({ filter: /^@shopify\/app-bridge-react$/ }, () => ({ path: 'ab', namespace: 'ab' }));
    b.onLoad({ filter: /.*/, namespace: 'ab' }, () => ({ contents: 'export const useAppBridge = () => window.shopify;', loader: 'js' }));
    b.onResolve({ filter: /^react-router$/ }, () => ({ path: 'rr', namespace: 'rr' }));
    b.onLoad({ filter: /.*/, namespace: 'rr' }, () => ({
      contents: `import { useState } from 'react';
        export const useLoaderData = () => window.__DATA__;
        export const useRouteError = () => null;
        export const useNavigate = () => () => {};
        export const useFetcher = () => { const [s] = useState({ state: 'idle', data: null, submit: (b) => { window.__SUBMITTED__ = b; } }); return s; };`,
      loader: 'js', resolveDir: ROOT,
    }));
    b.onResolve({ filter: /^@shopify\/shopify-app-react-router\/server$/ }, () => ({ path: 'b', namespace: 'boundary' }));
    b.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({ contents: 'export const boundary = { error: () => null, headers: () => ({}) };', loader: 'js' }));
  },
};

fs.writeFileSync(path.join(OUT, 'entry.jsx'), `
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@shopify/polaris';
import en from '@shopify/polaris/locales/en.json';
import Page from '${path.join(ROOT, 'app/routes/app.fbt.jsx').replace(/\\/g, '/')}';
createRoot(document.getElementById('root')).render(<AppProvider i18n={en}><Page /></AppProvider>);
`);
await build({
  entryPoints: [path.join(OUT, 'entry.jsx')],
  bundle: true, outfile: path.join(OUT, 'bundle.js'), format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' }, plugins: [stubPlugin], logLevel: 'error',
  nodePaths: [path.join(ROOT, 'node_modules')],
});
const css = fs.readFileSync(path.join(ROOT, 'node_modules/@shopify/polaris/build/esm/styles.css'), 'utf8');
const js = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8');

const sample = (id, title, price, variants = [['Default Title', price]]) => ({
  id: String(id), handle: title.toLowerCase().replace(/ /g, '-'), title, featured_image: '',
  variants: variants.map(([t, p], i) => ({ id: `${id}${i}`, title: t, public_title: t === 'Default Title' ? null : t, price: p, compare_at_price: null, available: true })),
});
const data = {
  shop: 'demo.myshopify.com', saved: false, enabled: true, embedEnabled: false, moneyFormat: 'Rs. {{amount}}',
  config: normalizeConfig({ rules: [{ id: 'old1', name: 'Old rule', when: { type: 'products', products: [{ id: '1', handle: 'tee', title: 'Classic Tee' }] }, show: { type: 'products', products: [{ id: '2', handle: 'cap', title: 'Cap' }] } }] }),
  samples: [sample(1, 'Classic Tee', 59900, [['S', 59900], ['M', 64900]]), sample(2, 'Denim Shorts', 39900), sample(3, 'Cap', 19900), sample(4, 'Socks', 9900)],
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1400), height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div>
  <script>window.__DATA__=${JSON.stringify(data)};
  window.__PICKS__=[];
  window.shopify={toast:{show:function(){}},resourcePicker:function(o){window.__PICKS__.push(o.type);
    return Promise.resolve(o.type==='collection'
      ? (o.multiple?[{id:'gid://shopify/Collection/50',title:'Tees',handle:'tees'}]:[{id:'gid://shopify/Collection/60',title:'Bottoms',handle:'bottoms'}])
      : [{id:'gid://shopify/Product/3',title:'Cap',handle:'cap',images:[{originalSrc:'https://cdn.shopify.com/cap.jpg'}]}]);}};
  </script><script>${js}</script></body></html>`;
await page.route('https://admin.test/**', (route) => route.fulfill({ contentType: 'text/html', body: html }));
await page.goto('https://admin.test/app/fbt');
await page.waitForSelector('text=What to show');
await page.waitForTimeout(400);

const text = await page.locator('body').textContent();
check('page: on/off card, What to show, Automatic pairs, Design, live preview', ['FBT on product pages', 'What to show', 'Automatic pairs', 'Design', 'Live preview'].every((t) => text.includes(t)));
check('page: theme embed warning with a link to the theme editor', text.includes('Turn on the FBT Widget app embed'));
check('page: the existing rule is listed in plain words', text.includes('On: Classic Tee') && text.includes('Shows: Cap'));
check('preview: the bundle, with "This item" and pictures joined by +', await page.locator('.fbt-preview .bxf--bundle').count() === 1 && (await page.locator('.fbt-preview .bxf-plus').count()) === 3);
check('Save: off until something changes', await page.getByRole('button', { name: 'Save' }).isDisabled());

// New collection → collection rule
await page.getByRole('button', { name: 'Add rule' }).click();
await page.getByRole('button', { name: 'Pick collections' }).click();
await page.getByLabel('Show these together').selectOption('collection');
await page.getByRole('button', { name: 'Pick a collection' }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Add rule', exact: true }).click();
await page.waitForTimeout(200);
check('rule: "Products in Tees → Products from Bottoms" added', (await page.locator('body').textContent()).includes('On: Products in Tees') && (await page.locator('body').textContent()).includes('Shows: Products from Bottoms'));
check('rule: the Shopify pickers were used (whole catalog, not a short list)', JSON.stringify(await page.evaluate(() => window.__PICKS__)) === '["collection","collection"]');

// An incomplete rule can't be added
await page.getByRole('button', { name: 'Add rule' }).click();
await page.getByLabel('Show on').selectOption('products');
await page.getByRole('button', { name: 'Add rule', exact: true }).click();
check('rule: an incomplete rule says what is missing', (await page.locator('body').textContent()).includes('Pick the products this rule is for.'));
await page.getByRole('button', { name: 'Cancel' }).click();

// Reorder: the new rule up
await page.getByRole('button', { name: 'Move up' }).nth(1).click();
check('rule: moved to the top', (await page.locator('.Polaris-Text--headingSm').filter({ hasText: /^Rule|^Old rule/ }).first().textContent()).startsWith('Rule'));

// Design
await page.getByRole('button', { name: /Cards/ }).click();
await page.waitForTimeout(150);
check('design: Cards → the preview shows a card with Add to cart for each product', await page.locator('.fbt-preview .bxf--cards').count() === 1 && (await page.locator('.fbt-preview [data-fbt-add]').count()) === 3);
await page.getByLabel('Heading').fill('Complete the look');
await page.waitForTimeout(150);
check('design: heading shows in the preview', (await page.locator('.fbt-preview .bxf-h').textContent()) === 'Complete the look');
await page.getByRole('button', { name: /Bundle/ }).click();
await page.waitForTimeout(150);
await page.locator('.fbt-preview [data-fbt-toggle="p3"]').uncheck();
await page.waitForTimeout(150);
check('preview: ticks work like on the storefront (total follows)', /Rs\. 1,097\.00/.test(await page.locator('.fbt-preview .bxf-total').textContent()), await page.locator('.fbt-preview .bxf-total').textContent());
await page.screenshot({ path: path.join(OUT, 'fbt-admin.png'), fullPage: true });

// Save
await page.getByRole('button', { name: 'Save' }).click();
const sent = JSON.parse(await page.evaluate(() => window.__SUBMITTED__ || '{}'));
check('Save: sends the rules (collection rule first), design and placement; never the pairs',
  sent.intent === 'save' && sent.config.rules[0].when.collections[0].handle === 'tees' && sent.config.rules[0].show.collection.handle === 'bottoms'
  && sent.config.title === 'Complete the look' && sent.config.style === 'bundle' && sent.config.pairs === undefined,
  JSON.stringify(sent).slice(0, 300));
await page.getByRole('button', { name: 'Build pairs now' }).click();
check('Build pairs now: asks the server to build them', JSON.parse(await page.evaluate(() => window.__SUBMITTED__)).intent === 'build_pairs');

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshot ${path.join(OUT, 'fbt-admin.png')}`);
process.exit(failed.length ? 1 : 0);

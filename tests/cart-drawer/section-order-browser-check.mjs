/* eslint-env node */
// Browser check for dragging the drawer's parts in the Cart Editor preview (section order).
// (copied harness of editor-preview-browser-check.mjs)
// Browser check for the Cart Editor's Image Banner section and live preview
// (app/components/CartEditorPage.jsx with the real sidebar + preview), outside
// Shopify: loader data is mocked, the AI bar is stubbed, saves are captured.
// Run from the repo root: node tests/cart-drawer/editor-preview-browser-check.mjs
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const OUT = path.join(os.tmpdir(), 'brix-cart-editor-check');
fs.mkdirSync(OUT, { recursive: true });
const shotDir = path.join(os.tmpdir(), 'brix-cart-editor-shots');
fs.mkdirSync(shotDir, { recursive: true });

const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /ai-agent\/BrixBar$/ }, () => ({ path: 'brixbar', namespace: 'stub' }));
    b.onLoad({ filter: /^brixbar$/, namespace: 'stub' }, () => ({ contents: 'export default function BrixBar(){ return null; }', loader: 'js' }));
    b.onResolve({ filter: /^react-router$/ }, () => ({ path: 'rr', namespace: 'rr' }));
    b.onLoad({ filter: /.*/, namespace: 'rr' }, () => ({
      contents: `import { useState } from 'react';
        export const useLoaderData = () => window.__DATA__;
        export const useNavigate = () => (to) => { window.__NAV__ = to; };
        export const useLocation = () => ({ pathname: '/app/cartdrawer', search: '' });
        export const useFetcher = () => { const [s] = useState({ state: 'idle', data: null, submit: (b) => { window.__LEGACY__ = b; } }); return s; };`,
      loader: 'js', resolveDir: ROOT,
    }));
  },
};

fs.writeFileSync(path.join(OUT, 'entry.jsx'), `
import { createRoot } from 'react-dom/client';
import { AppProvider } from '@shopify/polaris';
import en from '@shopify/polaris/locales/en.json';
import { CurrencyProvider } from '${path.join(ROOT, 'app/components/CurrencyContext.jsx').replace(/\\/g, '/')}';
import { PlanProvider } from '${path.join(ROOT, 'app/components/PlanContext.jsx').replace(/\\/g, '/')}';
import CartEditorPage from '${path.join(ROOT, 'app/components/CartEditorPage.jsx').replace(/\\/g, '/')}';
createRoot(document.getElementById('root')).render(
  <AppProvider i18n={en}><CurrencyProvider symbol="₹" code="INR" locale="en-IN"><PlanProvider plan="pro"><CartEditorPage /></PlanProvider></CurrencyProvider></AppProvider>
);
`);
await build({
  entryPoints: [path.join(OUT, 'entry.jsx')],
  bundle: true, outdir: OUT, entryNames: 'bundle', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' }, plugins: [stubPlugin], logLevel: 'error',
  loader: { '.css': 'css' }, nodePaths: [path.join(ROOT, 'node_modules')],
});
const polarisCss = fs.readFileSync(path.join(ROOT, 'node_modules/@shopify/polaris/build/esm/styles.css'), 'utf8');
const appCss = fs.readFileSync(path.join(OUT, 'bundle.css'), 'utf8');
const js = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const svg = (w, h, fill, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/><text x="50%" y="55%" font-family="Arial" font-size="${Math.round(h / 5)}" fill="#fff" text-anchor="middle">${label}</text></svg>`;
const data = {
  coupons: [], allProducts: [], drawerEnabled: true, cartRecord: null, pbRecord: null, csRecord: null, upsellRecord: null,
  configRecord: { is_enabled: 1, banner_enabled: 0, banner_placement: 'above_progress' },
};

const browser = await chromium.launch();
// One context, so later pages (the upsell checks) get the same mocks.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
const saves = [];
page.on('pageerror', (e) => errors.push(e.message));
await ctx.route('https://admin.test/**', async (route) => {
  const url = new URL(route.request().url());
  // Product search for the "select products" modals (any product of a big store).
  if (url.pathname === '/api/product-search') {
    const book = (n, title) => ({ id: `gid://shopify/Product/${n}`, title, handle: `book-${n}`, image: '', price: '99.00', variants: [{ id: `gid://shopify/ProductVariant/${n}1`, title: 'Default Title', price: '99.00', available: true }], available: true });
    const all = [book(9001, 'Story Book Gift'), book(9002, 'Saved Gift Book')];
    const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const products = ids.length ? all.filter((p) => ids.includes(p.id)) : all.filter((p) => q && p.title.toLowerCase().includes(q));
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, products }) });
  }
  if (url.pathname.startsWith('/api/')) {
    saves.push({ path: url.pathname, body: JSON.parse(route.request().postData() || '{}') });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
  }
  // CartPreview links the app's /brix_cart_ui.css route (app/routes/brix_cart_ui[.]css.jsx).
  if (url.pathname === '/brix_cart_ui.css') {
    return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(ROOT, 'extensions/cart-drawer/assets/brix_cart_ui.css'), 'utf8') });
  }
  return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><style>${polarisCss}</style><style>${appCss}</style><style>body{margin:0}</style></head><body><div id="root"></div><script>window.__DATA__=${JSON.stringify(data)}</script><script>${js}</script></body></html>` });
});
await ctx.route('https://img.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: svg(800, 400, '#be185d', 'MOBILE') }));
await page.goto('https://admin.test/app/cartdrawer');
await page.waitForSelector('.bxcd-root');
await page.waitForTimeout(300);
// Nothing is unsaved right after loading: Shopify's save bar (AppSaveBar, open = isDirty)
// would otherwise show at once and block leaving the page.

const yOf = (key) => page.evaluate((k) => document.querySelector(`.bxcd-root [data-arrange-key="${k}"]`)?.getBoundingClientRect().top ?? null, key);
check('no "Arrange" button: parts are draggable at once', await page.evaluate(() => !/Arrange sections/.test(document.body.textContent) && document.querySelector('.bxcd-root [data-arrange-key="checkout"]')?.getAttribute('draggable') === 'true'));
const before = [await yOf('summary'), await yOf('checkout')];
check('footer starts: summary above checkout', before[0] < before[1], before.join(' / '));
await page.locator('.bxcd-root [data-arrange-key="checkout"]').dragTo(page.locator('.bxcd-root [data-arrange-key="summary"]'));
await page.waitForTimeout(200);
const after = [await yOf('summary'), await yOf('checkout')];
check('drag the whole checkout part onto the summary: checkout is now above it', after[1] < after[0], after.join(' / '));
// Clicking still opens the editor section (a click is not a drag).
await page.locator('.bxcd-root [data-arrange-key="checkout"]').click({ position: { x: 20, y: 10 } });
await page.waitForTimeout(150);
check('a plain click still opens its editor section', await page.evaluate(() => /Checkout/.test(document.body.textContent)));
// Body: items can move relative to the other body parts only; footer parts never jump zones.
const zoneOk = await page.evaluate(() => { const f = document.querySelector('.bxcd-root [data-arrange-key="summary"]'); const b = document.querySelector('.bxcd-root [data-arrange-key="items"]'); return b.getBoundingClientRect().top < f.getBoundingClientRect().top; });
check('body stays above the footer', zoneOk);
// One list from the header to the cart items: a part dragged up passes the header, one dragged down passes the items.
await page.locator('.bxcd-root [data-arrange-key="items"]').dragTo(page.locator('.bxcd-root [data-arrange-key="header"]'));
await page.waitForTimeout(250);
check('drag the cart items up onto the header: items are now above the header', (await yOf('items')) < (await yOf('header')), `${await yOf('items')} / ${await yOf('header')}`);
await page.locator('.bxcd-root [data-arrange-key="items"]').dragTo(page.locator('.bxcd-root [data-arrange-key="header"]'), { targetPosition: { x: 20, y: 40 } });
await page.waitForTimeout(250);
await page.locator('.bxcd-root [data-arrange-key="header"]').dragTo(page.locator('.bxcd-root [data-arrange-key="items"]'), { targetPosition: { x: 40, y: 150 } });
await page.waitForTimeout(250);
check('drag the header down onto the items: the header is now below them', (await yOf('header')) > (await yOf('items')), `${await yOf('header')} / ${await yOf('items')}`);
// Design -> Colour theme: a ready mix paints the drawer, a custom mix and text colour follow.
await page.locator('button', { hasText: /^Design/ }).first().click();
await page.waitForSelector('text=Colour theme');
const drawerBg = () => page.evaluate(() => getComputedStyle(document.querySelector('.bxcd-root')).backgroundImage + ' | ' + getComputedStyle(document.querySelector('.bxcd-root')).backgroundColor);
check('no theme: the drawer is plain white', /rgb\(255, 255, 255\)/.test(await drawerBg()), await drawerBg());
await page.getByRole('button', { name: 'Sunset' }).click();
await page.waitForTimeout(150);
check('Sunset: the drawer background is a gradient of its two colours', /linear-gradient/.test(await drawerBg()) && /255, 214, 165/.test(await drawerBg()), await drawerBg());
await page.getByRole('button', { name: 'Night' }).click();
await page.waitForTimeout(150);
const nightText = await page.evaluate(() => getComputedStyle(document.querySelector('.bxcd-root .bxcd-theme-text')).color);
check('Night (dark): text drawn on the drawer turns light on its own', nightText === 'rgb(255, 255, 255)', nightText);
await page.getByRole('button', { name: 'Custom', exact: true }).click();
await page.getByRole('button', { name: 'Use one colour only' }).click();
await page.waitForTimeout(150);
check('one colour only: a plain background, no gradient', !/linear-gradient/.test(await drawerBg()), await drawerBg());
await page.getByRole('button', { name: 'White', exact: true }).click();
await page.waitForTimeout(150);
check('White: back to the plain drawer', /rgb\(255, 255, 255\)/.test(await drawerBg()), await drawerBg());
await page.getByRole('button', { name: 'Lavender' }).click();
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(500);
const legacy = await page.evaluate(() => window.__LEGACY__);
const style = legacy && JSON.parse(legacy.checkout_button_style || '{}');
check('Save sends the order in checkout_button_style.sectionOrder', style && style.sectionOrder && style.sectionOrder.footer.indexOf('checkout') < style.sectionOrder.footer.indexOf('summary'), JSON.stringify(style && style.sectionOrder));
const themeSaved = (() => { try { return JSON.parse(legacy.checkout_button_style).theme; } catch (e) { return null; } })();
check('Save sends the theme in checkout_button_style.theme', themeSaved && themeSaved.preset === 'lavender' && themeSaved.color2 === '#ffd9f0', JSON.stringify(themeSaved));
check('no page errors', errors.length === 0, errors.join(' | '));
await page.screenshot({ path: path.join(shotDir, 'section-order.png') });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? failed.length + ' FAILED' : 'all passed');
process.exit(failed.length ? 1 : 0);

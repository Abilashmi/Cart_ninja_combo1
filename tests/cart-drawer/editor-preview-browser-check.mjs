/* eslint-env node */
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
const saves = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('https://admin.test/**', async (route) => {
  const url = new URL(route.request().url());
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
await page.route('https://img.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: svg(800, 400, '#be185d', 'MOBILE') }));
await page.goto('https://admin.test/app/cartdrawer');
await page.waitForSelector('text=Image Banner');
await page.waitForTimeout(300);

const preview = () => page.evaluate(() => {
  const drawer = document.querySelector('.bxcd-root');
  const img = drawer.querySelector('.bxcd-banner img');
  const pick = (sel) => drawer.querySelector(sel);
  const top = (el) => (el ? el.getBoundingClientRect().top : null);
  const items = drawer.querySelector('.bxcd-items');
  const progress = [...drawer.querySelectorAll('.preview-highlight-zone')].find((z) => /reward|away|unlock/i.test(z.textContent));
  const rows = [...drawer.querySelectorAll('.bxcd-item')].map((it) => {
    const r = (s) => it.querySelector(s)?.getBoundingClientRect();
    const box = it.getBoundingClientRect();
    const rg = document.createRange(); rg.selectNodeContents(it.querySelector('.bxcd-item__title'));
    const t = rg.getBoundingClientRect(); const x = r('.bxcd-item__remove'); const q = r('.bxcd-item__qty'); const tot = r('.bxcd-item__total');
    const ov = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return { inside: [x, q, tot].filter(Boolean).every((p) => p.right <= box.right + 0.5 && p.left >= box.left - 0.5), titleVsRemove: ov(t, x), qtyVsTotal: ov(q, tot), media: Math.round(r('.bxcd-item__media').width) };
  });
  return {
    banner: img ? img.getAttribute('src') : null,
    placeholder: /Image banner is off|Add an image/.test(drawer.textContent),
    order: [['banner', top(pick('.bxcd-banner'))], ['items', top(items)], ['progress', top(progress)]].filter(([, t]) => t != null).sort((a, b) => a[1] - b[1]).map(([k]) => k).join(' > '),
    footer: /Total/.test(drawer.textContent) && Boolean(drawer.querySelector('.bxcd-summary')),
    checkout: [...drawer.querySelectorAll('button')].some((b) => /Checkout/.test(b.textContent)),
    mobile: drawer.classList.contains('bxcd-root--mobile'),
    rows,
    summaryAligned: (() => { const v = [...drawer.querySelectorAll('.bxcd-summary__value')].map((e) => Math.round(e.getBoundingClientRect().right)); return v.length >= 2 && Math.max(...v) - Math.min(...v) <= 1; })(),
  };
});

// Sidebar: the section exists, is Off, and its preview placeholder shows while editing.
check('sidebar: "Image Banner" section in the Body group, Off by default', (await page.locator('button', { hasText: 'Image Banner' }).first().textContent()).includes('Off'));
await page.locator('button', { hasText: 'Image Banner' }).first().click();
await page.waitForTimeout(200);
let p = await preview();
check('preview: while editing, a placeholder marks where the banner goes; nothing else', p.placeholder && !p.banner);

// Turn it on and upload a desktop image through the real drop zone.
await page.getByRole('switch', { name: 'Show image banner' }).click();
const desktopSvg = svg(1200, 300, '#1d4ed8', 'DESKTOP');
await page.locator('input[type=file]').first().setInputFiles({ name: 'banner.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(desktopSvg) });
await page.waitForFunction(() => document.querySelector('.bxcd-root .bxcd-banner img'), null, { timeout: 5000 }).catch(() => null);
p = await preview();
check('upload: the image is resized in the browser into a raster data URL and shows in the preview', /^data:image\/(webp|jpeg);base64,/.test(p.banner || ''), (p.banner || '').slice(0, 30));
check('default placement Above Progress Bar: banner first in the cart (no progress bar on)', p.order.startsWith('banner'), p.order);
check('section badge turns On', (await page.locator('button', { hasText: 'Image Banner' }).first().textContent()).includes('On'));

// Mobile image by link; the phone preview uses it, the desktop preview the desktop one.
await page.getByLabel('Or use an image link').nth(1).fill('https://img.test/mobile.svg');
await page.getByRole('button', { name: 'Use link' }).nth(1).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /Mobile/ }).first().click();
await page.waitForTimeout(300);
p = await preview();
check('phone preview: mobile image and the mobile row layout', p.banner === 'https://img.test/mobile.svg' && p.mobile && p.rows.every((r) => r.media === 64), JSON.stringify({ src: p.banner, mobile: p.mobile, media: p.rows.map((r) => r.media) }));
check('phone preview: rows clean (title clear of remove, quantity clear of subtotal, nothing outside the card)', p.rows.every((r) => r.inside && !r.titleVsRemove && !r.qtyVsTotal), JSON.stringify(p.rows));
await page.screenshot({ path: path.join(shotDir, 'mobile.png') });
await page.getByRole('button', { name: /Desktop/ }).first().click();
await page.waitForTimeout(300);
p = await preview();
check('desktop preview: desktop image and the desktop row layout', /^data:image/.test(p.banner || '') && !p.mobile && p.rows.every((r) => r.media === 76), JSON.stringify({ mobile: p.mobile, media: p.rows.map((r) => r.media) }));
check('desktop preview: rows clean and pricing summary aligned', p.rows.every((r) => r.inside && !r.titleVsRemove && !r.qtyVsTotal) && p.summaryAligned, JSON.stringify(p.rows));
await page.screenshot({ path: path.join(shotDir, 'desktop.png') });

// Placement moves the banner in the preview.
await page.getByLabel('Placement').selectOption('below_products');
await page.waitForTimeout(200);
p = await preview();
check('placement Below Products: banner moves under the items', p.order === 'items > banner', p.order);
await page.getByLabel('Placement').selectOption('above_products');
await page.waitForTimeout(200);
check('placement Above Products: banner above the items', (await preview()).order === 'banner > items');

// Empty vs non-empty cart in the preview.
await page.getByRole('button', { name: 'Empty', exact: true }).click();
await page.waitForTimeout(200);
p = await preview();
check('empty-cart preview: no pricing summary, no checkout button', !p.footer && !p.checkout, JSON.stringify({ footer: p.footer, checkout: p.checkout }));
await page.screenshot({ path: path.join(shotDir, 'empty.png') });
await page.getByRole('button', { name: 'Items', exact: true }).click();
await page.waitForTimeout(200);
p = await preview();
check('cart-with-items preview: pricing summary and checkout button', p.footer && p.checkout);

// Disable → nothing outside editing; Save sends the banner fields.
await page.getByLabel('Alt text (optional)').fill('Free shipping over ₹999');
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(800);
const cfg = saves.find((s) => s.path === '/api/cart-drawer-config')?.body || {};
check('save: banner settings go to /api/cart-drawer-config with the other drawer settings',
  cfg.banner_enabled === 1 && /^data:image/.test(cfg.banner_desktop_image) && cfg.banner_mobile_image === 'https://img.test/mobile.svg'
  && cfg.banner_placement === 'above_products' && cfg.banner_alt === 'Free shipping over ₹999' && cfg.header_title === 'Your Cart',
  JSON.stringify({ ...cfg, banner_desktop_image: String(cfg.banner_desktop_image).slice(0, 24) }).slice(0, 400));
await page.getByRole('switch', { name: 'Show image banner' }).click();
await page.locator('button', { hasText: 'Header Style' }).first().click();
await page.waitForTimeout(200);
p = await preview();
check('banner off and section closed: nothing in the preview', !p.banner && !p.placeholder);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots in ${shotDir}`);
process.exit(failed.length ? 1 : 0);

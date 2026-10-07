/* eslint-env node */
// Browser check for the COD customizer (app/routes/app.cod_.customize.jsx), outside
// Shopify: server modules are stubbed and loader data is mocked, then Playwright renders it.
// Run from the repo root: node tests/cod/customize-page-browser-check.mjs [live|off]   (W=<width> to resize)
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sanitizeCodSettings } from '../../app/utils/cod.shared.js';

const ROOT = process.cwd();
const OUT = path.join(os.tmpdir(), 'brix-cod-customize-check');
fs.mkdirSync(OUT, { recursive: true });

const STUBS = {
  'shopify.server': 'export const authenticate = {};',
  'plan-permissions.server': 'export const getShopPlan = () => {};',
  'currency.server': 'export const getShopCurrency = () => {};',
  'cod.server': 'export class CodError extends Error {}; export const getCodSettings=()=>{}, saveCodSettings=()=>{}, syncCodRuntime=()=>{}, listCodOrders=()=>{}, summarizeCodOrders=()=>({}), getCodSecrets=()=>{}, getCodSecretsStatus=()=>{}, saveCodSecrets=()=>{};',
  'cod-tracking.server': 'export const sendCodTestEvents = () => {};',
  'cod-sms.server': 'export const smsProviderStatus = () => {};',
  'discounts.server': 'export const listActiveDiscounts = async () => [];',
};

const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /\.server$/ }, (args) => ({ path: path.basename(args.path), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path] || '', loader: 'js' }));
    b.onResolve({ filter: /^react-router$/ }, () => ({ path: 'rr', namespace: 'rr' }));
    b.onLoad({ filter: /.*/, namespace: 'rr' }, () => ({
      contents: `import { useState } from 'react';
        export const useLoaderData = () => window.__DATA__;
        export const useRouteError = () => null;
        export const useNavigate = () => (to) => { window.__NAV__ = to; };
        export const useSearchParams = () => [new URLSearchParams(window.__SEARCH__ || '')];
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
import Page from '${path.join(ROOT, 'app/routes/app.cod_.customize.jsx').replace(/\\/g, '/')}';
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

const now = Date.now();
const day = 86400000;
const statuses = ['pending', 'paid', 'paid', 'pending', 'cancelled', 'paid', 'pending'];
const lifecycles = ['shipped', 'paid', 'paid', 'rto', 'cancelled', 'paid', 'placed'];
const sent = [{ ga4: 'sent', meta: 'sent' }, { ga4: 'no_consent', meta: 'no_consent' }, { ga4: 'no_client_id', meta: 'sent' }, { ga4: 'failed', meta: 'rejected' }];
const sources = ['drawer', 'product', 'combo'];
const names = ['Ananya Rao', 'Rohit Sharma', 'Priya Nair', 'Vikram Singh', 'Meera Iyer', 'Arjun Mehta', 'Kavya Reddy'];
const orders = Array.from({ length: 18 }, (_, i) => ({
  orderNumericId: 5000 + i, orderName: `#${1047 - i}`, customer: names[i % names.length], phone: `98XXXX${String(3210 + i).slice(-4)}`,
  phoneVerified: i % 3 !== 2, pincode: String(560001 + i * 7), source: sources[i % 3], total: 499 + ((i * 337) % 2500),
  currency: 'INR', status: statuses[i % statuses.length], lifecycle: lifecycles[i % lifecycles.length], tracking: sent[i % sent.length], createdAt: new Date(now - Math.floor(i * 0.7) * day - i * 3600000).toISOString(),
}));
const sum = (l) => l.reduce((a, o) => a + o.total, 0);
const scenario = process.argv[2] || 'live';
const settings = {
  enabled: scenario !== 'off', surfaces: { drawer: true, product: true, combo: scenario !== 'live' ? true : false },
  codFee: 49, shippingFee: 60, freeShippingAbove: 999, minOrder: 299, maxOrder: 5000, requireOtp: true, dailyLimitPerPhone: 3,
  blockedPincodes: ['744101', '744102', '682551'], excludedProductTags: ['no-cod', 'pre-order'], allowCoupons: true,
  prepaidNudgeText: 'Pay online and get 5% off with code PREPAID5.', orderTags: ['COD'],
  buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with Cash on Delivery', bg: '#0d6b4c', color: '#ffffff' },
  tracking: { ga4Id: '', metaPixelId: '123456789012345', metaContentId: 'shopify', dataLayer: true },
};
const data = {
  // As the loader sends it: getCodSettings() always returns sanitized settings.
  shop: 'demo.myshopify.com', settings: sanitizeCodSettings(settings), orders: scenario === 'empty' ? [] : orders,
  stats: scenario === 'empty' ? { count: 0, toCollect: 0, collected: 0, paidCount: 0, cancelledCount: 0, cancelRate: 0 } : {
    count: orders.length, toCollect: sum(orders.filter((o) => o.status === 'pending')), collected: sum(orders.filter((o) => o.status === 'paid')),
    paidCount: orders.filter((o) => o.status === 'paid').length, cancelledCount: orders.filter((o) => o.status === 'cancelled').length,
    cancelRate: Math.round((orders.filter((o) => o.status === 'cancelled').length / orders.length) * 100),
  },
  loadError: null, planState: scenario === 'warn' ? 'preview' : 'enabled', currencyCode: 'INR',
  sms: { configured: scenario === 'live' }, hasOrderScope: true,
  secretsStatus: { ga4ApiSecret: { set: false, last4: '' }, metaCapiToken: { set: true, last4: 'x9Zq' }, metaTestCode: { set: false, last4: '' } },
  couponOptions: [
    { code: 'SAVE10', title: 'Save 10%', summary: '10% off entire order • Minimum purchase of ₹999.00' },
    { code: 'WELCOME50', title: 'Welcome ₹50', summary: '₹50.00 off entire order • For first order' },
  ],
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
const width = Number(process.env.W || 1400);
const page = await browser.newPage({ viewport: { width, height: Number(process.env.H || 1000) } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{background:#f1f1f1;margin:0}</style></head><body><div id="root"></div><script>window.__DATA__=${JSON.stringify(data)}</script><script>${js}</script></body></html>`;
await page.route('https://admin.test/**', (route) => {
  const p = new URL(route.request().url()).pathname;
  if (p === '/brix-logo.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'public/brix-logo.png')) });
  return route.fulfill({ contentType: 'text/html', body: html });
});
await page.goto('https://admin.test/app/cod/customize');
await page.waitForSelector('.bcz-side');
await page.waitForTimeout(500);
const shot = (n, opts = {}) => page.screenshot({ path: path.join(os.tmpdir(), `cod-customize-${scenario}-${width}-${n}.png`), ...opts });
const row = (label) => page.locator('.bcz-row').filter({ has: page.locator('.bcz-row-l', { hasText: new RegExp(`^${label}$`) }) });
const openSec = async (label) => {
  const r = row(label);
  if ((await r.getAttribute('aria-expanded')) !== 'true') await r.click();
  await page.waitForTimeout(200);
};
const badge = (label) => row(label).locator('.bcz-badge').textContent().catch(() => '');
const pv = () => page.evaluate(() => {
  const btns = [...document.querySelectorAll('.bcz-screen .bcod-dr-btns > *')];
  const cod = document.querySelector('.bcz-screen .bcod-dr-btns .cod-pv-btn');
  return {
    order: btns.map((b) => (b.classList.contains('cod-pv-btn') ? 'cod' : 'checkout')),
    codText: cod ? cod.textContent : null,
    codBg: cod ? getComputedStyle(cod).backgroundColor : null,
    codRadius: cod ? getComputedStyle(cod).borderRadius : null,
    codOpacity: cod ? getComputedStyle(cod).opacity : null,
  };
});

await shot('start');
const layout = await page.evaluate(() => {
  const side = document.querySelector('.bcz-side').getBoundingClientRect();
  const main = document.querySelector('.bcz-main').getBoundingClientRect();
  const frame = document.querySelector('.bcz-frame').getBoundingClientRect();
  return {
    title: document.querySelector('.bcz-title')?.textContent,
    groups: [...document.querySelectorAll('.bcz-group')].map((g) => g.textContent),
    sideBySide: side.right <= main.left + 1 && Math.abs(side.top - main.top) < 2,
    frameInView: frame.top < window.innerHeight && frame.bottom > 0 && frame.width > 250,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    pill: document.querySelector('.bcz-pill')?.textContent,
    openRow: document.querySelector('.bcz-row.is-open .bcz-row-l')?.textContent,
  };
});
check('customizer: titled "Customize COD" with an Active / Inactive pill, like the Cart Editor', layout.title === 'Customize COD' && layout.pill === (scenario === 'off' ? 'Inactive' : 'Active'), `${layout.title} · ${layout.pill}`);
check('customizer: section groups Get started / Cart drawer / Other pages / Charges & rules / Checkout popup / Advanced',
  layout.groups.join('|') === 'Get started|Cart drawer|Other pages|Charges & rules|Checkout popup|Advanced', layout.groups.join('|'));
check('customizer: opens on the cart drawer Position section', layout.openRow === 'Position');
{
  const bars = await page.evaluate(() => ({
    bar: Math.round(document.querySelector('.bcz-bar').getBoundingClientRect().height),
    foot: Math.round(document.querySelector('.bcz-foot').getBoundingClientRect().height),
    items: [...document.querySelectorAll('.bcz-screen .bcod-dr-item')].filter((el) => {
      const r = el.getBoundingClientRect();
      const box = document.querySelector('.bcz-screen .bcod-dr-items').getBoundingClientRect();
      return r.bottom <= box.bottom + 1;
    }).length,
    place: [...document.querySelectorAll('.bcod-place-o')].map((o) => Math.round(o.getBoundingClientRect().width)),
  }));
  if (width > 900) {
    check(`preview at ${width}x${Number(process.env.H || 1000)}: toolbar and bottom bar take one line each`, bars.bar <= 46 && bars.foot <= 44, JSON.stringify(bars));
    check(`preview at ${width}x${Number(process.env.H || 1000)}: the cart drawer shows both sample items`, bars.items === 2, JSON.stringify(bars));
  }
  check('Position: one option per row, full width of the section', bars.place.length === 3 && new Set(bars.place).size === 1 && bars.place[0] > 300, JSON.stringify(bars.place));
}
if (width > 900) check(`layout at ${width}px: sections left, live preview right, device frame in view`, layout.sideBySide && layout.frameInView);
check(`layout at ${width}px: no sideways scroll`, !layout.overflow);

if (scenario === 'live') {
  // Position
  check('Position: badge shows the cart drawer is On', await badge('Position') === 'On');
  check('Position: three placement cards; preview Above Checkout by default', await page.locator('.bcod-place-o .bcod-mini').count() === 3 && JSON.stringify((await pv()).order) === '["cod","checkout"]');
  await page.getByRole('radio', { name: /Replace Checkout/ }).click();
  check('Replace Checkout: preview shows only COD', JSON.stringify((await pv()).order) === '["cod"]');
  await shot('replace');
  await page.getByRole('radio', { name: /Below Checkout/ }).click();
  check('Below Checkout: preview shows Checkout, then COD', JSON.stringify((await pv()).order) === '["checkout","cod"]');

  // COD button
  await openSec('COD button');
  check('Opening a section closes the other (one at a time)', await page.locator('.bcz-row.is-open').count() === 1);
  await page.getByLabel('Button text', { exact: true }).fill('Pay cash on delivery');
  await page.getByRole('button', { name: 'Outline', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Border radius' }).fill('4');
  await page.waitForTimeout(400);
  let p = await pv();
  check('COD button: text, Outline style and border radius update the preview', p.codText.includes('Pay cash on delivery') && p.codBg === 'rgba(0, 0, 0, 0)' && p.codRadius === '4px', `${p.codBg} ${p.codRadius}`);
  await page.getByRole('button', { name: 'Filled', exact: true }).click();
  await page.getByRole('textbox', { name: /^Button colour/ }).fill('#1d4ed8');
  await page.waitForTimeout(400);
  check('COD button: colour updates the preview', (await pv()).codBg === 'rgb(29, 78, 216)');
  await shot('button');

  // Device switch
  await page.getByRole('button', { name: 'Mobile' }).click();
  await page.waitForTimeout(200);
  check('Preview: Mobile shows a phone frame', await page.locator('.bcz-frame.is-mobile').count() === 1);
  await shot('mobile');
  await page.getByRole('button', { name: 'Desktop' }).click();

  // Product page
  await openSec('Product page');
  check('Product page: preview switches to the product page', await page.locator('.bcz-screen .cod-scr-atc').count() === 1);
  await shot('product');

  // COD fee
  await openSec('COD fee');
  check('COD fee: preview switches to the COD checkout', await page.locator('.bcz-screen .cod-scr-sheet').count() === 1);
  check('COD fee: settings saved before the switch (codFee 49) show the fee as on', await page.getByLabel('Charge a COD fee').isChecked() && await badge('COD fee') === 'On');
  await page.getByLabel('Fee amount').fill('40');
  await page.getByLabel('Fee title').fill('Handling fee');
  await page.waitForTimeout(1300); // BRIX loader in the preview
  const rows = await page.evaluate(() => [...document.querySelectorAll('.bcod-sum-r')].map((r) => r.textContent));
  check('COD fee: Subtotal ₹1,299, the fee under its title, Total ₹1,339', rows.some((r) => r.startsWith('Handling fee') && r.includes('40')) && rows.some((r) => r.startsWith('Total') && r.includes('1,339')), rows.join(' | '));
  check('COD fee: the COD checkout preview lists the fee under its title', (await page.locator('.bcz-screen .cod-pv-rows').textContent()).includes('Handling fee'));
  await page.getByLabel('Show fee to customers').uncheck();
  await page.waitForTimeout(150);
  check('Show fee off: the preview shows one "Delivery charges" line', (await page.locator('.bcz-screen .cod-pv-rows').textContent()).includes('Delivery charges'));
  await page.getByLabel('Show fee to customers').check();
  await shot('fee');

  // Eligibility
  await openSec('Eligibility');
  const tagInput = page.getByLabel('Excluded product tags');
  await tagInput.fill('fragile');
  await page.locator('.bcod-tags').getByRole('button', { name: 'Add' }).click();
  await tagInput.fill('NO-COD');
  await tagInput.press('Enter');
  await page.waitForTimeout(100);
  const dupError = await page.locator('.bcod-tagin .Polaris-InlineError').textContent().catch(() => '');
  await page.getByRole('button', { name: 'Remove pre-order' }).click();
  const chips = await page.evaluate(() => [...document.querySelectorAll('.bcod-chip')].map((c) => c.textContent.replace('×', '')));
  check('Excluded tags: chips, duplicates refused, removable', JSON.stringify(chips) === '["no-cod","fragile"]' && /already added/.test(dupError), `${chips} · ${dupError}`);
  check('Excluded behaviour: "Show COD as unavailable" by default', await page.getByRole('radio', { name: /Show COD as unavailable/ }).isChecked());
  await page.getByLabel('Excluded product in cart').check();
  await page.waitForTimeout(400);
  p = await pv();
  check('Preview: excluded product shows COD unavailable, Checkout kept', p.codText?.includes('Not available for some items') && p.codOpacity === '0.5' && p.order.includes('checkout'), JSON.stringify(p));
  await page.getByText('Hide COD completely', { exact: true }).click();
  await page.waitForTimeout(200);
  p = await pv();
  check('Preview: "Hide COD completely" removes the button for that cart', p.codText === null && p.order.join() === 'checkout', JSON.stringify(p));
  await page.getByLabel('Excluded product in cart').uncheck();
  await shot('eligibility');

  // Popup + coupons + tracking
  await openSec('Popup design');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="90"><circle cx="45" cy="45" r="36" fill="#e11d48"/><text x="96" y="58" font-family="Arial" font-weight="700" font-size="40" fill="#111827">Acme Store</text></svg>';
  await page.locator('.cod-logo-drop input[type=file]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await page.waitForSelector('.cod-logo-img img');
  await page.getByRole('button', { name: 'Soft' }).click();
  await page.waitForTimeout(1300);
  check('Popup design: preview shows the logo and soft corners', await page.locator('.bcz-screen .cod-scr-sheet.rad-soft .cod-pv-logo').count() === 1);
  await openSec('Coupons');
  await page.getByLabel('Add one of your Shopify codes').selectOption('SAVE10');
  check('Coupons: a Shopify code added as an offer', await page.locator('.cod-offer-code', { hasText: 'SAVE10' }).count() === 1);
  // A tall popup (open coupon box + offers) keeps its full height: the Place COD order button is never cut off.
  await page.getByLabel('Show the code box open').check();
  await page.getByLabel('Add one of your Shopify codes').selectOption('WELCOME50');
  await page.waitForTimeout(1300);
  for (const dev of ['Desktop', 'Mobile']) {
    await page.getByRole('button', { name: dev }).click();
    for (const surf of ['Cart drawer', 'Product page', 'COD checkout']) {
      await page.locator('.bcz-seg [role=tab]', { hasText: surf }).click();
      await page.waitForTimeout(surf === 'COD checkout' ? 1300 : 300);
      await page.evaluate(() => document.querySelector('.bcz-main').scrollIntoView({ block: 'start' }));
      const v = await page.evaluate(() => {
        const screen = document.querySelector('.bcz-screen');
        const sr = screen.getBoundingClientRect();
        const frame = document.querySelector('.bcz-frame').getBoundingClientRect();
        const last = document.querySelector('.bcz-screen .cod-pv-place, .bcz-screen .cod-pv-pw, .bcz-screen .cod-scr-buys, .bcz-screen .bcod-dr-btns');
        const lr = last ? last.getBoundingClientRect() : null;
        return {
          frameW: Math.round(frame.width),
          frameFits: frame.top >= 0 && frame.bottom <= window.innerHeight + 1,
          scrolls: screen.scrollHeight > screen.clientHeight + 1,
          lastVisible: Boolean(lr) && lr.top >= sr.top - 1 && lr.bottom <= sr.bottom + 1 && lr.height > 10,
        };
      });
      check(`${dev} · ${surf}: like the Cart Editor (${dev === 'Desktop' ? 360 : 320}px frame, fully in view), no scrolling, everything visible`,
        Math.abs(v.frameW - (dev === 'Desktop' ? 360 : 320)) <= 2 && v.frameFits && !v.scrolls && v.lastVisible, JSON.stringify(v));
      if (surf === 'COD checkout') await shot(`sheet-${dev.toLowerCase()}`);
    }
  }
  await page.getByRole('button', { name: 'Desktop' }).click();
  await openSec('Ads & analytics');
  await page.getByLabel('Measurement ID').fill('g-abc123xyz');
  check('Ads & analytics: saved Meta token shown only as last 4', (await page.locator('.cod-secret').first().textContent()).includes('x9Zq'));

  // Validation + save
  await page.evaluate(() => { window.__SUBMITTED__ = null; });
  await openSec('COD fee');
  await page.getByLabel('Fee amount').fill('');
  await openSec('Shipping');
  check('Errors: the section with a problem is flagged in the sidebar', await badge('COD fee') === '1 error');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(200);
  check('Errors: Save opens that section and sends nothing', (await page.locator('.bcz-row.is-open .bcz-row-l').textContent()) === 'COD fee' && !(await page.evaluate(() => window.__SUBMITTED__)));
  await page.getByLabel('Fee amount').fill('40');
  await page.locator('.bcz-pill').click();
  check('Active pill: switches COD off (saved with Save)', (await page.locator('.bcz-pill').textContent()) === 'Inactive');
  await page.locator('.bcz-pill').click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const saved = (await page.evaluate(() => JSON.parse(window.__SUBMITTED__ || '{}'))).settings || {};
  check('Save: every change is sent',
    saved.enabled === true && saved.drawerPlacement === 'below' && saved.buttons?.style === 'filled' && saved.buttons?.radius === 4 && saved.buttons?.bg === '#1d4ed8'
    && saved.buttons?.drawerText === 'Pay cash on delivery' && saved.codFeeEnabled === true && saved.codFee === 40 && saved.codFeeLabel === 'Handling fee'
    && saved.showCodFee === true && saved.excludedProductTags === 'no-cod, fragile' && saved.excludedBehavior === 'hide'
    && saved.sheet?.radius === 'soft' && saved.sheet?.offers?.[0]?.code === 'SAVE10' && saved.tracking?.ga4Id === 'G-ABC123XYZ',
    JSON.stringify({ p: saved.drawerPlacement, b: saved.buttons, fee: [saved.codFeeEnabled, saved.codFee, saved.codFeeLabel] }));
  let asked = '';
  page.once('dialog', (d) => { asked = d.message(); d.accept(); });
  await page.locator('.bcz-back').click();
  await page.waitForTimeout(100);
  check('Back arrow: asks before leaving unsaved changes, then returns to the dashboard', /unsaved/i.test(asked) && await page.evaluate(() => window.__NAV__) === '/app/cod', asked);
}
console.log('errors:', errors.length ? errors.join('\n') : 'none');
check('no page or console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

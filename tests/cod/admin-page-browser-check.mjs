/* eslint-env node */
// Browser check for the COD dashboard (app/routes/app.cod.jsx), outside Shopify:
// server modules are stubbed and loader data is mocked, then Playwright renders it.
// Run from the repo root: node tests/cod/admin-page-browser-check.mjs [live|warn|off|empty]
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sanitizeCodSettings } from '../../app/utils/cod.shared.js';
import { resolveCodRange } from '../../app/utils/cod-dates.shared.js';

const ROOT = process.cwd();
const OUT = path.join(os.tmpdir(), 'brix-cod-admin-check');
fs.mkdirSync(OUT, { recursive: true });

const STUBS = {
  'shopify.server': 'export const authenticate = {};',
  'plan-permissions.server': 'export const getShopPlan = () => {};',
  'currency.server': 'export const getShopCurrency = () => {};',
  'cod.server': 'export class CodError extends Error {}; export const getCodSettings=()=>{}, saveCodSettings=()=>{}, syncCodRuntime=()=>{}, listCodOrders=()=>{}, loadCodOrders=()=>{}, summarizeCodOrders=()=>({}), getCodSecrets=()=>{}, getCodSecretsStatus=()=>{}, saveCodSecrets=()=>{}, msg91Creds=()=>({}), getCodShippingStats=()=>{}, getShopTimezone=()=>{}, COD_ORDERS_VIEW_MAX=500;',
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
        export const useNavigation = () => ({ state: 'idle' });
        // The date filter's setSearchParams: records the query it would load.
        export const useSearchParams = () => [new URLSearchParams(window.__SEARCH__ || ''), (next) => {
          const prev = new URLSearchParams(window.__SEARCH__ || '');
          window.__SEARCH_SET__ = String(typeof next === 'function' ? next(prev) : new URLSearchParams(next));
        }];
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
import Page from '${path.join(ROOT, 'app/routes/app.cod.jsx').replace(/\\/g, '/')}';
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
  // The date filter as the loader resolves it (no query = last 30 days, the shop's days).
  range: resolveCodRange({}, { timeZone: 'Asia/Kolkata' }), timeZone: 'Asia/Kolkata', ordersTotal: scenario === 'empty' ? 0 : orders.length,
  stats: scenario === 'empty' ? { count: 0, toCollect: 0, collected: 0, paidCount: 0, cancelledCount: 0, cancelRate: 0 } : {
    count: orders.length, toCollect: sum(orders.filter((o) => o.status === 'pending')), collected: sum(orders.filter((o) => o.status === 'paid')),
    paidCount: orders.filter((o) => o.status === 'paid').length, cancelledCount: orders.filter((o) => o.status === 'cancelled').length,
    cancelRate: Math.round((orders.filter((o) => o.status === 'cancelled').length / orders.length) * 100),
  },
  // As getCodShippingStats() returns it (null when the PHP server has no shipping stats yet).
  shippingStats: scenario === 'empty' ? null : {
    days: 30, orders: 12, shipping: 1035, total: 15800, free: 4,
    byOption: [{ name: 'Standard delivery', orders: 9, shipping: 540, free: 4 }, { name: 'Express delivery', orders: 3, shipping: 495, free: 0 }],
    byZone: [{ name: 'Metro', orders: 7, shipping: 690, free: 2 }, { name: '', orders: 5, shipping: 345, free: 2 }],
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
const page = await browser.newPage({ viewport: { width, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const htmlFor = (d) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{background:#f1f1f1;margin:0}</style></head><body><div id="root"></div><script>window.__DATA__=${JSON.stringify(d)}</script><script>${js}</script></body></html>`;
// ?v=today: the date filter on Today (orders of today, by hour); ?v=cut: a period holding more orders than one view loads.
const todayData = { ...data, range: resolveCodRange({ range: 'today' }, { timeZone: 'Asia/Kolkata' }), orders: orders.slice(0, 3).map((o, i) => ({ ...o, createdAt: new Date(Date.now() - i * 3600000).toISOString() })), ordersTotal: 3 };
const cutData = { ...data, orders, ordersTotal: 600 };
const serve = (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/brix-logo.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'public/brix-logo.png')) });
  const v = u.searchParams.get('v');
  return route.fulfill({ contentType: 'text/html', body: htmlFor(v === 'today' ? todayData : v === 'cut' ? cutData : data) });
};
await page.route('https://admin.test/**', serve);
await page.goto('https://admin.test/app/cod');
await page.waitForSelector('.cod-status');
await page.waitForTimeout(500);
const shot = (n, opts = {}) => page.screenshot({ path: path.join(os.tmpdir(), `cod-admin-${scenario}-${n}.png`), ...opts });
await shot('full', { fullPage: true });
check('dashboard: Overview and Orders only; customizing is on its own page', JSON.stringify(await page.locator('.cod-views [role=tab]').allTextContents()).includes('Overview') && !(await page.locator('.cod-views [role=tab]').allTextContents()).some((t) => /Settings/.test(t)));
if (data.shippingStats) {
  const card = page.locator('.cod-ship-stats');
  const text = await card.textContent();
  check('dashboard: shipping card with charged, per order, shipped free and share of order value',
    /₹1,035/.test(text) && /₹86\.25/.test(text) && /33%/.test(text) && /6\.6%/.test(text), text.slice(0, 200));
  check('dashboard: shipping by delivery option and by zone (no-zone orders left out)',
    (await card.locator('.cod-ship-row').count()) === 3 && /Express delivery/.test(text) && /Metro/.test(text));
  await card.getByRole('button', { name: 'Set up dynamic shipping' }).click();
  check('dashboard: the shipping card opens Customize at Shipping charges', await page.evaluate(() => window.__NAV__) === '/app/cod/customize?section=shipping');
} else {
  check('dashboard: no shipping card without shipping stats', (await page.locator('.cod-ship-stats').count()) === 0);
}

// Date filter: Last 30 days by default; quick periods and calendar days ask the loader for that period.
const kpi = (label) => page.locator('.cod-kpi', { hasText: label });
check('date filter: "Last 30 days" with its dates by default', (await page.locator('.cod-dr-wrap button').first().textContent()).includes('Last 30 days')
  && /\d+ \w{3,4} – \d+ \w{3,4} \d{4}/.test(await page.locator('.cod-dr-dates').textContent()), await page.locator('.cod-dr-dates').textContent());
check('date filter: chart has one bar per day of the period', (await page.locator('.cod-bar').count()) === 30 && (await page.getByText('COD orders per day').count()) === 1);
if (scenario !== 'empty') {
  check('date filter: COD orders card counts the period and names it', (await kpi('COD orders').textContent()).includes(String(orders.length)) && (await kpi('COD orders').textContent()).includes('Last 30 days'));
}
await page.locator('.cod-dr-wrap button').first().click();
await page.waitForTimeout(300);
check('date filter: quick periods + a calendar in the popover', (await page.locator('.cod-dr-p').count()) === 7 && (await page.locator('.Polaris-DatePicker').count()) === 1);
await shot('date-filter');
await page.locator('.cod-dr-p', { hasText: 'Last 7 days' }).click();
check('date filter: "Last 7 days" loads ?range=last7', await page.evaluate(() => window.__SEARCH_SET__) === 'range=last7', await page.evaluate(() => window.__SEARCH_SET__));
await page.locator('.cod-dr-wrap button').first().click();
await page.waitForTimeout(300);
await page.locator('.Polaris-DatePicker__Day:not([disabled])', { hasText: /^1$/ }).first().click();
await page.getByRole('button', { name: 'Apply', exact: true }).click();
{
  const first = `${data.range.to.slice(0, 7)}-01`;
  check('date filter: one calendar day + Apply loads ?from=…&to=… for that day', await page.evaluate(() => window.__SEARCH_SET__) === `from=${first}&to=${first}`, await page.evaluate(() => window.__SEARCH_SET__));
}
{
  const p2 = await browser.newPage({ viewport: { width, height: 1000 } });
  p2.on('pageerror', (e) => errors.push(e.message));
  await p2.route('https://admin.test/**', serve);
  await p2.goto('https://admin.test/app/cod?v=today');
  await p2.waitForSelector('.cod-status');
  await p2.waitForTimeout(400);
  check('date filter on Today: the chart goes by hour (24 bars) and counts today\'s orders',
    (await p2.locator('.cod-bar').count()) === 24 && (await p2.getByText('COD orders per hour').count()) === 1 && (await p2.locator('.cod-chart').locator('..').textContent()).includes('Today · 3 orders'));
  await p2.goto('https://admin.test/app/cod?v=cut');
  await p2.waitForSelector('.cod-status');
  await p2.waitForTimeout(400);
  check('a period with more orders than one view loads: the card says so, the count is the real one',
    (await p2.locator('.cod-kpi', { hasText: 'COD orders' }).textContent()).includes('600') && (await p2.getByText(`Amounts from the newest ${orders.length}`).count()) === 1);
  await p2.getByRole('tab', { name: /^Orders/ }).click();
  await p2.waitForTimeout(300);
  check('…and the Orders tab says how many it shows', (await p2.getByText(`Showing the newest ${orders.length} of 600 orders`).count()) === 1);
  await p2.close();
}
await page.getByRole('button', { name: 'Customize', exact: true }).first().click();
check('dashboard: Customize button opens /app/cod/customize', await page.evaluate(() => window.__NAV__) === '/app/cod/customize');
if (await page.getByRole('button', { name: /Customize COD/ }).count()) {
  await page.getByRole('button', { name: /Customize COD/ }).click();
  check('dashboard: the "Customize COD" card opens the customizer', await page.evaluate(() => window.__NAV__) === '/app/cod/customize');
}
if (scenario === 'off') {
  await page.getByRole('button', { name: 'Turn on' }).click();
  check('checklist: Turn on opens the customizer at COD status', await page.evaluate(() => window.__NAV__) === '/app/cod/customize?section=status');
}
check(`dashboard at ${width}px: no sideways scroll`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
await page.getByRole('tab', { name: /^Orders/ }).click();
await page.waitForTimeout(300);
await shot('orders');
if (scenario === 'live') {
  await page.getByRole('tab', { name: /Payment pending/ }).click();
  await page.waitForTimeout(200);
  check('orders: payment filter works', (await page.locator('.Polaris-IndexTable__TableRow').count()) === orders.filter((o) => o.status === 'pending').length);
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.waitForTimeout(200);
  await shot('orders-lifecycle');
  console.log('order row:', await page.locator('.Polaris-IndexTable__TableRow').first().textContent());
}
console.log('errors:', errors.length ? errors.join('\n') : 'none');
check('no page or console errors', errors.length === 0);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

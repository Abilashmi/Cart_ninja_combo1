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

const ROOT = process.cwd();
const OUT = path.join(os.tmpdir(), 'brix-cod-admin-check');
fs.mkdirSync(OUT, { recursive: true });

const STUBS = {
  'shopify.server': 'export const authenticate = {};',
  'plan-permissions.server': 'export const getShopPlan = () => {};',
  'currency.server': 'export const getShopCurrency = () => {};',
  'cod.server': 'export class CodError extends Error {}; export const getCodSettings=()=>{}, saveCodSettings=()=>{}, syncCodRuntime=()=>{}, listCodOrders=()=>{}, summarizeCodOrders=()=>({}), getCodSecrets=()=>{}, getCodSecretsStatus=()=>{}, saveCodSecrets=()=>{}, msg91Creds=()=>({});',
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
const page = await browser.newPage({ viewport: { width, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style><style>body{background:#f1f1f1;margin:0}</style></head><body><div id="root"></div><script>window.__DATA__=${JSON.stringify(data)}</script><script>${js}</script></body></html>`;
await page.route('https://admin.test/**', (route) => {
  const p = new URL(route.request().url()).pathname;
  if (p === '/brix-logo.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'public/brix-logo.png')) });
  return route.fulfill({ contentType: 'text/html', body: html });
});
await page.goto('https://admin.test/app/cod');
await page.waitForSelector('.cod-status');
await page.waitForTimeout(500);
const shot = (n, opts = {}) => page.screenshot({ path: path.join(os.tmpdir(), `cod-admin-${scenario}-${n}.png`), ...opts });
await shot('full', { fullPage: true });
check('dashboard: Overview and Orders only; customizing is on its own page', JSON.stringify(await page.locator('.cod-views [role=tab]').allTextContents()).includes('Overview') && !(await page.locator('.cod-views [role=tab]').allTextContents()).some((t) => /Settings/.test(t)));
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

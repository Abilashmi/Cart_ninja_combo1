/* eslint-env node */
// Browser check for the COD admin page (app/routes/app.cod.jsx), outside Shopify:
// server modules are stubbed and loader data is mocked, then Playwright renders it.
// Run from the repo root: node tests/cod/admin-page-browser-check.mjs [live|warn|off|empty]
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = process.cwd();
const OUT = path.join(os.tmpdir(), 'brix-cod-admin-check');
fs.mkdirSync(OUT, { recursive: true });

const STUBS = {
  'shopify.server': 'export const authenticate = {};',
  'plan-permissions.server': 'export const getShopPlan = () => {};',
  'currency.server': 'export const getShopCurrency = () => {};',
  'cod.server': 'export class CodError extends Error {}; export const getCodSettings=()=>{}, saveCodSettings=()=>{}, syncCodRuntime=()=>{}, listCodOrders=()=>{}, summarizeCodOrders=()=>({}), getCodSecrets=()=>{}, getCodSecretsStatus=()=>{}, saveCodSecrets=()=>{};',
  'cod-tracking.server': 'export const sendCodTestEvents = () => {};',
  'cod-sms.server': 'export const smsProviderStatus = () => {};',
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
  shop: 'demo.myshopify.com', settings, orders: scenario === 'empty' ? [] : orders,
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
await page.getByRole('tab', { name: /^Settings/ }).click();
await page.waitForTimeout(300);
await shot('settings', { fullPage: true });
await page.getByRole('tab', { name: /^Orders/ }).click();
await page.waitForTimeout(300);
await shot('orders');
await page.getByRole('tab', { name: /^Settings/ }).click();

if (scenario === 'live') {
  // Interactions: tabs, preview surfaces, simulator, chips, contrast
  await page.getByRole('tab', { name: /Rules/ }).click();
  await page.getByPlaceholder('Type or paste PIN codes, e.g. 744101').fill('110001, 12345 ');
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'COD checkout' }).click();
  await page.waitForTimeout(400);
  await shot('rules');
  await page.getByRole('tab', { name: /Button style/ }).click();
  await page.getByRole('textbox', { name: 'Text colour', exact: true }).fill('#a7f3d0');
  await page.getByRole('button', { name: 'Product page' }).click();
  await page.waitForTimeout(300);
  await shot('look');
  // Product page button: spacing sliders drive the preview (drawn at 80%), Buy it now replaced by default.
  await page.getByRole('slider', { name: 'Space above' }).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  await shot('look-spacing', { fullPage: true });
  const pvReplace = await page.evaluate(() => ({
    marginTop: getComputedStyle(document.querySelector('.cod-stage .cod-pv-btn')).marginTop,
    buyNow: Boolean(document.querySelector('.cod-stage .cod-scr-bin')),
  }));
  await page.getByRole('tab', { name: /Placement/ }).click();
  await page.getByRole('switch', { name: 'Replace the Buy it now button' }).click();
  await page.locator('.cod-sticky').getByRole('button', { name: 'Product page' }).click();
  await page.waitForTimeout(200);
  await shot('placement-keep-buy-now');
  const pvKeep = await page.evaluate(() => Boolean(document.querySelector('.cod-stage .cod-scr-bin')));
  console.log('product button preview:', JSON.stringify({ ...pvReplace, buyNowWhenKept: pvKeep }));
  await page.getByRole('switch', { name: 'Replace the Buy it now button' }).click();
  await page.getByRole('tab', { name: /Placement/ }).click();
  await page.locator('.cod-sticky').getByRole('button', { name: 'Cart drawer' }).click();
  await page.locator('.cod-sticky input[type=number]').fill('199');
  await page.waitForTimeout(300);
  await shot('placement');
  const hits = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.cod-chip')].map((c) => c.textContent.replace('×', '')),
    badChips: [...document.querySelectorAll('.cod-chip.bad')].map((c) => c.textContent.replace('×', '')),
    sim: document.querySelector('.cod-sim')?.textContent,
    contrast: document.querySelector('.cod-contrast')?.textContent,
  }));
  console.log(JSON.stringify(hits, null, 1));
  await page.getByRole('tab', { name: /^Orders/ }).click();
  await page.getByRole('tab', { name: /Payment pending/ }).click();
  await page.waitForTimeout(200);
  console.log('pending rows:', await page.locator('.Polaris-IndexTable__TableRow').count());

  // Checkout popup section: upload a logo through the real drop zone (SVG gets drawn to a bitmap).
  await page.getByRole('tab', { name: /^Settings/ }).click();
  await page.getByRole('tab', { name: /Checkout popup/ }).click();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="90"><circle cx="45" cy="45" r="36" fill="#e11d48"/><text x="96" y="58" font-family="Arial" font-weight="700" font-size="40" fill="#111827">Acme Store</text></svg>';
  await page.locator('.cod-logo-drop input[type=file]').setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });
  await page.waitForSelector('.cod-logo-img img');
  await page.getByRole('button', { name: 'Soft' }).click();
  await page.waitForTimeout(1400); // let the BRIX loader finish in the preview
  await shot('popup', { fullPage: true });
  const popup = await page.evaluate(() => ({
    storedLogo: (document.querySelector('.cod-logo-img img')?.getAttribute('src') || '').slice(0, 22),
    previewLogo: Boolean(document.querySelector('.cod-scr-sheet .cod-pv-logo')),
    powered: Boolean(document.querySelector('.cod-pv-pw img[alt=BRIX]')),
    soft: Boolean(document.querySelector('.cod-scr-sheet.rad-soft')),
  }));
  console.log('popup:', JSON.stringify(popup));
  await page.getByRole('button', { name: 'Replay BRIX loader' }).click();
  await page.waitForTimeout(200);
  await shot('popup-loader');
  console.log('loader visible:', await page.locator('.cod-pv-loader').count());
  // Coupons section: pick a Shopify code, type another, open the field by default
  await page.getByRole('tab', { name: /^Coupons/ }).click();
  await page.getByLabel('Add one of your Shopify codes').selectOption('SAVE10');
  await page.getByLabel('Or type a code').fill('FESTIVE20');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Offer text for FESTIVE20').fill('20% off this festive week');
  await page.getByLabel('Field text').fill('Got a coupon?');
  await page.waitForTimeout(1400);
  await shot('coupons', { fullPage: true });
  console.log('coupons:', JSON.stringify(await page.evaluate(() => ({
    offerRows: [...document.querySelectorAll('.cod-offer-code')].map((e) => e.textContent),
    notInShopify: document.querySelectorAll('.cod-offer .Polaris-Badge').length,
    previewOffers: [...document.querySelectorAll('.cod-pv-ofr-c')].map((e) => e.textContent),
    previewLabel: document.querySelector('.cod-pv-cpn span')?.textContent,
  }))));
  // Ads & analytics: IDs validated, keys write-only (saved token shows only its last 4)
  await page.getByRole('tab', { name: /Ads & analytics/ }).click();
  await page.getByLabel('Measurement ID').fill('UA-123');
  await page.waitForTimeout(150);
  const badId = await page.locator('.Polaris-InlineError').first().textContent().catch(() => '');
  await page.getByLabel('Measurement ID').fill('g-abc123xyz');
  await page.getByLabel('Measurement Protocol API secret (recommended)').fill('ga4-secret-123');
  const tokenRow = await page.locator('.cod-secret').first().textContent();
  await page.waitForTimeout(200);
  await shot('tracking', { fullPage: true });
  console.log('tracking:', JSON.stringify({ badId, tokenRow, testDisabled: await page.getByRole('button', { name: 'Send test events' }).isDisabled() }));

  await page.getByRole('tab', { name: /Rules/ }).click();
  await page.getByRole('button', { name: 'Remove 12345' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  const submitted = await page.evaluate(() => JSON.parse(window.__SUBMITTED__ || '{}'));
  const sent = submitted.settings?.sheet;
  console.log('saved sheet:', JSON.stringify({ ...sent, logo: (sent?.logo || '').slice(0, 22) + '… (' + (sent?.logo || '').length + ' chars)' }));
  console.log('saved productButton:', JSON.stringify(submitted.settings?.productButton));
  console.log('saved tracking:', JSON.stringify(submitted.settings?.tracking), 'secrets:', JSON.stringify(submitted.secrets));
  await page.getByRole('tab', { name: /^Orders/ }).click();
  await page.getByRole('tab', { name: /^All/ }).click();
  await page.waitForTimeout(200);
  await shot('orders-lifecycle');
  console.log('order row:', await page.locator('.Polaris-IndexTable__TableRow').first().textContent());
}
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();

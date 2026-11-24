/* eslint-env node */
// Real-browser check of the guided setup: the REAL app shell pieces
// (GuideProvider + GuideShell), Home, COD → Customize, the Cart Editor and
// the Packs builder, with real routing (createBrowserRouter). Server modules
// are stubbed (their export names read from the real files), and
// /api/onboarding is a fake server that applies the same rules as the real
// route (utils/guide.shared.js). Nothing reaches a database or a store.
// Run from the repo root: node tests/onboarding/guide-browser-check.mjs
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyGuidePatch, completeModulePatch, GUIDE_MODULE_IDS } from '../../app/utils/guide.shared.js';
import { sanitizeCodSettings } from '../../app/utils/cod.shared.js';
import { shippingFromSimple } from '../../app/utils/shipping.shared.js';

const ROOT = process.cwd();
const OUT = path.join(os.tmpdir(), 'brix-guide-check');
const SHOTS = path.join(os.tmpdir(), 'brix-guide-shots');
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
const abs = (p) => path.join(ROOT, p).replace(/\\/g, '/');

/* ── bundle ─────────────────────────────────────────────────── */
// A stand-in for every *.server module: the same export names, doing nothing.
const OVERRIDES = { OTP_PRICE_PAISE: '50' };
function stubSource(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s*\*?\s*(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+(?:const|let|var|class)\s+(\w+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop().trim(); if (n && n !== 'default') names.add(n); }
  }
  const lines = [...names].map((n) => (n in OVERRIDES ? `export const ${n} = ${OVERRIDES[n]};` : `export function ${n}() { return undefined; }`));
  if (/export\s+default/.test(src)) lines.push('export default function stub() { return undefined; }');
  return lines.join('\n');
}
const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /\.server(\.js)?$/ }, (args) => {
      let file = path.resolve(args.resolveDir, args.path);
      if (!fs.existsSync(file)) file += '.js';
      return { path: file, namespace: 'stub' };
    });
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubSource(args.path), loader: 'js' }));
    b.onResolve({ filter: /^@shopify\/shopify-app-react-router\/server$/ }, () => ({ path: 'boundary', namespace: 'boundary' }));
    b.onLoad({ filter: /.*/, namespace: 'boundary' }, () => ({ contents: 'export const boundary = { error: () => null, headers: () => ({}) };', loader: 'js' }));
    b.onResolve({ filter: /^@shopify\/app-bridge-react$/ }, () => ({ path: path.join(ROOT, 'tests/packs/harness/app-bridge-stub.js') }));
    // Node built-ins some shared helpers import (api-helpers.js); never called in the browser.
    b.onResolve({ filter: /^(node:)?(fs|path|crypto|os|url)$/ }, (args) => ({ path: args.path, namespace: 'nodestub' }));
    b.onLoad({ filter: /.*/, namespace: 'nodestub' }, () => ({ contents: 'const any = new Proxy(function () {}, { get: () => any, apply: () => undefined }); export default any;', loader: 'js' }));
    b.onResolve({ filter: /ai-agent\/BrixBar$/ }, () => ({ path: 'brixbar', namespace: 'brixbar' }));
    b.onLoad({ filter: /.*/, namespace: 'brixbar' }, () => ({ contents: 'export default function BrixBar(){ return null; }', loader: 'js' }));
  },
};

fs.writeFileSync(path.join(OUT, 'entry.jsx'), `
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Outlet, useLocation } from 'react-router';
import { AppProvider } from '@shopify/polaris';
import en from '@shopify/polaris/locales/en.json';
import { I18nProvider } from '${abs('app/i18n/admin.jsx')}';
import { pickAdminMessages } from '${abs('app/i18n/admin.shared.js')}';
import enMessages from '${abs('app/i18n/en.json')}';
import { PlanProvider } from '${abs('app/components/PlanContext.jsx')}';
import { CurrencyProvider } from '${abs('app/components/CurrencyContext.jsx')}';
import { GuideProvider } from '${abs('app/components/guide/GuideProvider.jsx')}';
import GuideShell from '${abs('app/components/guide/GuideShell.jsx')}';
import Home from '${abs('app/routes/app._index.jsx')}';
import CodCustomize from '${abs('app/routes/app.cod_.customize.jsx')}';
import CartEditorPage from '${abs('app/components/CartEditorPage.jsx')}';
import NewPack from '${abs('app/routes/app.packs.new.jsx')}';
import { sanitizeCodSettings } from '${abs('app/utils/cod.shared.js')}';

// The app shell's part of routes/app.jsx.
function Layout() {
  return <GuideProvider initialState={window.__GUIDE__}><GuideShell><Outlet /></GuideShell></GuideProvider>;
}
function Stand() {
  const { pathname } = useLocation();
  return <div data-testid="stand-in" style={{ padding: 24, minHeight: '100vh' }}><h1>Stand-in page {pathname}</h1></div>;
}
const range = { preset: 'last30', label: 'Last 30 days', from: '2026-10-26', to: '2026-11-24', today: '2026-11-24', days: 30 };
const router = createBrowserRouter([{
  path: '/app', Component: Layout,
  children: [
    { index: true, Component: Home, loader: async () => {
      const d = await (await fetch('/api/onboarding')).json();
      // The personalized Home's numbers (services/guide-dashboard.server.js), from the fake server.
      const guideDash = await (await fetch('/test/dash')).json();
      return { shop: 'demo.myshopify.com', initialAnalytics: {}, range, moduleStatus: { cart: true, combo: false, cod: false, packs: false, fbt: false, coupon: false }, guideHome: { existing: d.existing, modules: d.modules }, guideDash };
    } },
    { path: 'cod/customize', Component: CodCustomize, loader: () => window.__COD__, action: async ({ request }) => {
      const body = await request.json();
      await fetch('/test/saved/cod', { method: 'POST' });
      return { success: true, settings: sanitizeCodSettings(body.settings) };
    } },
    { path: 'cartdrawer', Component: CartEditorPage, loader: () => window.__CART__, action: async () => ({ success: true }) },
    { path: 'packs/new', Component: NewPack, loader: () => ({ shop: 'demo.myshopify.com', planState: 'enabled', currency: { code: 'INR', locale: 'en-IN', symbol: '₹' } }) },
    { path: '*', Component: Stand },
  ],
}]);
window.__router = router;
createRoot(document.getElementById('root')).render(
  <AppProvider i18n={en}>
    <I18nProvider locale="en" messages={pickAdminMessages({ en: enMessages }, 'en')}>
      <PlanProvider plan="growth">
        <CurrencyProvider symbol="₹" code="INR" locale="en-IN">
          <RouterProvider router={router} />
        </CurrencyProvider>
      </PlanProvider>
    </I18nProvider>
  </AppProvider>
);
`);

await build({
  entryPoints: [path.join(OUT, 'entry.jsx')],
  bundle: true, outdir: OUT, entryNames: 'bundle', format: 'iife', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [stubPlugin], logLevel: 'error', loader: { '.css': 'css', '.png': 'dataurl' },
  nodePaths: [path.join(ROOT, 'node_modules')],
});
const polarisCss = fs.readFileSync(path.join(ROOT, 'node_modules/@shopify/polaris/build/esm/styles.css'), 'utf8');
const appCss = fs.existsSync(path.join(OUT, 'bundle.css')) ? fs.readFileSync(path.join(OUT, 'bundle.css'), 'utf8') : '';
const globalCss = fs.readFileSync(path.join(ROOT, 'app/global.css'), 'utf8');
const js = fs.readFileSync(path.join(OUT, 'bundle.js'), 'utf8');

/* ── loader data for the real pages ─────────────────────────── */
const codSettings = {
  enabled: false, surfaces: { drawer: true, product: true, combo: false }, codFee: 49, shippingFee: 60, freeShippingAbove: 999,
  minOrder: 299, maxOrder: 5000, requireOtp: true, dailyLimitPerPhone: 3, blockedPincodes: ['744101'], allowCoupons: true,
  buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with Cash on Delivery', bg: '#0d6b4c', color: '#ffffff' },
};
const COD = {
  shop: 'demo.myshopify.com', settings: sanitizeCodSettings(codSettings), orders: [], stats: { count: 0, toCollect: 0, collected: 0, paidCount: 0, cancelledCount: 0, cancelRate: 0 },
  shipping: shippingFromSimple(codSettings), shippingStored: false, shippingLoadError: null, loadError: null, planState: 'enabled', currencyCode: 'INR',
  sms: { configured: true, source: 'server' }, hasOrderScope: true,
  secretsStatus: { ga4ApiSecret: { set: false, last4: '' }, metaCapiToken: { set: false, last4: '' }, metaTestCode: { set: false, last4: '' } }, couponOptions: [],
};
const CART = { coupons: [], allProducts: [], drawerEnabled: true, cartRecord: null, pbRecord: null, csRecord: null, upsellRecord: null, configRecord: { is_enabled: 1, banner_enabled: 0 } };
// The Packs builder's product (picker + GET /api/packs), as tests/packs/admin-browser-check.mjs mocks it.
const PACK_PICK = [{ id: 'gid://shopify/Product/100', title: 'Tee', images: [] }];
const PACK_PRODUCT = { id: '100', title: 'Tee', handle: 'tee', status: 'ACTIVE', image: '', variants: [{ id: '200', title: 'M', price: 80, availableForSale: true, maxQuantity: 25, inventoryQuantity: 25, inventoryPolicy: 'DENY', image: '' }] };

/* ── the fake /api/onboarding (same rules as routes/api.onboarding.jsx) ── */
const server = {};
function resetServer({ state = null, existing = false, configured = {} } = {}) {
  server.state = state;
  server.existing = existing;
  server.configured = Object.fromEntries(GUIDE_MODULE_IDS.map((id) => [id, Boolean(configured[id])]));
  server.patches = 0;
  server.embedOn = { cart_drawer: true, Fbt: true, coupon_slider: true, Packs: true };
  server.verifies = [];
  server.dash = null;
}
const modulesStatus = () => Object.fromEntries(GUIDE_MODULE_IDS.map((id) => [id, { configured: server.configured[id], active: id === 'cart' ? true : id === 'brix_ai' ? null : false }]));
const html = () => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${polarisCss}</style><style>${globalCss}</style><style>${appCss}</style><style>body{margin:0;background:#f1f1f1}</style></head><body><div id="root"></div><script>window.shopify={toast:{show:function(m){window.__toast=m;}}};window.__GUIDE__=${JSON.stringify(server.state)};window.__COD__=${JSON.stringify(COD)};window.__CART__=${JSON.stringify(CART)};window.__pickerResult=${JSON.stringify(PACK_PICK)};</script><script>${js}</script></body></html>`;

async function routeAll(ctx) {
  await ctx.route('https://admin.test/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/onboarding') {
      if (req.method() === 'GET') return json({ ok: true, state: server.state, modules: modulesStatus(), existing: server.existing });
      const body = JSON.parse(req.postData() || '{}');
      if (body.intent === 'patch') { server.patches++; server.state = applyGuidePatch(server.state, body.patch); return json({ ok: true, state: server.state }); }
      if (body.intent === 'verify') {
        server.verifies.push(body.module);
        if (!server.configured[body.module]) return json({ ok: true, verified: false, unknown: false });
        server.state = applyGuidePatch(server.state, completeModulePatch(server.state, body.module), { trusted: true });
        return json({ ok: true, verified: true, state: server.state });
      }
      return json({ ok: false });
    }
    // Home's dashboard numbers: what the real loader returns for the saved features.
    if (url.pathname === '/test/dash') return json(server.dash && server.state?.modules?.length ? { ...server.dash, modules: server.state.modules } : null);
    if (url.pathname.startsWith('/test/saved/')) { server.configured[url.pathname.split('/').pop()] = true; return json({ ok: true }); }
    // The app embed a feature needs (routes/api.theme-embed-status.jsx).
    if (url.pathname === '/api/theme-embed-status') { const h = url.searchParams.get('handle') || 'cart_drawer'; return json({ checked: true, enabled: server.embedOn[h] !== false, handle: h, name: h === 'cart_drawer' ? 'BRIX Cart & Combo' : 'BRIX ' + h, editorUrl: 'https://demo.myshopify.com/admin/themes/current/editor?context=apps' }); }
    if (url.pathname === '/api/packs' && req.method() === 'GET') return json({ success: true, product: PACK_PRODUCT, currency: { code: 'INR', locale: 'en-IN', symbol: '₹' } });
    if (url.pathname === '/api/cart-drawer-config') { server.configured.cart = true; return json({ success: true, data: {} }); }
    if (url.pathname.startsWith('/api/')) return json({ success: true, data: {} });
    if (url.pathname === '/brix_cart_ui.css') return route.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(ROOT, 'extensions/cart-drawer/assets/brix_cart_ui.css'), 'utf8') });
    if (url.pathname === '/brix-logo.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'public/brix-logo.png')) });
    if (/\.(png|jpe?g|gif|svg|webp)$/i.test(url.pathname)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html() });
  });
}

/* ── checks ──────────────────────────────────────────────────── */
const results = [];
const errors = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();

async function open(start, { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await routeAll(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${start}: ${e.message}`));
  await page.goto(`https://admin.test${start}`);
  await page.waitForTimeout(700);
  return { ctx, page };
}
const ringOn = (page, target, timeout = 8000) => page.waitForFunction((t) => document.querySelector('[data-guide-ring]')?.getAttribute('data-guide-target') === t, target, { timeout }).then(() => true).catch(() => false);
const ringCovers = (page, target) => page.evaluate((t) => {
  const ring = document.querySelector('[data-guide-ring]');
  const el = [...document.querySelectorAll(`[data-tour="${t}"]`)].find((e) => e.getClientRects().length);
  if (!ring || !el) return false;
  const a = ring.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  return a.left <= b.left + 1 && a.top <= b.top + 1 && a.right >= b.right - 1 && a.bottom >= b.bottom - 1 && a.width - b.width < 20;
}, target);
const path_ = (page) => page.evaluate(() => location.pathname);
const settle = (page, ms = 800) => page.waitForTimeout(ms);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const currentStepTitle = (page) => page.evaluate(() => document.querySelector('.brx-gs-step.is-current .brx-gs-step-t')?.textContent || null);

/* 1. A new merchant: the questions in a box in the middle of the screen ── */
resetServer();
server.embedOn.cart_drawer = false;
// What Home's loader returns once features are saved (services/guide-dashboard.server.js shape).
server.dash = {
  period: { from: '2026-10-26', to: '2026-11-24', days: 30, prevFrom: '2026-09-26', prevTo: '2026-10-25' },
  impact: { revenue: { now: 1000, prev: 800 }, aov: { now: 500, prev: 400 }, orders: { now: 2, prev: 2 } },
  plan: { key: 'free', label: 'Free', price: 0, cap: 50, used: 12 },
  numbers: [
    { module: 'cod', id: 'cod_share', kind: 'percent', value: 10, prev: null, note: 'in_period' },
    { module: 'cod', id: 'cod_rto', kind: 'percent', value: 25, prev: null, note: 'lower_better' },
    { module: 'cod', id: 'cod_collect', kind: 'money', value: 800, prev: null, note: 'in_period' },
    { module: 'cart', id: 'cart_upsell', kind: 'money', value: 150, prev: 100, note: 'vs_prev' },
    { module: 'fbt', id: 'fbt_orders', kind: 'count', value: null, prev: null, note: 'vs_prev' },
    { module: 'packs', id: 'packs_active', kind: 'count', value: 3, prev: null, note: 'right_now' },
  ],
};
{
  const { ctx, page } = await open('/app');
  const layout = await page.evaluate(() => {
    const box = document.querySelector('.brx-gq-modal');
    const back = document.querySelector('.brx-gq-back');
    if (!box) return null;
    const a = box.getBoundingClientRect();
    const opts = [...document.querySelectorAll('[data-guide-payment]')].map((o) => o.getBoundingClientRect());
    return {
      centreX: Math.round(Math.abs((a.left + a.right) / 2 - innerWidth / 2)),
      centreY: Math.round(Math.abs((a.top + a.bottom) / 2 - innerHeight / 2)),
      overlay: getComputedStyle(back).position === 'fixed',
      dialog: box.getAttribute('role') === 'dialog' && box.getAttribute('aria-modal') === 'true',
      sameRow: opts.length === 3 && opts.every((o) => Math.abs(o.top - opts[0].top) < 2) && opts[0].left < opts[1].left && opts[1].left < opts[2].left,
      aside: Boolean(document.querySelector('[data-guide-aside]')),
      count: document.querySelector('.brx-gq-count')?.textContent,
      text: box.innerText.includes('How do your customers pay?') && box.innerText.includes('Welcome to BRIX'),
    };
  });
  check('new merchant: the questions open in a box in the middle of the screen, no side panel', layout && layout.text && layout.overlay && layout.dialog && !layout.aside && layout.centreX <= 2 && layout.centreY <= 4, JSON.stringify(layout));
  check('box: "Question 1 of 2", the three payment answers side by side', layout?.count === 'Question 1 of 2' && layout.sameRow === true);
  check('no spotlight before the merchant starts anything', (await page.locator('[data-guide-ring]').count()) === 0);
  await shot(page, '01-question-payment');

  await page.click('[data-guide-payment="postpaid"]');
  check('the picked answer gets its tick', (await page.getAttribute('[data-guide-payment="postpaid"]', 'aria-checked')) === 'true' && (await page.locator('[data-guide-payment="postpaid"] .brx-gq-tick .Polaris-Icon').count()) === 1);
  await page.click('[data-guide-continue]');
  check('Next: "Question 2 of 2"; postpaid picked COD Checkout by itself', (await page.locator('.brx-gq-count').innerText()) === 'Question 2 of 2' && (await page.getAttribute('[data-guide-feature="cod"]', 'aria-checked')) === 'true' && (await page.locator('[data-guide-cod-note]').count()) === 1);
  await page.click('[data-guide-back]');
  await page.click('[data-guide-payment="prepaid"]');
  await page.click('[data-guide-continue]');
  check('switching to prepaid takes the automatic COD pick off', (await page.getAttribute('[data-guide-feature="cod"]', 'aria-checked')) === 'false');
  await page.click('[data-guide-back]');
  await page.click('[data-guide-payment="both"]');
  await page.click('[data-guide-continue]');
  check('both picks COD Checkout by itself', (await page.getAttribute('[data-guide-feature="cod"]', 'aria-checked')) === 'true');
  const featRow = await page.evaluate(() => { const o = [...document.querySelectorAll('[data-guide-feature]')].slice(0, 4).map((e) => e.getBoundingClientRect().top); return o.every((t) => Math.abs(t - o[0]) < 2); });
  check('the features are laid out across (4 in a row on desktop)', featRow);
  for (const id of ['packs', 'cart', 'fbt']) await page.click(`[data-guide-feature="${id}"]`);
  check('several features can be picked', (await page.locator('[data-guide-feature][aria-checked="true"]').count()) === 4);
  await shot(page, '02-question-features');
  await page.click('[data-guide-start]');
  await settle(page, 900);
  check('answers saved: payment, features in setup order (COD first), tour running', server.state?.payment === 'both' && JSON.stringify(server.state.modules) === JSON.stringify(['cod', 'cart', 'fbt', 'packs']) && server.state.status === 'active' && server.state.current?.module === 'cod' && server.state.current.step === 0, JSON.stringify(server.state && { p: server.state.payment, m: server.state.modules, s: server.state.status, c: server.state.current }));
  const side = await page.evaluate(() => {
    const aside = document.querySelector('[data-guide-aside]');
    const main = document.querySelector('.brx-gs-main');
    if (!aside) return null;
    const a = aside.getBoundingClientRect();
    return { questions: Boolean(document.querySelector('[data-guide-questions]')), panel: aside.querySelector('[data-guide-panel]')?.dataset.guidePanel, position: getComputedStyle(aside).position, right: Math.round(a.right), vw: innerWidth, beside: main.getBoundingClientRect().right <= a.left + 1 };
  });
  check('after Start: the box closes, the steps panel is on the right side, beside the page', side && !side.questions && side.panel === 'guided' && side.position === 'sticky' && side.right === side.vw && side.beside, JSON.stringify(side));
  check('panel: the feature, "0 of 5 steps done", the COD steps', (await page.locator('[data-guide-title]').innerText()) === 'COD Checkout' && (await page.locator('[data-guide-steps-done]').innerText()) === '0 of 5 steps done' && (await currentStepTitle(page)) === 'Turn on Cash on Delivery');

  /* 2. The app embed COD needs */
  const embed = await page.waitForSelector('[data-guide-embed="cart_drawer"]', { timeout: 5000 }).then(() => true).catch(() => false);
  check('panel: warns that the "BRIX Cart & Combo" app embed is off', embed && (await page.locator('[data-guide-embed]').innerText()).includes('BRIX Cart & Combo') && (await page.locator('[data-guide-embed]').innerText()).includes('Off'));
  server.embedOn.cart_drawer = true;
  await page.click('[data-guide-embed-check]');
  check('"I\'ve turned it on" checks again and the warning goes', await page.waitForSelector('[data-guide-embed]', { state: 'detached', timeout: 5000 }).then(() => true).catch(() => false));

  /* 3. The dashboard follows what was picked */
  const dashReady = await page.waitForFunction(() => document.querySelector('[data-guide-dash-tile="cod_share"] b')?.textContent === '10%', null, { timeout: 8000 }).then(() => true).catch(() => false);
  const dash = await page.evaluate(() => {
    const sections = [...document.querySelectorAll('[data-guide-dash]')].map((s) => s.dataset.guideDash);
    const rows = [...document.querySelectorAll('[data-guide-dash="setup"] [data-tour^="home-mod-"]:not([data-tour$="-customize"])')].map((c) => c.getAttribute('data-tour'));
    const tile = (id) => document.querySelector(`[data-guide-dash-tile="${id}"]`)?.innerText.replace(/\s+/g, ' ').trim() || null;
    return {
      sections, rows,
      first: document.querySelector('[data-tour="home-mod-cod"] .brx-gd-first')?.textContent || null,
      firstElsewhere: document.querySelectorAll('.brx-gd-first').length,
      revenue: tile('revenue'), orders: tile('orders'), share: tile('cod_share'), rto: tile('cod_rto'), packs: tile('packs_active'), fbt: tile('fbt_orders'), upsell: tile('cart_upsell'),
      tips: document.querySelector('[data-guide-dash="tips"] h2')?.textContent,
      tipIds: [...document.querySelectorAll('[data-guide-tip-id]')].map((x) => x.dataset.guideTipId),
      tuts: [...document.querySelectorAll('[data-guide-tut]')].map((x) => x.dataset.guideTut),
      soon: [...document.querySelectorAll('[data-guide-tut-soon]')].length,
      watch: [...document.querySelectorAll('[data-guide-tut] button')].length,
      oldKpis: Boolean(document.querySelector('.brx-home-kpis')),
      more: document.querySelectorAll('.brx-home-grid .brx-home-card').length,
    };
  });
  check('Home is rebuilt from the picks: setup, impact, numbers, tips, plan, tutorials (no old KPI strip)', dashReady && JSON.stringify(dash.sections) === JSON.stringify(['setup', 'impact', 'numbers', 'tips', 'plan', 'tutorials']) && !dash.oldKpis, JSON.stringify(dash.sections));
  check('setup: the picked features in setup order, COD marked "Set up first"', JSON.stringify(dash.rows) === JSON.stringify(['home-mod-cod', 'home-mod-cart', 'home-mod-fbt', 'home-mod-packs']) && dash.first === 'Set up first' && dash.firstElsewhere === 1, JSON.stringify(dash.rows));
  check('impact: revenue with the change vs the previous 30 days, orders this month vs the plan', /1,000/.test(dash.revenue) && dash.revenue.includes('25% vs previous 30 days') && dash.orders.includes('12 / 50') && dash.orders.includes('Free plan limit'), JSON.stringify([dash.revenue, dash.orders]));
  check('feature numbers: COD share, RTO, Packs, upsell change; unknown ones say "No data yet"', dash.share.includes('COD share of orders') && dash.rto.includes('25%') && dash.packs.includes('3') && dash.upsell.includes('50% vs previous') && dash.fbt.includes('No data yet'), JSON.stringify([dash.share, dash.rto, dash.packs, dash.upsell, dash.fbt]));
  check('tips for a store taking both: the COD and Packs ones', dash.tips === 'Tips for your store' && dash.tipIds.includes('cod_otp'), JSON.stringify([dash.tips, dash.tipIds]));
  check('tutorials for the picked features, basics first; no video yet = "Video coming soon"', dash.tuts[0] === 'cod_basics' && dash.tuts.includes('packs_basics') && dash.tuts.includes('cart_basics') && dash.soon >= 1 && dash.watch >= 1, JSON.stringify(dash.tuts));
  check('the other features stay below ("More features")', dash.more === 2 && (await page.locator('text=More features').count()) === 1, String(dash.more));
  const badges = await page.evaluate(() => [...document.querySelectorAll('[data-tour="home-mod-cod"] [data-status]')].map((b) => `${b.dataset.status}:${b.textContent}`));
  check('setup row: separate statuses (tour, configured, active)', badges.length === 3 && badges[0].startsWith('tour:') && badges.includes('configured:Not configured'), JSON.stringify(badges));
  check('spotlight on Home: the COD row\'s Customize button', await ringOn(page, 'home-mod-cod-customize') && await ringCovers(page, 'home-mod-cod-customize'));
  check('its tooltip says to open COD Checkout', (await page.locator('[data-guide-tip]').innerText()).includes('Open COD Checkout'));
  await page.screenshot({ path: path.join(SHOTS, '03-home-dashboard.png'), fullPage: true });

  /* 4. Method A: click the highlighted Customize */
  await page.click('[data-tour="home-mod-cod-customize"]');
  await settle(page);
  check('clicking the highlighted button opens COD Customize', (await path_(page)) === '/app/cod/customize');
  check('the panel follows: step 1 "Turn on Cash on Delivery", still 0 done', (await currentStepTitle(page)) === 'Turn on Cash on Delivery' && (await page.locator('[data-guide-steps-done]').innerText()) === '0 of 5 steps done');
  check('spotlight on the real COD Active switch', await ringOn(page, 'cod-active') && await ringCovers(page, 'cod-active'));
  await shot(page, '05-cod-panel');

  /* 5. Method B: Next opens and highlights the next setting */
  await page.click('[data-guide-next]');
  check('Next: "Choose where the COD button shows" opens the Cart drawer section by itself', await ringOn(page, 'cod-section-position') && (await page.getAttribute('[data-tour="cod-section-position-toggle"]', 'aria-expanded')) === 'true');
  await settle(page, 500);
  check('the highlight is the real section (row + its settings)', await ringCovers(page, 'cod-section-position'));
  await page.click('[data-guide-prev]');
  check('Previous goes back a step', await ringOn(page, 'cod-active') && (await currentStepTitle(page)) === 'Turn on Cash on Delivery');

  /* 6. A step clicked in the panel, then Method A on a section row */
  await page.click('[data-guide-step="sms"]');
  check('a step clicked in the panel opens that setting (OTP SMS)', await ringOn(page, 'cod-section-sms') && (await page.getAttribute('[data-tour="cod-section-sms-toggle"]', 'aria-expanded')) === 'true');
  await page.click('[data-tour="cod-section-sms-toggle"]');
  check('clicking the highlighted section\'s row moves on (prepaid discount)', await ringOn(page, 'cod-section-prepaid'));

  /* 7. Completion needs the real save */
  await page.click('[data-guide-next]');
  await page.waitForSelector('[data-guide-not-saved]', { timeout: 5000 }).catch(() => {});
  check('Check & finish without saving: not completed, told why', (await page.locator('[data-guide-not-saved]').count()) === 1 && server.state.progress.cod.tour !== 'completed' && server.verifies.includes('cod'));
  await page.click('[data-tour="cod-active"]');
  await page.click('[data-tour="cod-save"] button');
  const moved = await page.waitForFunction(() => location.pathname === '/app', null, { timeout: 12000 }).then(() => true).catch(() => false);
  check('saving for real: verified on the server, COD marked set up', server.state.progress.cod.tour === 'completed' && Boolean(server.state.progress.cod.verifiedAt));
  check('then back to Home with the next feature\'s Customize highlighted (Cart Drawer)', moved && server.state.current?.module === 'cart' && await ringOn(page, 'home-mod-cart-customize'));
  await settle(page, 500);
  const codBadges = await page.evaluate(() => [...document.querySelectorAll('[data-tour="home-mod-cod"] [data-status]')].map((b) => b.textContent));
  check('the COD card now says Tour completed and Configured', codBadges.includes('Tour completed') && codBadges.includes('Configured'), JSON.stringify(codBadges));

  /* 8. Resume after a refresh */
  await page.reload();
  await settle(page, 900);
  check('after a refresh the guide resumes at the same place', await ringOn(page, 'home-mod-cart-customize') && (await page.locator('[data-guide-title]').innerText()) === 'Cart Drawer');

  /* 9. Cart Drawer: Next (Method B) on Home opens the editor */
  await page.click('[data-guide-next]');
  check('Next on Home opens the Cart Editor', await page.waitForFunction(() => location.pathname === '/app/cartdrawer', null, { timeout: 5000 }).then(() => true).catch(() => false));
  // Ringed and open together (the editor redraws its sidebar as it mounts).
  const designOpen = await page.waitForFunction(() => document.querySelector('[data-guide-ring]')?.getAttribute('data-guide-target') === 'cart-section-design' && document.querySelector('[data-tour="cart-section-design-toggle"]')?.getAttribute('aria-expanded') === 'true', null, { timeout: 8000 }).then(() => true).catch(() => false);
  check('Cart Editor: the Design section opens and is highlighted', designOpen);
  await page.click('[data-guide-step="upsellProducts"]');
  check('Cart Editor: clicking "Suggest upsell products" in the panel opens that section', await ringOn(page, 'cart-section-upsellProducts') && (await page.getAttribute('[data-tour="cart-section-upsellProducts-toggle"]', 'aria-expanded')) === 'true');
  await settle(page, 500);
  check('Cart Editor: the highlight covers the real Upsell section', await ringCovers(page, 'cart-section-upsellProducts'));
  await shot(page, '06-cart-upsell-section');
  await page.click('[data-guide-next]');
  check('Next: Coupon slider', await ringOn(page, 'cart-section-couponSlider'));

  /* 10. Cancel the tour: only the highlight stops, the steps stay */
  await page.click('[data-guide-tip-cancel]');
  await settle(page, 700);
  check('cancel tour: the highlight stops, the steps panel stays open', (await page.locator('[data-guide-ring]').count()) === 0 && (await page.locator('[data-guide-panel="guided"]').count()) === 1 && (await page.locator('[data-guide-pill]').count()) === 0 && server.state.status === 'paused');
  check('cancel tour: the panel offers "Resume tour"', (await page.locator('[data-guide-resume]').count()) === 1 && (await page.locator('[data-guide-paused]').count()) === 1 && (await page.locator('[data-guide-pause]').count()) === 0);
  await shot(page, '07-tour-cancelled');
  await page.evaluate(() => window.__router.navigate('/app'));
  await settle(page);
  check('the steps stay on other pages too (Home), still without a highlight', (await page.locator('[data-guide-panel="guided"]').count()) === 1 && (await page.locator('[data-guide-ring]').count()) === 0);
  await page.click('[data-guide-resume]');
  await settle(page, 800); // the change reaches the server after a short delay
  check('Resume tour: the highlight comes back where the tour was', server.state.status === 'active' && await ringOn(page, 'home-mod-cart-customize') && (await currentStepTitle(page)) === 'Show your coupons');
  await page.click('[data-tour="home-mod-cart-customize"]');
  check('Customize opens the page of the step the tour is on', await ringOn(page, 'cart-section-couponSlider', 10000) && (await path_(page)) === '/app/cartdrawer');

  /* 11. Refresh on an editor page mid-tour */
  await settle(page, 700);
  await page.reload();
  check('refresh on the Cart Editor: same section highlighted again', await ringOn(page, 'cart-section-couponSlider', 10000));

  /* 12. Close the guide (the arrow): only then it goes, leaving the pill */
  await page.click('[data-guide-collapse]');
  await settle(page, 600);
  const pill = await page.evaluate(() => {
    const p = document.querySelector('[data-guide-pill]');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { text: p.innerText.trim(), right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), pos: getComputedStyle(p).position };
  });
  check('close the guide: panel and highlight go, the page gets its width back', (await page.locator('[data-guide-aside]').count()) === 0 && (await page.locator('[data-guide-ring]').count()) === 0 && !(await page.evaluate(() => document.querySelector('.brx-gs').classList.contains('has-panel'))));
  check('close the guide: "Guided setup · 1/6" stays at the bottom right', pill && pill.pos === 'fixed' && /^Guided setup · 1\/6$/.test(pill.text) && pill.bottom >= 60 && pill.bottom <= 120 && pill.right >= 60 && pill.right <= 110, JSON.stringify(pill));
  await shot(page, '08-pill-closed');
  await page.evaluate(() => window.__router.navigate('/app'));
  await settle(page);
  check('the pill follows on other pages (Home)', (await page.locator('[data-guide-pill]').count()) === 1 && (await page.locator('[data-guide-aside]').count()) === 0);
  await page.click('[data-guide-pill]');
  check('tapping the pill opens the guide again, tour and all', (await page.locator('[data-guide-panel="guided"]').count()) === 1 && await ringOn(page, 'home-mod-cart-customize'));
  await page.click('[data-tour="home-mod-cart-customize"]');
  await ringOn(page, 'cart-section-couponSlider', 10000);

  /* 13. Skip a feature → the next one starts on Home */
  await page.click('[data-guide-skip]');
  const fbtRing = await ringOn(page, 'home-mod-fbt-customize');
  await settle(page, 800); // the change reaches the server after a short delay
  check('skip: Cart Drawer skipped, back to Home pointing at FBT', fbtRing && server.state.progress.cart.tour === 'skipped' && server.state.current.module === 'fbt', JSON.stringify({ fbtRing, cart: server.state.progress.cart?.tour, cur: server.state.current }));

  /* 14. A target that isn't on the page */
  await page.click('[data-tour="home-mod-fbt-customize"]');
  const missing = await page.waitForSelector('[data-guide-missing]', { timeout: 9000 }).then(() => true).catch(() => false);
  check('missing target: a clear card instead of a broken highlight', missing && (await page.locator('[data-guide-ring]').count()) === 0 && (await page.locator('[data-guide-missing]').innerText()).includes("Can't find this on the page"));
  await shot(page, '08-missing-target');
  await page.click('[data-guide-skip-step]');
  await settle(page, 300);
  check('Skip step moves on', (await currentStepTitle(page)) === 'Set the layout');
  await page.click('[data-guide-skip]');
  check('skipping FBT: Packs is next', await ringOn(page, 'home-mod-packs-customize'));

  /* 15. Packs builder: steps behind its tabs */
  await page.click('[data-guide-step="product"]');
  check('Packs: the panel step opens the real builder on that step', await ringOn(page, 'packs-step-product', 10000) && (await path_(page)) === '/app/packs/new');
  await page.click('[data-guide-next]');
  const blocked = await page.waitForSelector('[data-guide-missing]', { timeout: 9000 }).then(() => true).catch(() => false);
  const pageError = await page.locator('.Polaris-Banner').filter({ hasText: /attention|first|product/i }).count();
  check('Packs: a tab the builder refuses (no product yet) shows the builder\'s reason, not a fake highlight', blocked && pageError > 0 && (await page.locator('[data-guide-ring]').count()) === 0, `banner=${pageError}`);
  const continueBtn = page.locator('.pb-navbar').getByRole('button', { name: 'Continue' });
  await page.getByRole('button', { name: 'Choose product' }).click();
  await page.getByRole('button', { name: 'Change product' }).waitFor({ timeout: 10000 });
  await continueBtn.click();
  check('Packs: once the merchant fixes it and goes on, the waiting step is highlighted', await ringOn(page, 'packs-step-type', 6000) && (await page.locator('[data-guide-missing]').count()) === 0);
  await page.click('[data-guide-step="product"]');
  check('Packs: a panel step switches the builder back to its tab', await ringOn(page, 'packs-step-product'));
  await settle(page, 400);
  await continueBtn.click();
  const followed = await ringOn(page, 'packs-step-type', 6000);
  await settle(page, 1200); // the old step's search must not pull the builder back
  const after = await page.evaluate(() => ({
    step: document.querySelector('.brx-gs-step.is-current .brx-gs-step-t')?.textContent || null,
    tab: document.querySelector('[data-tour^="packs-step-"]')?.getAttribute('data-tour') || null,
  }));
  check('Packs: the builder\'s own Continue moves the tour with it (never pulled back)', followed && after.step === 'Pick the Pack type' && after.tab === 'packs-step-type', JSON.stringify({ followed, ...after }));

  /* 16. Change features and Restart: both from Question 1, answers already ticked */
  await settle(page, 800); // the Packs step reaches the server
  const before = JSON.stringify({ current: server.state.current, progress: server.state.progress });
  await page.click('[data-guide-edit]');
  await settle(page, 600);
  check('"Change features" opens the box right here at Question 1, already answered', (await path_(page)) === '/app/packs/new' && (await page.locator('[data-guide-questions="payment"]').count()) === 1 && (await page.locator('.brx-gq-count').innerText()) === 'Question 1 of 2' && (await page.getAttribute('[data-guide-payment="both"]', 'aria-checked')) === 'true' && (await page.locator('[data-guide-aside]').count()) === 0);
  await page.click('[data-guide-continue]');
  check('Next: Question 2 with the picked features ticked', (await page.getAttribute('[data-guide-feature="packs"]', 'aria-checked')) === 'true' && (await page.getAttribute('[data-guide-feature="cod"]', 'aria-checked')) === 'true');
  await page.click('[data-guide-close-questions]');
  await settle(page, 700);
  check('closing it changes nothing', (await page.locator('[data-guide-questions]').count()) === 0 && JSON.stringify({ current: server.state.current, progress: server.state.progress }) === before);
  await page.click('[data-guide-restart]');
  await settle(page, 400);
  check('"Restart" asks the questions again from Question 1, answers ticked', (await page.locator('[data-guide-questions="payment"]').count()) === 1 && (await page.locator('.brx-gq-brand').innerText()) === 'Restart guided setup' && (await page.getAttribute('[data-guide-payment="both"]', 'aria-checked')) === 'true');
  await page.click('[data-guide-not-now]');
  await settle(page, 700);
  check('Restart then Cancel: nothing changed', JSON.stringify({ current: server.state.current, progress: server.state.progress }) === before);
  await page.click('[data-guide-restart]');
  await page.click('[data-guide-continue]');
  await page.click('[data-guide-start]');
  await settle(page, 900);
  check('Restart → Start setup: progress cleared, answers kept, back on Home with COD first', (await path_(page)) === '/app' && await ringOn(page, 'home-mod-cod-customize') && Object.keys(server.state.progress).every((id) => server.state.progress[id].tour !== 'completed' && server.state.progress[id].tour !== 'skipped' && !(server.state.progress[id].done || []).length) && server.state.modules.length === 4 && JSON.stringify(server.state.current) === JSON.stringify({ module: 'cod', step: 0 }), JSON.stringify({ cur: server.state.current, progress: server.state.progress }));
  await ctx.close();
}

/* 17. An existing merchant: nothing forced, can start it */
resetServer({ existing: true, configured: { cart: true } });
{
  const { ctx, page } = await open('/app');
  const grid = await page.locator('.brx-home-grid .brx-home-card').count();
  check('existing merchant: same dashboard, no questions, no panel, no spotlight', (await page.locator('[data-guide-questions]').count()) === 0 && (await page.locator('[data-guide-aside]').count()) === 0 && grid === 6 && (await page.locator('[data-guide-ring]').count()) === 0, `cards=${grid}`);
  await page.click('[data-guide-open]');
  check('existing merchant: "Guided setup" opens the questions box', (await page.locator('[data-guide-questions="payment"]').count()) === 1 && (await page.locator('[data-guide-aside]').count()) === 0);
  await page.click('[data-guide-not-now]');
  await settle(page, 700);
  check('Not now closes it (nothing changed for an existing store)', (await page.locator('[data-guide-questions]').count()) === 0 && server.patches === 0 && server.state === null, `patches=${server.patches}`);
  await ctx.close();
}

/* 18. A new merchant who says "Not now" */
resetServer();
{
  const { ctx, page } = await open('/app');
  await page.click('[data-guide-not-now]');
  await settle(page, 800);
  await page.reload();
  await settle(page);
  check('new merchant "Not now": stays closed after a refresh, can reopen it', server.state?.status === 'dismissed' && (await page.locator('[data-guide-questions]').count()) === 0 && (await page.locator('[data-guide-open]').count()) === 1);
  await ctx.close();
}

/* 19. Phones and narrow frames */
resetServer();
{
  const { ctx, page } = await open('/app', { width: 390, height: 844 });
  const q = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('[data-guide-payment]')].map((o) => o.getBoundingClientRect());
    const card = document.querySelector('.brx-gq-modal').getBoundingClientRect();
    return { stacked: opts[0].top < opts[1].top && opts[1].top < opts[2].top, fits: card.width <= innerWidth };
  });
  check('phone: the questions stack and fit the screen', q.stacked && q.fits, JSON.stringify(q));
  await shot(page, '09-phone-questions');
  await ctx.close();
}
resetServer({ state: applyGuidePatch(null, { status: 'active', payment: 'postpaid', modules: ['cod', 'cart'], current: { module: 'cod', step: 0 } }) });
{
  const { ctx, page } = await open('/app', { width: 390, height: 844 });
  const m = await page.evaluate(() => {
    const aside = document.querySelector('[data-guide-aside]');
    const main = document.querySelector('.brx-gs-main');
    // Home itself already overflows by ~3px at 390px (a Feedback button), with or without the guide,
    // so the check is that the guide's own columns fit the screen.
    return { pos: getComputedStyle(aside).position, above: aside.getBoundingClientRect().top < main.getBoundingClientRect().top, mainW: Math.round(main.getBoundingClientRect().width), asideW: Math.round(aside.getBoundingClientRect().width), vw: innerWidth };
  });
  check('phone: the steps panel is a full-width section above the dashboard, both fit', m.pos === 'static' && m.above && m.mainW <= m.vw && m.asideW <= m.vw, JSON.stringify(m));
  const phoneRing = await ringOn(page, 'home-mod-cod-customize');
  await settle(page, 900); // after the smooth scroll
  check('phone: the spotlight rings the Customize button', phoneRing && await ringCovers(page, 'home-mod-cod-customize'));
  await shot(page, '10-phone-home');
  await ctx.close();
}
{
  const { ctx, page } = await open('/app/cod/customize', { width: 1000, height: 800 });
  await settle(page);
  const pos = await page.evaluate(() => getComputedStyle(document.querySelector('[data-guide-aside]') || document.querySelector('[data-guide-pill]')).position);
  check('narrow frame: the panel floats on the right and can fold away', pos === 'fixed');
  await ctx.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed. Screenshots: ${SHOTS}`);
process.exit(failed ? 1 : 0);

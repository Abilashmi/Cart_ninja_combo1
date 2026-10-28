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

// ── Upsell preview: variant dropdown, sold-out picks ──
const V = (id, title, price, available) => ({ id: `gid://shopify/ProductVariant/${id}`, title, price, available });
data.allProducts = [
  { id: 'gid://shopify/Product/101', title: 'Girls Grey Jeans', image: '', price: '899.00', available: true, variants: [V(1, '5-6 years', '849.00', false), V(2, '7-8 years', '899.00', true), V(3, '9-10 years', '949.00', true)] },
  { id: 'gid://shopify/Product/102', title: 'Navy Co-ord Set', image: '', price: '1099.00', available: false, variants: [V(4, '5-6 Y', '1099.00', false)] },
  { id: 'gid://shopify/Product/103', title: 'Cotton Socks', image: '', price: '199.00', available: true, variants: [V(5, 'Default Title', '199.00', true)] },
];
const upsellRecord = (soldOutBehavior) => ({ cartStatus: 1, upsell_status: 1, upsell_data: JSON.stringify({
  enabled: true, useAI: false, direction: 'vertical', layout: 'carousel', title: 'You may also like', buttonText: 'Add', soldOutBehavior,
  manualRules: [{ id: 'r1', triggerType: 'all', triggerProductIds: [], upsellProductIds: ['gid://shopify/Product/101', 'gid://shopify/Product/102'] }],
}) });
for (const behavior of ['replace', 'hide']) {
  data.cartRecord = upsellRecord(behavior);
  const up = await ctx.newPage();
  up.on('pageerror', (e) => errors.push(e.message));
  await up.goto('https://admin.test/app/cartdrawer');
  await up.waitForSelector('.cart-preview-upsell-section', { timeout: 8000 }).catch(() => {});
  const shown = await up.$$eval('.cart-preview-upsell-section', (els) => (els[0] ? els[0].textContent : ''));
  if (behavior === 'replace') {
    const sel = up.locator('.cart-preview-upsell-section select').first();
    check('preview: product with sizes gets a dropdown on the first in-stock size', (await sel.count()) === 1 && (await sel.inputValue()) === 'gid://shopify/ProductVariant/2');
    check('preview: sold-out size listed but disabled', await sel.locator('option').first().evaluate((o) => o.disabled && o.textContent.includes('Sold out')));
    await sel.selectOption('gid://shopify/ProductVariant/3');
    check('preview: picking a size changes the price', (await up.textContent('.cart-preview-upsell-section')).includes('949'));
    check('preview: sold-out pick replaced by an in-stock product', !shown.includes('Navy Co-ord Set') && shown.includes('Cotton Socks'), shown.slice(0, 160));
  } else {
    check('preview: "Just hide it" leaves the sold-out pick out with no stand-in', !shown.includes('Navy Co-ord Set') && !shown.includes('Cotton Socks') && shown.includes('Girls Grey Jeans'), shown.slice(0, 160));
  }
  await up.close();
}

// ── Coupon slider: the drawer's own saved title wins over the shared row
// (which the Coupon Banner page writes); text cards ──
{
  data.cartRecord = { cartStatus: 1, coupon_status: 1, coupon_data: JSON.stringify({
    enabled: true, sectionTitle: 'Unlock your savings', titleColor: '#be185d', titleFontSize: 18, position: 'top', layout: 'grid', template: 'template2',
    selectedCoupons: [{ id: 'text:t1', textOnly: true, code: '', labelText: 'Free shipping', description: 'On all orders', bgColor: '#4f46e5', textColor: '#ffffff', icon: 'shipping', borderRadius: 8, buttonText: '' }],
  }) };
  // What a Coupon Banner save leaves in the shared row.
  data.csRecord = { is_enabled: 1, selected_template: 'template1', title_text: 'Apply Coupon', title_color: '#1e293b', title_font_size: 14, title_alignment: 'left', position: 'above_cart', layout: 'list', selected_coupons: null };
  const cp = await ctx.newPage();
  cp.on('pageerror', (e) => errors.push(e.message));
  await cp.goto('https://admin.test/app/cartdrawer');
  await cp.locator('button', { hasText: 'Coupon Slider' }).first().click();
  await cp.waitForTimeout(300);
  check('coupon slider: reopening shows the drawer\'s own saved title, not the Coupon Banner\'s', (await cp.getByLabel('Title text', { exact: true }).inputValue()) === 'Unlock your savings', await cp.getByLabel('Title text', { exact: true }).inputValue());
  await cp.getByRole('tab', { name: 'Manage Coupons' }).click();
  check('coupon slider: saved text card listed', (await cp.textContent('body')).includes('Text card · On all orders'));
  await cp.getByRole('button', { name: 'Add a text card (no code)' }).click();
  await cp.waitForTimeout(300);
  check('coupon slider: a new text card opens with Heading and no code / button fields',
    (await cp.getByLabel('Heading').count()) === 1 && (await cp.getByLabel('Coupon Code').count()) === 0 && (await cp.getByLabel('Button Text').count()) === 0);
  await cp.getByRole('button', { name: 'Items', exact: true }).click();
  await cp.waitForTimeout(300);
  // Smallest element holding the coupon title and both cards: its buttons, minus the ← → arrows.
  const previewButtons = await cp.evaluate(() => {
    const root = document.querySelector('.bxcd-root');
    const all = [...root.querySelectorAll('div')].filter((d) => d.textContent.includes('Unlock your savings') && d.textContent.includes('no code needed'));
    const box = all.sort((a, b) => a.textContent.length - b.textContent.length)[0];
    return box ? [...box.querySelectorAll('button')].filter((b) => !/^[←→‹›]$/.test(b.textContent.trim())).length : -1;
  });
  check('coupon slider preview: text cards have no Apply button', previewButtons === 0, String(previewButtons));
  // The new text card's editor is still open: icon + subtitle settings drive the preview.
  check('coupon slider: text card editor has icon + subtitle settings, no Copied colours',
    (await cp.getByLabel('Show icon').count()) === 1 && (await cp.getByText('Copied button background').count()) === 0);
  await cp.getByRole('radio', { name: 'Star' }).click();
  await cp.getByLabel('Icon size').fill('30');
  await cp.getByLabel('Size', { exact: true }).fill('16');
  await cp.waitForTimeout(200);
  const pv = await cp.evaluate(() => {
    const root = document.querySelector('.bxcd-root');
    const svgs = [...root.querySelectorAll('svg')].map((x) => x.getAttribute('width'));
    const sub = [...root.querySelectorAll('div')].find((d) => d.textContent.trim() === 'On all orders, no code needed');
    return { svgs, sub: sub ? getComputedStyle(sub).fontSize : null };
  });
  check('coupon slider preview: icon size and subtitle size follow the settings', pv.svgs.includes('30') && pv.sub === '16px', JSON.stringify(pv));
  await cp.close();
  data.cartRecord = null; data.csRecord = null;
}

// ── Customization fixes: hex codes, rotating announcements, upsell colours,
// coupon size, free gift variant + badge, and what Save sends ──
{
  const P = 'gid://shopify/Product/101';
  data.configRecord = { is_enabled: 1, banner_enabled: 0, announcement_enabled: 1, announcement_text: 'Free shipping today', announcement_bg_color: '#111827', announcement_text_color: '#ffffff' };
  data.cartRecord = {
    cartStatus: 1, upsell_status: 1, coupon_status: 1,
    upsell_data: JSON.stringify({ enabled: true, useAI: false, direction: 'vertical', layout: 'carousel', title: 'More', buttonText: 'Add', manualRules: [{ id: 'r1', triggerType: 'all', triggerProductIds: [], upsellProductIds: ['gid://shopify/Product/103'] }] }),
    coupon_data: JSON.stringify({ enabled: true, position: 'top', layout: 'carousel', template: 'template2', selectedCoupons: [
      { id: 'c1', code: 'A', labelText: 'A very long coupon label that should wrap instead of being cut off', description: 'd', bgColor: '#4f46e5', textColor: '#ffffff', icon: 'rupee', borderRadius: 8, buttonText: 'Apply' },
      { id: 'c2', code: 'B', labelText: 'B', description: 'd', bgColor: '#be185d', textColor: '#ffffff', icon: 'discount', borderRadius: 8, buttonText: 'Apply' },
    ] }),
  };
  data.pbRecord = { is_enabled: 1, mode: 'amount', placement: 'top', show_on_empty: 1, tiers: [{ id: 9, min_value: 1, description: 'Gift', reward_type: 'product', icon_preset: 'rupee', reward_products: [P], reward_pricing: 'regular', reward_variants: {}, reward_badge_label: null }] };
  saves.length = 0;
  const ed = await ctx.newPage();
  ed.on('pageerror', (e) => errors.push(e.message));
  await ed.goto('https://admin.test/app/cartdrawer');
  await ed.waitForSelector('text=Announcements');
  const open = async (name) => { await ed.locator('button', { hasText: name }).first().click(); await ed.waitForTimeout(250); };

  // Announcements: add a second message → arrows and rotation in the preview.
  await open('Announcements');
  await ed.getByRole('button', { name: 'Add message' }).click();
  await ed.getByRole('textbox', { name: 'Message 2', exact: true }).fill('Sale ends Sunday');
  await ed.waitForTimeout(200);
  check('announcements: 2+ messages show auto-rotate, time and arrows settings', (await ed.getByLabel('Rotate messages automatically').count()) === 1 && (await ed.getByLabel('Show side arrows').count()) === 1);
  const annText = () => ed.locator('.cart-preview-announcement-msg').textContent();
  check('announcements preview: first message, with side arrows', (await annText()) === 'Free shipping today' && (await ed.getByRole('button', { name: 'Next announcement' }).count()) === 1);
  await ed.getByRole('button', { name: 'Next announcement' }).click();
  check('announcements preview: next arrow shows message 2', (await annText()) === 'Sale ends Sunday');

  // Hex code typed by hand: invalid shows an error and is not used; valid is.
  const bgBox = ed.getByRole('textbox', { name: /^Background Color/ });
  await bgBox.fill('#12');
  await ed.waitForTimeout(150);
  const annBg = () => ed.locator('.cart-preview-announcement').evaluate((e) => getComputedStyle(e).backgroundColor);
  check('colour code: an invalid code shows a clear message and the colour stays', (await ed.getByText('Enter a hex colour code like #008060').count()) >= 1 && (await annBg()) === 'rgb(17, 24, 39)', await annBg());
  await bgBox.fill('#ABC');
  await ed.waitForTimeout(150);
  check('colour code: a typed #ABC is applied (as #aabbcc)', (await annBg()) === 'rgb(170, 187, 204)' && (await ed.getByText('Enter a hex colour code like #008060').count()) === 0, await annBg());
  check('colour code: the swatch picker follows the typed code', (await ed.getByLabel('Pick Background Color').inputValue()) === '#aabbcc');

  // Upsell: own Add button colour, price colour.
  await open('Upsell Products');
  await ed.getByLabel('Add button uses the checkout button colors').uncheck();
  // Accessible name = label + the swatch prefix ("Add button #…").
  await ed.getByRole('textbox', { name: /^Add button #/ }).fill('#008060');
  await ed.getByRole('textbox', { name: /^Price/ }).fill('#ff5733');
  await ed.waitForTimeout(200);
  const up = await ed.evaluate(() => {
    const sec = document.querySelector('.cart-preview-upsell-section');
    const btn = sec && [...sec.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add');
    const price = sec && [...sec.querySelectorAll('div')].find((d) => /₹/.test(d.textContent) && d.children.length === 0);
    return { btn: btn && getComputedStyle(btn).backgroundColor, price: price && getComputedStyle(price).color };
  });
  check('upsell preview: own Add button and price colours', up.btn === 'rgb(0, 128, 96)' && up.price === 'rgb(255, 87, 51)', JSON.stringify(up));

  // Coupon card size + long label.
  await open('Coupon Slider');
  await ed.getByRole('spinbutton', { name: 'Card width' }).fill('220');
  await ed.waitForTimeout(200);
  const cp = await ed.evaluate(() => {
    const label = [...document.querySelectorAll('.bxcd-root div, .bxcd-root span')].find((d) => d.textContent.trim().startsWith('A very long coupon label') && d.children.length === 0);
    const card = label && label.closest('div[style*="width: 220px"]');
    return { card: Boolean(card), wraps: label ? getComputedStyle(label).whiteSpace !== 'nowrap' && label.getBoundingClientRect().height > 20 : false };
  });
  check('coupon preview: card takes the merchant\'s width and the long label wraps', cp.card && cp.wraps, JSON.stringify(cp));

  // Free gift: variant + badge.
  await open('Progress Bar');
  const varSel = ed.getByLabel('Variant of Girls Grey Jeans');
  check('free gift: a variant picker for a reward product with sizes; sold-out sizes disabled', (await varSel.count()) === 1 && (await varSel.locator('option[disabled]').count()) === 1);
  await varSel.selectOption('gid://shopify/ProductVariant/3');
  await ed.getByLabel('Gift badge text').fill('VIP BONUS');
  await ed.waitForTimeout(250);
  const gift = await ed.evaluate(() => { const r = document.querySelector('[data-testid="preview-reward-line"]'); return r ? { badge: r.querySelector('.bxcd-item__badge').textContent, variant: r.querySelector('.bxcd-item__variant')?.textContent, text: r.textContent } : null; });
  check('free gift preview: badge text and chosen variant shown', gift && gift.badge === 'VIP BONUS' && gift.variant === '9-10 years' && gift.text.includes('949'), JSON.stringify(gift));

  // Checkout button: text size and height, mirrored in the preview at its scale.
  await open('Checkout Button');
  await ed.getByLabel('Text size', { exact: true }).fill('19');
  await ed.getByLabel('Button height (padding top and bottom)').fill('22');
  await ed.waitForTimeout(250);
  const cbPrev = await ed.evaluate(() => {
    const b = [...document.querySelectorAll('.bxcd-root button')].find((x) => /→/.test(x.textContent));
    return b ? { fs: getComputedStyle(b).fontSize, pt: getComputedStyle(b).paddingTop } : null;
  });
  check('checkout button preview: text size and height follow the settings (scaled like the rest of the preview)', cbPrev && cbPrev.fs === '16.5px' && cbPrev.pt === '15px', JSON.stringify(cbPrev));

  // Continue shopping: off by default, then on above Checkout with its own text and style.
  const contPrev = () => ed.evaluate(() => {
    const all = [...document.querySelectorAll('.bxcd-root button')];
    const cont = all.find((x) => x.textContent.trim() === 'Back to shop');
    const co = all.find((x) => /→/.test(x.textContent));
    return cont && co ? { above: cont.getBoundingClientRect().bottom <= co.getBoundingClientRect().top, filled: getComputedStyle(cont).backgroundColor } : null;
  });
  check('continue shopping: off by default in the Cart Editor preview', (await contPrev()) === null);
  await ed.getByLabel('Show a "Continue shopping" button').check();
  await ed.getByLabel('Button text', { exact: true }).fill('Back to shop');
  await ed.getByLabel('Placement').selectOption('above');
  await ed.getByLabel('Style').selectOption('filled');
  await ed.waitForTimeout(250);
  const cont = await contPrev();
  check('continue shopping preview: above Checkout, filled, the merchant\'s text', cont && cont.above && cont.filled === 'rgb(17, 24, 39)', JSON.stringify(cont));

  await ed.getByRole('button', { name: 'Save', exact: true }).click();
  await ed.waitForTimeout(800);
  const body = (p) => saves.find((s) => s.path === p)?.body || {};
  const cbSaved = JSON.parse((await ed.evaluate(() => window.__LEGACY__))?.checkout_button_style || '{}');
  check('save: checkout button text size and padding go to the storefront blob', cbSaved.fontSize === 19 && cbSaved.paddingY === 22, JSON.stringify(cbSaved));
  const csSaved = cbSaved.continueShopping || {};
  check('save: Continue shopping goes to the storefront blob', csSaved.enabled === true && csSaved.text === 'Back to shop' && csSaved.placement === 'above' && csSaved.style === 'filled', JSON.stringify(csSaved));
  const c = body('/api/cart-drawer-config');
  check('save: messages, rotation and the typed colour go to /api/cart-drawer-config',
    JSON.stringify(c.announcement_messages) === '["Free shipping today","Sale ends Sunday"]' && c.announcement_text === 'Free shipping today' && c.announcement_auto_rotate === 1 && c.announcement_show_arrows === 1 && c.announcement_bg_color === '#aabbcc',
    JSON.stringify({ m: c.announcement_messages, t: c.announcement_text, bg: c.announcement_bg_color }));
  const pb = body('/api/progress-bar');
  check('save: tier variant and badge go to /api/progress-bar', pb.tiers?.[0]?.reward_variants?.[P] === 'gid://shopify/ProductVariant/3' && pb.tiers?.[0]?.reward_badge_label === 'VIP BONUS', JSON.stringify(pb.tiers?.[0]));
  const us = body('/api/upsell-settings');
  check('save: upsell colours go to /api/upsell-settings', us.button_follow_checkout === 0 && us.button_bg_color === '#008060' && us.price_color === '#ff5733', JSON.stringify(us));
  const legacy = await ed.evaluate(() => window.__LEGACY__);
  const legacyPb = JSON.parse(legacy?.progress_data || '{}');
  check('save: the storefront blob carries the new keys and no stale flat bar colours',
    JSON.parse(legacy?.coupon_data || '{}').cardWidth === 220 && JSON.parse(legacy?.upsell_data || '{}').priceColor === '#ff5733' && legacyPb.tiers?.[0]?.rewardBadgeLabel === 'VIP BONUS' && !('barBackgroundColor' in legacyPb),
    String(legacy?.coupon_data || '').slice(0, 80));
  await ed.screenshot({ path: path.join(shotDir, 'customization.png') });
  await ed.close();
}

// ── Reward products past the store's first 50 (extrokids: 4000+ products) ──
{
  data.cartRecord = null; data.csRecord = null; data.upsellRecord = null;
  // Picked earlier, not among the 50 products the editor loads.
  data.pbRecord = { is_enabled: 1, mode: 'amount', placement: 'top', show_on_empty: 1, tiers: [{ id: 9, min_value: 1, description: 'Gift', reward_type: 'product', icon_preset: 'gift', reward_products: ['gid://shopify/Product/9002'], reward_pricing: 'regular', reward_variants: {}, reward_badge_label: null }] };
  const rp = await ctx.newPage();
  rp.on('pageerror', (e) => errors.push(e.message));
  await rp.goto('https://admin.test/app/cartdrawer');
  await rp.waitForSelector('text=Announcements');
  await rp.locator('button', { hasText: 'Progress Bar' }).first().click();
  await rp.waitForTimeout(600);
  check('reward picked earlier outside the first 50: loaded by id, its name shows', (await rp.locator('.rpc-names').textContent().catch(() => '')).includes('Saved Gift Book'));
  await rp.getByRole('button', { name: 'Edit products' }).click();
  await rp.getByRole('searchbox', { name: 'Search products' }).fill('story');
  await rp.waitForSelector('.rpm-card:has-text("Story Book Gift")', { timeout: 4000 }).catch(() => {});
  check('reward search finds a product outside the first 50 (asks Shopify)', (await rp.locator('.rpm-card', { hasText: 'Story Book Gift' }).count()) === 1);
  await rp.locator('.rpm-card', { hasText: 'Story Book Gift' }).click();
  await rp.getByRole('button', { name: 'Save Selection' }).click();
  await rp.waitForTimeout(300);
  const names = await rp.locator('.rpc-names').textContent().catch(() => '');
  check('reward found by search shows on the milestone card after saving the selection', names.includes('Story Book Gift') && names.includes('Saved Gift Book'), names);
  await rp.close();
}

// ── Sidebar: opening the section under a long open one starts at its header, not its end ──
{
  const sb = await ctx.newPage();
  sb.on('pageerror', (e) => errors.push(e.message));
  await sb.goto('https://admin.test/app/cartdrawer');
  await sb.waitForSelector('text=Announcements');
  await sb.locator('[data-section="imageBanner"] > button').click();
  await sb.waitForTimeout(300);
  await sb.evaluate(() => { const l = document.querySelector('[data-section="imageBanner"]').parentElement.parentElement; l.scrollTop = l.scrollHeight; });
  await sb.locator('[data-section="progressBar"] > button').click();
  await sb.waitForTimeout(300);
  const at = await sb.evaluate(() => {
    const head = document.querySelector('[data-section="progressBar"]');
    const l = head.parentElement.parentElement;
    return { gap: Math.round(head.getBoundingClientRect().top - l.getBoundingClientRect().top), scrolls: l.scrollHeight > l.clientHeight };
  });
  check('sidebar: opening a section scrolls its header to the top of the list', at.scrolls && Math.abs(at.gap) <= 1, JSON.stringify(at));
  await sb.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots in ${shotDir}`);
process.exit(failed.length ? 1 : 0);

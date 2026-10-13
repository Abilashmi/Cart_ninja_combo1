/* eslint-env node */
// Browser check: Quick Shop's picture collection bar (qs_chip_style: images)
// and the bottom bar's button sizes (qs_btn_font_size / _m / pad_y / pad_x),
// on the real storefront script with every network call mocked.
// Run with: node tests/combo-weight/collection-bar-browser-check.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loadComboPageScript } from './storefront-script.mjs';
import { normalizeWeightPricing } from '../../app/utils/combo-weight.shared.js';

const SCRIPT = loadComboPageScript();
const API = 'https://app.test';
const SHOTS = path.resolve('tests/combo-weight/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
const svg = (label, fill) => `https://img.test/${label}.svg?fill=${encodeURIComponent(fill)}`;
const product = (n, title, image) => ({
  id: P(n), title, handle: `p${n}`, price: '199.00', currency: 'INR', image: image ? { url: image } : null, images: [], vendor: 'Brix', productType: 'Snack', tags: [], summary: '',
  variants: [{ id: V(n * 10), title: 'Default Title', price: '199.00', compareAtPrice: null, grams: 250, available: true, image: null }], variantId: V(n * 10),
});
const productsByHandle = {
  chips: [product(1, 'Masala Chips', svg('chips-product', '#f59e0b')), product(2, 'Salted Chips', null)],
  nuts: [product(3, 'Roasted Almonds', svg('almond-product', '#92400e'))],
  sweets: [product(4, 'Kaju Katli', null)],
};
const { value } = normalizeWeightPricing({ unit: 'kg', max_grams: 5000, tiers: [{ min_grams: 500, type: 'percentage', value: 10, label: '' }] });
const pricing = { enabled: true, reason: null, hash: value.hash, measure: 'weight', unit: value.unit, maxGrams: value.max_grams, tiers: value.tiers, messages: value.messages, qualifyingProductIds: [1, 2, 3, 4].map(P) };
const baseConfig = {
  layout: 'layout6', pricing_mode: 'weight', tab_count: 3, col_1: 'chips', col_2: 'nuts', col_3: 'sweets',
  qs_chip_style: 'images', qs_filter_type: false, qs_filter_brand: false, qs_filter_sort: false,
};

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();

async function open(config, { viewport = { width: 1280, height: 900 }, cod = false } = {}) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://img.test') {
      const fill = url.searchParams.get('fill') || '#999';
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="${fill}"/></svg>` });
    }
    if (url.pathname === '/pages/box') {
      const codStub = cod ? `window.BrixCod = { isAvailable: function () { return Promise.resolve(true); }, open: function () {}, comboButton: function () { return Promise.resolve({ text: "Cash on Delivery", icon: "", css: "background:#be185d;color:#ffffff;font-size:13px;", placement: "below" }); } };` : '';
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><script>${codStub}</script></head><body style="margin:0"><main><div data-brix-combo-root data-shop="demo.myshopify.com" data-template-id="5"></div></main><script src="${API}/combo-page.js"></script></body></html>` });
    }
    if (url.pathname === '/combo-page.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: SCRIPT });
    if (url.pathname === '/api/combo-page-data') {
      return json({ success: true, data: {
        templateId: 5, templateName: 'Snack Box', config, productsByHandle, activeDiscounts: [], weightPricing: pricing,
        collectionNameMap: { chips: 'Chips', nuts: 'Nuts & Dry Fruits', sweets: 'Sweets' },
        collectionImageMap: { nuts: svg('nuts-collection', '#16a34a') },
      } });
    }
    if (url.pathname === '/api/bundle-analytics') return json({ success: true });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://store.test/pages/box');
  await page.waitForSelector('.bxq-card');
  return page;
}

const tiles = (page) => page.$$eval('.bxq-col', (els) => els.map((el) => ({
  value: el.getAttribute('data-value'),
  name: el.querySelector('.bxq-col-name').textContent,
  img: el.querySelector('img')?.getAttribute('src') || '',
  letter: el.querySelector('.bxq-col-letter')?.textContent || '',
  on: el.classList.contains('is-on'),
})));
const cardTitles = (page) => page.$$eval('.bxq-card .bxq-name', (els) => els.map((e) => e.textContent));

// ── Picture bar ──
{
  const page = await open({ ...baseConfig, qs_chip_images: { sweets: svg('sweets-own', '#be185d'), chips: 'http://not-https.test/x.png' } });
  const t = await tiles(page);
  check('picture bar: All + one tile per collection, in page order', t.map((x) => x.value).join(',') === 'all,c:chips,c:nuts,c:sweets', t.map((x) => x.value).join(','));
  check('names under the pictures', t.map((x) => x.name).join(' | ') === 'All | Chips | Nuts & Dry Fruits | Sweets');
  check('picture: the collection\'s own Shopify image', t[2].img.includes('nuts-collection'));
  check('picture: the merchant\'s own https link wins', t[3].img.includes('sweets-own'));
  check('picture: no https link / collection image → the first product with an image', t[1].img.includes('chips-product'), t[1].img);
  check('"All" is selected first and shows all products', t[0].on && (await cardTitles(page)).length === 4);
  check('no text collection chips once pictures are on', await page.locator('.bxq-filters [data-combo-action="qs-chip"]').count() === 0);

  await page.click('.bxq-col[data-value="c:nuts"]');
  check('tapping a collection shows only its products', JSON.stringify(await cardTitles(page)) === JSON.stringify(['Roasted Almonds']));
  check('…and marks that tile selected', (await tiles(page)).find((x) => x.value === 'c:nuts').on);
  const ring = await page.$eval('.bxq-col.is-on .bxq-col-img', (el) => getComputedStyle(el).boxShadow);
  check('selected tile has the accent ring', /2\.5px/.test(ring), ring);
  await page.click('.bxq-col[data-value="all"]');
  check('back to All', (await cardTitles(page)).length === 4);
  await page.screenshot({ path: path.join(SHOTS, 'collection-bar-desktop.png') });
  await page.close();
}

// ── Shape, size, phone ──
{
  const page = await open({ ...baseConfig, qs_chip_image_shape: 'rounded', qs_chip_image_size: 90 });
  const box = await page.$eval('.bxq-col[data-value="c:chips"] .bxq-col-img', (el) => { const r = el.getBoundingClientRect(); return { w: r.width, radius: getComputedStyle(el).borderRadius }; });
  check('size and shape settings apply (90px, rounded)', Math.round(box.w) === 90 && box.radius === '16px', JSON.stringify(box));
  await page.close();
  const phone = await open({ ...baseConfig, qs_chip_image_size: 90 }, { viewport: { width: 390, height: 844 } });
  const w = await phone.$eval('.bxq-col[data-value="c:chips"] .bxq-col-img', (el) => el.getBoundingClientRect().width);
  check('phones get 80% of the size', Math.round(w) === 72, String(w));
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('phone: the bar scrolls inside itself, the page doesn\'t scroll sideways', overflow <= 1, String(overflow));
  await phone.screenshot({ path: path.join(SHOTS, 'collection-bar-phone.png') });
  await phone.close();
}

// ── Text chips stay the default ──
{
  const page = await open({ ...baseConfig, qs_chip_style: undefined });
  check('default (text) still draws text chips, no picture bar',
    await page.locator('.bxq-colbar').count() === 0 && await page.locator('.bxq-filters [data-combo-action="qs-chip"][data-value="c:nuts"]').count() === 1);
  await page.close();
}

// ── Bottom bar button sizes ──
async function buttonBox(page, sel) {
  return page.$eval(sel, (el) => { const cs = getComputedStyle(el); return { fs: cs.fontSize, pt: cs.paddingTop, pl: cs.paddingLeft }; });
}
{
  const page = await open({ ...baseConfig, qs_btn_font_size: 20, qs_btn_pad_y: 18, qs_btn_pad_x: 34 }, { cod: true });
  await page.click('.bxq-card [data-combo-action="qty-inc"]');
  await page.waitForSelector('.bxq-go');
  await page.waitForSelector('.bxq-cod');
  const go = await buttonBox(page, '.bxq-go');
  const cod = await buttonBox(page, '.bxq-cod');
  check('Go to Cart: text size and padding from the settings', go.fs === '20px' && go.pt === '18px' && go.pl === '34px', JSON.stringify(go));
  check('COD button: same padding, its own text size from COD settings', cod.pt === '18px' && cod.pl === '34px' && cod.fs === '13px', JSON.stringify(cod));
  await page.screenshot({ path: path.join(SHOTS, 'bar-button-sizes.png') });
  await page.close();

  const phone = await open({ ...baseConfig, qs_btn_font_size_m: 13, qs_btn_pad_y: 18, qs_btn_pad_x: 34 }, { viewport: { width: 390, height: 844 } });
  await phone.click('.bxq-card [data-combo-action="qty-inc"]');
  await phone.waitForSelector('.bxq-go');
  const m = await buttonBox(phone, '.bxq-go');
  check('phone: own text size, 2px less padding, sides at most 16px', m.fs === '13px' && m.pt === '16px' && m.pl === '16px', JSON.stringify(m));
  await phone.close();

  const dflt = await open(baseConfig);
  await dflt.click('.bxq-card [data-combo-action="qty-inc"]');
  await dflt.waitForSelector('.bxq-go');
  const d = await buttonBox(dflt, '.bxq-go');
  const themeSize = await dflt.$eval('.bxq', (el) => getComputedStyle(el).fontSize);
  check('defaults unchanged: theme text size, 14px / 26px padding', d.fs === themeSize && d.pt === '14px' && d.pl === '26px', JSON.stringify({ ...d, themeSize }));
  await dflt.close();
}

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);

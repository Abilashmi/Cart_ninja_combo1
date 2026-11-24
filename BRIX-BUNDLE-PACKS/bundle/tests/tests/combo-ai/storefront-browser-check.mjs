/* eslint-env node */
// Browser check for the combo page's AI suggestion row
// (app/routes/combo-page[.]js.jsx, config.ai_mode).
// Run with: node tests/combo-ai/storefront-browser-check.mjs
// Loads the real storefront script into a blank page with every network call
// mocked (no store, no BRIX server, no AI provider).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loadComboPageScript } from '../combo-weight/storefront-script.mjs';

const SCRIPT = loadComboPageScript();
const API = 'https://app.test';
const SHOTS = path.resolve('tests/combo-ai/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
const img = (label) => ({ url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#e8e1d9"/><text x="100" y="105" font-size="20" text-anchor="middle" fill="#555">${label}</text></svg>`)}`, altText: label });
const product = (n, title, price, variants = 1) => ({
  id: P(n), title, handle: `p${n}`, price, currency: 'INR', image: img(title.split(' ')[0]), images: [img(title.split(' ')[0])],
  variants: Array.from({ length: variants }, (_, i) => ({ id: V(n * 10 + i), title: variants > 1 ? `Size ${i + 1}` : 'Default Title', price, image: null })),
  variantId: V(n * 10),
});
const productsByHandle = {
  'face-wash': [product(1, 'Neem Face Wash', '299.00'), product(2, 'Rose Face Wash', '299.00')],
  serums: [product(3, 'Vitamin C Serum', '699.00'), product(4, 'Niacinamide Serum', '599.00', 2)],
  sunscreen: [product(5, 'SPF 50 Gel', '499.00')],
};
const pairs = {
  [P(1)]: [P(3), P(5), P(2)],
  [P(3)]: [P(5), P(1), P(4)],
  [P(5)]: [P(4), P(3)],
  [P(4)]: [P(1)],
};
const baseConfig = {
  layout: 'layout1', max_products: 4, ai_mode: true, show_preview_bar: true,
  step_1_collection: 'face-wash', step_1_title: 'Cleanse', step_2_collection: 'serums', step_2_title: 'Treat',
  step_3_collection: 'sunscreen', step_3_title: 'Protect',
  col_1: 'face-wash', col_2: 'serums', col_3: 'sunscreen', tab_count: 3,
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();

async function openCombo(config, { viewport = { width: 1280, height: 900 }, aiDelay = 0 } = {}) {
  const page = await browser.newPage({ viewport });
  const aiCalls = [];
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://store.test') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><main><div data-brix-combo-root data-shop="demo.myshopify.com" data-template-id="7"></div></main><script src="${API}/combo-page.js"></script></body></html>` });
    if (url.pathname === '/combo-page.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: SCRIPT });
    if (url.pathname === '/api/combo-page-data') {
      return json({ success: true, data: { templateId: 7, templateName: 'Skincare Kit', config, productsByHandle, collectionNameMap: { 'face-wash': 'Face Wash', serums: 'Serums', sunscreen: 'Sunscreen' }, activeDiscounts: [] } });
    }
    if (url.pathname === '/api/combo-ai-suggestions') {
      aiCalls.push(Object.fromEntries(url.searchParams));
      if (aiDelay) await new Promise((r) => setTimeout(r, aiDelay));
      return json({ success: true, data: { enabled: true, pairs } });
    }
    if (url.pathname === '/api/bundle-analytics') return json({ success: true });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://store.test/pages/kit');
  await page.waitForSelector('.brix-combo-card');
  return { page, aiCalls };
}

const rowTitles = (page) => page.$$eval('.brix-combo-ai [data-combo-action="ai-pick"]', (btns) => btns.map((b) => b.closest('div[style]').parentElement.querySelector('div[style*="font-weight:600"]').textContent));
const addCard = (page, n) => page.click(`.brix-combo-card[data-product-id="${P(n)}"] [data-combo-action="card-add"]`);

// ── layout1: row appears after a pick, adds, updates and hides when full ──
{
  const { page, aiCalls } = await openCombo(baseConfig);
  await page.waitForTimeout(200);
  check('AI endpoint called once with shop + template id', aiCalls.length === 1 && aiCalls[0].shop === 'demo.myshopify.com' && aiCalls[0].templateId === '7');
  check('no suggestion row before anything is picked', (await page.$('.brix-combo-ai')) === null);

  await addCard(page, 1);
  await page.waitForSelector('.brix-combo-ai');
  const titles1 = await rowTitles(page);
  check('row shows the AI picks for the chosen product', JSON.stringify(titles1) === JSON.stringify(['Vitamin C Serum', 'SPF 50 Gel', 'Rose Face Wash']), titles1.join(', '));
  const heading = await page.textContent('.brix-combo-ai');
  check('default heading is shown', heading.includes('Pairs well with your picks'));
  await page.screenshot({ path: path.join(SHOTS, 'layout1-desktop.png'), fullPage: true });

  await page.click(`.brix-combo-ai [data-product-id="${P(3)}"]`);
  const selected3 = await page.$eval(`.brix-combo-card[data-product-id="${P(3)}"]`, (el) => el.style.border);
  check('"Add" on a single-variant suggestion adds it to the combo', /rgb\(34, 197, 94\)|#22c55e/.test(selected3), selected3);
  const titles2 = await rowTitles(page);
  check('row drops picked products and mixes in the newest pick\'s matches', !titles2.includes('Vitamin C Serum') && !titles2.includes('Neem Face Wash') && titles2[0] === 'SPF 50 Gel', titles2.join(', '));
  check('multi-variant suggestion says "Choose"', (await page.textContent(`.brix-combo-ai [data-product-id="${P(4)}"]`)).trim() === 'Choose');

  await page.click(`.brix-combo-ai [data-product-id="${P(4)}"]`);
  await page.waitForTimeout(100);
  const flashed = await page.$eval(`.brix-combo-card[data-product-id="${P(4)}"]`, (el) => el.classList.contains('brix-combo-ai-flash'));
  const stillUnselected = await page.$eval(`.brix-combo-card[data-product-id="${P(4)}"]`, (el) => !/rgb\(34, 197, 94\)/.test(el.style.border));
  check('"Choose" highlights the product card instead of guessing a variant', flashed && stillUnselected);

  await addCard(page, 5);
  await addCard(page, 2);
  check('row hides once the combo is full', (await page.$('.brix-combo-ai')) === null);
  await page.close();
}

// ── AI answer arriving after the shopper already picked ──
{
  const { page } = await openCombo(baseConfig, { aiDelay: 600 });
  await addCard(page, 5);
  check('no row while the AI answer is still loading', (await page.$('.brix-combo-ai')) === null);
  await page.waitForSelector('.brix-combo-ai', { timeout: 3000 });
  check('row appears once the late AI answer arrives', true);
  await page.close();
}

// ── ai_mode off: nothing is fetched or shown ──
{
  const { page, aiCalls } = await openCombo({ ...baseConfig, ai_mode: false });
  await addCard(page, 1);
  await page.waitForTimeout(200);
  check('toggle off: AI endpoint never called', aiCalls.length === 0);
  check('toggle off: no suggestion row', (await page.$('.brix-combo-ai')) === null);
  await page.close();
}

// ── layout2 tabs: "Choose" switches to the tab holding the product ──
{
  const { page } = await openCombo({ ...baseConfig, layout: 'layout2', show_tab_all: false, ai_suggestions_title: 'Complete your routine' }, { viewport: { width: 390, height: 844 } });
  await addCard(page, 1);
  await page.waitForSelector('.brix-combo-ai');
  check('custom heading is used', (await page.textContent('.brix-combo-ai')).includes('Complete your routine'));
  await page.click(`.brix-combo-ai [data-product-id="${P(3)}"]`); // Vitamin C -> suggests Niacinamide (2 variants)
  await page.click('[data-combo-action="tab-pick"][data-tab="face-wash"]');
  check('layout2: Niacinamide card not on the face-wash tab', (await page.$(`.brix-combo-card[data-product-id="${P(4)}"]`)) === null);
  await page.click(`.brix-combo-ai [data-product-id="${P(4)}"]`);
  await page.waitForTimeout(100);
  check('layout2: "Choose" switches to the Serums tab and shows the card', (await page.$(`.brix-combo-card[data-product-id="${P(4)}"]`)) !== null);
  await page.screenshot({ path: path.join(SHOTS, 'layout2-mobile.png'), fullPage: true });
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

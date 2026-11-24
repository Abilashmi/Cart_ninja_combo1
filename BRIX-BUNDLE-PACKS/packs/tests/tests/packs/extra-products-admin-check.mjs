// Real-browser check of the BRIX Packs builder's "Products in this Pack" and "Show this Pack on" cards.
//
//   node --import ./tests/packs/register.mjs tests/packs/extra-products-admin-check.mjs
//
// Same Vite harness as admin-browser-check.mjs (real page components, mocked /api/packs, stubbed App Bridge picker).
// Proves the builder UI and the payload it sends; the server re-verifies everything it receives.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { calculateTier, defaultCustomization, normalizeTiers } from '../../app/utils/packs.shared.js';

const root = path.join(process.cwd(), 'tests', 'packs', 'harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

const SHOP = 'demo.myshopify.com';
const currency = { code: 'INR', locale: 'en-IN', symbol: '₹' };
const RAW_TIERS = [{ name: '', quantity: 2, discountType: 'percentage', discountValue: 10, badge: '' }, { name: '', quantity: 3, discountType: 'fixed', discountValue: 40, badge: '' }];
const calcTiers = () => normalizeTiers(RAW_TIERS).map((tier) => ({ ...tier, ...calculateTier(80, tier, { currencyCode: 'INR', locale: 'en-IN' }) }));
const variant = (id, title, price, extra = {}) => ({ id, title, price, availableForSale: true, maxQuantity: null, inventoryQuantity: 9, inventoryPolicy: 'CONTINUE', image: '', ...extra });
const PRODUCTS = {
  100: { id: '100', title: 'Tee', handle: 'tee', status: 'ACTIVE', published: true, image: '', options: ['Size'], variants: [variant('200', 'M', 80), variant('201', 'L', 100)] },
  101: { id: '101', title: 'Soap B', handle: 'soap-b', status: 'ACTIVE', published: true, image: '', options: ['Scent'], variants: [variant('1011', 'Rose', 50), variant('1012', 'Mint', 60, { availableForSale: false }), variant('1013', 'Pine', 20)] },
  102: { id: '102', title: 'Candle', handle: 'candle', status: 'ACTIVE', published: true, image: '', options: ['Title'], variants: [variant('1021', 'Default Title', 300)] },
};
const mixPack = (over = {}) => ({
  id: 55, shop: SHOP, productId: '100', variantId: '200', productTitle: 'Tee', variantTitle: 'M', productImage: '', basePrice: 80, status: 'draft', displayStatus: 'draft', enabled: false,
  template: 'choose_each_item', packType: 'mix_match', variantScope: 'all', allowedVariantIds: [], version: 2, tiers: calcTiers(), customization: defaultCustomization(),
  extraProducts: [{ productId: '101', handle: 'soap-b', title: 'Soap B', image: '', variantScope: 'selected', allowedVariantIds: ['1011'] }], showOn: ['101'],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', priceVerified: true, issue: null, available: true, maxQuantity: null, currency, ...over,
});

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (error) { results.push(false); console.log('  ✗', name, '\n     ', String(error.message).split('\n').slice(0, 3).join(' | ')); }
};
const browser = await chromium.launch();

async function open({ pack, picker = [], step = 'configure', onSave }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const calls = [];
  await page.route('http://harness.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/packs') {
      const request = route.request();
      const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
      calls.push({ method: request.method(), query: Object.fromEntries(url.searchParams), body });
      if (request.method() === 'GET') {
        const product = PRODUCTS[url.searchParams.get('product')];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(product ? { success: true, product, currency } : { success: false, error: 'nf' }), status: product ? 200 : 404 });
      }
      if (body.action === 'preview') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, valid: true, errors: [], currency, variant: { id: '200', title: 'M', price: 80, availableForSale: true, maxQuantity: null }, tiers: calcTiers() }) });
      if (body.action === 'save') {
        onSave?.(body);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, pack: mixPack({ ...body, id: 55 }), checkoutDiscount: null, warning: null }) });
      }
    }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(dist) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.addInitScript(({ start, data, picker }) => { window.__START__ = start; window.__DATA__ = data; window.__pickerResult = picker; },
    { start: `/app/packs/${pack.id}/edit?step=${step}`, data: { edit: { pack, shop: SHOP, planState: 'enabled', currency } }, picker });
  await page.goto('http://harness.test/');
  return { page, context, calls };
}
const text = (page) => page.locator('body').innerText();

console.log('\nBRIX Packs builder — other products in a Pack');

await check('the cards show the main product, the added product with its picked variants, and the pages it is shown on', async () => {
  const { page, context } = await open({ pack: mixPack() });
  await page.getByText('Products in this Pack').waitFor();
  const body = await text(page);
  assert.match(body, /Products in this Pack/);
  assert.match(body, /2 products/);
  assert.match(body, /Main product · all variants/);
  assert.match(body, /Soap B/);
  await page.getByText('1 of 3 variants').waitFor();
  assert.match(body, /Show this Pack on/);
  assert.match(body, /Product 101|Soap B/, 'the show-on page is listed (by title once it is looked up)');
  await context.close();
});

await check('a same-variant Pack never shows the extra-product cards', async () => {
  const { page, context } = await open({ pack: mixPack({ template: 'same_variant', packType: 'same_variant', variantScope: 'selected', allowedVariantIds: ['200'], extraProducts: [], showOn: [] }) });
  await page.getByText('Variant coverage').waitFor();
  assert.equal(await page.getByText('Products in this Pack').count(), 0);
  assert.equal(await page.getByText('Show this Pack on').count(), 0);
  await context.close();
});

await check('choosing variants for an extra product, and switching it to all variants', async () => {
  const { page, context } = await open({ pack: mixPack() });
  await page.getByText('1 of 3 variants').waitFor();
  const pine = page.getByRole('checkbox', { name: /Pine/ });
  await pine.waitFor();
  assert.equal(await pine.getAttribute('aria-checked'), 'false');
  await pine.click();
  await page.getByText('2 of 3 variants').waitFor();
  await page.getByRole('button', { name: 'All variants' }).last().click();
  await page.getByText('All of 3 variants').waitFor();
  await context.close();
});

await check('adding products keeps what was set, leaves the main product out, and removing one works', async () => {
  const picked = [
    { id: 'gid://shopify/Product/100', title: 'Tee', images: [] },
    { id: 'gid://shopify/Product/101', title: 'Soap B', handle: 'soap-b', images: [] },
    { id: 'gid://shopify/Product/102', title: 'Candle', handle: 'candle', images: [] },
  ];
  const { page, context } = await open({ pack: mixPack(), picker: picked });
  await page.getByText('1 of 3 variants').waitFor();
  await page.getByRole('button', { name: 'Change products' }).click();
  await page.getByText('Candle').first().waitFor();
  const body = await text(page);
  assert.match(body, /3 products/, 'main + 2 extras (the main product picked again is not duplicated)');
  assert.match(body, /1 of 3 variants/, 'Soap B kept its picked variants');
  await page.getByRole('button', { name: 'Remove Candle' }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Candle'));
  await context.close();
});

await check('a product with no variant picked blocks Continue with a clear message', async () => {
  const { page, context } = await open({ pack: mixPack({ extraProducts: [{ productId: '101', handle: 'soap-b', title: 'Soap B', image: '', variantScope: 'selected', allowedVariantIds: [] }] }) });
  await page.getByText('Select at least one variant of Soap B.').first().waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText(/Fix the other products first/).waitFor();
  await context.close();
});

await check('a fixed discount larger than the cheapest eligible variant is refused (floor across ALL products)', async () => {
  // 3 x cheapest (Pine, 20) = 60 and the fixed discount is 40: fine. Make it 100 -> larger than 3 x 20.
  const tiers = calcTiers().map((tier) => (tier.discountType === 'fixed' ? { ...tier, discountValue: 100 } : tier));
  const { page, context } = await open({ pack: mixPack({ tiers }) });
  await page.getByText('1 of 3 variants').waitFor();
  assert.doesNotMatch(await text(page), /cannot be larger than the Pack subtotal/, 'only Rose (50) is picked for Soap B, floor is 50 so 100 <= 150');
  await page.getByRole('checkbox', { name: /Pine/ }).click();
  await page.getByText(/Fixed discount cannot be larger than the Pack subtotal/).waitFor();
  await context.close();
});

await check('save sends the extra products and pages in the payload (and nothing from variants/live data)', async () => {
  let saved = null;
  const { page, context } = await open({ pack: mixPack(), step: 'review', onSave: (body) => { saved = body; } });
  await page.getByRole('button', { name: 'Save changes' }).waitFor();
  await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find((node) => node.innerText.trim() === 'Save changes'); return button && !button.disabled; });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForFunction(() => window.__router && true);
  await page.waitForTimeout(500);
  assert.ok(saved, 'a save request was sent');
  assert.equal(saved.packType, 'mix_match');
  assert.deepEqual(saved.showOn, ['101']);
  assert.deepEqual(saved.extraProducts, [{ productId: '101', handle: 'soap-b', title: 'Soap B', image: '', variantScope: 'selected', allowedVariantIds: ['1011'] }]);
  assert.ok(!('variants' in saved.extraProducts[0]));
  await context.close();
});

await check('a non-Mix & Match Pack never sends extra products, even if some were set before', async () => {
  let saved = null;
  const { page, context } = await open({ pack: mixPack({ template: 'same_variant', packType: 'same_variant', variantScope: 'selected', allowedVariantIds: ['200'] }), step: 'review', onSave: (body) => { saved = body; } });
  await page.getByRole('button', { name: 'Save changes' }).waitFor();
  await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find((node) => node.innerText.trim() === 'Save changes'); return button && !button.disabled; });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(500);
  assert.deepEqual([saved.extraProducts, saved.showOn], [[], []]);
  await context.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

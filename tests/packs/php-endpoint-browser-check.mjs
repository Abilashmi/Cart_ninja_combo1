// Real-browser check of the BRIX Packs widget on the PHP data path
// (php_backend/packs_storefront.php -> pricing:'client'), no store needed.
//
//   node tests/packs/php-endpoint-browser-check.mjs
//
// Loads extensions/cart-drawer/assets/packs_widget.js straight from disk,
// serves a product page with the same JSON Packs.liquid renders, and mocks the
// PHP endpoint with UNPRICED Packs, so this verifies the widget prices tiers
// from the page's live variant data. Not Shopify's checkout discount.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const script = fs.readFileSync(path.join(process.cwd(), 'extensions', 'cart-drawer', 'assets', 'packs_widget.js'), 'utf8');

const tiers = [
  { quantity: 1, name: '', badge: '', discountType: 'none', discountValue: 0 },
  { quantity: 2, name: '', badge: '', discountType: 'percentage', discountValue: 5 },
  { quantity: 3, name: 'Family pack', badge: 'Best value', discountType: 'fixed', discountValue: 30 },
];
const pack = (over = {}) => ({ id: 7, version: 4, variantId: '200', template: 'same_variant', packType: 'same_variant', variantScope: 'selected', allowedVariantIds: ['200'], productTitle: 'Old title', variantTitle: 'M', productImage: '', basePrice: 1, tiers, customization: {}, ...over });
const phpBody = (packs, over = {}) => ({ success: true, pricing: 'client', packs, reason: packs.length ? null : 'no_active_pack', checkoutDiscount: { verified: true, state: 'active', message: 'ok' }, preview: false, ...over });
// Liquid prices are minor units x100: 8000 = 80.00
const product = (over = {}) => ({
  title: 'Tee', image: '', currency: 'INR', shopCurrency: 'INR',
  variants: [
    { id: 200, title: 'M', price: 8000, available: true, inventoryQuantity: 2, inventoryPolicy: 'deny', inventoryManagement: 'shopify' },
    { id: 201, title: 'L', price: 10000, available: true, inventoryQuantity: 0, inventoryPolicy: 'continue', inventoryManagement: null },
  ],
  ...over,
});

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (error) { results.push(false); console.log('  ✗', name, '\n     ', String(error.message).split('\n')[0]); }
};

const browser = await chromium.launch();

async function open({ body, pageProduct = product(), shopifyGlobals = '', variantInput = '200' }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  await page.route('http://shop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/apps/cart-app/packs_storefront.php') {
      requests.push(url);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (url.pathname === '/packs_widget.js') return route.fulfill({ contentType: 'application/javascript', body: script });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Tee</title></head><body>
      <main><form action="/cart/add" method="post"><input type="hidden" name="id" value="${variantInput}"><button>Add to cart</button></form></main>
      <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="100" data-api="/apps/cart-app" data-endpoint="/apps/cart-app/packs_storefront.php"></div>
      ${pageProduct ? `<script type="application/json" data-brix-packs-product>${JSON.stringify(pageProduct)}</script>` : ''}
      <script>${shopifyGlobals}</script>
      <script src="/packs_widget.js" defer></script></body></html>` });
  });
  await page.goto('http://shop.test/products/tee');
  return { page, context, requests };
}

console.log('\nBRIX Packs widget — PHP endpoint (client pricing) checks');

await check('calls the PHP endpoint with shop + productId and prices tiers from the page variant (80.00)', async () => {
  const { page, context, requests } = await open({ body: phpBody([pack()]) });
  await page.waitForSelector('.brix-packs-widget');
  const text = await page.locator('.brix-packs-widget').innerText();
  assert.equal(requests[0].searchParams.get('shop'), 'demo.myshopify.com');
  assert.equal(requests[0].searchParams.get('productId'), '100');
  assert.match(text, /₹80\.00/);
  assert.match(text, /₹152\.00/); // 2 x 80, 5% off
  assert.match(text, /₹210\.00/); // 3 x 80 - 30 fixed
  assert.doesNotMatch(text, /₹1\.00/); // stored basePrice cache is never used
  await context.close();
});

await check('inventory cap from Liquid (deny policy, 2 in stock) disables the 3-pack', async () => {
  const { page, context } = await open({ body: phpBody([pack()]) });
  await page.waitForSelector('.brix-packs-widget');
  const disabled = await page.locator('.brix-packs-widget [aria-disabled="true"], .brix-packs-widget [disabled]').count();
  assert.ok(disabled >= 1, 'expected at least one disabled tier');
  await context.close();
});

await check('multi-variant pack gets per-variant prices (L = 100.00 when selected)', async () => {
  const { page, context } = await open({ body: phpBody([pack({ variantScope: 'all', allowedVariantIds: [] })]), variantInput: '201' });
  await page.waitForSelector('.brix-packs-widget');
  assert.match(await page.locator('.brix-packs-widget').innerText(), /₹190\.00/); // 2 x 100, 5% off
  await context.close();
});

await check('fixed discount is converted to the presentment currency with Shopify.currency.rate', async () => {
  const pageProduct = product({ currency: 'EUR', variants: [{ id: 200, title: 'M', price: 900, available: true, inventoryQuantity: 0, inventoryPolicy: 'continue', inventoryManagement: null }] });
  const { page, context } = await open({ body: phpBody([pack()]), pageProduct, shopifyGlobals: "window.Shopify={currency:{active:'EUR',rate:'0.01'}};" });
  await page.waitForSelector('.brix-packs-widget');
  assert.match(await page.locator('.brix-packs-widget').innerText(), /€26\.70/); // 3 x 9.00 - (30 x 0.01)
  await context.close();
});

await check('anchor variant not on the page -> nothing rendered', async () => {
  const { page, context } = await open({ body: phpBody([pack({ variantId: '999', allowedVariantIds: ['999'] })]) });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.brix-packs-widget').count(), 0);
  await context.close();
});

await check('missing Liquid product data -> nothing rendered', async () => {
  const { page, context } = await open({ body: phpBody([pack()]), pageProduct: null });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.brix-packs-widget').count(), 0);
  await context.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

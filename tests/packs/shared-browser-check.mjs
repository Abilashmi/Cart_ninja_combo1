// Real-browser check: a Pack used on many products (shared) with a set pack price, as the storefront
// gets it from php_backend/packs_storefront.php (pricing 'client', priced from the page's own product).
//
//   node tests/packs/shared-browser-check.mjs
//
// The widget is read straight from extensions/cart-drawer/assets/packs_widget.js; the product page
// (the Packs.liquid product JSON), the PHP endpoint and /cart/add.js are mocked with Playwright routes.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SCRIPT = fs.readFileSync(path.join(ROOT, 'extensions/cart-drawer/assets/packs_widget.js'), 'utf8');

// The page: a ₹1,299 kurta (two sizes). The Pack belongs to another product (100) and is shared here.
const pageProduct = (price) => ({
  title: 'Rose Kurta', image: '', currency: 'INR', shopCurrency: 'INR', options: ['Size'],
  variants: [
    { id: 701, title: 'S', price: price * 100, available: true, inventoryQuantity: 5, inventoryPolicy: 'deny', inventoryManagement: 'shopify', options: ['S'], image: '' },
    { id: 702, title: 'M', price: price * 100, available: true, inventoryQuantity: 5, inventoryPolicy: 'deny', inventoryManagement: 'shopify', options: ['M'], image: '' },
  ],
});
const sharedPack = {
  id: 5, version: 2, variantId: '1001', productId: '100', productHandle: 'indigo-kurta', template: 'same_variant', packType: 'same_variant', variantScope: 'selected', allowedVariantIds: ['1001'],
  productTitle: 'Indigo Kurta', variantTitle: 'S', productImage: '', basePrice: 899, shared: true,
  tiers: [
    { quantity: 1, name: '', badge: '', discountType: 'none', discountValue: 0 },
    { quantity: 2, name: '', badge: '', discountType: 'set', discountValue: 1999 },
    { quantity: 3, name: '', badge: 'Most popular', discountType: 'set', discountValue: 3299 },
  ],
  customization: { design: { preset: 'offer_rows' }, content: { heading: 'Buy more, save more', showBuyNow: false } },
};

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓', name); } catch (error) { results.push({ name, ok: false }); console.log('  ✗', name, '\n     ', String(error.message).split('\n').slice(0, 4).join(' | ')); }
};
const browser = await chromium.launch();

async function open({ price, pack = sharedPack, collections = '900,901' }) {
  const context = await browser.newContext({ viewport: { width: 520, height: 1000 } });
  const page = await context.newPage();
  const calls = { api: [], cart: [], products: [] };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (process.env.DEBUG_PACKS) console.log('   [console]', message.type(), message.text()); });
  await page.route('http://shop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/packs.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
    if (url.pathname === '/packs_storefront.php') {
      calls.api.push(url.search);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, pricing: 'client', packs: [pack], reason: null, checkoutDiscount: { verified: true, state: 'active' }, preview: false }) });
    }
    if (url.pathname.startsWith('/products/') && url.pathname.endsWith('.js')) { calls.products.push(url.pathname); return route.fulfill({ status: 404, body: '' }); }
    if (url.pathname === '/cart/add.js') {
      calls.cart.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: calls.cart.at(-1).items }) });
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Kurta</title></head><body>
      <main><h1>Rose Kurta</h1><form action="/cart/add" method="post"><input type="hidden" name="id" value="701"><button type="submit" name="add">Add to cart</button></form>
      <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="700" data-collection-ids="${collections}" data-api="http://shop.test" data-endpoint="http://shop.test/packs_storefront.php"></div>
      <script type="application/json" data-brix-packs-product>${JSON.stringify(pageProduct(price))}</script></main>
      <script src="http://shop.test/packs.js"></script></body></html>` });
  });
  await page.goto('http://shop.test/products/rose-kurta');
  return { page, context, calls, errors };
}

console.log('\nBRIX Packs shared Pack + set price — browser checks');

await check('the page sends its collections; the shared Pack sells this page\'s product at the set prices', async () => {
  const { page, context, calls, errors } = await open({ price: 1299 });
  await page.waitForSelector('.brix-packs-widget');
  assert.match(calls.api[0], /collections=900,901/);
  assert.deepEqual(calls.products, [], 'the Pack\'s own product page is never fetched for a shared Pack');
  const rows = page.locator('.brix-packs-lrow');
  assert.equal(await rows.count(), 3);
  assert.match(await rows.nth(1).textContent(), /1,999/);
  assert.match(await rows.nth(1).textContent(), /2,598/, 'full price struck: 2 x 1,299');
  assert.match(await rows.nth(1).textContent(), /23% OFF/);
  await rows.nth(1).click();
  await page.getByRole('button', { name: 'Size M' }).first().click();
  await page.getByRole('button', { name: 'Size M' }).nth(1).click();
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => document.querySelector('.brix-packs-msg'));
  const items = calls.cart[0].items;
  assert.deepEqual(items.map((line) => [line.id, line.quantity]), [[702, 2]]);
  assert.equal(items[0].properties._brix_pack_id, '5');
  assert.equal(items[0].properties._brix_pack_quantity, '2');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('a set price that saves nothing on this product: that pack is left off this page', async () => {
  const { page, context, errors } = await open({ price: 949 });
  await page.waitForSelector('.brix-packs-widget');
  // Buy 2 at 1,999 vs 2 x 949 = 1,898: no saving, hidden. Buy 3 at 3,299 vs 2,847: hidden too.
  assert.deepEqual(await page.locator('.brix-packs-ltitle').allTextContents(), ['Buy 1']);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('every pack saves nothing: no widget at all', async () => {
  const onlySet = { ...sharedPack, tiers: [sharedPack.tiers[1]] };
  const { page, context, errors } = await open({ price: 949, pack: onlySet });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.brix-packs-widget').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

// Real-browser check: a Fixed Combo whose added product the shopper chooses the size of
// (tier item `pick: true`), as the storefront gets it from php_backend/packs_storefront.php
// (pricing 'client'): a saree + a blouse in sizes 30-34, on a collection page (shared Pack).
//
//   node tests/packs/combo-pick-browser-check.mjs
//
// The widget is read straight from extensions/cart-drawer/assets/packs_widget.js; the product page,
// the PHP endpoint, the blouse's /products/<handle>.js and /cart/add.js are mocked with Playwright.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SCRIPT = fs.readFileSync(path.join(ROOT, 'extensions/cart-drawer/assets/packs_widget.js'), 'utf8');

const saree = {
  title: 'Black Saree', image: '', currency: 'INR', shopCurrency: 'INR', options: ['Color'],
  variants: [{ id: 701, title: 'Black', price: 169900, available: true, inventoryQuantity: 5, inventoryPolicy: 'deny', inventoryManagement: 'shopify', options: ['Black'], image: '' }],
};
// /products/blouse.js: size 30 sold out, 34 dearer. The stored variant (5011) no longer exists.
const blouseJs = {
  title: 'Basic Blouse', featured_image: '', options: [{ name: 'Size', position: 1, values: ['30', '32', '34'] }],
  variants: [
    { id: 5014, title: '30', price: 65000, available: false, inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 0, options: ['30'] },
    { id: 5015, title: '32', price: 65000, available: true, inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 4, options: ['32'] },
    { id: 5016, title: '34', price: 70000, available: true, inventory_management: 'shopify', inventory_policy: 'deny', inventory_quantity: 4, options: ['34'] },
  ],
};
const pack = (preset) => ({
  id: 32, version: 2, variantId: '1001', productId: '100', productHandle: '', template: 'fixed_combo', packType: 'combo', variantScope: 'all', allowedVariantIds: [],
  productTitle: 'Indigo Saree', variantTitle: '', productImage: '', basePrice: 1599, shared: true,
  tiers: [
    { quantity: 1, name: 'Only Saree', badge: '', discountType: 'none', discountValue: 0, items: [] },
    { quantity: 2, name: 'With Blouse', badge: '', discountType: 'fixed', discountValue: 100, items: [{ productId: '501', variantId: '5011', quantity: 1, handle: 'blouse', title: 'Basic Blouse', variantTitle: '', image: '', pick: true }] },
  ],
  customization: { design: { preset }, content: { heading: 'Choose Your Pack', showBuyNow: false } },
});

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓', name); } catch (error) { results.push({ name, ok: false }); console.log('  ✗', name, '\n     ', String(error.message).split('\n').slice(0, 4).join(' | ')); }
};
const browser = await chromium.launch();

async function open(preset) {
  const context = await browser.newContext({ viewport: { width: 520, height: 1100 } });
  const page = await context.newPage();
  const calls = { cart: [] };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://shop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/packs.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
    if (url.pathname === '/packs_storefront.php') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, pricing: 'client', packs: [pack(preset)], reason: null, checkoutDiscount: { verified: true, state: 'active' }, preview: false }) });
    if (url.pathname === '/products/blouse.js') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(blouseJs) });
    if (url.pathname.endsWith('.js') && url.pathname.startsWith('/products/')) return route.fulfill({ status: 404, body: '' });
    if (url.pathname === '/cart/add.js') {
      calls.cart.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: calls.cart.at(-1).items }) });
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Saree</title></head><body>
      <main><h1>Black Saree</h1><form action="/cart/add" method="post"><input type="hidden" name="id" value="701"><button type="submit" name="add">Add to cart</button></form>
      <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="700" data-collection-ids="900" data-api="http://shop.test" data-endpoint="http://shop.test/packs_storefront.php"></div>
      <script type="application/json" data-brix-packs-product>${JSON.stringify(saree)}</script></main>
      <script src="http://shop.test/packs.js"></script></body></html>` });
  });
  await page.goto('http://shop.test/products/black-saree');
  await page.waitForSelector('.brix-packs-widget');
  return { page, context, calls, errors };
}

console.log('\nBRIX Packs Fixed Combo, shopper chooses the size — browser checks');

for (const preset of ['list', 'offer_rows', 'slots']) {
  await check(`${preset}: the blouse's sizes to choose, priced from the cheapest; Add waits for a size; the chosen size goes in the cart`, async () => {
    const { page, context, calls, errors } = await open(preset);
    const widget = page.locator('.brix-packs-widget');
    assert.match(await widget.textContent(), /2,249/, 'from 1,699 + 650 - 100');
    assert.doesNotMatch(await widget.textContent(), /Unavailable|Low stock/);
    await page.getByRole('radio', { name: /With Blouse/ }).first().click();
    const chips = page.getByRole('group', { name: 'Basic Blouse Size' });
    assert.equal(await chips.getByRole('button').count(), 3);
    assert.equal(await chips.getByRole('button', { name: /30/ }).isDisabled(), true, 'sold out size');
    assert.equal(await page.locator('.brix-packs-add').isDisabled(), true, 'nothing added without a size');
    assert.match(await widget.textContent(), /Choose the size of Basic Blouse/);
    await chips.getByRole('button', { name: /34/ }).click();
    assert.match(await widget.textContent(), /2,299/, '34 costs 700: 1,699 + 700 - 100');
    await page.locator('.brix-packs-add').click();
    await page.waitForFunction(() => document.querySelector('.brix-packs-msg'));
    const items = calls.cart[0].items;
    assert.deepEqual(items.map((line) => [line.id, line.quantity]).sort(), [[5016, 1], [701, 1]]);
    assert.equal(items[0].properties._brix_pack_quantity, '2');
    assert.equal(items[0].properties._brix_pack_group, items[1].properties._brix_pack_group);
    assert.deepEqual(errors, []);
    if (preset === 'list') await widget.screenshot({ path: path.join(ROOT, 'tests/packs/screenshots/combo-pick-list.png') });
    await context.close();
  });
}

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

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
import process from 'node:process';

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

// Dawn-like markup: the price in its own #price-<section> block, a hidden
// installment /cart/add form under it, the quantity input outside the real
// form, Add to cart + Buy it now inside it — and a recommendations section
// with its own prices that must never be mistaken for the product price.
const dawnMain = (variantInput, slot) => `<section id="recs-top"><div class="price">$10</div></section><main class="product__info-container">
  <h1>Tee</h1>
  <div id="price-template--1__main"><div class="price">$80</div></div>
  <form id="product-form-installment" class="installment" action="/cart/add"><input type="hidden" name="id" value="${variantInput}"></form>
  <div class="product-form__input product-form__quantity"><quantity-input><input class="quantity__input" name="quantity" value="1" form="product-form-main"></quantity-input></div>
  <product-form><form id="product-form-main" action="/cart/add"><input type="hidden" name="id" value="${variantInput}">
    <div class="product-form__buttons"><button type="submit" name="add" id="theme-add">Add to cart</button><div class="shopify-payment-button"><button id="buy-now" type="button">Buy it now</button></div></div>
  </form></product-form>
  <p id="after-form">Description</p>
  ${slot ? '<div id="custom-slot" data-brix-packs-slot></div>' : ''}
</main><section id="recs"><div class="card"><div class="price">$10</div></div></section>`;

async function open({ body, pageProduct = product(), shopifyGlobals = '', variantInput = '200', dawn = false, slot = false }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  const cartCalls = [];
  await page.route('http://shop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/cart/add.js') {
      cartCalls.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: cartCalls.at(-1).items }) });
    }
    if (url.pathname === '/checkout') return route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' });
    if (url.pathname === '/apps/cart-app/packs_storefront.php') {
      requests.push(url);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (url.pathname === '/packs_widget.js') return route.fulfill({ contentType: 'application/javascript', body: script });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tee</title></head><body>
      ${dawn ? dawnMain(variantInput, slot) : `<main><form action="/cart/add" method="post"><input type="hidden" name="id" value="${variantInput}"><button>Add to cart</button></form></main>`}
      <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="100" data-api="/apps/cart-app" data-endpoint="/apps/cart-app/packs_storefront.php"></div>
      ${pageProduct ? `<script type="application/json" data-brix-packs-product>${JSON.stringify(pageProduct)}</script>` : ''}
      <script>${shopifyGlobals}</script>
      <script src="/packs_widget.js" defer></script></body></html>` });
  });
  await page.goto('http://shop.test/products/tee');
  return { page, context, requests, cartCalls };
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

const placed = (position) => pack({ customization: { placement: { position } } });
const positionOf = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-brix-packs-root]');
  const pf = document.querySelector('product-form');
  const prev = root.previousElementSibling;
  return { belowPrice: Boolean(prev && /^price-template/.test(prev.id)), beforeProductForm: root.nextElementSibling === pf, inSlot: root.parentElement.id === 'custom-slot' };
});

await check('default placement: right below the product price (not a recommendations price, not the installment form)', async () => {
  const { page, context } = await open({ body: phpBody([pack()]), dawn: true });
  await page.waitForSelector('.brix-packs-widget');
  assert.equal((await positionOf(page)).belowPrice, true);
  assert.equal(await page.evaluate(() => document.querySelector('[data-brix-packs-root]').getAttribute('style')), null, 'pre-placement spacing removed');
  await context.close();
});

await check('Dawn: theme Add to cart, quantity and Buy it now hidden (the Pack has its own Buy Now)', async () => {
  const { page, context } = await open({ body: phpBody([pack()]), dawn: true });
  await page.waitForSelector('.brix-packs-widget');
  assert.equal(await page.locator('#theme-add').isVisible(), false, 'add');
  assert.equal(await page.locator('.product-form__quantity').isVisible(), false, 'qty');
  assert.equal(await page.locator('#buy-now').isVisible(), false, 'buynow');
  await context.close();
});

await check('Dawn: no Pack for this product -> theme controls untouched', async () => {
  const { page, context } = await open({ body: phpBody([]), dawn: true });
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#theme-add').isVisible(), true);
  assert.equal(await page.locator('.product-form__quantity').isVisible(), true);
  await context.close();
});

await check('Packs saved with the old buy-button placements show below the price', async () => {
  for (const old of ['above_buttons', 'below_buttons']) {
    const { page, context } = await open({ body: phpBody([placed(old)]), dawn: true });
    await page.waitForSelector('.brix-packs-widget');
    assert.equal((await positionOf(page)).belowPrice, true, old);
    await context.close();
  }
});

await check('placement custom moves into the BRIX Packs position block', async () => {
  const { page, context } = await open({ body: phpBody([placed('custom')]), dawn: true, slot: true });
  await page.waitForSelector('.brix-packs-widget');
  assert.equal((await positionOf(page)).inSlot, true);
  await context.close();
});

await check('placement custom without the block falls back to below the price', async () => {
  const { page, context } = await open({ body: phpBody([placed('custom')]), dawn: true });
  await page.waitForSelector('.brix-packs-widget');
  assert.equal((await positionOf(page)).belowPrice, true);
  await context.close();
});

await check('a theme with no recognisable price block: falls back to above the buy buttons', async () => {
  const { page, context } = await open({ body: phpBody([pack()]) });
  await page.waitForSelector('.brix-packs-widget');
  assert.equal(await page.evaluate(() => document.querySelector('[data-brix-packs-root]').nextElementSibling.tagName), 'FORM');
  await context.close();
});

await check('if the theme re-renders the product info and drops the Pack, it is put back below the new price', async () => {
  const { page, context } = await open({ body: phpBody([pack()]), dawn: true });
  await page.waitForSelector('.brix-packs-widget');
  await page.evaluate(() => { const main = document.querySelector('main'); main.innerHTML = main.innerHTML.replace(/<div data-brix-packs-root[\s\S]*?<\/section><\/div>/, ''); document.querySelector('[data-brix-packs-root]')?.remove(); });
  await page.waitForFunction(() => { const root = document.querySelector('[data-brix-packs-root]'); return root && /^price-template/.test(root.previousElementSibling?.id || ''); }, null, { timeout: 4000 });
  await context.close();
});

// ── Layouts: Pack tabs / Stacked packs / Visual picker, and the Pack's own Buy Now ──
const swatch = (color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`)}`;
const shirtProduct = () => product({
  title: 'Tee', image: swatch('#cccccc'),
  variants: [
    { id: 200, title: 'Black / M', price: 8000, available: true, inventoryQuantity: 0, inventoryPolicy: 'continue', inventoryManagement: null, image: swatch('#111111') },
    { id: 201, title: 'White / L', price: 10000, available: true, inventoryQuantity: 0, inventoryPolicy: 'continue', inventoryManagement: null, image: swatch('#eeeeee') },
    { id: 202, title: 'Red / S', price: 9000, available: false, inventoryQuantity: 0, inventoryPolicy: 'deny', inventoryManagement: 'shopify', image: swatch('#cc0000') },
  ],
});
const withDesign = (preset, over = {}) => pack({ customization: { design: { preset }, content: { heading: 'Choose Your Pack', cta: 'Add to Cart', ...(over.content || {}) } }, ...over.pack });
const mixMatch = (preset, content) => withDesign(preset, { content, pack: { packType: 'mix_match', variantScope: 'all', allowedVariantIds: [] } });
const shotDir = path.join(process.cwd(), 'tests', 'packs', 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
const shoot = (page, name) => page.locator('.brix-packs-widget').screenshot({ path: path.join(shotDir, name) });
const widgetText = (page) => page.locator('.brix-packs-widget').innerText();

const allVariants = { variantScope: 'all', allowedVariantIds: [] };

await check('Design 1 · Pack tabs: packs side by side; under the chosen pack one dropdown per item, stacked vertically', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([withDesign('tabs', { pack: allVariants })]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="tabs"]');
  assert.equal(await page.locator('.brix-packs-tab').count(), 3);
  assert.equal(await page.locator('.brix-packs-selects select').count(), 1, 'Buy 1 -> one dropdown');
  await page.locator('.brix-packs-tab').nth(2).click();
  assert.equal(await page.locator('.brix-packs-selects select').count(), 3, 'Family pack (3) -> three dropdowns');
  const boxes = await page.locator('.brix-packs-selects select').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
  assert.ok(boxes[0] < boxes[1] && boxes[1] < boxes[2], 'dropdowns are stacked vertically');
  const options = await page.locator('.brix-packs-selects select').first().locator('option').allTextContents();
  assert.ok(options.every((text) => !/Red/.test(text)), 'sold-out variant not offered');
  await page.locator('.brix-packs-tab').nth(1).click();
  await page.locator('.brix-packs-selects select').nth(1).selectOption('201');
  assert.match(await page.locator('.brix-packs-panel').innerText(), /₹171\.00/); // (80 + 100) x 0.95
  await shoot(page, 'layout-tabs.png');
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => /Added to your cart/.test(document.body.innerText));
  assert.deepEqual(cartCalls[0].items.map((item) => [item.id, item.quantity]).sort(), [[200, 1], [201, 1]]);
  assert.equal(new Set(cartCalls[0].items.map((item) => item.properties._brix_pack_group)).size, 1, 'one Pack group for the discount');
  await context.close();
});

await check('Design 2 · Stacked packs (single variant): Buy N rows; the chosen row shows the variant photo once per item', async () => {
  const single = product({ title: 'Mug', image: swatch('#3366cc'), variants: [{ id: 200, title: 'Default Title', price: 8000, available: true, inventoryQuantity: 0, inventoryPolicy: 'continue', inventoryManagement: null, image: swatch('#3366cc') }] });
  const { page, context, cartCalls } = await open({ body: phpBody([withDesign('stacked', { pack: { variantTitle: 'Default Title', productTitle: 'Mug' } })]), pageProduct: single, dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="stacked"]');
  assert.equal(await page.locator('.brix-packs-stack-item').count(), 3);
  assert.match(await page.locator('.brix-packs-stack-item').nth(0).innerText(), /Buy 1[\s\S]*₹80\.00/);
  assert.equal(await page.locator('.brix-packs-tile').count(), 1, 'Buy 1 -> one photo');
  await page.locator('.brix-packs-stack-item').nth(2).locator('button').click();
  assert.equal(await page.locator('.brix-packs-stack-item').nth(2).locator('.brix-packs-tile img').count(), 3, 'Buy 3 -> three photos');
  assert.equal(await page.locator('.brix-packs-stack-item').nth(0).locator('.brix-packs-tile').count(), 0, 'only the chosen row opens');
  assert.equal(await page.locator('.brix-packs-widget select').count(), 0, 'nothing to choose for a single variant');
  assert.doesNotMatch(await page.locator('.brix-packs-tiles').innerText(), /Default Title/);
  assert.match(await page.locator('.brix-packs-tiles').innerText(), /Mug/);
  await shoot(page, 'layout-stacked.png');
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => /Added to your cart/.test(document.body.innerText));
  assert.deepEqual(cartCalls[0].items.map((item) => [item.id, item.quantity]), [[200, 3]]);
  await context.close();
});

await check('Design 2 · Stacked packs with several variants: one dropdown switches every photo', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([withDesign('stacked', { pack: allVariants })]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="stacked"]');
  await page.locator('.brix-packs-stack-item').nth(1).locator('button').click();
  assert.equal(await page.locator('.brix-packs-tiles-wrap select').count(), 1);
  await page.locator('.brix-packs-tiles-wrap select').selectOption('201');
  const srcs = await page.locator('.brix-packs-tile img').evaluateAll((els) => els.map((e) => e.getAttribute('src')));
  assert.equal(srcs.length, 2);
  assert.ok(srcs.every((src) => /eeeeee/.test(src)), 'both photos show the picked variant');
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => /Added to your cart/.test(document.body.innerText));
  assert.deepEqual(cartCalls[0].items.map((item) => [item.id, item.quantity]), [[201, 2]]);
  await context.close();
});

await check('Design 3 · Visual picker: Buy N rows; the chosen pack opens one dropdown per item showing the variant photo (closed box and every option)', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([withDesign('visual', { pack: allVariants })]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="visual"]');
  assert.equal(await page.locator('.brix-packs-stack-item').count(), 3, 'packs are vertical rows');
  await page.locator('.brix-packs-stack-item').nth(1).locator('button.brix-packs-tier').click();
  assert.equal(await page.locator('.brix-packs-dd').count(), 2, 'Buy 2 -> two photo dropdowns');
  assert.match(await page.locator('.brix-packs-dd-trigger img').first().getAttribute('src'), /111111/);
  await page.locator('.brix-packs-dd-trigger').nth(1).click();
  const list = page.locator('.brix-packs-dd-list');
  await list.waitFor();
  assert.equal(await list.locator('[role="option"]').count(), 2, 'sold-out variant not offered');
  assert.equal(await list.locator('[role="option"] img').count(), 2, 'every option shows its photo');
  await shoot(page, 'layout-visual.png');
  await list.locator('[role="option"]', { hasText: 'White / L' }).click();
  await list.waitFor({ state: 'detached' });
  assert.match(await page.locator('.brix-packs-dd-trigger img').nth(1).getAttribute('src'), /eeeeee/);
  assert.match(await page.locator('.brix-packs-stack-item').nth(1).innerText(), /₹171\.00/);
  // keyboard: open with ArrowDown, move, pick with Enter; Escape closes
  await page.locator('.brix-packs-dd-trigger').first().focus();
  await page.keyboard.press('ArrowDown');
  await list.waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await list.waitFor({ state: 'detached' });
  assert.match(await page.locator('.brix-packs-dd-trigger').first().innerText(), /White \/ L/);
  await page.locator('.brix-packs-dd-trigger').first().click();
  await page.keyboard.press('Escape');
  await list.waitFor({ state: 'detached' });
  // clicking outside closes it too
  await page.locator('.brix-packs-dd-trigger').first().click();
  await page.locator('h1, main').first().click({ force: true });
  await list.waitFor({ state: 'detached' });
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => /Added to your cart/.test(document.body.innerText));
  assert.deepEqual(cartCalls[0].items.map((item) => [item.id, item.quantity]), [[201, 2]]);
  await context.close();
});

await check('Design 3 · Visual picker also works for Mix & Match Packs', async () => {
  const { page, context } = await open({ body: phpBody([mixMatch('visual')]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="visual"]');
  await page.locator('.brix-packs-stack-item').nth(2).locator('button.brix-packs-tier').click();
  assert.equal(await page.locator('.brix-packs-dd').count(), 3);
  await context.close();
});

await check('Buy Now: adds the Pack (with Pack markers) then goes to checkout; the theme Buy it now is hidden', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([withDesign('tabs')]), dawn: true });
  await page.waitForSelector('.brix-packs-buy');
  assert.equal(await page.locator('#buy-now').isVisible(), false, "theme's Buy it now hidden");
  assert.equal(await page.locator('#theme-add').isVisible(), false);
  assert.equal(await page.locator('.brix-packs-buy').innerText(), 'Buy Now');
  await page.locator('.brix-packs-tab').nth(1).click();
  await Promise.all([page.waitForURL('**/checkout'), page.locator('.brix-packs-buy').click()]);
  assert.equal(cartCalls.length, 1);
  assert.equal(cartCalls[0].items[0].quantity, 2);
  assert.equal(cartCalls[0].items[0].properties._brix_pack_id, '7');
  await context.close();
});

await check('Buy Now switched off: no Pack Buy Now, theme Buy it now stays; a saved "classic" Pack shows as Stacked packs', async () => {
  const { page, context } = await open({ body: phpBody([withDesign('classic', { content: { showBuyNow: false } })]), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="stacked"]');
  assert.equal(await page.locator('.brix-packs-buy').count(), 0);
  assert.equal(await page.locator('#buy-now').isVisible(), true);
  await context.close();
});

await check('custom Buy Now label; saved "premium"/"highlight" Packs show as Pack tabs', async () => {
  const { page, context } = await open({ body: phpBody([withDesign('premium', { content: { buyNow: 'Buy it now' } })]), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="tabs"] .brix-packs-buy');
  assert.equal(await page.locator('.brix-packs-buy').innerText(), 'Buy it now');
  assert.match(await widgetText(page), /Add to Cart/);
  await context.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

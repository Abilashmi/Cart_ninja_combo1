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

// Storefront API cartCreate (the Pack's Buy Now): a cart of its own + its checkout.
const cartCreateOk = { data: { cartCreate: { cart: { checkoutUrl: 'http://shop.test/checkouts/cn/pack-only' }, userErrors: [] } } };

async function open({ body, pageProduct = product(), shopifyGlobals = '', variantInput = '200', dawn = false, slot = false, cartCreate = cartCreateOk }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requests = [];
  const cartCalls = [];
  const storefrontCalls = [];
  await page.route('http://shop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/cart/add.js') {
      cartCalls.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: cartCalls.at(-1).items }) });
    }
    if (/^\/api\/[\d-]+\/graphql\.json$/.test(url.pathname)) {
      storefrontCalls.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartCreate) });
    }
    if (url.pathname.startsWith('/checkouts/')) return route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' });
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
  return { page, context, requests, cartCalls, storefrontCalls };
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

// ── Templates: Horizontal Select / Quick Add Picker / Image Variant Select ──
const swatch = (color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`)}`;
const v = (id, options, price, extra = {}) => ({ id, title: options.join(' / '), options, price, available: true, inventoryQuantity: 0, inventoryPolicy: 'continue', inventoryManagement: null, image: '', ...extra });
// Size + Color. Red only comes in S and M; L / White is sold out; M / Blue has no photo of its own.
const shirtProduct = () => product({
  title: 'Tee', image: swatch('#cccccc'), options: ['Size', 'Color'],
  variants: [
    v(300, ['M', 'Black'], 8000, { image: swatch('#111111') }),
    v(301, ['L', 'Black'], 8000, { image: swatch('#222222') }),
    v(302, ['M', 'Blue'], 9000),
    v(303, ['L', 'Blue'], 9000, { image: swatch('#0000ff') }),
    v(304, ['S', 'Red'], 8000, { image: swatch('#ff0000') }),
    v(305, ['M', 'Red'], 8000, { image: swatch('#ee0000') }),
    v(306, ['L', 'White'], 8000, { available: false, inventoryPolicy: 'deny', inventoryManagement: 'shopify' }),
    v(307, ['S', 'Black'], 8000, { inventoryQuantity: 1, inventoryPolicy: 'deny', inventoryManagement: 'shopify', image: swatch('#333333') }),
  ],
});
const colorFirst = () => { const p = shirtProduct(); return { ...p, options: ['Color', 'Size'], variants: p.variants.map((x) => ({ ...x, options: [x.options[1], x.options[0]] })) }; };
const threeOptions = () => product({
  title: 'Bottle', image: swatch('#cccccc'), options: ['Size', 'Color', 'Material'],
  variants: [v(400, ['500ml', 'Black', 'Steel'], 8000, { image: swatch('#444444') }), v(401, ['1L', 'Black', 'Steel'], 9000), v(402, ['1L', 'Green', 'Glass'], 9000, { image: swatch('#00aa00') })],
});
const mug = () => product({ title: 'Mug', image: swatch('#3366cc'), options: ['Title'], variants: [v(200, ['Default Title'], 8000, { title: 'Default Title', image: swatch('#3366cc') })] });
const designed = (preset, over = {}) => pack({ variantId: '300', variantScope: 'all', allowedVariantIds: [], customization: { design: { preset }, content: { heading: 'Choose Your Pack', cta: 'Add Pack to Cart', ...(over.content || {}) }, ...(over.custom || {}) }, ...over.pack });
const mix = (preset, over = {}) => designed(preset, { ...over, pack: { packType: 'mix_match', template: 'choose_each_item', ...over.pack } });
const shotDir = path.join(process.cwd(), 'tests', 'packs', 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });
const shoot = (page, name) => page.locator('.brix-packs-widget').screenshot({ path: path.join(shotDir, name) });
const widgetText = (page) => page.locator('.brix-packs-widget').innerText();
const card = (page, index) => page.locator('.brix-packs-card').nth(index);
const slot = (page, index) => page.locator('.brix-packs-slot, .brix-packs-icard').nth(index);
// Visible option names (the label also holds a screen-reader-only "Item N").
const fieldNames = (locator) => locator.locator('.brix-packs-field-label').evaluateAll((els) => els.map((e) => e.lastChild.textContent));
const lines = (call) => call.items.map((item) => [item.id, item.quantity]);
const addPack = async (page) => { await page.locator('.brix-packs-add').click(); await page.waitForSelector('.brix-packs-msg[data-type="success"]'); };

await check('all templates: pack cards sit side by side with name, item count, price, savings and badge', async () => {
  for (const preset of ['slots', 'quick_add', 'image_slots']) {
    const { page, context } = await open({ body: phpBody([mix(preset)]), pageProduct: shirtProduct(), dawn: true });
    await page.waitForSelector(`.brix-packs-widget[data-layout="${preset}"]`);
    const boxes = await page.locator('.brix-packs-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
    assert.equal(boxes.length, 3);
    assert.ok(boxes[0].top === boxes[1].top && boxes[1].top === boxes[2].top && boxes[0].left < boxes[1].left && boxes[1].left < boxes[2].left, `${preset}: horizontal`);
    const third = await card(page, 2).innerText();
    assert.match(third, /Family pack[\s\S]*3 items[\s\S]*₹210\.00[\s\S]*₹240\.00[\s\S]*Save ₹30\.00/);
    assert.match(third, /Best value/i);
    assert.equal(await page.locator('.brix-packs-card[role="radio"][aria-checked="true"]').count(), 1);
    await context.close();
  }
});

await check('Horizontal Select (Mix & Match): Pack N -> N slots, one dropdown per Shopify option, must complete every slot', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([mix('slots')]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="slots"]');
  assert.equal(await page.locator('.brix-packs-slot').count(), 1, 'Pack 1 -> one slot');
  await card(page, 2).click();
  assert.equal(await page.locator('.brix-packs-slot').count(), 3, 'Pack 3 -> three slots');
  await card(page, 1).click();
  assert.equal(await page.locator('.brix-packs-slot').count(), 2, 'Pack 2 -> two slots');
  assert.deepEqual(await fieldNames(slot(page, 0)), ['Size', 'Color']);
  assert.equal(await page.getByLabel('Item 2 Color').count(), 1, 'selects are labelled per item');
  assert.match(await widgetText(page), /0 \/ 2 selected/);
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), true, 'nothing chosen yet');
  await page.getByLabel('Item 1 Size').selectOption('M');
  await page.getByLabel('Item 1 Color').selectOption('Black');
  assert.match(await widgetText(page), /1 \/ 2 selected/);
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), true, 'item 2 still open');
  await page.getByLabel('Item 2 Size').selectOption('L');
  await page.getByLabel('Item 2 Color').selectOption('Blue');
  assert.match(await widgetText(page), /2 \/ 2 selected/);
  assert.match(await card(page, 1).innerText(), /₹161\.50/); // (80 + 90) x 0.95
  assert.match(await slot(page, 1).innerText(), /L \/ Blue/);
  await shoot(page, 'template-slots.png');
  await addPack(page);
  assert.deepEqual(lines(cartCalls[0]), [[300, 1], [303, 1]]);
  assert.equal(new Set(cartCalls[0].items.map((item) => item.properties._brix_pack_group)).size, 1, 'one Pack group for the discount');
  assert.equal(cartCalls[0].items[0].properties._brix_pack_quantity, '2');
  await context.close();
});

await check('duplicates follow the Pack rule: Mix & Match allows the same variant twice -> one cart line of 2', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([mix('slots')]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-slot');
  await card(page, 1).click();
  for (const item of [1, 2]) { await page.getByLabel(`Item ${item} Size`).selectOption('M'); await page.getByLabel(`Item ${item} Color`).selectOption('Black'); }
  await addPack(page);
  assert.deepEqual(lines(cartCalls[0]), [[300, 2]]);
  await context.close();
});

await check('option values cascade from real variants: Color = Red -> L is unavailable; an impossible combination is flagged, never swapped', async () => {
  const { page, context } = await open({ body: phpBody([mix('slots')]), pageProduct: colorFirst(), dawn: true });
  await page.waitForSelector('.brix-packs-slot');
  await page.getByLabel('Item 1 Color').selectOption('Red');
  const sizes = await page.getByLabel('Item 1 Size').locator('option').evaluateAll((els) => els.map((o) => [o.value, o.disabled, o.textContent]));
  assert.deepEqual(sizes.filter(([value]) => value).map(([value, disabled]) => [value, disabled]), [['M', false], ['L', true], ['S', false]]);
  assert.match(sizes.find(([value]) => value === 'L')[2], /Unavailable/);
  // White exists only as a sold-out L.
  const colors = await page.getByLabel('Item 1 Color').locator('option').evaluateAll((els) => els.map((o) => [o.value, o.disabled, o.textContent]));
  assert.deepEqual(colors.find(([value]) => value === 'White').slice(1), [true, 'White — Sold out']);
  // L / Blue, then switch Color to Red: Red / L does not exist.
  await page.getByLabel('Item 1 Color').selectOption('Blue');
  await page.getByLabel('Item 1 Size').selectOption('L');
  await page.getByLabel('Item 1 Color').selectOption('Red');
  assert.equal(await page.getByLabel('Item 1 Size').inputValue(), 'L', 'the pick is kept, not silently changed');
  assert.match(await slot(page, 0).innerText(), /isn’t available/);
  assert.equal(await page.getByLabel('Item 1 Size').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), true);
  await page.getByLabel('Item 1 Size').selectOption('S');
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), false);
  await context.close();
});

await check('three options (Size, Color, Material): three dropdowns in Horizontal Select and Image Variant Select', async () => {
  for (const preset of ['slots', 'image_slots']) {
    const { page, context, cartCalls } = await open({ body: phpBody([mix(preset, { pack: { variantId: '400' } })]), pageProduct: threeOptions(), dawn: true });
    await page.waitForSelector(`.brix-packs-widget[data-layout="${preset}"]`);
    assert.deepEqual(await fieldNames(slot(page, 0)), ['Size', 'Color', 'Material'], preset);
    if (preset === 'image_slots') assert.equal(await slot(page, 0).locator('img').count(), 1, 'image in the slot');
    await page.getByLabel('Item 1 Size').selectOption('1L');
    await page.getByLabel('Item 1 Color').selectOption('Green');
    await page.getByLabel('Item 1 Material').selectOption('Glass');
    await addPack(page);
    assert.deepEqual(lines(cartCalls[0]), [[402, 1]], preset);
    await context.close();
  }
});

await check('Image Variant Select: a photo in every slot; it follows the resolved variant and falls back to the product photo', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([mix('image_slots')]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="image_slots"]');
  await card(page, 1).click();
  assert.equal(await page.locator('.brix-packs-icard').count(), 2);
  assert.equal(await page.locator('.brix-packs-icard img').count(), 2, 'every slot shows an image');
  const src = (i) => page.locator('.brix-packs-icard').nth(i).locator('img').getAttribute('src');
  assert.match(await src(0), /cccccc/, 'product photo before anything is chosen');
  await page.getByLabel('Item 1 Size').selectOption('L');
  await page.getByLabel('Item 1 Color').selectOption('Blue');
  assert.match(await src(0), /0000ff/, 'L / Blue variant photo');
  assert.match(await slot(page, 0).innerText(), /Tee[\s\S]*L \/ Blue[\s\S]*₹90\.00/);
  await page.getByLabel('Item 1 Size').selectOption('M');
  assert.match(await src(0), /cccccc/, 'M / Blue has no photo -> product photo');
  await page.getByLabel('Item 2 Size').selectOption('M');
  await page.getByLabel('Item 2 Color').selectOption('Black');
  assert.match(await src(1), /111111/);
  await shoot(page, 'template-image-slots.png');
  await addPack(page);
  assert.deepEqual(lines(cartCalls[0]), [[302, 1], [300, 1]]);
  await context.close();
});

await check('Quick Add Picker: + adds, count updates, a full pack blocks more, remove frees a slot', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([mix('quick_add')]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="quick_add"]');
  await card(page, 1).click();
  assert.match(await widgetText(page), /Choose 2 items[\s\S]*Selected: 0 \/ 2/);
  const plus = (name) => page.getByRole('button', { name: `Add ${name} to your pack` });
  const box = await plus('M / Black').boundingBox();
  const cardBox = await page.locator('.brix-packs-vcard[data-variant-id="300"]').boundingBox();
  assert.ok(box.x + box.width > cardBox.x + cardBox.width - 20 && box.y < cardBox.y + 20, '+ sits top-right');
  await plus('M / Black').click();
  assert.match(await widgetText(page), /Selected: 1 \/ 2/);
  assert.equal(await page.locator('.brix-packs-vcard[data-variant-id="300"]').getAttribute('data-selected'), '1');
  await plus('M / Blue').click();
  assert.match(await widgetText(page), /Selected: 2 \/ 2/);
  assert.equal(await plus('L / Black').getAttribute('aria-disabled'), 'true', 'third item blocked');
  await plus('L / Black').click({ force: true });
  assert.match(await widgetText(page), /Your pack is full/);
  assert.match(await widgetText(page), /Selected: 2 \/ 2/);
  await shoot(page, 'template-quick-add.png');
  await page.getByRole('button', { name: 'Remove item 2, M / Blue' }).click();
  assert.match(await widgetText(page), /Selected: 1 \/ 2/);
  await plus('L / Black').click();
  assert.equal(await page.getByRole('button', { name: /Add L \/ White/ }).getAttribute('aria-disabled'), 'true', 'sold out');
  await addPack(page);
  assert.deepEqual(lines(cartCalls[0]), [[300, 1], [301, 1]]);
  await context.close();
});

await check('Quick Add Picker: the same variant twice (duplicates allowed) and Shopify stock caps per variant', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([mix('quick_add')]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-grid');
  await card(page, 2).click();
  await page.getByRole('button', { name: 'Add S / Black to your pack' }).click();
  assert.equal(await page.getByRole('button', { name: /Add another S \/ Black/ }).getAttribute('aria-disabled'), 'true', 'only 1 in stock');
  await page.getByRole('button', { name: 'Add M / Black to your pack' }).click();
  await page.getByRole('button', { name: /Add another M \/ Black/ }).click();
  assert.match(await widgetText(page), /Selected: 3 \/ 3/);
  await addPack(page);
  assert.deepEqual(lines(cartCalls[0]), [[307, 1], [300, 2]]);
  await context.close();
});

await check('stock: two slots on a variant with 1 in stock is flagged and cannot be added', async () => {
  const { page, context } = await open({ body: phpBody([mix('slots')]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-slot');
  await card(page, 1).click();
  for (const item of [1, 2]) { await page.getByLabel(`Item ${item} Size`).selectOption('S'); await page.getByLabel(`Item ${item} Color`).selectOption('Black'); }
  assert.match(await slot(page, 1).innerText(), /Only 1 of S \/ Black left/);
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), true);
  await context.close();
});

await check('Same Variant Pack: one selection for every item, started from the theme variant; cart gets N of it', async () => {
  for (const preset of ['slots', 'image_slots', 'quick_add']) {
    const { page, context, cartCalls } = await open({ body: phpBody([designed(preset)]), pageProduct: shirtProduct(), dawn: true, variantInput: '303' });
    await page.waitForSelector(`.brix-packs-widget[data-layout="${preset}"][data-mode="same"]`);
    await card(page, 1).click();
    assert.match(await widgetText(page), /2 \/ 2/, preset);
    if (preset !== 'quick_add') {
      assert.equal(await page.locator('.brix-packs-slot, .brix-packs-icard').count(), 1, `${preset}: one selection`);
      assert.match(await slot(page, 0).innerText(), /all 2 items/i);
      assert.match(await slot(page, 0).innerText(), /✓ L \/ Blue/);
    } else {
      await page.getByRole('button', { name: 'Choose M / Black for all 2 items' }).click();
    }
    await addPack(page);
    assert.deepEqual(lines(cartCalls[0]), [[preset === 'quick_add' ? 300 : 303, 2]], preset);
    await context.close();
  }
});

await check('product with no options: nothing to choose, its photo is shown, the real variant is added', async () => {
  for (const preset of ['slots', 'image_slots']) {
    const { page, context, cartCalls } = await open({ body: phpBody([designed(preset, { pack: { variantId: '200', variantScope: 'selected', allowedVariantIds: ['200'] } })]), pageProduct: mug(), dawn: true });
    await page.waitForSelector('.brix-packs-widget');
    assert.equal(await page.locator('.brix-packs-widget select').count(), 0);
    assert.match(await page.locator('.brix-packs-widget img').first().getAttribute('src'), /3366cc/);
    assert.doesNotMatch(await widgetText(page), /Default Title/);
    await addPack(page);
    assert.deepEqual(lines(cartCalls[0]), [[200, 1]], preset);
    await context.close();
  }
});

await check('keyboard: arrow keys move between pack cards; focus stays on a dropdown after choosing', async () => {
  const { page, context } = await open({ body: phpBody([mix('slots')]), pageProduct: shirtProduct(), dawn: true });
  await page.waitForSelector('.brix-packs-card');
  await card(page, 0).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await card(page, 1).getAttribute('aria-checked'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-fk')), 'tier-1');
  await page.getByLabel('Item 1 Size').focus();
  await page.getByLabel('Item 1 Size').selectOption('M');
  assert.equal(await page.evaluate(() => document.activeElement.id), await page.getByLabel('Item 1 Size').getAttribute('id'));
  assert.equal(await page.getByLabel('Item 1 Size').inputValue(), 'M');
  await context.close();
});

await check('mobile (375px): every template fits without page-level horizontal scroll; Image Variant Select stacks', async () => {
  for (const preset of ['slots', 'quick_add', 'image_slots']) {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    await page.route('http://shop.test/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/apps/cart-app/packs_storefront.php') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(phpBody([mix(preset)])) });
      if (url.pathname === '/packs_widget.js') return route.fulfill({ contentType: 'application/javascript', body: script });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0 16px">${dawnMain('300')}
        <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="100" data-api="/apps/cart-app" data-endpoint="/apps/cart-app/packs_storefront.php"></div>
        <script type="application/json" data-brix-packs-product>${JSON.stringify(shirtProduct())}</script><script src="/packs_widget.js" defer></script></body></html>` });
    });
    await page.goto('http://shop.test/products/tee');
    await page.waitForSelector('.brix-packs-card');
    await card(page, 2).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${preset}: page overflows by ${overflow}px`);
    const widths = await page.locator('.brix-packs-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    assert.ok(Math.min(...widths) >= 100, `${preset}: pack cards stay readable (${widths})`);
    if (preset === 'image_slots') {
      const lefts = await page.locator('.brix-packs-icard').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
      assert.equal(new Set(lefts).size, 1, 'one column');
    }
    await page.locator('.brix-packs-widget').screenshot({ path: path.join(shotDir, `mobile-${preset}.png`) });
    await context.close();
  }
});

await check('Buy Now: checks out ONLY the Pack (own cart, with Pack markers) and never touches the shopper cart; the theme Buy it now is hidden', async () => {
  const { page, context, cartCalls, storefrontCalls } = await open({ body: phpBody([pack({ customization: { design: { preset: 'slots' } } })]), dawn: true, shopifyGlobals: 'window.Shopify = { country: "IN" };' });
  await page.waitForSelector('.brix-packs-buy');
  assert.equal(await page.locator('#buy-now').isVisible(), false, "theme's Buy it now hidden");
  assert.equal(await page.locator('#theme-add').isVisible(), false);
  assert.equal(await page.locator('.brix-packs-buy').innerText(), 'Buy Now');
  await card(page, 1).click();
  await Promise.all([page.waitForURL('**/checkouts/cn/pack-only'), page.locator('.brix-packs-buy').click()]);
  assert.equal(cartCalls.length, 0, 'the shopper cart (/cart/add.js) is not used');
  assert.equal(storefrontCalls.length, 1);
  assert.match(storefrontCalls[0].query, /cartCreate/);
  const input = storefrontCalls[0].variables.input;
  assert.deepEqual(input.buyerIdentity, { countryCode: 'IN' });
  assert.equal(input.lines.length, 1);
  assert.equal(input.lines[0].merchandiseId, 'gid://shopify/ProductVariant/200');
  assert.equal(input.lines[0].quantity, 2);
  const attrs = Object.fromEntries(input.lines[0].attributes.map((a) => [a.key, a.value]));
  assert.equal(attrs._brix_pack_id, '7');
  assert.equal(attrs._brix_pack_quantity, '2');
  assert.ok(attrs._brix_pack_group);
  await context.close();
});

const withDesign = (preset, over = {}) => pack({ customization: { design: { preset }, content: { heading: 'Choose Your Pack', cta: 'Add to Cart', ...(over.content || {}) }, ...(over.colors ? { colors: over.colors } : {}), ...(over.buttons ? { buttons: over.buttons } : {}) }, ...over.pack });

await check('Buy Now: a Shopify cart error is shown, the shopper stays on the page and the cart is untouched', async () => {
  const { page, context, cartCalls } = await open({ body: phpBody([withDesign('tabs')]), dawn: true, cartCreate: { data: { cartCreate: { cart: null, userErrors: [{ message: 'Only 1 item left in stock.' }] } } } });
  await page.waitForSelector('.brix-packs-buy');
  await page.locator('.brix-packs-buy').click();
  await page.waitForSelector('.brix-packs-msg[data-type="error"]');
  assert.match(await page.locator('.brix-packs-msg').innerText(), /Only 1 item left/);
  assert.equal(new URL(page.url()).pathname, '/products/tee');
  assert.equal(cartCalls.length, 0);
  assert.equal(await page.locator('.brix-packs-buy').isDisabled(), false, 'can try again');
  await context.close();
});

await check('Add to Cart still adds the Pack to the shopper cart', async () => {
  const { page, context, cartCalls, storefrontCalls } = await open({ body: phpBody([withDesign('tabs')]), dawn: true });
  await page.waitForSelector('.brix-packs-add');
  await page.locator('.brix-packs-add').click();
  await page.waitForSelector('.brix-packs-msg[data-type="success"]');
  assert.equal(cartCalls.length, 1);
  assert.equal(storefrontCalls.length, 0);
  await context.close();
});

await check('button customization: colors, shape, stacked + Buy Now first; old Packs keep the outline Buy Now look', async () => {
  const styled = withDesign('tabs', { buttons: { layout: 'stacked', order: 'buy_first', radius: 20, fontSize: 18, fontWeight: 500, paddingY: 10, borderWidth: 3, uppercase: true, addBorder: '#111111', buyNowBackground: '#ff0000', buyNowText: '#00ff00', buyNowBorder: '#0000ff' } });
  const { page, context } = await open({ body: phpBody([styled]), dawn: true });
  await page.waitForSelector('.brix-packs-buy');
  const buy = await page.locator('.brix-packs-buy').evaluate((node) => { const s = getComputedStyle(node); return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor, bw: s.borderTopWidth, radius: s.borderTopLeftRadius, size: s.fontSize, weight: s.fontWeight, transform: s.textTransform, pad: s.paddingTop }; });
  assert.deepEqual(buy, { bg: 'rgb(255, 0, 0)', color: 'rgb(0, 255, 0)', border: 'rgb(0, 0, 255)', bw: '3px', radius: '20px', size: '18px', weight: '500', transform: 'uppercase', pad: '10px' });
  assert.equal(await page.locator('.brix-packs-add').evaluate((node) => getComputedStyle(node).borderTopColor), 'rgb(17, 17, 17)');
  assert.equal(await page.locator('.brix-packs-actions').evaluate((node) => getComputedStyle(node).flexDirection), 'column-reverse');
  const addBox = await page.locator('.brix-packs-add').boundingBox();
  const buyBox = await page.locator('.brix-packs-buy').boundingBox();
  assert.ok(buyBox.y < addBox.y, 'Buy Now shown above Add to Cart');
  await context.close();

  // Saved before the buttons group existed: Buy Now = outline in the button color on the card background.
  const legacy = await open({ body: phpBody([withDesign('tabs', { colors: { button: '#aa0000', cardBackground: '#fafafa' } })]), dawn: true });
  await legacy.page.waitForSelector('.brix-packs-buy');
  const old = await legacy.page.locator('.brix-packs-buy').evaluate((node) => { const s = getComputedStyle(node); return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor }; });
  assert.deepEqual(old, { bg: 'rgb(250, 250, 250)', color: 'rgb(170, 0, 0)', border: 'rgb(170, 0, 0)' });
  assert.equal(await legacy.page.locator('.brix-packs-actions').evaluate((node) => getComputedStyle(node).flexDirection), 'row');
  await legacy.context.close();
});

await check('Buy Now switched off: no Pack Buy Now, theme Buy it now stays; a saved "classic"/"stacked" Pack shows as Horizontal Select', async () => {
  const { page, context } = await open({ body: phpBody([withDesign('classic', { content: { showBuyNow: false } })]), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="slots"]');
  assert.equal(await page.locator('.brix-packs-buy').count(), 0);
  assert.equal(await page.locator('#buy-now').isVisible(), true);
  await context.close();
});

await check('custom Buy Now label; saved "premium"/"tabs" Packs show as Horizontal Select, "visual" as Image Variant Select', async () => {
  const visual = await open({ body: phpBody([withDesign('visual')]), dawn: true });
  await visual.page.waitForSelector('.brix-packs-widget[data-layout="image_slots"]');
  await visual.context.close();
  const { page, context } = await open({ body: phpBody([withDesign('premium', { content: { buyNow: 'Buy it now' } })]), dawn: true });
  await page.waitForSelector('.brix-packs-widget[data-layout="slots"] .brix-packs-buy');
  assert.equal(await page.locator('.brix-packs-buy').innerText(), 'Buy it now');
  assert.match(await widgetText(page), /Add to Cart/);
  await context.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

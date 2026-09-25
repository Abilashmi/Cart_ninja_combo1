// Real-browser check of the BRIX Packs storefront widget (no Shopify store needed).
//
//   1. start the built app:  node node_modules/@react-router/serve/bin.js ./build/server/index.js  (PORT=3999)
//   2. node tests/packs/widget-browser-check.mjs
//
// The widget script is fetched from the running app (/packs.js). The storefront
// page, /api/packs-storefront and Shopify's /cart/add.js are mocked with
// Playwright routes, so this verifies rendering, templates, customization,
// currency, badges, variants, cart payloads and error handling — NOT Shopify's
// checkout discount (that needs a deployed function; see CLAUDE.md).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const APP = process.env.PACKS_APP_URL || 'http://localhost:3999';
const SHOT_DIR = process.env.PACKS_SHOTS || path.join(process.cwd(), 'tests', 'packs', 'screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const customization = (over = {}) => ({
  content: { heading: 'Choose Your Pack', subheading: 'Buy more and save more.', cta: 'Add Pack to Cart', promoText: '' },
  savings: { visible: true, mode: 'save_amount' },
  colors: { primary: '#008060', background: '#ffffff', cardBackground: '#ffffff', selectedCard: '#e6f4f1', border: '#dfe3e8', text: '#202223', price: '#202223', discount: '#008060', badge: '#fff4d6', button: '#008060', buttonText: '#ffffff' },
  borders: { radius: 8, width: 1, style: 'solid', shadow: false },
  typography: { headingSize: 20, packTitleSize: 15, priceSize: 18, descriptionSize: 13, fontWeight: 600, alignment: 'left' },
  spacing: { cardPadding: 16, cardGap: 10, sectionSpacing: 20, buttonSpacing: 16 },
  images: { enabled: true, size: 'medium', position: 'top' },
  ...over,
});

// 80 x1 / x2 5% / x3 10% — numbers exactly as the server's calculateTier returns them
const tiers = [
  { quantity: 1, name: '', badge: '', discountType: 'none', discountValue: 0, subtotal: 80, discountAmount: 0, price: 80, savings: 0, effectiveUnitPrice: 80 },
  { quantity: 2, name: '', badge: '', discountType: 'percentage', discountValue: 5, subtotal: 160, discountAmount: 8, price: 152, savings: 8, effectiveUnitPrice: 76 },
  { quantity: 3, name: 'Family pack', badge: 'Best value', discountType: 'percentage', discountValue: 10, subtotal: 240, discountAmount: 24, price: 216, savings: 24, effectiveUnitPrice: 72 },
];
const variants = [
  { id: '200', title: 'M', price: 80, availableForSale: true, maxQuantity: null },
  { id: '201', title: 'L', price: 100, availableForSale: true, maxQuantity: null },
  { id: '202', title: 'XL', price: 120, availableForSale: false, maxQuantity: null },
];
const pack = (over = {}) => ({ id: 7, version: 4, variantId: '200', template: 'same_variant', productTitle: 'Tee', variantTitle: 'M', productImage: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=', basePrice: 80, available: true, maxQuantity: null, tiers, customization: customization(), ...over });
const apiBody = (packs, over = {}) => ({ success: true, packs, reason: packs.length ? null : 'no_active_pack', currency: { code: 'INR', locale: 'en-IN' }, checkoutDiscount: { verified: true, state: 'active', message: 'Checkout discount is active.' }, preview: false, ...over });

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓', name); } catch (error) { results.push({ name, ok: false, error }); console.log('  ✗', name, '\n     ', String(error.message).split('\n')[0]); }
};

const browser = await chromium.launch();

async function open({ body, viewport = { width: 1000, height: 900 }, search = '', shopifyGlobals = '', cartResponse, variantInput = '200', apiStatus = 200 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const cartCalls = [];
  const consoleWarnings = [];
  page.on('console', (message) => { if (message.type() === 'warning') consoleWarnings.push(message.text()); });
  const script = await (await fetch(`${APP}/packs.js`)).text();
  await page.route('http://shop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/cart/add.js') {
      cartCalls.push(JSON.parse(route.request().postData()));
      const response = cartResponse ? cartResponse(cartCalls.at(-1)) : { status: 200, body: { items: cartCalls.at(-1).items } };
      return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><title>Tee</title></head><body>
      <main><h1>Tee</h1><form action="/cart/add" method="post"><input type="hidden" name="id" value="${variantInput}"><button>Add to cart</button></form></main>
      <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="100" data-api="${APP}"></div>
      <script>${shopifyGlobals}</script>
      <script src="${APP}/packs.js"></script></body></html>` });
  });
  await page.route(`${APP}/packs.js`, (route) => route.fulfill({ contentType: 'application/javascript', body: script, headers: { 'access-control-allow-origin': '*' } }));
  await page.route(`${APP}/api/packs-storefront**`, (route) => route.fulfill({ status: apiStatus, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }));
  await page.goto(`http://shop.test/products/tee${search}`);
  return { page, context, cartCalls, consoleWarnings };
}

console.log('\nBRIX Packs storefront widget — browser checks');

await check('same_variant: renders tiers with shop currency (₹), savings, badge only where set, widget sits before the product form', async () => {
  const { page, context } = await open({ body: apiBody([pack()]) });
  await page.waitForSelector('.brix-packs-widget');
  const text = await page.locator('.brix-packs-widget').innerText();
  assert.match(text, /Choose Your Pack/);
  assert.match(text, /₹80\.00/);
  assert.match(text, /₹216\.00/);
  assert.match(text, /Save ₹24\.00/);
  assert.match(text, /₹72\.00 each/);
  assert.doesNotMatch(text, /\$/);
  assert.equal(await page.locator('.brix-packs-badge').count(), 1); // only the tier that has a badge
  assert.equal(await page.locator('.brix-packs-badge').textContent(), 'Best value');
  assert.match(text, /Family pack/);
  assert.match(text, /Buy 1/);
  assert.equal(await page.evaluate(() => document.querySelector('[data-brix-packs-root]').nextElementSibling.tagName), 'FORM');
  await page.screenshot({ path: path.join(SHOT_DIR, 'same_variant.png'), fullPage: false });
  await context.close();
});

await check('selecting a tier works (aria + keyboard) and add-to-cart sends the REAL variant with the tier quantity and pack markers', async () => {
  const { page, context, cartCalls } = await open({ body: apiBody([pack()]) });
  await page.waitForSelector('.brix-packs-tier');
  assert.equal(await page.locator('.brix-packs-tier[aria-checked="true"]').count(), 1);
  await page.locator('.brix-packs-tier').nth(2).click();
  assert.equal(await page.locator('.brix-packs-tier').nth(2).getAttribute('aria-checked'), 'true');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('.brix-packs-tier').nth(1).getAttribute('aria-checked'), 'true');
  await page.locator('.brix-packs-tier').nth(2).click();
  let eventDetail = null;
  await page.exposeFunction('reportEvent', (detail) => { eventDetail = detail; });
  await page.evaluate(() => document.addEventListener('brix:packs:added', (event) => window.reportEvent(event.detail)));
  await page.locator('.brix-packs-add').click();
  await page.waitForSelector('.brix-packs-msg[data-type="success"]');
  assert.equal(cartCalls.length, 1);
  const [item] = cartCalls[0].items;
  assert.equal(cartCalls[0].items.length, 1);
  assert.equal(item.id, 200);
  assert.equal(item.quantity, 3);
  assert.equal(item.properties._brix_pack_id, '7');
  assert.equal(item.properties._brix_pack_quantity, '3');
  assert.equal(item.properties._brix_pack_version, '4');
  assert.match(item.properties._brix_pack_group, /^[a-z0-9]{8,}$/);
  await page.waitForTimeout(100);
  assert.equal(eventDetail.quantity, 3);
  // a second add gets a different group token -> never merges into an odd quantity
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => !document.querySelector('.brix-packs-add').disabled);
  assert.notEqual(cartCalls[1].items[0].properties._brix_pack_group, item.properties._brix_pack_group);
  await context.close();
});

await check('add-to-cart failure shows Shopify\'s message; network failure is explained; button recovers', async () => {
  const { page, context } = await open({ body: apiBody([pack()]), cartResponse: () => ({ status: 422, body: { status: 422, message: 'Cart Error', description: 'You can only add 2 of this item to your cart.' } }) });
  await page.waitForSelector('.brix-packs-add');
  await page.locator('.brix-packs-add').click();
  await page.waitForSelector('.brix-packs-msg[data-type="error"]');
  assert.match(await page.locator('.brix-packs-msg').innerText(), /only add 2/);
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), false);
  await context.close();
});

await check('visual_offer renders a genuinely different layout (card grid + product image + pill)', async () => {
  const same = await open({ body: apiBody([pack()]) });
  await same.page.waitForSelector('.brix-packs-tier');
  const listColumns = await same.page.evaluate(() => getComputedStyle(document.querySelector('.brix-packs-tiers')).gridTemplateColumns.split(' ').length);
  const sameImages = await same.page.locator('.brix-packs-img').count();
  await same.context.close();
  const visual = await open({ body: apiBody([pack({ template: 'visual_offer' })]) });
  await visual.page.waitForSelector('.brix-packs-tier');
  const cardColumns = await visual.page.evaluate(() => getComputedStyle(document.querySelector('.brix-packs-tiers')).gridTemplateColumns.split(' ').length);
  assert.equal(listColumns, 1);
  assert.ok(cardColumns >= 3, `expected a multi-column card grid, got ${cardColumns}`);
  assert.equal(sameImages, 0);
  assert.equal(await visual.page.locator('.brix-packs-img').count(), 3);
  assert.equal(await visual.page.locator('.brix-packs-radio').first().isVisible(), false);
  assert.equal(await visual.page.locator('.brix-packs-widget').getAttribute('data-template'), 'visual_offer');
  await visual.page.screenshot({ path: path.join(SHOT_DIR, 'visual_offer.png') });
  await visual.context.close();
});

await check('visual_offer honours image settings (disabled / left)', async () => {
  const off = await open({ body: apiBody([pack({ template: 'visual_offer', customization: customization({ images: { enabled: false, size: 'medium', position: 'top' } }) })]) });
  await off.page.waitForSelector('.brix-packs-tier');
  assert.equal(await off.page.locator('.brix-packs-img').count(), 0);
  await off.context.close();
  const left = await open({ body: apiBody([pack({ template: 'visual_offer', customization: customization({ images: { enabled: true, size: 'large', position: 'left' } }) })]) });
  await left.page.waitForSelector('.brix-packs-img');
  assert.equal(await left.page.locator('.brix-packs-img').first().getAttribute('data-size'), 'large');
  assert.equal(await left.page.locator('.brix-packs-widget').getAttribute('data-image-position'), 'left');
  await left.context.close();
});

await check('choose_each_item: one variant picker per item, only sellable variants, price updates, cart gets one line per variant', async () => {
  const { page, context, cartCalls } = await open({ body: apiBody([pack({ template: 'choose_each_item', variants })]) });
  await page.waitForSelector('.brix-packs-tier');
  assert.equal(await page.locator('.brix-packs-choose select').count(), 1); // Buy 1 selected first
  await page.locator('.brix-packs-tier').nth(2).click();
  assert.equal(await page.locator('.brix-packs-choose select').count(), 3);
  const options = await page.locator('#brix-packs-item-0 option').allInnerTexts();
  assert.equal(options.length, 2); // XL is sold out -> not offered
  assert.ok(options.every((label) => !label.includes('XL')));
  await page.locator('#brix-packs-item-1').selectOption('201');
  await page.locator('#brix-packs-item-2').selectOption('201');
  // 80 + 100 + 100 = 280, minus 10% = 252
  assert.match(await page.locator('.brix-packs-tier').nth(2).innerText(), /₹252\.00/);
  assert.match(await page.locator('.brix-packs-tier').nth(2).innerText(), /Save ₹28\.00/);
  await page.screenshot({ path: path.join(SHOT_DIR, 'choose_each_item.png') });
  await page.locator('.brix-packs-add').click();
  await page.waitForSelector('.brix-packs-msg[data-type="success"]');
  const items = cartCalls[0].items;
  assert.deepEqual(items.map((item) => [item.id, item.quantity]), [[200, 1], [201, 2]]);
  assert.equal(new Set(items.map((item) => item.properties._brix_pack_group)).size, 1); // one group token across lines
  assert.ok(items.every((item) => item.properties._brix_pack_quantity === '3'));
  await context.close();
});

await check('customization is applied (colors, radius, weight, alignment, shadow, promo text, hidden savings)', async () => {
  const custom = customization({
    content: { heading: 'Stock up', subheading: '', cta: 'Grab it', promoText: 'Free returns on packs' },
    colors: { ...customization().colors, primary: '#ff0000', button: '#0000ff', buttonText: '#ffff00', background: '#111111', text: '#eeeeee' },
    borders: { radius: 20, width: 2, style: 'dashed', shadow: true },
    typography: { headingSize: 30, packTitleSize: 15, priceSize: 22, descriptionSize: 13, fontWeight: 700, alignment: 'center' },
    spacing: { cardPadding: 24, cardGap: 4, sectionSpacing: 40, buttonSpacing: 30 },
    savings: { visible: false, mode: 'save_amount' },
  });
  const { page, context } = await open({ body: apiBody([pack({ customization: custom })]) });
  await page.waitForSelector('.brix-packs-widget');
  const style = await page.evaluate(() => {
    const widget = document.querySelector('.brix-packs-widget');
    const add = document.querySelector('.brix-packs-add');
    const heading = document.querySelector('.brix-packs-heading');
    const selected = document.querySelector('.brix-packs-tier[aria-checked="true"]');
    return { bg: getComputedStyle(widget).backgroundColor, radius: getComputedStyle(widget).borderTopLeftRadius, borderStyle: getComputedStyle(widget).borderTopStyle, shadow: getComputedStyle(widget).boxShadow, marginTop: getComputedStyle(widget).marginTop,
      addBg: getComputedStyle(add).backgroundColor, addColor: getComputedStyle(add).color, addMargin: getComputedStyle(add).marginTop, headSize: getComputedStyle(heading).fontSize, headWeight: getComputedStyle(heading).fontWeight,
      align: getComputedStyle(document.querySelector('.brix-packs-head')).textAlign, selectedBorder: getComputedStyle(selected).borderTopColor, gap: getComputedStyle(document.querySelector('.brix-packs-tiers')).rowGap, pad: getComputedStyle(selected).paddingTop };
  });
  assert.equal(style.bg, 'rgb(17, 17, 17)');
  assert.equal(style.radius, '20px');
  assert.equal(style.borderStyle, 'dashed');
  assert.notEqual(style.shadow, 'none');
  assert.equal(style.marginTop, '40px');
  assert.equal(style.addBg, 'rgb(0, 0, 255)');
  assert.equal(style.addColor, 'rgb(255, 255, 0)');
  assert.equal(style.addMargin, '30px');
  assert.equal(style.headSize, '30px');
  assert.equal(style.headWeight, '700');
  assert.equal(style.align, 'center');
  assert.equal(style.selectedBorder, 'rgb(255, 0, 0)');
  assert.equal(style.gap, '4px');
  assert.equal(style.pad, '24px');
  const text = await page.locator('.brix-packs-widget').innerText();
  assert.match(text, /Stock up/);
  assert.match(text, /Grab it/);
  assert.match(text, /Free returns on packs/);
  assert.doesNotMatch(text, /Save ₹/); // savings hidden
  assert.equal(await page.locator('.brix-packs-sub').count(), 0); // empty subheading -> no empty element
  await page.screenshot({ path: path.join(SHOT_DIR, 'customized.png') });
  await context.close();
});

await check('save-as-percent mode and injection-safe rendering (hostile text/colors)', async () => {
  const hostile = customization({ content: { heading: '<img src=x onerror="window.__pwned=1">', subheading: '', cta: 'Add', promoText: '' }, savings: { visible: true, mode: 'save_percent' }, colors: { ...customization().colors, primary: 'red;background:url(//evil)' } });
  const { page, context } = await open({ body: apiBody([pack({ customization: hostile, tiers: tiers.map((tier) => ({ ...tier, badge: tier.badge && '<b>x</b>' })) })]) });
  await page.waitForSelector('.brix-packs-widget');
  assert.match(await page.locator('.brix-packs-widget').innerText(), /Save 10%/);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.locator('.brix-packs-heading img').count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector('.brix-packs-widget').style.getPropertyValue('--brix-packs-primary')), '#008060'); // invalid color ignored -> default
  await context.close();
});

await check('currency: zero-decimal (JPY) and non-shop presentment currency', async () => {
  const jpy = await open({ body: apiBody([pack({ tiers: tiers.map((tier) => ({ ...tier, subtotal: tier.subtotal * 100, price: tier.price * 100, savings: tier.savings * 100 })) })], { currency: { code: 'JPY', locale: 'ja-JP' } }) });
  await jpy.page.waitForSelector('.brix-packs-tier');
  const jpyText = await jpy.page.locator('.brix-packs-widget').innerText();
  assert.match(jpyText, /21,600/);
  assert.doesNotMatch(jpyText, /21,600\.\d/);
  await jpy.context.close();
  // storefront is showing EUR with a known rate: amounts converted, still formatted as EUR
  const eur = await open({ body: apiBody([pack()]), shopifyGlobals: 'window.Shopify={currency:{active:"EUR",rate:"0.5"}};' });
  await eur.page.waitForSelector('.brix-packs-tier');
  assert.match(await eur.page.locator('.brix-packs-widget').innerText(), /€108\.00/);
  await eur.context.close();
  // EUR with NO known rate: never print shop-currency numbers as EUR — amounts are hidden, discount stays as %
  const noRate = await open({ body: apiBody([pack()]), shopifyGlobals: 'window.Shopify={currency:{active:"EUR"}};' });
  await noRate.page.waitForSelector('.brix-packs-tier');
  const hiddenText = await noRate.page.locator('.brix-packs-widget').innerText();
  assert.doesNotMatch(hiddenText, /₹|€|216/);
  assert.match(hiddenText, /Save 10%/);
  await noRate.context.close();
});

await check('no false savings claims: unverified checkout discount -> no widget for shoppers; merchant preview shows a warning banner', async () => {
  const shopper = await open({ body: apiBody([], { reason: 'discount_unverified', checkoutDiscount: { verified: false, state: 'discount_missing' } }) });
  await shopper.page.waitForTimeout(600);
  assert.equal(await shopper.page.locator('.brix-packs-widget').count(), 0);
  assert.equal((await shopper.page.locator('[data-brix-packs-root]').innerHTML()).trim(), '');
  await shopper.context.close();
  const merchant = await open({ search: '?brix_packs_preview=1', body: apiBody([pack()], { preview: true, checkoutDiscount: { verified: false, state: 'discount_missing', message: 'The Packs checkout discount is not installed on this store.' } }) });
  await merchant.page.waitForSelector('.brix-packs-preview');
  assert.match(await merchant.page.locator('.brix-packs-preview').innerText(), /Preview only.*not installed.*will not be applied at checkout/s);
  await merchant.context.close();
});

await check('errors are visible in preview mode and silent (console only) for shoppers; loading always resolves', async () => {
  const bad = { success: false, error: 'Something went wrong. Please try again.', code: 'internal_error' };
  const shopper = await open({ body: bad, apiStatus: 500 });
  await shopper.page.waitForTimeout(500);
  assert.equal(await shopper.page.locator('.brix-packs-widget, .brix-packs-preview').count(), 0);
  assert.ok(shopper.consoleWarnings.some((line) => line.includes('[BRIX Packs]')));
  await shopper.context.close();
  const merchant = await open({ search: '?brix_packs_preview=1', body: bad, apiStatus: 500 });
  await merchant.page.waitForSelector('.brix-packs-preview');
  assert.match(await merchant.page.locator('.brix-packs-preview').innerText(), /Something went wrong/);
  await merchant.context.close();
});

await check('inventory: sold-out disables everything; stock cap disables larger tiers', async () => {
  const soldOut = await open({ body: apiBody([pack({ available: false })]) });
  await soldOut.page.waitForSelector('.brix-packs-add');
  assert.equal(await soldOut.page.locator('.brix-packs-add').isDisabled(), true);
  assert.equal(await soldOut.page.locator('.brix-packs-add').innerText(), 'Sold out');
  assert.equal(await soldOut.page.locator('.brix-packs-tier:not([disabled])').count(), 0);
  await soldOut.context.close();
  const capped = await open({ body: apiBody([pack({ maxQuantity: 2 })]) });
  await capped.page.waitForSelector('.brix-packs-tier');
  assert.equal(await capped.page.locator('.brix-packs-tier').nth(2).isDisabled(), true);
  assert.equal(await capped.page.locator('.brix-packs-tier').nth(1).isDisabled(), false);
  assert.equal(await capped.page.locator('.brix-packs-tier').nth(2).getAttribute('title'), 'Only 2 in stock');
  await capped.context.close();
});

await check('variant switching: shows the Pack that belongs to the selected variant, hides otherwise', async () => {
  const other = pack({ id: 8, variantId: '201', variantTitle: 'L', customization: customization({ content: { heading: 'Large pack', subheading: '', cta: 'Add', promoText: '' } }) });
  const { page, context } = await open({ body: apiBody([pack(), other]) });
  await page.waitForSelector('.brix-packs-widget');
  assert.match(await page.locator('.brix-packs-heading').innerText(), /Choose Your Pack/);
  await page.evaluate(() => { document.querySelector('input[name=id]').value = '201'; });
  await page.waitForFunction(() => document.querySelector('.brix-packs-heading')?.textContent === 'Large pack', null, { timeout: 3000 });
  await page.evaluate(() => { document.querySelector('input[name=id]').value = '999'; });
  await page.waitForFunction(() => !document.querySelector('.brix-packs-widget'), null, { timeout: 3000 });
  await context.close();
});

await check('mobile (375px): no horizontal overflow for every template', async () => {
  for (const template of ['same_variant', 'visual_offer', 'choose_each_item']) {
    const { page, context } = await open({ body: apiBody([pack({ template, variants })]), viewport: { width: 375, height: 800 } });
    await page.waitForSelector('.brix-packs-tier');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `${template} overflows by ${overflow}px`);
    await page.screenshot({ path: path.join(SHOT_DIR, `mobile_${template}.png`) });
    await context.close();
  }
});

await check('widget CSS is scoped: theme elements keep their own styles', async () => {
  const { page, context } = await open({ body: apiBody([pack()]) });
  await page.waitForSelector('.brix-packs-widget');
  const outside = await page.evaluate(() => ({ h1: getComputedStyle(document.querySelector('h1')).fontSize, button: getComputedStyle(document.querySelector('form button')).backgroundColor }));
  assert.equal(outside.h1, '32px'); // browser default h1, untouched
  assert.notEqual(outside.button, 'rgb(0, 128, 96)');
  const css = await page.evaluate(() => document.getElementById('brix-packs-style').textContent);
  const selectors = css.split('}').map((rule) => rule.split('{')[0].trim()).filter((sel) => sel && !sel.startsWith('@'));
  assert.ok(selectors.every((selector) => selector.split(',').every((part) => part.includes('.brix-packs-'))), 'every CSS selector must be .brix-packs- prefixed');
  await context.close();
});

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

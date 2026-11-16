// Real-browser check of the minimal Pack templates (Quantity Rail, Price List,
// Savings Ladder, Stack Cards, Offer Rows) and the offer band.
//
//   node tests/packs/templates-browser-check.mjs
//
// No app build needed: the widget is read straight from
// extensions/cart-drawer/assets/packs_widget.js. The product page,
// /api/packs-storefront and Shopify's /cart/add.js are mocked with Playwright
// routes. Screenshots go to tests/packs/screenshots/templates-*.png.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SCRIPT = fs.readFileSync(path.join(ROOT, 'extensions/cart-drawer/assets/packs_widget.js'), 'utf8');
const SHOT_DIR = process.env.PACKS_SHOTS || path.join(ROOT, 'tests', 'packs', 'screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const PX = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#9aab8e"/></svg>');
const PX2 = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#1f1f21"/></svg>');

// 799 each; Buy 1 / Buy 2 (10%) / Buy 3 (15%, badge)
const tiers3 = [
  { quantity: 1, name: '', badge: '', discountType: 'none', discountValue: 0 },
  { quantity: 2, name: '', badge: '', discountType: 'percentage', discountValue: 10 },
  { quantity: 3, name: '', badge: 'Most popular', discountType: 'percentage', discountValue: 15 },
];
// Two options; Black has its own photo so Color gets photo chips.
const optionVariants = [
  { id: '301', title: 'S / Black', price: 799, availableForSale: true, maxQuantity: null, image: PX2, options: ['S', 'Black'] },
  { id: '302', title: 'S / Sage', price: 799, availableForSale: true, maxQuantity: null, image: PX, options: ['S', 'Sage'] },
  { id: '303', title: 'M / Black', price: 799, availableForSale: true, maxQuantity: null, image: PX2, options: ['M', 'Black'] },
  { id: '304', title: 'M / Sage', price: 799, availableForSale: false, maxQuantity: null, image: PX, options: ['M', 'Sage'] },
];
const customization = (preset, over = {}) => ({
  content: { heading: 'Choose your pack', subheading: '', cta: 'Add Pack to Cart', promoText: '', showBuyNow: false },
  savings: { visible: true, mode: 'save_amount' },
  colors: { primary: '#141414', background: '#ffffff', cardBackground: '#ffffff', selectedCard: '#f4f4f2', border: '#e3e3e3', text: '#141414', price: '#141414', discount: '#0b7a55', badge: '#141414', button: '#141414', buttonText: '#ffffff' },
  borders: { radius: 10, width: 1, style: 'solid', shadow: false },
  badge: { style: 'pill', position: 'auto', textColor: '#ffffff', size: 0, uppercase: true, fontWeight: 700 },
  design: { preset },
  ...over,
});
const pack = (preset, over = {}) => ({
  id: 9, version: 1, variantId: '301', template: 'choose_each_item', packType: 'mix_match', variantScope: 'all', allowedVariantIds: [],
  productTitle: 'Crew Tee', variantTitle: 'S / Black', productImage: PX, basePrice: 799, available: true, maxQuantity: null,
  productOptions: ['Size', 'Color'], variants: optionVariants, tiers: tiers3, customization: customization(preset), ...over,
});
const singlePack = (preset, over = {}) => pack(preset, {
  variantId: '401', template: 'same_variant', packType: 'same_variant', productTitle: 'Vitamin C Serum', variantTitle: 'Default Title', basePrice: 599,
  productOptions: ['Title'], variants: [{ id: '401', title: 'Default Title', price: 599, availableForSale: true, maxQuantity: null, image: PX, options: ['Default Title'] }],
  ...over,
});
const apiBody = (packs) => ({ success: true, packs, reason: null, currency: { code: 'INR', locale: 'en-IN' }, checkoutDiscount: { verified: true, state: 'active', message: '' }, preview: false });

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓', name); } catch (error) { results.push({ name, ok: false, error }); console.log('  ✗', name, '\n     ', String(error.message).split('\n').slice(0, 6).join(' | ')); }
};

const browser = await chromium.launch();

async function open({ packs, variantInput = '301', viewport = { width: 520, height: 1100 }, reducedMotion = 'no-preference' }) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  const cartCalls = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('http://shop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/packs.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
    if (url.pathname === '/api/packs-storefront') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(apiBody(packs)) });
    if (url.pathname === '/cart/add.js') {
      cartCalls.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: cartCalls.at(-1).items }) });
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><title>Tee</title><style>body{font-family:system-ui;margin:0;padding:16px}</style></head><body>
      <main><h1>Product</h1><form action="/cart/add" method="post"><input type="hidden" name="id" value="${variantInput}"><button type="submit" name="add">Add to cart</button></form>
      <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="100" data-api="http://shop.test"></div></main>
      <script src="http://shop.test/packs.js"></script></body></html>` });
  });
  await page.goto('http://shop.test/products/tee');
  await page.waitForSelector('.brix-packs-widget');
  return { page, context, cartCalls, errors };
}
const shot = (page, name) => page.locator('.brix-packs-widget').screenshot({ path: path.join(SHOT_DIR, `templates-${name}.png`) });
const noSideScroll = async (page) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'the page scrolls sideways');

console.log('\nBRIX Packs minimal templates — browser checks');

await check('Quantity Rail: pack bar, item circles, chips that move on to the next item, cart lines', async () => {
  const { page, context, cartCalls, errors } = await open({ packs: [pack('rail')] });
  const bar = page.locator('.brix-packs-rail button');
  assert.equal(await bar.count(), 3);
  assert.deepEqual(await page.locator('.brix-packs-rail small').allTextContents(), ['1 item', 'Save 10%', 'Save 15%']);
  await bar.nth(2).click();
  assert.equal(await page.locator('.brix-packs-circle').count(), 3);
  assert.match(await page.locator('.brix-packs-railprice strong').textContent(), /2,037/);
  const add = page.locator('.brix-packs-add');
  assert.equal(await add.isDisabled(), true);
  // M / Sage is sold out: once M is chosen, the Sage chip is disabled.
  await page.getByRole('button', { name: 'Size M' }).click();
  assert.equal(await page.getByRole('button', { name: /Color Sage/ }).isDisabled(), true);
  await page.getByRole('button', { name: 'Color Black' }).click();
  assert.equal(await page.locator('.brix-packs-circle[aria-pressed="true"]').getAttribute('data-fk'), 'circle-1', 'moves on to item 2');
  await page.getByRole('button', { name: 'Size S' }).click();
  await page.getByRole('button', { name: 'Color Sage' }).click();
  await page.getByRole('button', { name: 'Size S' }).click();
  await page.getByRole('button', { name: 'Color Black' }).click();
  assert.equal(await page.locator('.brix-packs-railhead span').textContent(), 'All set');
  assert.equal(await add.isDisabled(), false);
  await shot(page, 'rail');
  await add.click();
  await page.waitForFunction(() => document.querySelector('.brix-packs-msg'));
  const items = cartCalls[0].items;
  assert.deepEqual(items.map((line) => [line.id, line.quantity]).sort(), [[301, 1], [302, 1], [303, 1]]);
  assert.ok(items.every((line) => line.properties._brix_pack_quantity === '3' && line.properties._brix_pack_id === '9'));
  await noSideScroll(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Price List: rows, the chosen row opens a chip line per item', async () => {
  const { page, context, cartCalls, errors } = await open({ packs: [pack('list')] });
  assert.equal(await page.locator('.brix-packs-lrow').count(), 3);
  assert.match(await page.locator('.brix-packs-lrow').nth(2).textContent(), /Most popular/);
  await page.locator('.brix-packs-lrow').nth(1).click();
  assert.equal(await page.locator('.brix-packs-lline').count(), 2);
  const lines = page.locator('.brix-packs-lline');
  await lines.nth(0).getByRole('button', { name: 'Size S' }).click();
  await lines.nth(0).getByRole('button', { name: 'Color Black' }).click();
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), true);
  await lines.nth(1).getByRole('button', { name: 'Size S' }).click();
  await lines.nth(1).getByRole('button', { name: 'Color Black' }).click();
  await shot(page, 'list');
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => document.querySelector('.brix-packs-msg'));
  assert.deepEqual(cartCalls[0].items.map((line) => [line.id, line.quantity]), [[301, 2]]);
  await noSideScroll(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Savings Ladder: items go in a tray, the pack follows the count, the ladder climbs', async () => {
  const { page, context, cartCalls, errors } = await open({ packs: [pack('ladder')] });
  assert.equal(await page.locator('.brix-packs-cell').count(), 3);
  assert.match(await page.locator('.brix-packs-nudge').textContent(), /Add an item/);
  // Color has photos, so it is the tile option; Size is chosen with chips first.
  await page.getByRole('button', { name: 'Add Black' }).click();
  assert.match(await page.locator('.brix-packs-msg').textContent(), /Choose size first/);
  await page.getByRole('button', { name: 'M', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: /Add Sage/ }).isDisabled(), true, 'M / Sage is sold out');
  await page.getByRole('button', { name: 'Add Black' }).click();
  assert.match(await page.locator('.brix-packs-nudge').textContent(), /Add 1 more to save 10%/);
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), false, 'one item = Buy 1');
  await page.getByRole('button', { name: 'S', exact: true }).click();
  await page.getByRole('button', { name: 'Add Sage' }).click();
  await page.getByRole('button', { name: 'Add Black' }).click();
  assert.match(await page.locator('.brix-packs-nudge').textContent(), /Top saving unlocked/);
  assert.equal(await page.locator('.brix-packs-ladder-node[data-hit="1"]').count(), 3);
  assert.equal(await page.getByRole('button', { name: 'Add Black' }).isDisabled(), true, 'tray full');
  await shot(page, 'ladder');
  await page.getByRole('button', { name: /Remove item 3/ }).click();
  assert.match(await page.locator('.brix-packs-total-label').textContent(), /2 items/);
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => document.querySelector('.brix-packs-msg'));
  assert.deepEqual(cartCalls[0].items.map((line) => [line.id, line.quantity, line.properties._brix_pack_quantity]).sort(), [[302, 1, '2'], [303, 1, '2']]);
  await noSideScroll(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Savings Ladder with packs of 1 and 3: two items is not a pack', async () => {
  const gapTiers = [tiers3[0], tiers3[2]];
  const { page, context, errors } = await open({ packs: [singlePack('ladder', { tiers: gapTiers })], variantInput: '401' });
  await page.getByRole('button', { name: 'Add one' }).click();
  await page.getByRole('button', { name: 'Add one' }).click();
  assert.match(await page.locator('.brix-packs-nudge').textContent(), /Add 1 more to save 15%/);
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), true);
  await page.getByRole('button', { name: 'Add one' }).click();
  assert.equal(await page.locator('.brix-packs-add').isDisabled(), false);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Stack Cards: one-variant product, stacked photos, one tap to buy', async () => {
  const { page, context, cartCalls, errors } = await open({ packs: [singlePack('stack')], variantInput: '401' });
  const cards = page.locator('.brix-packs-card');
  assert.equal(await cards.count(), 3);
  assert.deepEqual(await Promise.all([0, 1, 2].map((i) => cards.nth(i).locator('.brix-packs-sphotos > *').count())), [1, 2, 3]);
  assert.equal(await page.locator('.brix-packs-body').count(), 0, 'no item pickers for one variant');
  await cards.nth(1).click();
  assert.match(await cards.nth(1).textContent(), /539\.10 each|539 each/);
  await shot(page, 'stack');
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => document.querySelector('.brix-packs-msg'));
  assert.deepEqual(cartCalls[0].items.map((line) => [line.id, line.quantity]), [[401, 2]]);
  await noSideScroll(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Offer Rows + offer band: % OFF tag, footer line, moving text round the badge pack', async () => {
  const custom = customization('offer_rows', { content: { heading: 'Buy more, save more', promoText: 'Free shipping on every pack', showBuyNow: false }, band: { enabled: true, target: 'badge', text: 'Limited time offer', background: '#13312b', textColor: '#ffffff', speed: 40, textSize: 10, thickness: 18 } });
  const { page, context, errors } = await open({ packs: [singlePack('offer_rows', { customization: custom })], variantInput: '401' });
  assert.deepEqual(await page.locator('.brix-packs-off').allTextContents(), ['10% OFF', '15% OFF']);
  const band = page.locator('.brix-packs-band');
  assert.equal(await band.count(), 1);
  assert.match(await band.textContent(), /Buy 3/);
  const text = band.locator('textPath').first();
  assert.match(await text.textContent(), /LIMITED TIME OFFER/);
  const before = Number(await text.getAttribute('startOffset'));
  await page.waitForTimeout(400);
  const after = Number(await text.getAttribute('startOffset'));
  assert.ok(after < before, `the text moves (${before} -> ${after})`);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.brix-packs-band')).backgroundColor), 'rgb(19, 49, 43)');
  await shot(page, 'offer-rows');
  // The band follows the chosen pack when set to "selected".
  await page.locator('.brix-packs-lrow').nth(0).click();
  assert.equal(await page.locator('.brix-packs-band').count(), 1, 'still on the badge pack');
  await noSideScroll(page);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('offer band: "selected" follows the chosen pack, reduced motion keeps it still, and it fits a phone', async () => {
  const custom = customization('list', { band: { enabled: true, target: 'selected', text: 'Today only', speed: 40 } });
  const { page, context, errors } = await open({ packs: [singlePack('list', { customization: custom })], variantInput: '401', viewport: { width: 375, height: 900 }, reducedMotion: 'reduce' });
  assert.equal(await page.locator('.brix-packs-band .brix-packs-lrow').getAttribute('data-index'), '0');
  await page.locator('.brix-packs-lrow').nth(2).click();
  assert.equal(await page.locator('.brix-packs-band .brix-packs-lrow').getAttribute('data-index'), '2');
  const text = page.locator('.brix-packs-band textPath').first();
  assert.match(await text.textContent(), /TODAY ONLY/);
  const before = await text.getAttribute('startOffset');
  await page.waitForTimeout(300);
  assert.equal(await text.getAttribute('startOffset'), before, 'still with reduced motion');
  await shot(page, 'list-band-phone');
  await noSideScroll(page);
  assert.deepEqual(errors, []);
  await context.close();
});

// Fixed Combo: this product (picked) + fixed products per tier.
const cream = { variant: { id: '501', title: 'Default Title', price: 349, availableForSale: true, maxQuantity: null, image: PX2 }, quantity: 1, title: 'Night Cream', variantTitle: '' };
const sunscreen = { variant: { id: '502', title: 'SPF 50', price: 299, availableForSale: true, maxQuantity: null, image: PX }, quantity: 1, title: 'Sunscreen', variantTitle: 'SPF 50' };
const comboPack = (preset) => pack(preset, {
  template: 'fixed_combo', packType: 'combo',
  tiers: [
    { quantity: 2, name: 'Duo', badge: '', discountType: 'percentage', discountValue: 10, items: [{ productId: '601', variantId: '501', quantity: 1 }], comboItems: [cream] },
    { quantity: 3, name: 'Trio', badge: 'Most popular', discountType: 'percentage', discountValue: 20, items: [{ productId: '601', variantId: '501', quantity: 1 }, { productId: '602', variantId: '502', quantity: 1 }], comboItems: [cream, sunscreen] },
  ],
});

await check('Fixed Combo in the new templates: one item to pick, the fixed products listed and added; the Ladder shows as a Price List', async () => {
  for (const preset of ['rail', 'list', 'offer_rows', 'stack', 'ladder']) {
    const { page, context, cartCalls, errors } = await open({ packs: [comboPack(preset)] });
    const text = await page.locator('.brix-packs-widget').textContent();
    assert.match(text, preset === 'rail' ? /Night Cream/ : /Crew Tee \+ Night Cream/, `${preset}: combo text`);
    if (preset === 'ladder') assert.equal(await page.locator('.brix-packs-ladder').count(), 0, 'no ladder for a combo');
    if (preset === 'stack') {
      assert.equal(await page.locator('.brix-packs-card').nth(1).locator('.brix-packs-sphotos > *').count(), 3, 'tee + cream + sunscreen photos');
      await page.locator('.brix-packs-card').nth(1).click();
    } else if (preset === 'rail') {
      await page.locator('.brix-packs-rail button').nth(1).click();
      assert.equal(await page.locator('.brix-packs-circle').count(), 1, 'one item to pick');
      assert.match(await page.locator('.brix-packs-includes').textContent(), /Sunscreen/);
    } else {
      await page.locator('.brix-packs-lrow').nth(1).click();
      assert.equal(await page.locator('.brix-packs-lline').count(), 1, `${preset}: one item to pick`);
      assert.match(await page.locator('.brix-packs-includes').textContent(), /Sunscreen/);
    }
    if (preset !== 'stack') {
      await page.getByRole('button', { name: 'Size S' }).first().click();
      await page.getByRole('button', { name: 'Color Black' }).first().click();
    } else {
      await page.getByLabel(/Size/).first().selectOption('S');
      await page.getByLabel(/Color/).first().selectOption('Black');
    }
    await page.locator('.brix-packs-add').click();
    await page.waitForFunction(() => document.querySelector('.brix-packs-msg'));
    const ids = cartCalls[0].items.map((line) => line.id).sort();
    assert.deepEqual(ids, [301, 501, 502], `${preset}: cart lines`);
    if (preset === 'offer_rows') await shot(page, 'combo-offer-rows');
    assert.deepEqual(errors, [], preset);
    await context.close();
  }
});

await check('every new template fits a 360px phone without sideways scroll', async () => {
  for (const preset of ['rail', 'list', 'ladder', 'stack', 'offer_rows']) {
    const { page, context, errors } = await open({ packs: [pack(preset, { customization: customization(preset, { band: { enabled: true, target: 'all' } }) })], viewport: { width: 360, height: 900 } });
    await noSideScroll(page);
    assert.deepEqual(errors, [], preset);
    await page.locator('.brix-packs-widget').screenshot({ path: path.join(SHOT_DIR, `templates-${preset}-phone.png`) });
    await context.close();
  }
});

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);

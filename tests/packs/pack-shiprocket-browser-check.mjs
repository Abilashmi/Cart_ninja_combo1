// Shiprocket's own product Buy Now with a Pack selected (real browser, BrixCod and Shiprocket faked).
//   serve the widget on :3999 (the built app, or any static server for
//   extensions/cart-drawer/assets/packs_widget.js at /packs.js), then:
//   node tests/packs/pack-shiprocket-browser-check.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const APP = 'http://localhost:3999';
const tiers = [
  { quantity: 1, name: '', badge: '', discountType: 'none', discountValue: 0 },
  { quantity: 2, name: '', badge: '', discountType: 'fixed', discountValue: 500 },
];
const pack = { id: 7, version: 4, variantId: '200', template: 'same_variant', packType: 'same_variant', variantScope: 'selected', allowedVariantIds: ['200'], productTitle: 'Pendant', variantTitle: 'Default', basePrice: 1599, available: true, maxQuantity: null, tiers, customization: { content: { heading: 'Choose Your Pack' } } };
const body = { success: true, packs: [pack], currency: { code: 'INR', locale: 'en-IN' }, checkoutDiscount: { verified: true, state: 'active' }, preview: false };
// BrixCod loads after the widget (as on a store), so the first price has to wait for it.
const fakeCod = `setTimeout(function () { window.BrixCod = { isAvailable: function () { return Promise.resolve(true); }, open: function () {},
  setPackPrice: function (p) { window.__prices.push(p); },
  payOnlinePack: function (items, opts) { window.__paid.push(items); if (opts.onOpen) opts.onOpen(); return true; } }; }, 700);`;
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const script = await (await fetch(`${APP}/packs.js`)).text();
await page.route('http://shop.test/**', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><body><main>
  <form action="/cart/add"><input type="hidden" name="id" value="200"><button type="button">Add to cart</button></form>
  <div class="shiprocket-headless" data-type="product"><button class="sr-headless-checkout" onclick="window.__sr.push('product')"><span>Prepaid</span></button></div>
  <div class="shiprocket-headless" data-type="mini-cart"><button id="mini" class="sr-headless-checkout" onclick="window.__sr.push('mini')">Checkout</button></div></main>
  <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="555" data-api="${APP}"></div>
  <script>window.__sr = []; window.__paid = []; window.__prices = []; ${fakeCod}</script><script src="${APP}/packs.js"></script></body></html>` }));
await page.route(`${APP}/packs.js`, (r) => r.fulfill({ contentType: 'application/javascript', body: script }));
await page.route(`${APP}/api/packs-storefront**`, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }));
await page.goto('http://shop.test/products/pendant');
await page.waitForSelector('.brix-packs-widget');
const state = () => page.evaluate(() => ({ sr: window.__sr.splice(0), paid: window.__paid.splice(0), prices: window.__prices.splice(0) }));
const tap = async (sel = '.shiprocket-headless[data-type=product] span') => { await page.locator(sel).click(); await page.waitForTimeout(200); };

// Buy 1 (no saving): Shiprocket's own handler, as before.
await page.waitForFunction(() => window.BrixCod);
await tap();
let s = await state();
assert.deepEqual(s.sr, ['product']);
assert.equal(s.paid.length, 0);
console.log('✓ Buy 1: Shiprocket handles its own Buy Now');

// Buy 2: the tap is BRIX's, with the Pack's items and properties; the label price follows.
await page.locator('[role="radio"]').nth(1).click();
await page.waitForFunction(() => window.__prices.length > 0);
await tap();
s = await state();
assert.deepEqual(s.sr, [], "Shiprocket's own handler never ran");
assert.equal(s.paid.length, 1);
assert.equal(s.paid[0][0].variantId, 200);
assert.equal(s.paid[0][0].quantity, 2);
assert.equal(s.paid[0][0].properties._brix_pack_id, '7');
assert.equal(s.prices.at(-1), 2698);
console.log('✓ Buy 2: BRIX opens Shiprocket with the Pack (2 items, Pack properties), label price ₹2,698');

// The cart drawer's Shiprocket checkout is never taken over.
await tap('#mini');
s = await state();
assert.deepEqual(s.sr, ['mini']);
assert.equal(s.paid.length, 0);
console.log('✓ cart drawer Shiprocket checkout untouched');

// Back to Buy 1: Shiprocket's own again, price handed back (null).
await page.locator('[role="radio"]').nth(0).click();
await page.waitForTimeout(200);
await tap();
s = await state();
assert.deepEqual(s.sr, ['product']);
assert.equal(s.prices.at(-1), null);
console.log('✓ back to Buy 1: Shiprocket\'s own Buy Now and label again');
await browser.close();

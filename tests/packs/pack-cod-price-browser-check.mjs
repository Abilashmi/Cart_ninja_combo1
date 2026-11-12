// Pack COD button price + hiding BRIX COD's own product-page button (real browser, BrixCod faked).
//   serve the widget on :3999 (the built app, or any static server for
//   extensions/cart-drawer/assets/packs_widget.js at /packs.js), then:
//   node tests/packs/pack-cod-price-browser-check.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const APP = 'http://localhost:3999';
const tiers = [
  { quantity: 1, name: '', badge: '', discountType: 'none', discountValue: 0 },
  { quantity: 2, name: '', badge: '', discountType: 'fixed', discountValue: 500 },
  { quantity: 3, name: '', badge: '', discountType: 'fixed', discountValue: 1000 },
];
const custom = (content) => ({ content: { heading: 'Choose Your Pack', showCod: true, ...content } });
const pack = (content = {}) => ({ id: 7, version: 4, variantId: '200', template: 'same_variant', packType: 'same_variant', variantScope: 'selected', allowedVariantIds: ['200'], productTitle: 'Pendant', variantTitle: 'Default', basePrice: 1599, available: true, maxQuantity: null, tiers, customization: custom(content) });
const body = (p) => ({ success: true, packs: [p], currency: { code: 'INR', locale: 'en-IN' }, checkoutDiscount: { verified: true, state: 'active' }, preview: false });
const fakeCod = `window.BrixCod = { isAvailable: function () { return Promise.resolve(true); }, open: function () {},
  priceTagValues: function (cart, total) { window.__seen = cart; return { price: total, cod_fee: 100, cod_price: Math.round((total + 100) * 100) / 100, ready: true }; } };`;
const browser = await chromium.launch();
async function open(p, { noCod = false } = {}) {
  const page = await (await browser.newContext()).newPage();
  const script = await (await fetch(`${APP}/packs.js`)).text();
  await page.route('http://shop.test/**', (r) => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><body><main>
    <form action="/cart/add"><input type="hidden" name="id" value="200"><button>Add to cart</button>
    <div data-brix-cod-slot="auto" style="display:block !important;width:100%"><button id="reg">Buy with COD ₹1,699</button></div></form></main>
    <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="555" data-api="${APP}"></div>
    <script>${noCod ? '' : fakeCod}</script><script src="${APP}/packs.js"></script></body></html>` }));
  await page.route(`${APP}/packs.js`, (r) => r.fulfill({ contentType: 'application/javascript', body: script }));
  await page.route(`${APP}/api/packs-storefront**`, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body(p)) }));
  await page.goto('http://shop.test/products/pendant');
  await page.waitForSelector('.brix-packs-widget');
  return page;
}
const codText = (page) => page.locator('.brix-packs-cod').innerText();
const slotShown = (page) => page.evaluate(() => getComputedStyle(document.querySelector('[data-brix-cod-slot]')).display !== 'none');

let page = await open(pack());
await page.waitForSelector('.brix-packs-cod');
await page.waitForFunction(() => /₹/.test(document.querySelector('.brix-packs-cod').textContent));
assert.equal(await codText(page), 'Buy with COD ₹1,699');
const radios = page.locator('[role="radio"]');
await radios.nth(1).click();
assert.equal(await codText(page), 'Buy with COD ₹2,798');
await radios.nth(2).click();
assert.equal(await codText(page), 'Buy with COD ₹3,897');
assert.equal((await page.evaluate(() => window.__seen)).items[0].product_id, '555');
assert.equal(await slotShown(page), false, 'regular COD button hidden');
// brix_cod.js mounting its button again (theme redraw): the new holder is hidden too
await page.evaluate(() => { const old = document.querySelector('[data-brix-cod-slot]'); const n = old.cloneNode(true); n.removeAttribute('data-brix-pack-hid'); n.style.cssText = 'display:block !important;width:100%'; old.replaceWith(n); });
await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-brix-cod-slot]')).display === 'none');
console.log('✓ price follows the Pack (1,699 / 2,798 / 3,897), regular COD hidden, stays hidden after a remount');

page = await open(pack({ codText: 'COD {cod_price} (fee {cod_fee})' }));
await page.waitForFunction(() => /₹/.test(document.querySelector('.brix-packs-cod')?.textContent || ''));
await page.locator('[role="radio"]').nth(1).click();
assert.equal(await codText(page), 'COD ₹2,798 (fee ₹100)');
console.log('✓ merchant price tags filled');

page = await open(pack({ showCod: false }));
await page.waitForTimeout(800);
assert.equal(await page.locator('.brix-packs-cod').count(), 0);
assert.equal(await slotShown(page), true, 'regular COD stays when the Pack COD is off');
console.log('✓ Pack COD off: regular COD button untouched');
await browser.close();

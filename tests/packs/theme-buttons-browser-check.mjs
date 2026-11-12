// Real-browser check of "Use existing theme buttons" in the BRIX Packs widget.
//   node tests/packs/theme-buttons-browser-check.mjs
// Loads extensions/cart-drawer/assets/packs_widget.js straight from disk; the storefront page,
// /api/packs-storefront and /cart/add.js are mocked. Pages imitate a Dawn-style theme (button
// styled by CSS scoped to its product form), a plain Debut-style one, and a theme with no button.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync('extensions/cart-drawer/assets/packs_widget.js', 'utf8');
const API = 'http://api.test';
const tiers = [
  { quantity: 1, name: '', badge: '', discountType: 'none', discountValue: 0, subtotal: 80, discountAmount: 0, price: 80, savings: 0, effectiveUnitPrice: 80 },
  { quantity: 2, name: '', badge: '', discountType: 'percentage', discountValue: 5, subtotal: 160, discountAmount: 8, price: 152, savings: 8, effectiveUnitPrice: 76 },
];
const colors = { primary: '#008060', background: '#ffffff', cardBackground: '#ffffff', selectedCard: '#e6f4f1', border: '#dfe3e8', text: '#202223', price: '#202223', discount: '#008060', badge: '#fff4d6', button: '#008060', buttonText: '#ffffff' };
const pack = (content = {}) => ({
  id: 7, version: 4, variantId: '200', template: 'same_variant', packType: 'same_variant', variantScope: 'selected', allowedVariantIds: ['200'], productTitle: 'Tee', variantTitle: 'M',
  productImage: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=', basePrice: 80, available: true, maxQuantity: null, tiers,
  customization: { content: { heading: 'Choose Your Pack', cta: 'Add Pack to Cart', buyNow: 'Buy Now', ...content }, colors, images: { enabled: false } },
  variants: [{ id: '200', title: 'M', price: 80, availableForSale: true, maxQuantity: null }],
});
const body = (p) => ({ success: true, packs: [p], currency: { code: 'INR', locale: 'en-IN' }, checkoutDiscount: { verified: true, state: 'active' }, preview: false });

const THEMES = {
  dawn: `<style>.product-form .button.product-form__submit{background:rgb(17,17,17);color:rgb(255,255,255);border:2px solid rgb(17,17,17);border-radius:30px;font-size:17px;font-weight:700;text-transform:uppercase;padding:14px 20px}
    .product-form .shopify-payment-button__button--unbranded{background:rgb(255,255,255);color:rgb(17,17,17);border:2px solid rgb(17,17,17);border-radius:30px;font-size:17px}</style>
    <product-form class="product-form"><form id="pf" action="/cart/add" method="post"><input type="hidden" name="id" value="200">
    <button type="submit" name="add" class="button product-form__submit"><span>Add to cart</span></button>
    <div class="shopify-payment-button" data-shopify="payment-button"><button class="shopify-payment-button__button shopify-payment-button__button--unbranded">Buy it now</button></div></form></product-form>`,
  debut: `<form action="/cart/add" method="post"><input type="hidden" name="id" value="200"><button>Add to cart</button></form>`,
  wallet: `<form action="/cart/add" method="post"><input type="hidden" name="id" value="200"><button type="submit" name="add">Add to cart</button>
    <div class="shopify-payment-button"><button class="shopify-payment-button__button shopify-payment-button__button--branded">Shop Pay</button></div></form>`,
  nobutton: `<form action="/cart/add" method="post"><input type="hidden" name="id" value="200"><input type="number" name="quantity"></form>`,
};

const browser = await chromium.launch();
async function open(theme, content) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await context.newPage();
  const cartCalls = [];
  const themeSubmits = [];
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await page.route('http://shop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/cart/add.js') {
      cartCalls.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: cartCalls.at(-1).items }) });
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><main>${THEMES[theme]}</main>
      <div data-brix-packs-root data-shop="demo.myshopify.com" data-product-id="100" data-api="${API}"></div>
      <script>document.addEventListener('submit',e=>{window.__themeSubmits=(window.__themeSubmits||0)+1;e.preventDefault()});</script>
      <script src="${API}/packs.js"></script></body></html>` });
  });
  await page.route(`${API}/packs.js`, (r) => r.fulfill({ contentType: 'application/javascript', body: script }));
  await page.route(`${API}/api/packs-storefront**`, (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body(pack(content))) }));
  await page.goto('http://shop.test/products/tee');
  await page.waitForSelector('.brix-packs-widget');
  return { page, context, cartCalls, themeSubmits, warnings };
}

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (e) { results.push(false); console.log('  ✗', name, '\n     ', String(e.message).split('\n')[0]); }
};
const look = (page, sel) => page.evaluate((s) => { const c = getComputedStyle(document.querySelector(s)); return [c.backgroundColor, c.color, c.borderTopLeftRadius, c.fontSize, c.fontWeight, c.textTransform, c.borderTopWidth].join('|'); }, sel);

console.log('\nBRIX Packs — theme buttons');

await check('theme mode (Dawn-style): Add + Buy Now are theme shells with the theme look, no BRIX buttons, originals hidden', async () => {
  const { page, context } = await open('dawn', { buttonMode: 'theme' });
  assert.equal(await page.locator('.brix-packs-themebtn--add').count(), 1);
  assert.equal(await page.locator('.brix-packs-themebtn--buy').count(), 1);
  assert.equal(await page.locator('.brix-packs-add, .brix-packs-buy').count(), 0);
  assert.equal((await page.locator('.brix-packs-themebtn--add').textContent()).trim(), 'Add to cart');
  assert.equal((await page.locator('.brix-packs-themebtn--buy').textContent()).trim(), 'Buy it now');
  assert.equal(await look(page, '.brix-packs-themebtn--add'), await look(page, 'button[name="add"]'));
  assert.equal(await look(page, '.brix-packs-themebtn--buy'), await look(page, '.shopify-payment-button__button--unbranded'));
  assert.equal(await page.locator('button[name="add"]').isVisible(), false);
  assert.equal(await page.locator('[data-brix-packs-root] [data-brix-theme-buttons="theme"]').count() + await page.locator('.brix-packs-widget[data-brix-theme-buttons="theme"]').count() > 0, true);
  await context.close();
});

await check('theme Add adds the whole pack once (real variant, tier quantity, pack markers) and the theme form does not also submit', async () => {
  const { page, context, cartCalls } = await open('dawn', { buttonMode: 'theme' });
  await page.waitForSelector('[role="radio"]');
  await page.locator('[role="radio"]').nth(1).click({ timeout: 10000 });
  let added = null;
  await page.exposeFunction('seen', (d) => { added = d; });
  await page.evaluate(() => document.addEventListener('brix:packs:added', (e) => window.seen(e.detail)));
  await page.locator('.brix-packs-themebtn--add').click();
  await page.waitForFunction(() => document.querySelector('.brix-packs-msg'));
  assert.equal(cartCalls.length, 1);
  assert.equal(cartCalls[0].items[0].id, 200);
  assert.equal(cartCalls[0].items[0].quantity, 2);
  assert.equal(cartCalls[0].items[0].properties._brix_pack_id, '7');
  assert.equal(added.quantity, 2);
  assert.equal(await page.evaluate(() => window.__themeSubmits || 0), 0);
  assert.match(await page.locator('.brix-packs-msg').innerText(), /Added to your cart/);
  await context.close();
});

await check('theme Buy it now is a wallet (branded) -> BRIX Buy Now used, Add still theme', async () => {
  const { page, context, warnings } = await open('wallet', { buttonMode: 'theme' });
  assert.equal(await page.locator('.brix-packs-themebtn--add').count(), 1);
  assert.equal(await page.locator('.brix-packs-themebtn--buy').count(), 0);
  assert.equal(await page.locator('.brix-packs-buy').count(), 1);
  assert.equal(await page.locator('.brix-packs-widget').getAttribute('data-brix-theme-buttons'), 'partial');
  assert.ok(warnings.some((w) => /Buy it now/.test(w)));
  await context.close();
});

await check('merchant overrides: own text with amount tags + own colors on the theme buttons; empty = the theme', async () => {
  const { page, context } = await open('dawn', { buttonMode: 'theme', themeAddLabel: 'Add {quantity} for {price}', themeBuyLabel: 'Buy now, save {saving}', themeAddBg: '#ff0000', themeAddText: '#ffffff', themeBuyBorder: '#00ff00' });
  await page.locator('[role="radio"]').nth(1).click();
  assert.equal((await page.locator('.brix-packs-themebtn--add').textContent()).trim(), 'Add 2 for ₹152.00');
  assert.equal((await page.locator('.brix-packs-themebtn--buy').textContent()).trim(), 'Buy now, save ₹8.00');
  assert.equal(await page.locator('.brix-packs-themebtn--add').evaluate((n) => getComputedStyle(n).backgroundColor), 'rgb(255, 0, 0)');
  assert.equal(await page.locator('.brix-packs-themebtn--buy').evaluate((n) => getComputedStyle(n).borderTopColor), 'rgb(0, 255, 0)');
  // untouched fields still follow the theme
  assert.equal(await page.locator('.brix-packs-themebtn--buy').evaluate((n) => getComputedStyle(n).backgroundColor), await page.locator('.shopify-payment-button > .shopify-payment-button__button--unbranded').evaluate((n) => getComputedStyle(n).backgroundColor));
  await context.close();
});

await check('amount tags also work in BRIX mode button text', async () => {
  const { page, context } = await open('dawn', { buttonMode: 'brix', cta: 'Add · {price}' });
  assert.match(await page.locator('.brix-packs-add').textContent(), /Add · ₹80.00/);
  await context.close();
});

await check('admin preview shows the merchant button text (tags filled) and colors in theme mode', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setContent('<div id="m"></div>');
  await page.addScriptTag({ content: script });
  const p = pack({ buttonMode: 'theme', themeAddLabel: 'Add {quantity} · {price}', themeBuyLabel: 'Buy now {saving} off', themeAddBg: '#ff0000' });
  await page.evaluate((pk) => window.BrixPacksWidget.mount(document.getElementById('m'), { pack: pk, currency: { code: 'INR', locale: 'en-IN' }, checkoutDiscount: null }), p);
  assert.match(await page.locator('.brix-packs-add').textContent(), /Add 1 · ₹80.00/);
  assert.match(await page.locator('.brix-packs-buy').textContent(), /Buy now ₹0.00 off/);
  assert.equal(await page.locator('.brix-packs-add').evaluate((n) => getComputedStyle(n).backgroundColor), 'rgb(255, 0, 0)');
  await context.close();
});

await check('no theme button found -> BRIX Add button + warning, still functional', async () => {
  const { page, context, warnings, cartCalls } = await open('nobutton', { buttonMode: 'theme', showBuyNow: false });
  assert.equal(await page.locator('.brix-packs-themebtn').count(), 0);
  assert.equal(await page.locator('.brix-packs-add').count(), 1);
  assert.equal(await page.locator('.brix-packs-widget').getAttribute('data-brix-theme-buttons'), 'fallback');
  assert.ok(warnings.some((w) => /Add to cart/.test(w)));
  await page.locator('.brix-packs-add').click();
  await page.waitForFunction(() => document.querySelector('.brix-packs-msg'));
  assert.equal(cartCalls.length, 1);
  await context.close();
});

await check('Debut-style button with no type/name is detected', async () => {
  const { page, context } = await open('debut', { buttonMode: 'theme', showBuyNow: false });
  assert.equal(await page.locator('.brix-packs-themebtn--add').count(), 1);
  assert.equal(await page.locator('.brix-packs-add').count(), 0);
  await context.close();
});

await check('BRIX mode and legacy Packs (no buttonMode) keep BRIX buttons', async () => {
  for (const content of [{ buttonMode: 'brix' }, {}]) {
    const { page, context } = await open('dawn', content);
    assert.equal(await page.locator('.brix-packs-themebtn').count(), 0);
    assert.equal(await page.locator('.brix-packs-add').count(), 1);
    await context.close();
  }
});

await check('each button can be switched off independently in theme mode', async () => {
  let r = await open('dawn', { buttonMode: 'theme', showBuyNow: false });
  assert.equal(await r.page.locator('.brix-packs-themebtn--buy, .brix-packs-buy').count(), 0);
  assert.equal(await r.page.locator('.brix-packs-themebtn--add').count(), 1);
  await r.context.close();
  r = await open('dawn', { buttonMode: 'theme', showAddToCart: false });
  assert.equal(await r.page.locator('.brix-packs-themebtn--add, .brix-packs-add').count(), 0);
  assert.equal(await r.page.locator('.brix-packs-themebtn--buy').count(), 1);
  await r.context.close();
});

await check('mobile width: theme buttons stay inside the widget', async () => {
  const { page, context } = await open('dawn', { buttonMode: 'theme' });
  await page.setViewportSize({ width: 360, height: 800 });
  const fits = await page.evaluate(() => { const w = document.querySelector('.brix-packs-widget').getBoundingClientRect(); return [...document.querySelectorAll('.brix-packs-themebtn')].every((b) => { const r = b.getBoundingClientRect(); return r.left >= w.left - 1 && r.right <= w.right + 1; }); });
  assert.ok(fits);
  await context.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

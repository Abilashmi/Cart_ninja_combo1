/* eslint-env node */
// Browser check for the storefront COD sheet (extensions/cart-drawer/assets/brix_cod.js).
// Run with: node tests/cod/sheet-browser-check.mjs
// Loads the real script into a blank page with every network call mocked
// (no store, no BRIX server), then walks the cart drawer, product page and
// combo flows end to end, including OTP, a blocked PIN code and the order.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cod.js'), 'utf8');
const API = 'https://api.test';
const config = {
  success: true, enabled: true, surfaces: { drawer: true, product: true, combo: true }, otpRequired: true,
  minOrder: 299, maxOrder: 5000, codFee: 49, shippingFee: 0, freeShippingAbove: 0, blockedPincodes: ['744101'],
  excludedProductTags: ['no-cod'], allowCoupons: true, prepaidNudgeText: 'Pay online and get 5% off with code PREPAID5.',
  buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with Cash on Delivery', bg: '#0d6b4c', color: '#ffffff' }, currency: 'INR',
};
const quote = {
  currency: 'INR', lines: [{ title: 'Cold Brew Kit', variantTitle: 'Hazelnut', quantity: 1, image: null, originalTotal: 899, total: 899 }],
  itemsTotal: 899, subtotal: 899, discounts: 0, shipping: 0, codFee: 49, tax: 0, taxesIncluded: true, total: 948, coupon: null,
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
const posted = [];
let cartCleared = false;

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
  const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
  if (url.origin === 'https://shop.test' && url.pathname === '/') {
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><main>
      <form action="/cart/add" id="product-form"><input type="hidden" name="id" value="11"><input name="quantity" value="2"><input name="properties[Engraving]" value="AR"><button type="submit" name="add">Add to cart</button></form>
      </main><script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};window.ShopifyAnalytics={meta:{page:{pageType:'product'}}};</script>
      <script src="https://cdn.test/brix_cod.js" data-api="${API}" data-shop="demo.myshopify.com"></script></body></html>` });
  }
  if (url.href === 'https://cdn.test/brix_cod.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
  if (url.pathname === '/products/undefined.js' || url.pathname.startsWith('/products/')) return json({ tags: ['coffee'] });
  if (url.pathname === '/cart.js') return json({ items: [{ variant_id: 11, quantity: 1, properties: {}, final_line_price: 89900 }] });
  if (url.pathname === '/cart/clear.js') { cartCleared = true; return json({ items: [] }); }
  if (url.origin !== API) return route.fulfill({ status: 404, body: '' });
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } });
  if (body) posted.push({ path: url.pathname, body });
  if (url.pathname === '/api/cod/config') return json(config);
  if (url.pathname === '/api/cod/pincode') {
    const pin = url.searchParams.get('pin');
    return json({ success: true, pincode: pin, found: pin === '560001', city: 'Bangalore', state: 'Karnataka', blocked: false });
  }
  if (url.pathname === '/api/cod/otp') {
    if (body.step === 'send') return json({ success: true, resendAfter: 30 });
    return body.code === '1234' ? json({ success: true, token: 'tok' }) : json({ success: false, code: 'otp_wrong', error: "That code doesn't match. 4 tries left." }, 400);
  }
  if (url.pathname === '/api/cod/quote') return json({ success: true, quote });
  if (url.pathname === '/api/cod/order') return json({ success: true, order: { orderName: '#1047', total: 948, currency: 'INR', statusPageUrl: 'https://shop.test/status' } });
  return json({ success: false, error: 'unmocked' }, 404);
});

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('https://shop.test/');
await page.waitForFunction(() => window.BrixCod);

// Product page button
const productBtn = page.locator('[data-brix-cod-slot] [data-brix-cod-btn]');
await productBtn.waitFor({ timeout: 5000 });
check('product page: button injected under Add to cart', (await productBtn.textContent()).includes('Buy with Cash on Delivery'));
check('product page: fee shown on the button', (await productBtn.textContent()).includes('49'));

// Drawer button rendering rules
await page.evaluate(() => {
  const slot = document.createElement('div'); slot.id = 'drawer-slot'; document.body.appendChild(slot);
  window.BrixCod.mountDrawerButton(slot, { cart: { items: [{ variant_id: 11, quantity: 1, final_line_price: 19900, properties: {} }] }, onPayOnline: () => { window.__paidOnline = true; } });
});
const drawerBtn = page.locator('#drawer-slot [data-brix-cod-btn]');
check('drawer: disabled below the minimum, with the reason', await drawerBtn.isDisabled() && (await drawerBtn.textContent()).includes('299'));
await page.evaluate(() => window.BrixCod.mountDrawerButton(document.getElementById('drawer-slot'), { cart: { items: [{ variant_id: 11, quantity: 1, final_line_price: 89900, properties: { _brix_pack_id: '3' } }] } }));
check('drawer: disabled for Pack carts', await drawerBtn.isDisabled() && (await drawerBtn.textContent()).includes('Packs'));
await page.evaluate(() => window.BrixCod.mountDrawerButton(document.getElementById('drawer-slot'), { cart: { items: [{ variant_id: 11, quantity: 1, final_line_price: 89900, properties: {} }] }, onPayOnline: () => { window.__paidOnline = true; }, onSuccess: (o) => { window.__success = o.orderName; } }));
check('drawer: enabled for an eligible cart', !(await drawerBtn.isDisabled()));

// Full drawer flow
await drawerBtn.click();
const sheet = page.locator('[data-brix-cod-sheet]');
const inSheet = (sel) => sheet.locator(sel);
await inSheet('#cod-phone').waitFor();
check('flow: starts on the phone step when OTP is on', true);
await inSheet('#cod-phone').fill('98765 43210');
await inSheet('button[type="submit"]').click();
await inSheet('#cod-otp').waitFor();
check('flow: OTP step shows the number', (await inSheet('.bd').textContent()).includes('9876543210'));
await inSheet('#cod-otp').fill('0000');
await inSheet('[data-err] .n.er').waitFor();
check('flow: wrong code shows the server message', (await inSheet('[data-err]').textContent()).includes("doesn't match"));
await inSheet('#cod-otp').fill('1234');
await inSheet('#cod-name').waitFor();
check('flow: correct code moves to the address step, phone marked verified', (await inSheet('.bd').textContent()).includes('Phone verified'));

await inSheet('#cod-name').fill('Ananya Rao');
await inSheet('#cod-a1').fill('14, 3rd Cross, Indiranagar');
await inSheet('#cod-pin').fill('744101');
await inSheet('[data-pin] .n.er').waitFor();
check('flow: blocked PIN code refuses COD and offers Pay online', await inSheet('button[type="submit"]').isDisabled() && !(await inSheet('[data-alt]').isHidden()));
await inSheet('#cod-pin').fill('560001');
await page.waitForFunction(() => document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelector('#cod-city').value === 'Bangalore');
check('flow: PIN lookup fills city and state', (await inSheet('#cod-state').inputValue()) === 'Karnataka');
await inSheet('button[type="submit"]').click();
await inSheet('.tot').waitFor();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(os.tmpdir(), 'brix-cod-review.png') });
const reviewText = await inSheet('.bd').textContent();
check('review: shows COD fee, total and the prepaid message', reviewText.includes('COD fee') && reviewText.includes('948') && reviewText.includes('PREPAID5'));
await inSheet('button[type="submit"]').click();
await inSheet('.done').waitFor();
check('done: order number and amount to pay shown', (await inSheet('.done').textContent()).includes('#1047'));
await page.waitForFunction(() => window.__success === '#1047');
check('done: cart cleared and onSuccess called', cartCleared);

const orderPost = posted.filter((p) => p.path === '/api/cod/order').pop().body;
check('order request: verified token, surface, cart items and address sent', orderPost.token === 'tok' && orderPost.surface === 'drawer' && orderPost.items[0].variantId === 11 && orderPost.address.pincode === '560001' && orderPost.phone === '9876543210' && /^cod/.test(orderPost.idemKey));
await inSheet('[data-act="close"]').first().click();
await page.waitForFunction(() => !document.querySelector('[data-brix-cod-sheet]'));

// Product page flow sends the form's variant, quantity and properties; returning shoppers skip OTP + address typing
await productBtn.click();
await inSheet('#cod-name').waitFor();
check('returning shopper: verified phone and saved address reused', (await inSheet('#cod-name').inputValue()) === 'Ananya Rao');
const productQuote = posted.filter((p) => p.path === '/api/cod/quote').pop().body;
check('product page: buys the selected variant, quantity and line properties', productQuote.surface === 'product' && productQuote.items[0].variantId === '11' && productQuote.items[0].quantity === 2 && productQuote.items[0].properties.Engraving === 'AR');
await inSheet('[data-act="close"]').first().click();
await page.waitForFunction(() => !document.querySelector('[data-brix-cod-sheet]'));

// Combo: open with explicit items + Pay online fallback from an error
await page.route(`${API}/api/cod/quote`, (route) => route.fulfill({ status: 422, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ success: false, code: 'below_min', error: 'Cash on Delivery is available on orders from ₹299.' }) }));
await page.evaluate(() => window.BrixCod.open({ surface: 'combo', items: [{ variantId: 12, quantity: 1 }], coupon: 'COMBO10', onPayOnline: () => { window.__comboOnline = true; } }));
await inSheet('.n.er').waitFor();
check('combo: rule error shown before asking for any details', (await inSheet('.n.er').textContent()).includes('₹299'));
await inSheet('[data-act="online"]').click();
await page.waitForFunction(() => window.__comboOnline === true);
check('combo: Pay online hands back to the normal checkout', true);

await page.screenshot({ path: path.join(os.tmpdir(), 'brix-cod-last.png') });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

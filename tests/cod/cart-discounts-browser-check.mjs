/* eslint-env node */
// Browser check: the cart's discount codes and attributes reach COD.
// Run with: node tests/cod/cart-discounts-browser-check.mjs
// Loads the real brix_cod.js with every network call mocked. Proves the popup
// sends the codes already on the cart (cart.js discount_codes + the BRIX
// drawer's own code) and the cart attributes with every quote and the order,
// and shows each discount Shopify gave by name. Whether they apply is the
// server's call (settings.cartDiscounts, tests/cod/cod-discounts.test.mjs).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cod.js'), 'utf8');
const PHP = 'https://php.test';
const config = {
  success: true, enabled: true, surfaces: { drawer: true, product: true, combo: true }, otpRequired: false,
  minOrder: 0, maxOrder: 0, codFee: 0, codFeeLabel: 'COD fee', showCodFee: true, shippingFee: 0, freeShippingAbove: 0, blockedPincodes: [],
  excludedProductTags: [], allowCoupons: false, buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with COD', bg: '#0d6b4c', color: '#ffffff' },
};
const quote = {
  currency: 'INR', lines: [{ title: 'Kurta', variantTitle: '', quantity: 2, image: null, originalTotal: 2000, total: 1700, unitPrice: 850, variantId: '11', productId: '1', sku: null }],
  itemsTotal: 2000, subtotal: 1700, discounts: 300, shipping: 0, codFee: 0, tax: 0, taxesIncluded: true, total: 1700, coupon: null,
  discountList: [{ title: 'Buy 2, save 100', code: null, automatic: true, amount: 100 }, { title: 'KO10', code: 'KO10', automatic: false, amount: 200 }],
  cartCodes: [{ code: 'KO10', applied: true }, { code: 'OLDCODE', applied: false }],
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
const posted = [];
page.on('pageerror', (e) => check('no page errors', false, e.message));
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url());
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
  const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
  if (url.origin === 'https://shop.test' && url.pathname === '/') {
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><main></main>
      <script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};</script>
      <script src="https://cdn.test/brix_cod.js" data-php="${PHP}" data-shop="demo.myshopify.com" data-currency="INR"></script></body></html>` });
  }
  if (url.href === 'https://cdn.test/brix_cod.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
  // The cart has a code from an app (applicable), one Shopify says no longer applies, and attributes.
  if (url.pathname === '/cart.js') {
    return json({
      items: [{ variant_id: 11, quantity: 2, properties: {}, final_line_price: 170000 }],
      discount_codes: [{ code: 'KO10', applicable: true }, { code: 'DEAD', applicable: false }],
      attributes: { gift_note: 'For Amma', 'app-ref': 'abc' },
    });
  }
  if (url.pathname.startsWith('/products/')) return json({ tags: [] });
  if (url.origin === PHP && url.pathname === '/cod_storefront.php') {
    if (url.searchParams.get('action') === 'config') return json(config);
    return json({ success: true, pincode: url.searchParams.get('pin'), found: true, city: 'Bangalore', state: 'Karnataka', blocked: false });
  }
  if (url.origin === PHP && url.pathname === '/cod_checkout.php') {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
    posted.push(body);
    if (body.endpoint === 'quote') return json({ success: true, quote });
    if (body.endpoint === 'order') return json({ success: true, order: { orderName: '#2001', orderId: 'gid://shopify/Order/2001', total: 1700, currency: 'INR' } });
  }
  return route.fulfill({ status: 404, body: '' });
});

await page.goto('https://shop.test/');
await page.waitForFunction(() => window.BrixCod);
await page.evaluate(() => {
  const slot = document.createElement('div'); slot.id = 'slot'; document.body.appendChild(slot);
  // BRIX drawer with its own coupon-slider code applied.
  window.BrixCod.mountDrawerButton(slot, { cart: { items: [{ variant_id: 11, quantity: 2, final_line_price: 170000, properties: {} }] }, coupon: 'SLIDER5' });
});
await page.locator('#slot [data-brix-cod-btn]').click();
const sheet = page.locator('[data-brix-cod-sheet]');
const inSheet = (sel) => sheet.locator(sel);
// OTP is off, so phone and address are one step.
await inSheet('#cod-phone2').waitFor();

const firstQuote = posted.find((p) => p.endpoint === 'quote');
check('quote carries the cart\'s applicable codes + the drawer code, not the dead one', JSON.stringify(firstQuote?.cartCodes) === JSON.stringify(['KO10', 'SLIDER5']), JSON.stringify(firstQuote?.cartCodes));
check('quote carries the cart attributes', firstQuote?.cartAttributes?.gift_note === 'For Amma');
check('the drawer code is not sent as a popup coupon (Coupons is off)', !firstQuote?.coupon);

await inSheet('#cod-phone2').fill('98765 43210');
await inSheet('#cod-name').fill('Ananya Rao');
await inSheet('#cod-a1').fill('14, 3rd Cross, Indiranagar');
await inSheet('#cod-pin').fill('560001');
await page.waitForTimeout(400);
await inSheet('button[type="submit"]').click();
await inSheet('.tot').waitFor();
const rows = (await inSheet('.rows').textContent()).replace(/\s+/g, ' ');
check('review names each discount', rows.includes('Buy 2, save 100') && rows.includes('KO10') && rows.includes('200'), rows);
check('review says which cart code did not apply', rows.includes("OLDCODE doesn't apply to this order"), rows);
await page.screenshot({ path: path.join(os.tmpdir(), 'brix-cod-cart-discounts.png') });

await inSheet('[data-act="place"], button:has-text("Place")').first().click();
await page.waitForTimeout(500);
const order = posted.find((p) => p.endpoint === 'order');
check('order carries the same cart codes and attributes', JSON.stringify(order?.cartCodes) === JSON.stringify(['KO10', 'SLIDER5']) && order?.cartAttributes?.['app-ref'] === 'abc', JSON.stringify(order && { codes: order.cartCodes, attrs: order.cartAttributes }));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

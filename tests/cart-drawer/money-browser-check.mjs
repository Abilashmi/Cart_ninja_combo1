// Real-browser check: the storefront cart drawer (assets/cart_drawer_inline.js)
// shows money exactly as Shopify charges it — $45.90 stays $45.90, never $46.
//
//   node tests/cart-drawer/money-browser-check.mjs
//
// The drawer config (PHP backend) and Shopify's /cart.js are mocked, so no
// store or database is involved.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const script = fs.readFileSync(path.join(process.cwd(), 'extensions', 'cart-drawer', 'assets', 'cart_drawer_inline.js'), 'utf8');

// 2 x 45.90 = 91.80. Shopify amounts are in cents.
const cart = (currency) => ({
  token: 't', currency, item_count: 2, total_price: 9180, original_total_price: 9180, total_discount: 0,
  items: [{ key: 'k1', id: 1, variant_id: 1, product_id: 1, product_title: 'Snowboard', title: 'Snowboard', quantity: 2, price: 4590, original_price: 4590, final_price: 4590, line_price: 9180, original_line_price: 9180, final_line_price: 9180, properties: {}, image: '', url: '/products/snowboard' }],
});

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (error) { results.push(false); console.log('  ✗', name, '\n     ', String(error.message).split('\n')[0]); }
};
const browser = await chromium.launch();

async function drawerText(currency, lang = 'en') {
  const page = await browser.newPage();
  await page.route('https://int.thebrix.io/**', (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.includes('save_cart_drawer') ? { status: 'success', data: { cartStatus: 1 } } : { status: 'success', data: [] };
    return route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  });
  await page.route('**/cartdrawer.fly.dev/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.route('http://shop.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/cart.js') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cart(currency)) });
    if (url.pathname === '/drawer.js') return route.fulfill({ contentType: 'application/javascript', body: script });
    if (url.pathname.startsWith('/products/') || url.pathname.startsWith('/recommendations')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"></head><body><a href="/cart" id="cart-link">Cart</a><div id="cc-root" data-shop="demo.myshopify.com" data-currency="${currency}"></div><script src="/drawer.js" defer></script></body></html>` });
  });
  await page.goto('http://shop.test/');
  await page.waitForTimeout(800);
  await page.locator('#cart-link').click();
  await page.waitForFunction(() => /Subtotal/.test(document.body.innerText), null, { timeout: 10000 });
  const text = await page.evaluate(() => document.body.innerText);
  await page.close();
  return text;
}

console.log('\nCart drawer — money display');

await check('USD: $45.90 each, $91.80 subtotal and total — no rounding to $46 / $92', async () => {
  const text = await drawerText('USD');
  assert.match(text, /\$45\.90/);
  assert.match(text, /\$91\.80/);
  assert.doesNotMatch(text, /\$46(?![.\d])|\$92(?![.\d])/);
});

await check('INR: ₹45.90 shown exactly too (the amount Shopify charges)', async () => {
  const text = await drawerText('INR', 'en-IN');
  assert.match(text, /₹45\.90/);
  assert.match(text, /₹91\.80/);
});

await check('JPY has no decimals, so it shows whole yen', async () => {
  const text = await drawerText('JPY', 'ja');
  assert.match(text, /¥46(?![.\d])/);
  assert.match(text, /¥92(?![.\d])/);
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

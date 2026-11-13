/* eslint-env node */
// Browser check for Partial COD in the storefront COD popup (extensions/cart-drawer/assets/brix_cod.js).
// Run with: node tests/cod/partial-cod-browser-check.mjs
// The real script in a blank product page, every network call mocked: walks
// the popup to its review step, picks Part payment and checks the hand-off to
// Shopify checkout (the cart link with the one-time code, the address filled
// in and the _brix_partial_cod attribute).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cod.js'), 'utf8');
const PHP = 'https://php.test';
const baseConfig = {
  success: true, enabled: true, surfaces: { drawer: true, product: true, combo: true }, otpRequired: false,
  minOrder: 0, maxOrder: 0, codFee: 0, showCodFee: true, shippingFee: 0, freeShippingAbove: 0, blockedPincodes: [],
  excludedProductTags: [], allowCoupons: false, prepaidNudgeText: '',
  buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with Cash on Delivery', bg: '#0d6b4c', color: '#ffffff' },
  tracking: { ga4Id: '', metaPixelId: '', metaContentId: 'shopify', dataLayer: false },
};
const quote = {
  currency: 'INR', lines: [{ title: 'Krishna Pendant', variantTitle: '', quantity: 2, image: null, originalTotal: 3198, total: 2698, unitPrice: 1349, variantId: '11', productId: '1', sku: null }],
  itemsTotal: 3198, subtotal: 2698, discounts: 0, packDiscount: 500, shipping: 0, codFee: 0, tax: 0, taxesIncluded: true, total: 2698, coupon: null,
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();

async function run({ partialCod, partialAnswer }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const posted = [];
  let checkoutUrl = null;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://shop.test' && url.pathname === '/') {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><main>
        <form action="/cart/add" id="product-form"><input type="hidden" name="id" value="11"><input name="quantity" value="2"><input name="properties[_brix_pack_id]" value="7"><button type="submit" name="add">Add to cart</button></form>
        </main><script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};window.ShopifyAnalytics={meta:{page:{pageType:'product'}}};</script>
        <script src="https://cdn.test/brix_cod.js" data-php="${PHP}" data-shop="demo.myshopify.com" data-currency="INR"></script></body></html>` });
    }
    if (url.origin === 'https://shop.test' && url.pathname.startsWith('/cart/')) { checkoutUrl = url; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Shopify checkout</title><h1>Shopify checkout</h1>' }); }
    if (url.href === 'https://cdn.test/brix_cod.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
    if (url.pathname.startsWith('/products/')) return json({ tags: [] });
    if (url.origin === PHP && url.pathname === '/cod_storefront.php') {
      if (url.searchParams.get('action') === 'config') return json({ ...baseConfig, partialCod });
      const pin = url.searchParams.get('pin');
      return json({ success: true, pincode: pin, found: true, city: 'Chennai', state: 'Tamil Nadu', blocked: false });
    }
    if (url.origin === PHP && url.pathname === '/cod_checkout.php') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } });
      posted.push(body);
      if (body.endpoint === 'quote') return json({ success: true, quote });
      if (body.endpoint === 'partial-cod') return partialAnswer.ok ? json({ success: true, ...partialAnswer.body }) : json({ success: false, ...partialAnswer.body }, 422);
      if (body.endpoint === 'order') return json({ success: true, order: { orderName: '#1047', orderId: 'gid://shopify/Order/1047', total: 2698, currency: 'INR', statusPageUrl: null } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('https://shop.test/');
  const productBtn = page.locator('[data-brix-cod-slot] [data-brix-cod-btn]');
  await productBtn.waitFor({ timeout: 5000 });
  await productBtn.click();
  const sheet = page.locator('[data-brix-cod-sheet]');
  const inSheet = (sel) => sheet.locator(sel);
  await inSheet('#cod-name').waitFor();
  await inSheet('[name="phone"]').fill('98765 43210'); // no OTP: the phone is on the address step
  await inSheet('#cod-name').fill('Asha Kumar');
  await inSheet('#cod-a1').fill('12, Temple Street, Mylapore');
  await inSheet('#cod-pin').fill('600004');
  await page.waitForFunction(() => document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelector('#cod-city').value === 'Chennai');
  await inSheet('button[type="submit"]').click();
  try { await inSheet('.tot').waitFor({ timeout: 8000 }); } catch (e) {
    console.log('DEBUG view text:', (await inSheet('.sh').textContent()).replace(/\s+/g, ' ').slice(0, 600), '| posted:', JSON.stringify(posted.map((p) => p.endpoint)));
    throw e;
  }
  await page.waitForTimeout(250);
  return { page, inSheet, posted, errors, getCheckout: () => checkoutUrl };
}

// 1) Partial COD on: two choices, COD picked first; Part payment changes the rows and the button; hands off to Shopify checkout.
{
  const { page, inSheet, posted, errors, getCheckout } = await run({
    partialCod: { mode: 'fixed', amount: 50, percent: 10, minOrder: 0, maxOrder: 0 },
    partialAnswer: { ok: true, body: { code: 'PCTESTCODE01', advance: 50, balance: 2648, total: 2698, currency: 'INR' } },
  });
  const choices = inSheet('button.pay[data-act="pay-mode"]');
  check('review: Cash on Delivery and Part payment offered as two choices', (await choices.count()) === 2);
  check('review: Cash on Delivery is picked first, button places the COD order', (await inSheet('button.pay[data-mode="cod"]').getAttribute('aria-pressed')) === 'true' && (await inSheet('button[type="submit"]').textContent()).includes('Place COD order'));
  check('review: Part payment card shows the split', (await inSheet('button.pay[data-mode="partial"]').textContent()).includes('₹50') && (await inSheet('button.pay[data-mode="partial"]').textContent()).includes('2,648'));
  await inSheet('button.pay[data-mode="partial"]').click();
  await page.waitForTimeout(150);
  const rows = await inSheet('.rows').textContent();
  check('partial: rows show Total ₹2,698, Pay now ₹50 and Pay on delivery ₹2,648 (once)', /Total\s*₹2,698/.test(rows) && /Pay now\s*₹50/.test(rows) && /Pay on delivery\s*₹2,648/.test(rows) && rows.split('Pay on delivery').length === 2, rows.replace(/\s+/g, ' ').slice(-90));
  check('partial: button reads "Pay ₹50 now" and the note explains the rest', /^Pay ₹50(\.00)? now$/.test((await inSheet('button[type="submit"]').textContent()).trim()) && /Keep ₹2,648(\.00)? ready at delivery/.test(await inSheet('.bd').textContent()));
  await page.screenshot({ path: '/tmp/brix-partial-cod-review.png' });
  await inSheet('[name="policy"]').check();
  await inSheet('button[type="submit"]').click();
  await page.waitForURL(/\/cart\//, { timeout: 5000 });
  const req = posted.find((p) => p.endpoint === 'partial-cod');
  check('partial: asks the server for the code with the items and address (no amounts)', Boolean(req) && req.items[0].variantId === '11' && req.items[0].quantity === 2 && req.items[0].properties._brix_pack_id === '7' && req.address.pincode === '600004' && !('advance' in req) && !('total' in req));
  check('partial: no COD order placed', !posted.some((p) => p.endpoint === 'order'));
  const url = getCheckout();
  const q = url ? url.searchParams : new URLSearchParams();
  check('checkout: a cart link for exactly these items', url && url.pathname === '/cart/11:2', url && url.pathname);
  check('checkout: the one-time code and the Partial COD attribute', q.get('discount') === 'PCTESTCODE01' && q.get('attributes[_brix_partial_cod]') === '50');
  check('checkout: the shopper\'s address filled in', q.get('checkout[shipping_address][first_name]') === 'Asha' && q.get('checkout[shipping_address][last_name]') === 'Kumar' && q.get('checkout[shipping_address][zip]') === '600004' && q.get('checkout[shipping_address][city]') === 'Chennai' && q.get('checkout[shipping_address][country]') === 'IN' && q.get('checkout[shipping_address][phone]') === '+919876543210');
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// 2) The server refuses (e.g. the order changed): the reason shows, the popup stays, COD still works.
{
  const { page, inSheet, errors, getCheckout } = await run({
    partialCod: { mode: 'percent', amount: 50, percent: 10, minOrder: 0, maxOrder: 0 },
    partialAnswer: { ok: false, body: { code: 'partial_unavailable', error: 'Part payment is not available for this order. Please choose Cash on Delivery or pay online.' } },
  });
  check('percent: 10% of ₹2,698 rounds up to ₹270', (await inSheet('button.pay[data-mode="partial"]').textContent()).includes('₹270'));
  await inSheet('button.pay[data-mode="partial"]').click();
  await inSheet('[name="policy"]').check();
  await inSheet('button[type="submit"]').click();
  await inSheet('[data-err] .n.er').waitFor();
  check('refused: the reason shows and the shopper stays on the review step', (await inSheet('[data-err]').textContent()).includes('Part payment is not available') && !getCheckout());
  await inSheet('button.pay[data-mode="cod"]').click();
  check('refused: switching back to Cash on Delivery offers the COD order again', (await inSheet('button[type="submit"]').textContent()).includes('Place COD order'));
  check('no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// 2b) "Only offer part payment": one Part payment card, no full COD; outside the range, normal COD.
{
  const { page, inSheet, errors, getCheckout } = await run({
    partialCod: { mode: 'fixed', amount: 400, percent: 10, minOrder: 0, maxOrder: 0, only: true },
    partialAnswer: { ok: true, body: { code: 'PCTESTCODE02', advance: 400, balance: 2298, total: 2698, currency: 'INR' } },
  });
  check('only: no Cash on Delivery choice, one Part payment card', (await inSheet('button.pay').count()) === 0 && (await inSheet('.pay').count()) === 1 && (await inSheet('.pay').textContent()).includes('Part payment') && !(await inSheet('.pay').textContent()).includes('Cash on Delivery'));
  check('only: the button pays the advance', /^Pay ₹400(\.00)? now$/.test((await inSheet('button[type="submit"]').textContent()).trim()));
  await inSheet('[name="policy"]').check();
  await inSheet('button[type="submit"]').click();
  await page.waitForURL(/\/cart\//, { timeout: 5000 });
  check('only: goes to Shopify checkout with the code', getCheckout()?.searchParams.get('discount') === 'PCTESTCODE02');
  check('only: no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}
{
  const { page, inSheet, errors } = await run({ partialCod: { mode: 'fixed', amount: 50, percent: 10, minOrder: 0, maxOrder: 2000, only: true }, partialAnswer: { ok: true, body: {} } });
  check('only, order outside the Partial COD range: normal COD', (await inSheet('button.pay').count()) === 0 && (await inSheet('button[type="submit"]').textContent()).includes('Place COD order'));
  check('only, outside the range: no page errors', errors.length === 0, errors.join('; '));
  await page.close();
}

// 3) Partial COD off, or not offered for this total: the popup is exactly as before.
for (const [name, partialCod] of [['off', null], ['order above its maximum', { mode: 'fixed', amount: 50, percent: 10, minOrder: 0, maxOrder: 2000 }]]) {
  const { page, inSheet, errors } = await run({ partialCod, partialAnswer: { ok: true, body: {} } });
  check(`${name}: one Cash on Delivery card, no choices`, (await inSheet('button.pay').count()) === 0 && (await inSheet('.pay').count()) === 1 && (await inSheet('button[type="submit"]').textContent()).includes('Place COD order'));
  check(`${name}: no page errors`, errors.length === 0, errors.join('; '));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

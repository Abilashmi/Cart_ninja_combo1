/* eslint-env node */
// Browser check: the COD popup fills in the shopper's saved address after the OTP
// (extensions/cart-drawer/assets/brix_cod.js `savedAddresses`, "use-saved"; the
// server side is app/routes/api.cod.otp.jsx + saved-addresses.server.js).
// Run with: node tests/cod/saved-address-browser-check.mjs
// The real script in a blank page, every network call mocked; cart drawer flow.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cod.js'), 'utf8');
const PHP = 'https://php.test';
const config = {
  success: true, enabled: true, surfaces: { drawer: true, product: false, combo: false }, otpRequired: true,
  minOrder: 0, maxOrder: 0, codFee: 0, showCodFee: true, shippingFee: 0, freeShippingAbove: 0, blockedPincodes: [],
  buttons: { drawerText: 'Cash on Delivery' },
};
const quote = {
  currency: 'INR', lines: [{ title: 'Kurta', variantTitle: 'M', quantity: 1, image: null, originalTotal: 999, total: 999, unitPrice: 999, variantId: '11', productId: '1' }],
  itemsTotal: 999, subtotal: 999, discounts: 0, shipping: 0, codFee: 0, tax: 0, taxesIncluded: true, total: 999, coupon: null,
};
const ASHA_NEW = { name: 'Asha Rao', address1: '5, Anna Salai', address2: '', city: 'Chennai', state: 'Tamil Nadu', pincode: '600002', email: 'asha@example.com' };
const ASHA_OLD = { name: 'Asha Rao', address1: '12, MG Road', address2: 'Flat 4B', city: 'Bengaluru', state: 'karnataka', pincode: '560001', email: '' };

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();

// One run of the drawer flow up to the address step. `addresses` = what the verify answer carries.
async function toAddressStep({ addresses, stored = null, shotName }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 860 } });
  const posted = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const raw = route.request().postData();
    const body = raw ? JSON.parse(raw) : null;
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.href === 'https://shop.test/') {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="font-family:Arial"><div id="slot"></div>
        <script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};${stored ? `localStorage.setItem('brix_cod_address_v1', ${JSON.stringify(JSON.stringify(stored))});` : ''}</script>
        <script src="https://cdn.test/brix_cod.js" data-php="${PHP}" data-shop="demo.myshopify.com" data-currency="INR"></script></body></html>` });
    }
    if (url.href === 'https://cdn.test/brix_cod.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
    if (url.pathname === '/cart.js') return json({ items: [{ variant_id: 11, quantity: 1, properties: {}, final_line_price: 99900 }] });
    if (url.pathname.startsWith('/products/')) return json({ tags: [] });
    if (url.origin === PHP && url.pathname === '/cod_storefront.php') {
      if (url.searchParams.get('action') === 'config') return json(config);
      const pin = url.searchParams.get('pin');
      const places = { 600002: ['Chennai', 'Tamil Nadu'], 560001: ['Bengaluru', 'Karnataka'] };
      return json({ success: true, pincode: pin, found: Boolean(places[pin]), city: places[pin]?.[0] || '', state: places[pin]?.[1] || '', blocked: false });
    }
    if (url.origin === PHP && url.pathname === '/cod_checkout.php') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
      posted.push(body);
      if (body.endpoint === 'otp') return body.step === 'send' ? json({ success: true, resendAfter: 30 }) : json({ success: true, token: 'tok', addresses });
      if (body.endpoint === 'quote') return json({ success: true, quote });
      if (body.endpoint === 'order') return json({ success: true, order: { orderName: '#1001', orderId: 'gid://shopify/Order/1', total: 999, currency: 'INR' } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://shop.test/');
  await page.waitForFunction(() => window.BrixCod);
  await page.evaluate(() => window.BrixCod.mountDrawerButton(document.getElementById('slot'), { cart: { items: [{ variant_id: 11, quantity: 1, final_line_price: 99900, properties: {} }] } }));
  await page.locator('#slot [data-brix-cod-btn]').click();
  const inSheet = (sel) => page.locator('[data-brix-cod-sheet]').locator(sel);
  await inSheet('#cod-phone').waitFor();
  await inSheet('#cod-phone').fill('9876543210');
  await inSheet('button[type="submit"]').click();
  await inSheet('#cod-otp').waitFor();
  await inSheet('#cod-otp').fill('1234');
  await inSheet('#cod-name').waitFor({ state: 'attached' });
  await page.waitForTimeout(450);
  if (shotName) await page.screenshot({ path: path.join(os.tmpdir(), `brix-cod-saved-${shotName}.png`) });
  return { page, inSheet, posted, errors };
}

// 1. A new browser, two saved addresses: the newest fills the "Deliver to" card, the other is offered.
{
  const { page, inSheet, posted, errors } = await toAddressStep({ addresses: [ASHA_NEW, ASHA_OLD], shotName: '1-filled' });
  const card = await inSheet('[data-card]').textContent().catch(() => '');
  check('filled: the newest saved address is the "Deliver to" card', card.includes('Asha Rao') && card.includes('5, Anna Salai') && card.includes('600002'), card);
  check('filled: the form behind the card holds it (what is submitted)', (await inSheet('#cod-a1').inputValue()) === '5, Anna Salai' && (await inSheet('#cod-state').inputValue()) === 'Tamil Nadu');
  check('filled: the button says "Deliver here"', (await inSheet('button[type="submit"]').textContent()).trim() === 'Deliver here');
  const offered = await inSheet('[data-act="use-saved"]').allTextContents();
  check('offered: the other saved address is listed to pick', offered.length === 1 && offered[0].includes('12, MG Road') && offered[0].includes('Flat 4B'), JSON.stringify(offered));
  await inSheet('[data-act="use-saved"]').click();
  await page.waitForTimeout(300);
  const card2 = await inSheet('[data-card]').textContent();
  check('pick: tapping it makes it the card', card2.includes('12, MG Road') && card2.includes('Karnataka'), card2);
  check('pick: the address it replaced is now offered instead', (await inSheet('[data-act="use-saved"]').textContent()).includes('5, Anna Salai'));
  check('pick: the state is matched to the list whatever its case ("karnataka")', (await inSheet('#cod-state').inputValue()) === 'Karnataka');
  check('pick: the email from the earlier address stays', (await inSheet('#cod-email').inputValue()) === 'asha@example.com');
  await page.screenshot({ path: path.join(os.tmpdir(), 'brix-cod-saved-2-picked.png') });
  await inSheet('button[type="submit"]').click();
  await inSheet('.tot').waitFor();
  check('review: shows the picked address', (await inSheet('.bd').textContent()).includes('12, MG Road'));
  const quoteBody = posted.filter((b) => b.endpoint === 'quote').pop();
  check('quote: priced for the picked PIN code', quoteBody?.pincode === '560001', String(quoteBody?.pincode));
  // Only the address used is remembered in this browser (as before), never the other saved ones.
  const kept = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  check('privacy: the other saved address is never written to the browser', kept.includes('12, MG Road') && !kept.includes('Anna Salai'));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// 2. No saved addresses: the empty form, as before.
{
  for (const [label, addresses] of [['no saved addresses', []], ['an older server (no `addresses` field)', undefined]]) {
    const { page, inSheet, errors } = await toAddressStep({ addresses });
    check(`${label}: the empty form opens, nothing offered`, (await inSheet('#cod-name').isVisible()) && (await inSheet('#cod-a1').inputValue()) === '' && (await inSheet('[data-act="use-saved"]').count()) === 0 && errors.length === 0);
    await page.close();
  }
}

// 3. This browser already has an address: it stays the card, the saved ones are offered.
{
  const stored = { name: 'Asha R', address1: '9, Beach Road', address2: '', city: 'Chennai', state: 'Tamil Nadu', pincode: '600002', email: '' };
  const { page, inSheet } = await toAddressStep({ addresses: [ASHA_NEW, ASHA_OLD], stored, shotName: '3-stored' });
  check('stored: the address this browser used last stays the card', (await inSheet('[data-card]').textContent()).includes('9, Beach Road'));
  check('stored: both saved addresses are offered', (await inSheet('[data-act="use-saved"]').count()) === 2);
  await page.close();
}

// 4. A saved address whose state isn't on the list: the form opens filled, state to pick.
{
  const odd = { ...ASHA_NEW, state: 'TN' };
  const { page, inSheet } = await toAddressStep({ addresses: [odd] });
  check('unknown state: the form opens with name, street and PIN filled', (await inSheet('#cod-name').isVisible()) && (await inSheet('#cod-name').inputValue()) === 'Asha Rao' && (await inSheet('#cod-pin').inputValue()) === '600002');
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

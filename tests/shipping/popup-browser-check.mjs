/* eslint-env node */
// Browser check for dynamic shipping in the storefront COD popup
// (extensions/cart-drawer/assets/brix_cod.js: delivery options on the review
// step). Run with: node tests/shipping/popup-browser-check.mjs
// The real script on a blank page, every network call mocked; the mocked
// /api/cod/quote prices delivery with the real rules engine
// (app/utils/shipping.shared.js), as cod.server.js does.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeShipping, quoteShipping, deliveryForShopper, newMethod } from '../../app/utils/shipping.shared.js';

const SCRIPT = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cod.js'), 'utf8');
const PHP = 'https://php.test';
const shot = (page, name) => page.screenshot({ path: path.join(os.tmpdir(), `brix-ship-${name}.png`) });
// Monday 26 Oct 2026, 10:00 in India.
const NOW = new Date('2026-10-26T04:30:00Z');

const config = {
  success: true, enabled: true, surfaces: { drawer: true, product: true, combo: true }, otpRequired: false,
  minOrder: 0, maxOrder: 0, codFee: 0, codFeeLabel: 'Cash on Delivery Fee', showCodFee: true, blockedPincodes: [],
  excludedProductTags: [], allowCoupons: false, prepaidNudgeText: '',
  buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with Cash on Delivery', bg: '#0d6b4c', color: '#ffffff' },
};
const SHIPPING = sanitizeShipping({
  zones: [{ id: 'metro', name: 'Metro', cities: ['Bengaluru'], states: [], pins: [] }],
  methods: [
    { ...newMethod('standard'), rate: { type: 'flat', amount: 49 }, freeAbove: 1500 },
    { ...newMethod('express', 'express'), rate: { type: 'flat', amount: 99 }, zones: ['metro'] },
    { ...newMethod('scheduled', 'scheduled'), rate: { type: 'flat', amount: 79 }, zones: ['metro'], schedule: { firstDay: 1, lastDay: 4, slots: ['10:00-13:00', '17:00-21:00'] } },
  ],
  blocked: { zones: [], states: [], cities: [], pins: ['744*'], message: 'We don’t deliver to the islands yet.' },
});
const ITEMS = 899;
const baseQuote = {
  currency: 'INR', lines: [{ title: 'Cold Brew Kit', variantTitle: '', quantity: 1, image: null, originalTotal: ITEMS, total: ITEMS, unitPrice: ITEMS, variantId: '11', productId: '1', sku: 'CBK' }],
  itemsTotal: ITEMS, subtotal: ITEMS, discounts: 0, codFee: 0, tax: 0, taxesIncluded: true, coupon: null, cartCodes: [],
};

// Quotes carry the address as pincode / city / state; orders as `address`.
function quoteFor(body, strict = false) {
  const a = body.address || body;
  const destination = a.pincode ? { pincode: a.pincode, city: a.city, state: a.state } : null;
  const s = quoteShipping(SHIPPING, {
    destination, subtotal: ITEMS, now: NOW, choice: body.delivery || {},
    lines: [{ productId: 'gid://shopify/Product/1', quantity: 1, value: ITEMS, unitGrams: 500 }],
  });
  if (s.blocked) return [422, { success: false, code: 'not_deliverable', error: s.blocked.message }];
  if (strict && s.choiceError) return [409, { success: false, code: 'delivery_changed', error: 'That delivery day or time is no longer available. Please pick another.' }];
  const price = s.selected ? s.selected.price : 0;
  return [200, { success: true, quote: { ...baseQuote, shipping: price, total: ITEMS + price, delivery: deliveryForShopper(s) } }];
}

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();
const errors = [];
const PLACES = { 560001: ['Bangalore', 'Karnataka'], 302001: ['Jaipur', 'Rajasthan'], 744101: ['Port Blair', 'Andaman and Nicobar Islands'] };

async function newShop({ refuseFirstOrder = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 390, height: 860 } });
  const posted = [];
  let refused = false;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.href === 'https://shop.test/') {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="font-family:Arial,sans-serif"><main><h1>Shop</h1></main>
        <script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};</script>
        <script src="https://cdn.test/brix_cod.js" data-php="${PHP}" data-shop="demo.myshopify.com" data-currency="INR"></script></body></html>` });
    }
    if (url.href === 'https://cdn.test/brix_cod.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
    if (url.origin === PHP && url.pathname === '/cod_storefront.php') {
      if (url.searchParams.get('action') === 'config') return json(config);
      const pin = url.searchParams.get('pin');
      const place = PLACES[pin];
      return json({ success: true, pincode: pin, found: Boolean(place), city: place ? place[0] : '', state: place ? place[1] : '', blocked: false });
    }
    if (url.origin === PHP && url.pathname === '/cod_checkout.php') {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
      posted.push({ endpoint: body.endpoint, body });
      if (body.endpoint === 'quote') { const [status, data] = quoteFor(body); return json(data, status); }
      if (body.endpoint === 'order') {
        // The cut-off passed while the shopper was deciding: the server refuses the old pick once.
        if (refuseFirstOrder && !refused) { refused = true; return json({ success: false, code: 'delivery_changed', error: 'That delivery day or time is no longer available. Please pick another.' }, 409); }
        const [status, data] = quoteFor(body, true);
        if (status !== 200) return json(data, status);
        return json({ success: true, order: { orderName: '#2001', orderId: 'gid://shopify/Order/2001', total: data.quote.total, currency: 'INR', statusPageUrl: '' } });
      }
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://shop.test/');
  await page.waitForFunction(() => window.BrixCod);
  const sheet = page.locator('[data-brix-cod-sheet]');
  return { page, posted, inSheet: (sel) => sheet.locator(sel) };
}

// Opens the popup, fills the address for `pin` and goes to the review step.
async function toReview(shop, pin) {
  const { page, inSheet } = shop;
  await page.evaluate(() => window.BrixCod.open({ surface: 'combo', items: [{ variantId: 11, quantity: 1 }], onPayOnline: () => { window.__online = true; } }));
  await inSheet('#cod-name').waitFor();
  await inSheet('#cod-phone2').fill('9876543210');
  await inSheet('#cod-name').fill('Ananya Rao');
  await inSheet('#cod-a1').fill('14, 3rd Cross, Indiranagar');
  await inSheet('#cod-pin').fill(pin);
  await page.waitForFunction((city) => document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelector('#cod-city').value === city, PLACES[pin][0]);
  await inSheet('button[type="submit"]').click();
}
const lastQuote = (shop) => shop.posted.filter((p) => p.endpoint === 'quote').pop().body;
const totalText = (shop) => shop.inSheet('.tot').textContent();

// 1. Bengaluru: three options, pick express, then a scheduled day and time, place the order.
{
  const shop = await newShop();
  const { page, inSheet } = shop;
  await toReview(shop, '560001');
  await inSheet('.dlv').waitFor();
  const q = lastQuote(shop);
  check('review quote carries the address city and state (zones by city / state)', q.pincode === '560001' && q.city === 'Bangalore' && q.state === 'Karnataka', JSON.stringify(q));
  const names = await inSheet('.dlo .cb b').allTextContents();
  check('three delivery options for a Metro address', JSON.stringify(names) === JSON.stringify(['Standard delivery', 'Express delivery', 'Scheduled delivery']), names.join(', '));
  check('Standard picked first, priced in the totals', (await inSheet('.dlo.on .cb b').textContent()) === 'Standard delivery' && (await totalText(shop)).includes('948'));
  check('Standard shows its delivery dates', (await inSheet('.dlo.on .cb span').textContent()).includes('Arrives 30 Oct – 2 Nov'));
  check('how much more for free shipping', (await inSheet('.fsh').textContent()).includes('601'));
  await page.waitForTimeout(250);
  await shot(page, '1-review');

  await inSheet('[data-act="dlv"][data-id="express"]').click();
  await page.waitForFunction(() => document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelector('.tot').textContent.includes('998'));
  check('tapping Express re-prices the order with that pick', lastQuote(shop).delivery.option === 'express' && (await inSheet('.dlo.on .cb b').textContent()) === 'Express delivery');
  // Dispatched Tuesday (1 day to pack), then 1–2 working days.
  check('Express shows its own dates, and no free shipping hint (it has no free-from amount)', (await inSheet('.dlo.on .cb span').textContent()).includes('Arrives 28–29 Oct') && (await inSheet('.fsh').count()) === 0, await inSheet('.dlo.on .cb span').textContent());

  await inSheet('[data-act="dlv"][data-id="scheduled"]').click();
  await inSheet('[data-act="dlv-date"]').first().waitFor();
  const days = await inSheet('[data-act="dlv-date"]').allTextContents();
  check('Scheduled: working days to pick, the first one chosen', days[0] === 'Tomorrow' && days.length === 4 && (await inSheet('.dt.on').first().textContent()) === 'Tomorrow', days.join(', '));
  check('Scheduled: time slots shown', JSON.stringify(await inSheet('[data-act="dlv-slot"]').allTextContents()) === JSON.stringify(['10 AM – 1 PM', '5 PM – 9 PM']));
  await inSheet('[data-act="dlv-date"]').nth(2).click();
  await page.waitForFunction(() => document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelectorAll('.dt.on')[0].getAttribute('data-date') === '2026-10-29');
  await inSheet('[data-act="dlv-slot"]').nth(1).click();
  await page.waitForFunction(() => document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelector('[data-act="dlv-slot"].on').getAttribute('data-slot') === '17:00-21:00');
  check('picking a day and a slot re-quotes with them', JSON.stringify(lastQuote(shop).delivery) === JSON.stringify({ option: 'scheduled', date: '2026-10-29', slot: '17:00-21:00' }));
  check('the total follows the pick', (await totalText(shop)).includes('978'));
  await page.waitForTimeout(250);
  await shot(page, '2-scheduled');

  await inSheet('button[type="submit"]').click();
  await inSheet('.done').waitFor();
  const order = shop.posted.find((p) => p.endpoint === 'order').body;
  check('the order carries the delivery pick', JSON.stringify(order.delivery) === JSON.stringify({ option: 'scheduled', date: '2026-10-29', slot: '17:00-21:00' }));
  check('done: the booked day and time shown', (await inSheet('.tl').textContent()).includes('Scheduled delivery · Thu, 29 Oct, 5 PM – 9 PM'), await inSheet('.tl').textContent());
  await page.close();
}

// 2. Jaipur: one option only (no radio), no Metro options.
{
  const shop = await newShop();
  await toReview(shop, '302001');
  await shop.inSheet('.dlv').waitFor();
  check('outside Metro: only Standard, shown as a plain card', (await shop.inSheet('.dlo').count()) === 1 && (await shop.inSheet('[data-act="dlv"]').count()) === 0 && (await shop.inSheet('.dlo .cb b').textContent()) === 'Standard delivery');
  await shop.page.close();
}

// 3. A blocked area: refused at review with the merchant's message, Change address and Pay online.
{
  const shop = await newShop();
  await toReview(shop, '744101');
  await shop.inSheet('.n.er').waitFor();
  check('blocked area: the merchant\'s message at review', (await shop.inSheet('.n.er').textContent()).includes('We don’t deliver to the islands yet.'));
  check('blocked area: Change address offered', (await shop.inSheet('[data-go="address"]').count()) >= 1);
  await shop.page.close();
}

// 4. The pick is gone when placing the order: back to fresh choices with the reason, then it goes through.
{
  const shop = await newShop({ refuseFirstOrder: true });
  await toReview(shop, '560001');
  await shop.inSheet('.dlv').waitFor();
  await shop.inSheet('button[type="submit"]').click();
  await shop.page.waitForFunction(() => /no longer available/.test(document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelector('[data-err]')?.textContent || ''));
  check('delivery changed: review shown again with the reason, no order yet', (await shop.inSheet('.dlv').count()) === 1 && (await shop.inSheet('.done').count()) === 0);
  await shop.inSheet('button[type="submit"]').click();
  await shop.inSheet('.done').waitFor();
  const orders = shop.posted.filter((p) => p.endpoint === 'order');
  check('delivery changed: placing again works, with a new idempotency key', orders.length === 2 && orders[0].body.idemKey !== orders[1].body.idemKey);
  await shop.page.close();
}

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

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

const shot = (page, name) => page.screenshot({ path: path.join(os.tmpdir(), `brix-cod-${name}.png`) });
const SCRIPT = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cod.js'), 'utf8');
const API = 'https://cartdrawer.fly.dev'; // BRIX app server: the browser must never call it
const PHP = 'https://php.test';   // PHP backend: settings, PIN lookups, and the relay for OTP/quote/order
const config = {
  success: true, enabled: true, surfaces: { drawer: true, product: true, combo: true }, otpRequired: true,
  minOrder: 299, maxOrder: 5000, codFee: 49, codFeeLabel: 'Cash on Delivery Fee', showCodFee: true, shippingFee: 0, freeShippingAbove: 0, blockedPincodes: ['744101'],
  excludedProductTags: ['no-cod'], allowCoupons: true, prepaidNudgeText: 'Pay online and get 5% off with code PREPAID5.',
  buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with Cash on Delivery', bg: '#0d6b4c', color: '#ffffff' },
  tracking: { ga4Id: 'G-TEST123', metaPixelId: '123456789012345', metaContentId: 'variant', dataLayer: true },
};
const quote = {
  currency: 'INR', lines: [{ title: 'Cold Brew Kit', variantTitle: 'Hazelnut', quantity: 1, image: null, originalTotal: 899, total: 899, unitPrice: 899, variantId: '11', productId: '1', sku: 'CBK-H' }],
  itemsTotal: 899, subtotal: 899, discounts: 0, shipping: 0, codFee: 49, tax: 0, taxesIncluded: true, total: 948, coupon: null,
};

// Dawn's product form buttons: Add to cart, then Shopify's Buy it now, with
// theme CSS that would restyle any <button> and space the buttons out.
const DAWN_BUTTONS = `<style>button{text-transform:uppercase;letter-spacing:3px;min-height:60px;padding:0 30px;border-radius:0}
  .product-form__buttons>*:not(:last-child){margin-bottom:10px}</style>
  <div class="product-form__buttons"><button type="submit" name="add">Add to cart</button>
  <div data-shopify="payment-button" class="shopify-payment-button"><shopify-accelerated-checkout><button type="button" class="shopify-payment-button__button">Buy it now</button></shopify-accelerated-checkout></div></div>`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
// A store logo, drawn in the browser so the test needs no image files.
{
  const scratch = await browser.newPage();
  config.sheet = {
    logo: await scratch.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 240; c.height = 64;
      const g = c.getContext('2d'); g.fillStyle = '#7c3aed'; g.beginPath(); g.arc(32, 32, 26, 0, 7); g.fill();
      g.fillStyle = '#111827'; g.font = 'bold 30px Arial'; g.fillText('Acme Store', 70, 43);
      return c.toDataURL('image/png');
    }),
    logoSize: 'md', accent: '#7c3aed', radius: 'soft', showSummary: true, showTrust: true, thankYouText: 'Thank you for shopping with Acme!',
    couponLabel: 'Got a coupon?', offers: [{ code: 'SAVE10', text: '10% off on orders above ₹999' }],
  };
  await scratch.close();
}
const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
const posted = [];
const phpReads = [];
const directAppCalls = [];
let forceQuoteError = false;
let productButton = null; // productButton settings served with the config (null = not sent)
let cartCleared = false;
const tagLoads = []; // gtag.js / fbevents.js requests

// The theme already has gtag + a Meta pixel with the same ID (recorded, never loaded), and GA / Meta cookies.
const THEME_TAGS = `window.__ga=[];window.gtag=function(){window.__ga.push([].slice.call(arguments));};
  window.__fb=[];window.fbq=function(){window.__fb.push([].slice.call(arguments));};window.fbq.getState=function(){return {pixels:[{id:'123456789012345'}]};};
  window.dataLayer=[];document.cookie='_ga=GA1.1.123.456';document.cookie='_fbp=fb.1.1700000000000.42';
  window.__track=[];document.addEventListener('brix:cod:track',function(e){window.__track.push(e.detail);});`;

const handler = async (route) => {
  const url = new URL(route.request().url());
  const body = route.request().postData() ? JSON.parse(route.request().postData()) : null;
  const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
  if (url.hostname === 'www.googletagmanager.com' || url.hostname === 'connect.facebook.net') { tagLoads.push(url.href); return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); }
  // A Dawn-based theme like House of KO's: several /cart/add forms before the
  // real one, which sits in a .product__info-wrapper.grid__item column.
  if (url.origin === 'https://shop.test' && url.pathname === '/dawn') {
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><main>
      <div class="hidden" style="display:none"><form action="/cart/add" id="sticky-form"><input type="hidden" name="id" value="21"><button type="submit" name="add">Add</button></form></div>
      <div class="upsell"><form action="/cart/add" id="upsell-form"><input type="hidden" name="id" value="99"><button type="submit" name="add">Add upsell</button></form></div>
      <div class="product__info-wrapper grid__item">
        <form action="/cart/add" id="product-form-installment"><input type="hidden" name="id" value="21"></form>
        <form action="/cart/add" id="product-form-main"><input type="hidden" name="id" value="21" disabled>${DAWN_BUTTONS}</form>
      </div>
      <div class="grid__item"><div class="card"><form action="/cart/add" id="card-form"><input type="hidden" name="id" value="22"><button type="submit" name="add">Add</button></form></div></div>
      </main><script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};window.ShopifyAnalytics={meta:{page:{pageType:'product'},product:{variants:[{id:21},{id:22}]}}};</script>
      <script src="https://cdn.test/brix_cod.js" data-php="${PHP}" data-shop="demo.myshopify.com" data-currency="INR"></script></body></html>` });
  }
  if (url.origin === 'https://shop.test' && url.pathname === '/') {
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="font-family:Arial,sans-serif"><main>
      <form action="/cart/add" id="product-form"><input type="hidden" name="id" value="11"><input name="quantity" value="2"><input name="properties[Engraving]" value="AR"><button type="submit" name="add">Add to cart</button></form>
      </main><script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};window.ShopifyAnalytics={meta:{page:{pageType:'product'}}};${url.searchParams.has('notags') ? '' : THEME_TAGS}</script>
      <script src="https://cdn.test/brix_cod.js" data-brix-logo="https://cdn.test/brix_logo.png" data-php="${PHP}" data-shop="demo.myshopify.com" data-currency="INR"></script></body></html>` });
  }
  if (url.href === 'https://cdn.test/brix_cod.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
  if (url.href === 'https://cdn.test/brix_logo.png') return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_logo.png')) });
  if (url.pathname === '/api/cod/quote' || (url.origin === PHP && url.pathname === '/cod_checkout.php' && body && body.endpoint === 'quote')) await new Promise((r) => setTimeout(r, 250));
  if (url.pathname === '/products/undefined.js' || url.pathname.startsWith('/products/')) return json({ tags: ['coffee'] });
  if (url.pathname === '/cart.js') return json({ items: [{ variant_id: 11, quantity: 1, properties: {}, final_line_price: 89900 }] });
  if (url.pathname === '/cart/clear.js') { cartCleared = true; return json({ items: [] }); }
  if (url.origin === PHP && url.pathname === '/cod_storefront.php') {
    phpReads.push(url.searchParams.get('action'));
    if (route.request().method() !== 'GET') return json({ success: false }, 405);
    if (url.searchParams.get('action') === 'config') return json(productButton ? { ...config, productButton } : config);
    const pin = url.searchParams.get('pin');
    return json({ success: true, pincode: pin, found: pin === '560001', city: 'Bangalore', state: 'Karnataka', blocked: false });
  }
  if (url.origin === API) { directAppCalls.push(url.pathname); return route.fulfill({ status: 404, body: '' }); }
  if (!(url.origin === PHP && url.pathname === '/cod_checkout.php')) return route.fulfill({ status: 404, body: '' });
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' } });
  url.pathname = '/api/cod/' + body.endpoint; // what cod_checkout.php relays to
  posted.push({ path: url.pathname, body });
  if (url.pathname === '/api/cod/quote' && forceQuoteError) return json({ success: false, code: 'below_min', error: 'Cash on Delivery is available on orders from ₹299.' }, 422);
  if (url.pathname === '/api/cod/otp') {
    if (body.step === 'send') return json({ success: true, resendAfter: 30 });
    return body.code === '1234' ? json({ success: true, token: 'tok' }) : json({ success: false, code: 'otp_wrong', error: "That code doesn't match. 4 tries left." }, 400);
  }
  if (url.pathname === '/api/cod/quote') {
    // SAVE10 is a real code (₹90 off); any other code is rejected by "Shopify".
    if (body.coupon === 'SAVE10') return json({ success: true, quote: { ...quote, discounts: 90, subtotal: 809, total: 858, lines: [{ ...quote.lines[0], total: 809 }], coupon: { code: 'SAVE10', applied: true } } });
    if (body.coupon) return json({ success: true, quote: { ...quote, coupon: { code: body.coupon, applied: false } } });
    return json({ success: true, quote });
  }
  if (url.pathname === '/api/cod/order') return json({ success: true, order: { orderName: '#1047', orderId: 'gid://shopify/Order/1047', total: 858, currency: 'INR', statusPageUrl: 'https://shop.test/status' } });
  return json({ success: false, error: 'unmocked' }, 404);
};
await page.route('**/*', handler);

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
  // Dawn's base.css hides empty elements; the sheet host only has a shadow
  // root, so it must still show with this rule on the page.
  const themeCss = document.createElement('style'); themeCss.textContent = 'a:empty,div:empty,section:empty{display:none}'; document.head.appendChild(themeCss);
  const drawer = document.createElement('div'); drawer.id = 'cc-overlay'; drawer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fff;';
  const slot = document.createElement('div'); slot.id = 'drawer-slot'; drawer.appendChild(slot); document.body.appendChild(drawer);
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
await inSheet('.bl img[alt="BRIX"]').waitFor();
await page.waitForTimeout(250);
await shot(page, '0-loader');
check('loader: the BRIX logo shows first while COD is checked', true);
await inSheet('#cod-phone').waitFor();
await page.waitForTimeout(300);
check('drawer: the COD sheet opens in front of the cart drawer', await page.evaluate(() => {
  const host = document.querySelector('[data-brix-cod-sheet]');
  const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 40);
  return hit === host;
}));
check('flow: starts on the phone step when OTP is on', true);
check('sheet: uses the storefront font, not the browser default', /Arial/.test(await page.evaluate(() => getComputedStyle(document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelector('.sh')).fontFamily)));
check('look: store logo in the header, step title in the body', (await inSheet('.hd img.lg').count()) === 1 && (await inSheet('.bt').textContent()) === 'Confirm your phone');
check('look: Powered by BRIX under the sheet', (await inSheet('.pw img[alt="BRIX"]').count()) === 1);
check('look: accent colour and soft corners applied', await page.evaluate(() => {
  const sh = document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelector('.sh');
  return sh.style.getPropertyValue('--cod-bg') === '#7c3aed' && sh.classList.contains('r-soft');
}));
check('phone step: labelled stepper, order summary and trust badges shown', (await inSheet('.stp').textContent()).includes('Address') && (await inSheet('.sum').count()) === 1 && (await inSheet('.trust div').count()) === 3);
await inSheet('[data-act="summary"]').click();
check('phone step: order summary expands to show the items', (await inSheet('.sum.open').count()) === 1 && (await inSheet('.sum').textContent()).includes('Cold Brew Kit'));
await inSheet('#cod-phone').fill('98765');
check('phone step: no tick for an incomplete number', (await inSheet('.pre.valid').count()) === 0);
await inSheet('button[type="submit"]').click();
check('phone step: invalid number highlights the field', (await inSheet('.pre.bad').count()) === 1);
await inSheet('#cod-phone').fill('98765 43210');
check('phone step: tick shown once the number is valid', (await inSheet('.pre.valid').count()) === 1);
await shot(page, '1-phone');
await inSheet('button[type="submit"]').click();
await inSheet('#cod-otp').waitFor();
check('flow: OTP step shows the number', (await inSheet('.bd').textContent()).includes('98765 43210'));
await inSheet('#cod-otp').fill('12');
check('otp: typed digits paint into the boxes', (await inSheet('[data-otp] i').allTextContents()).join('') === '12');
await inSheet('#cod-otp').fill('0000');
await inSheet('[data-err] .n.er').waitFor();
check('otp: wrong code turns the boxes red', (await inSheet('.otpw.bad').count()) === 1);
await shot(page, '2-otp-wrong');
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
check('address: PIN lookup confirms the place inline', (await inSheet('[data-pin] .pst.ok').textContent()).includes('Bangalore'));
await shot(page, '3-address');
await inSheet('#cod-a1').fill('14');
await inSheet('button[type="submit"]').click();
check('address: a short street highlights that field', (await inSheet('#cod-a1').getAttribute('aria-invalid')) === 'true');
await inSheet('#cod-a1').fill('14, 3rd Cross, Indiranagar');
check('address: typing clears the highlight', (await inSheet('#cod-a1').getAttribute('aria-invalid')) === null);
await inSheet('button[type="submit"]').click();
await inSheet('.tot').waitFor();
await page.waitForTimeout(300);
await shot(page, '4-review');
const reviewText = await inSheet('.bd').textContent();
check('review: shows the COD fee under its title, total and the prepaid message', reviewText.includes('Cash on Delivery Fee') && reviewText.includes('948') && reviewText.includes('PREPAID5'));

// Coupon: wrong code, then a real one, then paste-and-claim after removing it
await inSheet('[data-act="coupon-open"]').click();
await inSheet('.ofr').first().scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
await shot(page, '4a-coupon-box');
await inSheet('[name="coupon"]').fill('WRONG1');
await inSheet('[data-act="coupon-apply"]').click();
await inSheet('.cpn-err').waitFor();
check('coupon: a code Shopify rejects shows why and keeps the price', (await inSheet('.cpn-err').textContent()).includes("WRONG1 isn't valid") && (await inSheet('.tot').textContent()).includes('948'));
await inSheet('[name="coupon"]').fill('SAVE10');
await inSheet('[name="coupon"]').press('Enter');
await inSheet('.cpn.ok').waitFor();
check('coupon: Enter applies the code (does not place the order)', !posted.some((p) => p.path === '/api/cod/order'));
check('coupon: applied card shows the saving and the new total', (await inSheet('.cpn.ok').textContent()).includes('SAVE10 applied') && (await inSheet('.cpn.ok').textContent()).includes('90') && (await inSheet('.tot').textContent()).includes('858'));
await page.waitForTimeout(500);
await shot(page, '4b-coupon');
await inSheet('[data-act="coupon-remove"]').click();
await inSheet('[data-act="coupon-open"]').waitFor();
check('coupon: Remove goes back to the full price', (await inSheet('.tot').textContent()).includes('948'));
check('coupon: merchant label and suggested offer shown', (await inSheet('.cpn-add').textContent()).includes('Got a coupon?') && (await inSheet('.ofr').textContent()).includes('10% off on orders above'));
await inSheet('[data-act="coupon-offer"][data-code="SAVE10"]').click();
await inSheet('.cpn.ok').waitFor();
check('coupon: tapping an offer applies it', (await inSheet('.tot').textContent()).includes('858') && (await inSheet('.ofr').count()) === 0);
await inSheet('[data-act="coupon-remove"]').click();
await inSheet('[data-act="coupon-open"]').waitFor();
await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://shop.test' });
await page.evaluate(() => navigator.clipboard.writeText('  SAVE10 '));
await inSheet('[data-act="coupon-open"]').click();
await inSheet('[data-act="coupon-paste"]').click();
await inSheet('.cpn.ok').waitFor();
check('coupon: Paste fills and claims the code in one tap', (await inSheet('.tot').textContent()).includes('858'));
const policy = inSheet('[name="policy"]');
check('data policy: consent ticked by default, links to the BRIX COD data policy in a new tab',
  await policy.isChecked() && (await inSheet('.agr a').getAttribute('href')) === 'https://thebrix.io/cod-data-policy' && (await inSheet('.agr a').getAttribute('target')) === '_blank');
await policy.uncheck();
await inSheet('button[type="submit"]').click();
await page.waitForTimeout(150);
check('data policy: unticked blocks the order with a message',
  !posted.some((p) => p.path === '/api/cod/order') && (await inSheet('[data-err]').textContent()).includes('agree to the data policy') && (await inSheet('.agr.bad').count()) === 1);
await policy.check();
await inSheet('button[type="submit"]').click();
await inSheet('.done').waitFor();
check('done: order number and amount to pay shown', (await inSheet('.done').textContent()).includes('#1047'));
check('done: merchant thank-you message shown', (await inSheet('.done').textContent()).includes('Thank you for shopping with Acme!'));
check('done: copy button and next-steps timeline shown', (await inSheet('[data-act="copy"]').count()) === 1 && (await inSheet('.tl > div').count()) === 3);
await page.waitForTimeout(700);
await shot(page, '5-done');
await page.waitForFunction(() => window.__success === '#1047');
check('done: cart cleared and onSuccess called', cartCleared);

const orderPost = posted.filter((p) => p.path === '/api/cod/order').pop().body;
check('order request: the claimed coupon is sent with the order', orderPost.coupon === 'SAVE10');
check('order request: verified token, surface, cart items and address sent', orderPost.token === 'tok' && orderPost.surface === 'drawer' && orderPost.items[0].variantId === 11 && orderPost.address.pincode === '560001' && orderPost.phone === '9876543210' && /^cod/.test(orderPost.idemKey));
check('order request: GA client id, Meta _fbp, consent and page sent for the server-side purchase',
  orderPost.track.gaClientId === '123.456' && orderPost.track.fbp === 'fb.1.1700000000000.42'
  && orderPost.track.consent.analytics === true && orderPost.track.consent.marketing === true && orderPost.track.pageUrl.startsWith('https://shop.test/'));

// Ads & analytics: the funnel in order, to the merchant's IDs only
const ga = await page.evaluate(() => window.__ga);
const fb = await page.evaluate(() => window.__fb);
const gaEvents = ga.filter((c) => c[0] === 'event');
check('GA4: funnel fires once per step, in order',
  JSON.stringify(gaEvents.map((c) => c[1])) === JSON.stringify(['begin_checkout', 'cod_otp_verified', 'add_shipping_info', 'add_payment_info', 'purchase']),
  gaEvents.map((c) => c[1]).join(' → '));
check('GA4: sent only to the merchant\'s property, existing gtag reused', gaEvents.every((c) => c[2].send_to === 'G-TEST123') && tagLoads.length === 0);
const gaPurchase = gaEvents.find((c) => c[1] === 'purchase')[2];
check('GA4: purchase has the order name as transaction_id, coupon, value and items',
  gaPurchase.transaction_id === '#1047' && gaPurchase.value === 858 && gaPurchase.currency === 'INR' && gaPurchase.coupon === 'SAVE10'
  && gaPurchase.items[0].item_id === '11' && gaPurchase.items[0].item_variant === 'Hazelnut' && gaPurchase.shipping === 49);
const fbTracks = fb.filter((c) => /^trackSingle/.test(c[0]));
check('Meta: pixel already on the page is not initialised twice', !fb.some((c) => c[0] === 'init'));
check('Meta: standard + custom events to this pixel only',
  JSON.stringify(fbTracks.map((c) => `${c[0]}:${c[2]}`)) === JSON.stringify(['trackSingle:InitiateCheckout', 'trackSingleCustom:CodOtpVerified', 'trackSingleCustom:CodAddressAdded', 'trackSingle:AddPaymentInfo', 'trackSingle:Purchase'])
  && fbTracks.every((c) => c[1] === '123456789012345'), fbTracks.map((c) => c[2]).join(' → '));
const fbPurchase = fbTracks.find((c) => c[2] === 'Purchase');
check('Meta: Purchase carries eventID brixcod_<order id> for dedup with the server', fbPurchase[4] && fbPurchase[4].eventID === 'brixcod_1047' && fbPurchase[3].value === 858 && fbPurchase[3].content_ids[0] === '11');
const dl = await page.evaluate(() => window.dataLayer.filter((e) => e && e.event).map((e) => e.event));
check('GTM: brix_cod_* events pushed to the dataLayer', dl.includes('brix_cod_begin_checkout') && dl.includes('brix_cod_purchase'));
check('brix:cod:track DOM event fired for each step', (await page.evaluate(() => window.__track.length)) === 5);
await inSheet('[data-act="close"]').first().click();
await page.waitForFunction(() => !document.querySelector('[data-brix-cod-sheet]'));
await page.evaluate(() => document.getElementById('cc-overlay').remove()); // fake drawer closed

// Product page flow sends the form's variant, quantity and properties; returning shoppers skip OTP + address typing.
// The shopper declined cookies in the store's banner this time: no GA / Meta events.
await page.evaluate(() => {
  window.__ga.length = 0; window.__fb.length = 0; window.__track.length = 0;
  window.Shopify.customerPrivacy = { analyticsProcessingAllowed: () => false, marketingAllowed: () => false };
});
await productBtn.click();
await inSheet('[data-card]').waitFor();
check('consent: declined in the cookie banner → no GA4 or Meta events', (await page.evaluate(() => window.__ga.length + window.__fb.length)) === 0);
check('consent: the DOM event still fires, marked as not consented', await page.evaluate(() => window.__track.length === 1 && window.__track[0].consent.marketing === false));
check('returning shopper: verified phone and saved address reused', (await inSheet('#cod-name').inputValue()) === 'Ananya Rao');
await page.waitForTimeout(300);
await shot(page, '6-saved-address');
check('returning shopper: saved address shown as a card with the form folded away', (await inSheet('[data-card]').textContent()).includes('Indiranagar') && await inSheet('#cod-name').isHidden() && (await inSheet('button[type="submit"]').textContent()).includes('Deliver here'));
await inSheet('[data-act="edit-addr"]').click();
check('returning shopper: Change opens the filled form', await inSheet('#cod-name').isVisible() && (await inSheet('[data-card]').count()) === 0);
const productQuote = posted.filter((p) => p.path === '/api/cod/quote').pop().body;
check('product page: buys the selected variant, quantity and line properties', productQuote.surface === 'product' && productQuote.items[0].variantId === '11' && productQuote.items[0].quantity === 2 && productQuote.items[0].properties.Engraving === 'AR');
await inSheet('[data-act="close"]').first().click();
await page.waitForFunction(() => !document.querySelector('[data-brix-cod-sheet]'));

// Combo: open with explicit items + Pay online fallback from an error
forceQuoteError = true;
await page.evaluate(() => window.BrixCod.open({ surface: 'combo', items: [{ variantId: 12, quantity: 1 }], coupon: 'COMBO10', onPayOnline: () => { window.__comboOnline = true; } }));
await inSheet('.n.er').waitFor();
check('combo: rule error shown before asking for any details', (await inSheet('.n.er').textContent()).includes('₹299'));
await inSheet('[data-act="online"]').click();
await page.waitForFunction(() => window.__comboOnline === true);
check('combo: Pay online hands back to the normal checkout', true);

await shot(page, '7-error');

// A theme without gtag / Meta pixel: the popup loads them itself, only once the shopper uses COD.
const page2 = await browser.newPage();
await page2.route('**/*', handler);
forceQuoteError = false;
await page2.goto('https://shop.test/?notags=1');
await page2.waitForFunction(() => window.BrixCod);
await page2.waitForTimeout(300);
check('no tags: nothing loaded before the popup is used', tagLoads.length === 0);
await page2.evaluate(() => window.BrixCod.open({ surface: 'combo', items: [{ variantId: 12, quantity: 1 }] }));
await page2.locator('[data-brix-cod-sheet]').locator('#cod-phone').waitFor();
await page2.waitForTimeout(200);
check('no tags: gtag.js and fbevents.js loaded on begin_checkout', tagLoads.some((u) => u === 'https://www.googletagmanager.com/gtag/js?id=G-TEST123') && tagLoads.some((u) => u.includes('connect.facebook.net/en_US/fbevents.js')), tagLoads.join(', '));
check('no tags: GA4 configured without a page view, pixel initialised once', await page2.evaluate(() => {
  const cfg = window.dataLayer.filter((a) => a && a[0] === 'config');
  const inits = window.fbq.queue.filter((a) => a[0] === 'init');
  return cfg.length === 1 && cfg[0][1] === 'G-TEST123' && cfg[0][2].send_page_view === false && inits.length === 1 && inits[0][1] === '123456789012345';
}));
await page2.close();

// Dawn-style product page: the button goes on the visible main form, not the
// hidden installment / sticky forms or another product's upsell card.
const page3 = await browser.newPage();
await page3.route('**/*', handler);
await page3.goto('https://shop.test/dawn');
const dawnBtn = page3.locator('[data-brix-cod-btn]');
await dawnBtn.first().waitFor({ timeout: 5000 }).catch(() => {});
const dawn = await page3.evaluate(() => [...document.querySelectorAll('[data-brix-cod-btn]')].map((b) => ({ form: b.closest('form') && b.closest('form').getAttribute('id'), shown: b.getBoundingClientRect().height > 0 })));
check('product page (Dawn layout): one visible button, on the main Add to cart form', dawn.length === 1 && dawn[0].form === 'product-form-main' && dawn[0].shown, JSON.stringify(dawn));
const dawnLayout = () => page3.evaluate(() => {
  const slot = document.querySelector('[data-brix-cod-slot]');
  const bin = document.querySelector('.shopify-payment-button');
  const btn = slot && slot.querySelector('[data-brix-cod-btn]');
  const cs = btn && getComputedStyle(btn);
  return {
    buttons: document.querySelectorAll('[data-brix-cod-btn]').length,
    beforeBuyNow: Boolean(slot && bin && slot.nextElementSibling === bin),
    buyNowHidden: bin ? getComputedStyle(bin).display === 'none' : null,
    slotMargin: slot && getComputedStyle(slot).marginBottom,
    style: cs && [cs.textTransform, cs.letterSpacing, cs.paddingTop, cs.paddingLeft, cs.borderRadius, cs.minHeight, cs.marginTop].join(' '),
  };
});
const replaced = await dawnLayout();
await shot(page3, '8-product-replaces-buy-now');
check('product page: COD button takes the place of Buy it now, which is hidden', replaced.beforeBuyNow && replaced.buyNowHidden === true, JSON.stringify(replaced));
check('product page: theme button CSS does not change the COD button', replaced.style === 'none normal 14px 16px 12px 0px 10px' && replaced.slotMargin === '0px', replaced.style);
// Themes redraw the product form on variant change; the button must come back, once.
await page3.evaluate(() => { const f = document.getElementById('product-form-main'); f.outerHTML = f.outerHTML.replace(/<div data-brix-cod-slot[^]*?<\/button><\/div>/, ''); });
await page3.waitForFunction(() => document.querySelector('#product-form-main [data-brix-cod-btn]'), null, { timeout: 3000 }).catch(() => {});
const redrawn = await dawnLayout();
check('product page: button comes back after the theme redraws the form', redrawn.buttons === 1 && redrawn.beforeBuyNow && redrawn.buyNowHidden === true, JSON.stringify(redrawn));
await page3.close();

// Merchant keeps Buy it now and changes the spacing.
productButton = { replaceBuyNow: false, marginTop: 4, marginBottom: 6, paddingY: 20, paddingX: 24, radius: 0 };
const page4 = await browser.newPage();
await page4.route('**/*', handler);
await page4.goto('https://shop.test/dawn');
await page4.locator('[data-brix-cod-btn]').first().waitFor({ timeout: 5000 }).catch(() => {});
const kept = await page4.evaluate(() => {
  const slot = document.querySelector('[data-brix-cod-slot]');
  const btn = slot && slot.querySelector('[data-brix-cod-btn]');
  const cs = btn && getComputedStyle(btn);
  const bin = document.querySelector('.shopify-payment-button');
  return {
    afterAddToCart: Boolean(slot && slot.previousElementSibling && slot.previousElementSibling.name === 'add'),
    buyNowShown: getComputedStyle(bin).display !== 'none',
    style: cs && [cs.marginTop, cs.marginBottom, cs.paddingTop, cs.paddingLeft, cs.borderRadius].join(' '),
  };
});
check('product page: Buy it now kept when replacing is off, COD button under Add to cart', kept.afterAddToCart && kept.buyNowShown, JSON.stringify(kept));
await shot(page4, '9-product-keeps-buy-now');
check('product page: merchant spacing applied', kept.style === '4px 6px 20px 24px 0px', kept.style);
await page4.close();
productButton = null;
check('settings and PIN lookups come from the PHP backend', phpReads.includes('config') && phpReads.includes('pincode'));
check('OTP, pricing and the order go through the PHP relay', ['/api/cod/otp', '/api/cod/quote', '/api/cod/order'].every((p) => posted.some((x) => x.path === p)));
check('the browser never calls the app server directly', directAppCalls.length === 0, directAppCalls.join(', '));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

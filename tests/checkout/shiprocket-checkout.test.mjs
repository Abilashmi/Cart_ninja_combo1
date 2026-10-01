// Run with: node --test "tests/checkout/*.test.mjs"
// Logic-only test of extensions/cart-drawer/assets/brix_checkout.js against a
// stubbed page. It does NOT prove Shiprocket's real script accepts these
// calls — that needs a store with Shiprocket Checkout installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../../extensions/cart-drawer/assets/brix_checkout.js', import.meta.url), 'utf8');

const flush = () => new Promise((resolve) => setImmediate(resolve));

// A fake page: controllable clock, cookie jar, fetch, and Shiprocket stub.
function makePage({ shiprocket = true, buyDirect = true, cartItems = [], cartFails = false, discountFails = false, cookies = {}, popupOnCall = true, buyCartThrows = false } = {}) {
  let now = 0;
  let timers = [];
  let nextId = 1;
  const page = { navigations: [], fetches: [], buyCartCalls: [], buyDirectCalls: [], popup: false, cookies: { ...cookies }, session: new Map() };

  const events = {
    buyCart(event) {
      if (buyCartThrows) throw new Error('shiprocket exploded');
      page.buyCartCalls.push(event);
      if (popupOnCall) page.popup = true;
    },
  };
  if (buyDirect) events.buyDirect = (payload) => { page.buyDirectCalls.push(payload); if (popupOnCall) page.popup = true; };

  const window = {
    location: { set href(url) { page.navigations.push(url); } },
    sessionStorage: {
      getItem: (key) => (page.session.has(key) ? page.session.get(key) : null),
      setItem: (key, value) => { page.session.set(key, String(value)); },
      removeItem: (key) => { page.session.delete(key); },
    },
    fetch(url) {
      page.fetches.push(url);
      if (url.startsWith('/discount/')) {
        if (discountFails) return Promise.reject(new Error('offline'));
        // Shopify sets this cookie itself on /discount/<code>.
        page.cookies.discount_code = decodeURIComponent(url.slice('/discount/'.length).split('?')[0]);
        return Promise.resolve({ json: async () => ({}) });
      }
      if (cartFails) return Promise.reject(new Error('offline'));
      return Promise.resolve({ json: async () => ({ items: cartItems }) });
    },
  };
  if (shiprocket === true) window.shiprocketCheckoutEvents = events;
  page.loadShiprocket = () => { window.shiprocketCheckoutEvents = events; };

  const document = {
    get cookie() { return Object.entries(page.cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '); },
    set cookie(value) {
      const [pair, ...attrs] = value.split(';').map((part) => part.trim());
      const [name, raw] = pair.split('=');
      if (attrs.some((attr) => /^max-age=0$/i.test(attr))) delete page.cookies[name];
      else page.cookies[name] = decodeURIComponent(raw);
    },
    querySelector: () => (page.popup ? {} : null),
  };

  const context = vm.createContext({
    window,
    document,
    Date: { now: () => now },
    setTimeout: (fn, ms) => { timers.push({ id: nextId, at: now + ms, fn }); return nextId++; },
    setInterval: (fn, ms) => { timers.push({ id: nextId, at: now + ms, fn, every: ms }); return nextId++; },
    clearInterval: (id) => { timers = timers.filter((timer) => timer.id !== id); },
  });
  vm.runInContext(SOURCE, context);
  page.api = window.BrixCheckout;

  // Moves the clock forward, running due timers in order and letting
  // promise chains settle between each.
  page.advance = async (ms) => {
    const end = now + ms;
    await flush();
    for (;;) {
      const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at += due.every;
      else timers = timers.filter((timer) => timer !== due);
      due.fn();
      await flush();
    }
    now = end;
    await flush();
  };
  return page;
}

const FALLBACK = '/checkout?discount=SAVE10';

test('Shiprocket not on the page: goes to the normal Shopify checkout URL', async () => {
  const page = makePage({ shiprocket: false });
  page.api.checkoutCart({ coupon: 'SAVE10', fallbackUrl: FALLBACK });
  await page.advance(1400);
  assert.deepEqual(page.navigations, []); // still giving the deferred script time to load
  await page.advance(200);
  assert.deepEqual(page.navigations, [FALLBACK]);
  assert.deepEqual(page.fetches, []); // never touched the cart or the discount cookie
});

test('Shiprocket present: opens its cart checkout, with the coupon in the cookie it reads', async () => {
  const page = makePage({ cartItems: [{ properties: {}, final_line_price: 5000 }] });
  let closed = 0;
  page.api.checkoutCart({ coupon: 'SAVE10', fallbackUrl: FALLBACK, onOpen: () => { closed += 1; } });
  await page.advance(200);
  assert.equal(page.buyCartCalls.length, 1);
  assert.equal(page.cookies.discount_code, 'SAVE10');
  assert.ok(page.fetches.some((url) => url.startsWith('/discount/SAVE10')));
  assert.equal(closed, 1); // drawer told to close once the popup is up
  assert.deepEqual(page.navigations, []);
});

test('Shiprocket script that finishes loading after the tap is still used', async () => {
  const page = makePage({ shiprocket: 'late' });
  page.api.checkoutCart({ fallbackUrl: '/checkout' });
  await page.advance(400);
  page.loadShiprocket();
  await page.advance(400);
  assert.equal(page.buyCartCalls.length, 1);
  assert.deepEqual(page.navigations, []);
});

test('coupon still reaches Shiprocket when the /discount request fails', async () => {
  const page = makePage({ discountFails: true });
  page.api.checkoutCart({ coupon: 'SAVE10', fallbackUrl: FALLBACK });
  await page.advance(200);
  assert.equal(page.cookies.discount_code, 'SAVE10');
  assert.equal(page.buyCartCalls.length, 1);
});

test('removing the coupon clears only a cookie this helper set', async () => {
  const page = makePage();
  page.api.checkoutCart({ coupon: 'SAVE10', fallbackUrl: FALLBACK });
  await page.advance(200);
  assert.equal(page.cookies.discount_code, 'SAVE10');

  page.popup = false; // shopper closed Shiprocket, removed the coupon, tapped checkout again
  page.api.checkoutCart({ coupon: null, fallbackUrl: '/checkout' });
  await page.advance(200);
  assert.equal(page.cookies.discount_code, undefined);
  assert.equal(page.buyCartCalls.length, 2);
});

test('a discount cookie from the merchant\'s own link is left alone', async () => {
  const page = makePage({ cookies: { discount_code: 'FESTIVE' } });
  page.api.checkoutCart({ coupon: null, fallbackUrl: '/checkout' });
  await page.advance(200);
  assert.equal(page.cookies.discount_code, 'FESTIVE');
  assert.equal(page.buyCartCalls.length, 1);
});

test('cart with a Pack line stays on Shopify checkout (Shiprocket would not apply the pack price)', async () => {
  const page = makePage({ cartItems: [{ properties: { _brix_pack_id: '7' }, final_line_price: 9000 }] });
  page.api.checkoutCart({ coupon: null, fallbackUrl: '/checkout' });
  await page.advance(200);
  assert.deepEqual(page.navigations, ['/checkout']);
  assert.equal(page.buyCartCalls.length, 0);
});

test('cart with a free reward gift stays on Shopify checkout', async () => {
  const page = makePage({ cartItems: [{ properties: {}, final_line_price: 6000 }, { properties: { _brixReward: 'true' }, final_line_price: 0 }] });
  page.api.checkoutCart({ fallbackUrl: '/checkout' });
  await page.advance(200);
  assert.deepEqual(page.navigations, ['/checkout']);
  assert.equal(page.buyCartCalls.length, 0);
});

test('a regular-priced reward product does not block Shiprocket', async () => {
  const page = makePage({ cartItems: [{ properties: { _brixReward: 'true' }, final_line_price: 2000 }] });
  page.api.checkoutCart({ fallbackUrl: '/checkout' });
  await page.advance(200);
  assert.equal(page.buyCartCalls.length, 1);
  assert.deepEqual(page.navigations, []);
});

test('cart cannot be read: stays on Shopify checkout', async () => {
  const page = makePage({ cartFails: true });
  page.api.checkoutCart({ fallbackUrl: '/checkout' });
  await page.advance(200);
  assert.deepEqual(page.navigations, ['/checkout']);
  assert.equal(page.buyCartCalls.length, 0);
});

test('Shiprocket throws: goes to Shopify checkout', async () => {
  const page = makePage({ buyCartThrows: true });
  page.api.checkoutCart({ fallbackUrl: '/checkout' });
  await page.advance(200);
  assert.deepEqual(page.navigations, ['/checkout']);
});

test('Shiprocket never opens its popup: goes to Shopify checkout after the timeout', async () => {
  const page = makePage({ popupOnCall: false });
  page.api.checkoutCart({ fallbackUrl: '/checkout' });
  await page.advance(7000);
  assert.deepEqual(page.navigations, []);
  await page.advance(1500);
  assert.deepEqual(page.navigations, ['/checkout']);
  assert.equal(page.buyCartCalls.length, 1);
});

test('double tap starts one checkout, and a later tap works again', async () => {
  const page = makePage();
  page.api.checkoutCart({ fallbackUrl: '/checkout' });
  page.api.checkoutCart({ fallbackUrl: '/checkout' });
  await page.advance(200);
  assert.equal(page.buyCartCalls.length, 1);

  page.popup = false;
  page.api.checkoutCart({ fallbackUrl: '/checkout' });
  await page.advance(200);
  assert.equal(page.buyCartCalls.length, 2);
});

const COMBO = {
  items: [{ variantId: 111, quantity: 2 }, { variantId: 222, quantity: 1 }],
  coupon: 'COMBO15',
  attributes: { combo_source: 'ComboForge', combo_template_id: '9', combo_template_name: 'Summer box' },
  fallbackUrl: 'https://shop.example/discount/COMBO15?redirect=%2Fcart%2F111%3A2%2C222%3A1',
};

test('combo checkout: Shiprocket gets the same items, code and attributes as the cart link', async () => {
  const page = makePage();
  page.api.checkoutItems(COMBO);
  await page.advance(200);
  assert.equal(page.buyDirectCalls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(page.buyDirectCalls[0])), {
    type: 'cart',
    products: COMBO.items,
    couponCode: 'COMBO15',
    cartAttributes: COMBO.attributes,
    fallbackUrl: COMBO.fallbackUrl,
  });
  assert.deepEqual(page.navigations, []);
  assert.deepEqual(page.fetches, []); // the shopper's own cart is never touched
});

test('combo checkout: no Shiprocket, or no direct checkout support, uses the cart link', async () => {
  const none = makePage({ shiprocket: false });
  none.api.checkoutItems(COMBO);
  await none.advance(1600);
  assert.deepEqual(none.navigations, [COMBO.fallbackUrl]);

  const old = makePage({ buyDirect: false });
  old.api.checkoutItems(COMBO);
  await old.advance(200);
  assert.deepEqual(old.navigations, [COMBO.fallbackUrl]);
});

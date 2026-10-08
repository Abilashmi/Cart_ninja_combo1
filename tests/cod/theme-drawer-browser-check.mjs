/* eslint-env node */
// Browser check: BRIX COD in the theme's own cart drawer, and in the BRIX Cart
// Drawer, for each merchant setting (extensions/cart-drawer/assets/brix_cod.js).
// Run from the repo root: node tests/cod/theme-drawer-browser-check.mjs
//
// Loads the real brix_cod.js and cart_drawer_inline.js (as the "Custom Cart
// Drawer" app embed does) into mocked theme pages. Every network call is
// mocked: cart.js, products/<handle>.js, the PHP backend (COD settings and
// the BRIX drawer's own settings) and the COD relay.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const COD_JS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cod.js'), 'utf8');
const DRAWER_JS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/cart_drawer_inline.js'), 'utf8');
const PHP = 'https://php.test';
const BRIX_PHP = 'https://int.thebrix.io'; // where cart_drawer_inline.js reads the BRIX drawer's settings
const shotDir = path.join(os.tmpdir(), 'brix-cod-theme');
fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const BASE_CFG = {
  success: true, enabled: true, surfaces: { drawer: true, product: true, combo: true }, otpRequired: false,
  minOrder: 0, maxOrder: 0, codFee: 40, codFeeLabel: 'Cash on Delivery Fee', showCodFee: true, shippingFee: 0, freeShippingAbove: 0,
  blockedPincodes: [], excludedProductTags: ['no-cod', 'pre-order', 'fragile'], excludedBehavior: 'unavailable',
  allowCoupons: true, prepaidNudgeText: '', drawerPlacement: 'above', drawerSelector: '',
  buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with COD', bg: '#0d6b4c', color: '#ffffff', style: 'filled', radius: 12 },
  productButton: { replaceBuyNow: true, marginTop: 10, marginBottom: 0, paddingY: 14, paddingX: 16, radius: 12 },
  sheet: {}, tracking: { ga4Id: '', metaPixelId: '', metaContentId: 'shopify', dataLayer: false },
};
const TAGS = { tee: ['summer', 'cotton'], tote: ['bags'], jacket: ['Pre-Order'], vase: ['fragile', 'home'] };
const line = (handle, price) => ({ variant_id: 100 + Object.keys(TAGS).indexOf(handle), quantity: 1, handle, final_line_price: price * 100, properties: {} });
const CART = [line('tee', 999), line('tote', 300)];

// Theme CSS that would restyle any <button>, like most themes do.
const THEME_CSS = `body{font-family:Arial,sans-serif;margin:0}
  button,.button{text-transform:uppercase;letter-spacing:2px;min-height:50px;border-radius:0;background:#121212;color:#fff;border:0;padding:0 24px;width:100%}
  .drawer{position:fixed;top:0;right:0;width:360px;height:100vh;background:#fff;box-shadow:-4px 0 20px rgba(0,0,0,.2);display:flex;flex-direction:column}
  .drawer__footer,.mini-cart__footer,.side-cart__foot{padding:16px;border-top:1px solid #eee}
  .cart__ctas{display:flex;gap:10px}.cart__ctas>*{flex:1}
  .mini-cart__actions{display:flex;gap:10px}.mini-cart__actions>*{flex:1}
  .totals{display:flex;justify-content:space-between;margin-bottom:12px}`;

// Dawn's cart drawer (sections/cart-drawer.liquid, trimmed). Dawn redraws
// .drawer__inner from the server after every cart change.
const dawnInner = (total = '₹1,299.00') => `<div class="drawer__inner">
  <div class="drawer__header"><h2 class="drawer__heading">Your cart</h2></div>
  <cart-drawer-items><form action="/cart" id="CartDrawer-Form" method="post"><div class="cart-item">Items</div></form></cart-drawer-items>
  <div class="drawer__footer">
    <div class="totals"><h2>Estimated total</h2><p>${total}</p></div>
    <div class="cart__ctas"><button type="submit" id="CartDrawer-Checkout" class="cart__checkout-button button" name="checkout" form="CartDrawer-Form">Check out</button></div>
    <div class="cart__dynamic-checkout-buttons additional-checkout-buttons"><shopify-accelerated-checkout-cart><button type="button" class="shop-pay">Shop Pay</button></shopify-accelerated-checkout-cart></div>
  </div></div>`;
const THEMES = {
  dawn: `<cart-drawer class="drawer"><div id="CartDrawer" class="cart-drawer">${dawnInner()}</div></cart-drawer>
    <main id="MainContent"><form action="/cart" id="cart" method="post"><button type="submit" name="checkout" id="main-checkout">Check out (cart page)</button></form></main>
    <script>window.rerender=function(t){document.querySelector('#CartDrawer').innerHTML=${JSON.stringify(dawnInner('__T__'))}.replace('__T__',t)};</script>`,
  // Prestige/Focal-style: Checkout shares a flex row with "View cart".
  prestige: `<div id="mini-cart" class="mini-cart drawer"><form id="mini-cart-form" action="/cart" method="post"></form>
    <div class="mini-cart__footer"><div class="mini-cart__actions"><a href="/cart" class="button">View cart</a><button type="submit" form="mini-cart-form" name="checkout" id="pr-checkout">Checkout</button></div></div></div>`,
  // A theme whose Checkout is a link.
  link: `<aside class="side-cart drawer"><div class="side-cart__foot"><a href="/checkout" id="link-checkout" class="button">Checkout</a></div></aside>`,
  // A theme BRIX doesn't recognise; the merchant gave the selector.
  custom: `<div class="weird-panel drawer"><div class="actions"><span class="go-checkout" id="custom-checkout" role="button" style="display:block;padding:14px;background:#000;color:#fff;text-align:center">Pay now</span></div></div>`,
};

function themePage(theme) {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${THEME_CSS}</style></head><body>
    <header><a href="/cart" id="cart-icon-bubble">Cart</a></header>
    ${THEMES[theme] || ''}
    <div id="cc-root" data-shop="demo.myshopify.com" data-currency="INR"></div>
    <script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};window.ShopifyAnalytics={meta:{page:{pageType:'index'}}};</script>
    <script src="https://cdn.test/brix_cod.js" data-php="${PHP}" data-shop="demo.myshopify.com" data-currency="INR"></script>
    <script src="https://cdn.test/cart_drawer_inline.js"></script>
  </body></html>`;
}

const browser = await chromium.launch();

async function open(theme, { cfg = {}, cart = CART, brixOn = false, viewport = { width: 1280, height: 800 } } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const net = { quotes: [], checkoutPosts: [], navigations: [], productReads: [] };
  const state = { cart: [...cart], cfg: { ...BASE_CFG, ...cfg, buttons: { ...BASE_CFG.buttons, ...(cfg.buttons || {}) } } };
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.href === 'https://cdn.test/brix_cod.js') return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: COD_JS });
    if (url.href === 'https://cdn.test/cart_drawer_inline.js') return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: DRAWER_JS });
    if (url.origin === 'https://shop.test') {
      if (url.pathname === '/' && req.method() === 'GET') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: themePage(theme) });
      if (url.pathname === '/cart.js') return json({ items: state.cart, item_count: state.cart.length, total_price: state.cart.reduce((n, l) => n + l.final_line_price, 0), currency: 'INR' });
      const m = /^\/products\/([^/]+)\.js$/.exec(url.pathname);
      if (m) { net.productReads.push(m[1]); return json({ handle: m[1], tags: TAGS[m[1]] || [] }); }
      if (url.pathname === '/cart' && req.method() === 'POST') { net.checkoutPosts.push(req.postData() || ''); return route.fulfill({ contentType: 'text/html', body: '<p>checkout</p>' }); }
      if (url.pathname === '/checkout') { net.navigations.push(url.pathname); return route.fulfill({ contentType: 'text/html', body: '<p>checkout</p>' }); }
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.origin === PHP && url.pathname === '/cod_storefront.php') return json(state.cfg);
    if (url.origin === PHP && url.pathname === '/cod_checkout.php') {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
      const body = JSON.parse(req.postData() || '{}');
      if (body.endpoint === 'quote') {
        net.quotes.push(body);
        if (state.quoteError) return json({ success: false, code: 'below_min', error: 'Cash on Delivery is available on orders from ₹2,000.' }, 422);
        return json({ success: true, quote: { currency: 'INR', lines: [], itemsTotal: 1299, subtotal: 1299, discounts: 0, shipping: 0, codFee: 40, tax: 0, taxesIncluded: true, total: 1339, coupon: null } });
      }
      return json({ success: false, error: 'unmocked' }, 404);
    }
    if (url.origin === BRIX_PHP) {
      if (url.pathname === '/save_cart_drawer.php') return json(brixOn ? { status: 'success', data: { cartStatus: '1', checkoutName: 'Checkout Now' } } : { status: 'success', data: { cartStatus: '0' } });
      if (url.pathname === '/save_coupon.php') return json({ status: 'success', data: [] });
      return json({ status: 'success' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://shop.test/');
  page.net = net;
  page.state = state;
  return page;
}

// What a COD slot looks like relative to the drawer's Checkout button.
async function look(page, checkoutSel) {
  return page.evaluate((sel) => {
    const co = document.querySelector(sel);
    const slots = [...document.querySelectorAll('[data-brix-cod-drawer]')];
    return {
      slots: slots.length,
      buttons: slots.filter((s) => s.querySelector('[data-brix-cod-btn]')).length,
      text: slots.map((s) => s.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
      disabled: slots.map((s) => { const b = s.querySelector('[data-brix-cod-btn]'); return b ? b.disabled : null; }),
      before: co && slots[0] ? Boolean(slots[0].compareDocumentPosition(co) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
      checkoutShown: co ? getComputedStyle(co).display !== 'none' : null,
      inMain: Boolean(document.querySelector('main [data-brix-cod-drawer]')),
      slotParent: slots[0] ? (slots[0].parentElement.className || slots[0].parentElement.id || slots[0].parentElement.tagName) : null,
      btnWidth: slots[0]?.querySelector('[data-brix-cod-btn]')?.getBoundingClientRect().width || 0,
      coWidth: co ? co.getBoundingClientRect().width : 0,
      transform: slots[0]?.querySelector('[data-brix-cod-btn]') ? getComputedStyle(slots[0].querySelector('[data-brix-cod-btn]')).textTransform : null,
      radius: slots[0]?.querySelector('[data-brix-cod-btn]') ? getComputedStyle(slots[0].querySelector('[data-brix-cod-btn]')).borderRadius : null,
      bg: slots[0]?.querySelector('[data-brix-cod-btn]') ? getComputedStyle(slots[0].querySelector('[data-brix-cod-btn]')).backgroundColor : null,
      shadow: slots[0]?.querySelector('[data-brix-cod-btn]') ? getComputedStyle(slots[0].querySelector('[data-brix-cod-btn]')).boxShadow : null,
      sheet: Boolean(document.querySelector('[data-brix-cod-sheet]')),
    };
  }, checkoutSel);
}
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const waitButton = (page) => page.waitForSelector('[data-brix-cod-drawer] [data-brix-cod-btn]', { timeout: 5000 }).catch(() => null);
const DAWN_CO = '#CartDrawer-Checkout';
const allErrors = [];
const done = async (page, name) => {
  await page.screenshot({ path: path.join(shotDir, `${name}.png`) });
  allErrors.push(...page.errors);
  await page.context().close();
};

/* 1. Dawn, BRIX Cart Drawer off: Above Checkout (the default) */
{
  const page = await open('dawn');
  await waitButton(page);
  const s = await look(page, DAWN_CO);
  check('theme drawer: COD added to Dawn\'s own cart drawer while the BRIX drawer is off', s.buttons === 1, JSON.stringify({ slots: s.slots, text: s.text }));
  check('theme drawer: one button per drawer (Shop Pay button and cart page ignored)', s.slots === 1 && !s.inMain);
  check('Above Checkout: COD sits above Checkout, Checkout still shown', s.before === true && s.checkoutShown === true);
  check('Above Checkout: COD gets its own full-width row, not squeezed into the flex row', s.slotParent === 'drawer__footer' && Math.abs(s.btnWidth - s.coWidth) < 2, `${s.slotParent}, ${s.btnWidth} vs ${s.coWidth}`);
  check('fee: "+₹40 Cash on Delivery Fee" under the button', s.text.includes('+₹40.00 Cash on Delivery Fee') || s.text.includes('+₹40 Cash on Delivery Fee'), s.text);
  check('theme CSS does not restyle the COD button (no uppercase, merchant radius, merchant colour)', s.transform === 'none' && s.radius === '12px' && s.bg === 'rgb(13, 107, 76)', `${s.transform} ${s.radius} ${s.bg}`);
  check('the BRIX Cart Drawer did not take over the theme drawer', await page.evaluate(() => window.__brixCartDrawerActive === false));
  await page.locator('[data-brix-cod-drawer] [data-brix-cod-btn]').click();
  await page.waitForSelector('[data-brix-cod-sheet]', { timeout: 4000 }).catch(() => null);
  await settle(page, 600);
  const q = page.net.quotes[0];
  check('clicking COD opens the COD popup for the whole cart', Boolean(q) && q.surface === 'drawer' && q.items.length === 2 && q.items[0].variantId === 100, JSON.stringify(q && { surface: q.surface, items: q.items }));
  await done(page, '1-dawn-above');
}

/* 2. Below Checkout */
{
  const page = await open('dawn', { cfg: { drawerPlacement: 'below' } });
  await waitButton(page);
  const s = await look(page, DAWN_CO);
  check('Below Checkout: COD sits below Checkout, Checkout still shown', s.buttons === 1 && s.before === false && s.checkoutShown === true);
  await done(page, '2-dawn-below');
}

/* 3. Replace Checkout, then "Pay online" goes through the theme's own Checkout */
{
  const page = await open('dawn', { cfg: { drawerPlacement: 'replace' } });
  await waitButton(page);
  const s = await look(page, DAWN_CO);
  check('Replace Checkout: Checkout hidden, COD in its place', s.buttons === 1 && s.checkoutShown === false && s.before === true);
  check('Replace Checkout: Shop Pay / accelerated buttons are left alone', await page.evaluate(() => getComputedStyle(document.querySelector('.shop-pay')).display !== 'none'));
  page.state.quoteError = true; // the popup's first check fails, so it offers "Pay online"
  await page.locator('[data-brix-cod-drawer] [data-brix-cod-btn]').click();
  const payOnline = page.locator('[data-brix-cod-sheet] [data-act="online"]');
  await payOnline.first().waitFor({ timeout: 5000 }).catch(() => null);
  const hasPayOnline = await payOnline.count();
  if (hasPayOnline) await Promise.all([page.waitForURL('**/cart', { timeout: 4000 }).catch(() => null), payOnline.first().click()]);
  check('Replace Checkout: "Pay online" submits the theme\'s own (hidden) Checkout button', hasPayOnline > 0 && page.net.checkoutPosts.length === 1 && page.net.checkoutPosts[0].includes('checkout'), `posts=${JSON.stringify(page.net.checkoutPosts)}`);
  allErrors.push(...page.errors);
  await page.context().close();
}

/* 4. Replace + a cart COD can't be used for (minimum order): Checkout comes back */
{
  const page = await open('dawn', { cfg: { drawerPlacement: 'replace', minOrder: 2000 } });
  await waitButton(page);
  const s = await look(page, DAWN_CO);
  check('Replace Checkout + below the minimum: Checkout stays, COD shown unavailable above it', s.checkoutShown === true && s.disabled[0] === true && s.before === true && s.text.includes('Available on orders from'), s.text);
  await done(page, '4-dawn-replace-min');
}

/* 5. Excluded product tags: show as unavailable (default), multiple tags, case-insensitive */
{
  const page = await open('dawn', { cfg: { drawerPlacement: 'replace' }, cart: [line('tee', 999), line('jacket', 1500)] });
  await waitButton(page);
  let s = await look(page, DAWN_CO);
  check('excluded tag (Pre-Order vs pre-order): COD shown as unavailable, Checkout kept', s.disabled[0] === true && s.checkoutShown === true && s.text.includes('Not available for some items in your cart'), s.text);
  check('excluded tags: tags read from the storefront\'s products/<handle>.js', page.net.productReads.includes('jacket') && page.net.productReads.includes('tee'));
  // The shopper removes the jacket and adds a vase (another excluded tag): Dawn redraws the drawer.
  page.state.cart = [line('tee', 999), line('vase', 450)];
  await page.evaluate(() => window.rerender('₹1,449.00'));
  await page.waitForFunction(() => document.querySelector('[data-brix-cod-drawer]') && document.querySelector('#CartDrawer-Checkout'), null, { timeout: 4000 });
  await settle(page);
  s = await look(page, DAWN_CO);
  check('drawer redrawn by the theme: COD button comes back next to the new Checkout', s.slots === 1 && s.buttons === 1, JSON.stringify(s));
  check('multiple tags: a second excluded tag (fragile) also makes COD unavailable', s.disabled[0] === true && s.checkoutShown === true);
  page.state.cart = [line('tee', 999), line('tote', 300)];
  await page.evaluate(() => window.rerender('₹1,299.00'));
  await settle(page, 1200);
  s = await look(page, DAWN_CO);
  check('cart without excluded products: COD usable again and Replace hides Checkout', s.disabled[0] === false && s.checkoutShown === false, JSON.stringify({ disabled: s.disabled, shown: s.checkoutShown }));
  await done(page, '5-dawn-excluded');
}

/* 6. Excluded product + "Hide COD completely" */
{
  const page = await open('dawn', { cfg: { drawerPlacement: 'replace', excludedBehavior: 'hide' }, cart: [line('vase', 450)] });
  await settle(page, 1500);
  const s = await look(page, DAWN_CO);
  check('Hide COD completely: no COD button, Checkout shown', s.buttons === 0 && s.checkoutShown === true, JSON.stringify({ buttons: s.buttons, shown: s.checkoutShown }));
  await done(page, '6-dawn-hide');
}

/* 7. Fee title and "Show fee to customers" */
{
  let page = await open('dawn', { cfg: { codFeeLabel: 'Handling fee' } });
  await waitButton(page);
  let s = await look(page, DAWN_CO);
  check('fee title: the merchant\'s title is used under the button', s.text.includes('Handling fee') && !s.text.includes('Cash on Delivery Fee'), s.text);
  await page.context().close();
  page = await open('dawn', { cfg: { showCodFee: false } });
  await waitButton(page);
  s = await look(page, DAWN_CO);
  check('show fee off: the button doesn\'t mention the fee', !/fee/i.test(s.text) && !s.text.includes('40'), s.text);
  await page.context().close();
  page = await open('dawn', { cfg: { codFee: 0 } });
  await waitButton(page);
  s = await look(page, DAWN_CO);
  check('fee switched off (PHP sends 0): no fee line', !/fee/i.test(s.text), s.text);
  await page.context().close();
}

/* 8. Button styles */
{
  const page = await open('dawn', { cfg: { buttons: { style: 'outline', radius: 0 } } });
  await waitButton(page);
  const s = await look(page, DAWN_CO);
  check('Outline style: transparent with a border in the button colour, merchant radius', s.bg === 'rgba(0, 0, 0, 0)' && s.shadow.includes('rgb(13, 107, 76)') && s.radius === '0px', `${s.bg} ${s.shadow} ${s.radius}`);
  await page.context().close();
}

/* 9. Prestige-style row, a link Checkout, and an unknown theme with the custom selector */
{
  let page = await open('prestige', { cfg: { drawerPlacement: 'below' } });
  await waitButton(page);
  let s = await look(page, '#pr-checkout');
  check('flex row (Checkout next to View cart): COD goes on its own line under the row', s.buttons === 1 && s.slotParent === 'mini-cart__footer' && s.before === false, JSON.stringify({ parent: s.slotParent, before: s.before }));
  await done(page, '9a-prestige-below');

  page = await open('link', { cfg: { drawerPlacement: 'replace' } });
  await waitButton(page);
  s = await look(page, '#link-checkout');
  check('link Checkout (<a href="/checkout">): replaced and hidden', s.buttons === 1 && s.checkoutShown === false);
  await done(page, '9b-link-replace');

  page = await open('custom');
  await settle(page, 1500);
  s = await look(page, '#custom-checkout');
  check('unknown theme without a selector: nothing is added', s.slots === 0);
  await page.context().close();
  page = await open('custom', { cfg: { drawerSelector: '.go-checkout' } });
  await waitButton(page);
  s = await look(page, '#custom-checkout');
  check('unknown theme + merchant\'s Checkout selector: COD added there', s.buttons === 1 && s.before === true);
  await page.context().close();
}

/* 10. Nothing is added when it shouldn't be */
{
  for (const [name, opts] of [
    ['COD off', { cfg: { enabled: false } }],
    ['cart drawer turned off in BRIX', { cfg: { surfaces: { drawer: false, product: true, combo: true } } }],
    ['empty cart', { cart: [] }],
  ]) {
    const page = await open('dawn', opts);
    await settle(page, 1500);
    const s = await look(page, DAWN_CO);
    check(`${name}: no COD button and the theme's Checkout untouched`, s.buttons === 0 && s.checkoutShown === true, JSON.stringify({ buttons: s.buttons, shown: s.checkoutShown }));
    allErrors.push(...page.errors);
    await page.context().close();
  }
}

/* 11. BRIX Cart Drawer on: COD lives in the BRIX drawer, the theme drawer is left alone */
{
  for (const placement of ['above', 'below', 'replace']) {
    const page = await open('dawn', { brixOn: true, cfg: { drawerPlacement: placement } });
    await page.waitForFunction(() => window.__brixCartDrawerActive === true, null, { timeout: 5000 }).catch(() => null);
    await settle(page, 600);
    const theme = await look(page, DAWN_CO);
    if (placement === 'above') check('BRIX drawer on: no COD added to the theme\'s drawer', theme.slots === 0 && theme.checkoutShown === true, JSON.stringify({ slots: theme.slots }));
    await page.evaluate(() => window.testCart());
    await page.waitForSelector('#cc-cod-slot [data-brix-cod-btn]', { timeout: 6000 }).catch(() => null);
    await settle(page, 500);
    const brix = await page.evaluate(() => {
      const slot = document.getElementById('cc-cod-slot');
      const wrap = document.getElementById('cc-checkout-wrap');
      return {
        button: Boolean(slot && slot.querySelector('[data-brix-cod-btn]')),
        before: slot && wrap ? Boolean(slot.compareDocumentPosition(wrap) & Node.DOCUMENT_POSITION_FOLLOWING) : null,
        checkoutShown: wrap ? getComputedStyle(wrap).display !== 'none' : null,
        checkoutButton: Boolean(wrap && wrap.querySelector('a,button')),
      };
    });
    const want = { above: { before: true, shown: true }, below: { before: false, shown: true }, replace: { before: true, shown: false } }[placement];
    check(`BRIX drawer, ${placement} Checkout: COD placed as chosen`, brix.button && brix.checkoutButton && brix.before === want.before && brix.checkoutShown === want.shown, JSON.stringify(brix));
    if (placement === 'replace') await page.screenshot({ path: path.join(shotDir, '11-brix-replace.png') });
    allErrors.push(...page.errors);
    await page.context().close();
  }
  // Excluded product in the BRIX drawer with Replace: Checkout must stay.
  const page = await open('dawn', { brixOn: true, cfg: { drawerPlacement: 'replace' }, cart: [line('jacket', 1500)] });
  await page.waitForFunction(() => window.__brixCartDrawerActive === true, null, { timeout: 5000 }).catch(() => null);
  await page.evaluate(() => window.testCart());
  await page.waitForSelector('#cc-cod-slot [data-brix-cod-btn]', { timeout: 6000 }).catch(() => null);
  await settle(page, 500);
  const brix = await page.evaluate(() => ({
    disabled: document.querySelector('#cc-cod-slot [data-brix-cod-btn]')?.disabled,
    checkoutShown: getComputedStyle(document.getElementById('cc-checkout-wrap')).display !== 'none',
  }));
  check('BRIX drawer, Replace + excluded product: COD unavailable, Checkout kept', brix.disabled === true && brix.checkoutShown === true, JSON.stringify(brix));
  allErrors.push(...page.errors);
  await page.context().close();
}

/* 12. Phone width */
{
  const page = await open('dawn', { viewport: { width: 390, height: 844 }, cfg: { drawerPlacement: 'replace' } });
  await waitButton(page);
  const s = await look(page, DAWN_CO);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('phone width: COD fills the drawer width, no sideways scroll', s.buttons === 1 && s.btnWidth > 300 && !overflow, `${s.btnWidth}px`);
  await done(page, '12-phone');
}

/* 13. Each place's own button look (COD → Customize: cart drawer / product page / combo page) */
{
  const looks = {
    drawer: { style: 'filled', bg: '#0c7a43', color: '#ffffff', fontSize: 17, bold: true, uppercase: true, icon: true, radius: 20 },
    product: { style: 'outline', bg: '#1d4ed8', color: '#ffffff', fontSize: 14, bold: true, uppercase: false, icon: false, radius: 6 },
    combo: { style: 'minimal', bg: '#be185d', color: '#ffffff', fontSize: 16, bold: false, uppercase: false, icon: true, radius: 4 },
  };
  const page = await open('dawn', { cfg: { buttons: { looks, comboText: 'Pay cash' } } });
  await waitButton(page);
  const s = await look(page, DAWN_CO);
  const type = await page.evaluate(() => {
    const b = document.querySelector('[data-brix-cod-drawer] [data-brix-cod-btn]');
    return { size: getComputedStyle(b).fontSize, icon: Boolean(b.querySelector('svg')) };
  });
  check('looks: the drawer button uses the cart drawer look (colour, corners, size, capitals, icon)',
    s.bg === 'rgb(12, 122, 67)' && s.radius === '20px' && s.transform === 'uppercase' && type.size === '17px' && type.icon, JSON.stringify({ ...type, bg: s.bg, radius: s.radius, transform: s.transform }));
  const combo = await page.evaluate(() => window.BrixCod.comboButton());
  check('looks: combo pages get their own look and text from BrixCod.comboButton()',
    combo && combo.text === 'Pay cash' && /color:#be185d/.test(combo.css) && /background:transparent/.test(combo.css) && /border-radius:4px/.test(combo.css) && /font-weight:500/.test(combo.css) && /<svg/.test(combo.icon), JSON.stringify(combo && { text: combo.text, css: combo.css }));
  await page.context().close();

  // Drawer off: the combo page still gets its button.
  const off = await open('dawn', { cfg: { surfaces: { drawer: false, product: true, combo: true }, buttons: { looks } } });
  await settle(off, 1200);
  const offCombo = await off.evaluate(() => window.BrixCod.comboButton());
  check('looks: with the cart drawer off, combo pages still get their COD button', Boolean(offCombo) && (await look(off, DAWN_CO)).buttons === 0);
  allErrors.push(...off.errors);
  await off.context().close();
}

check('no page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots in ${shotDir}`);
process.exit(failed.length ? 1 : 0);

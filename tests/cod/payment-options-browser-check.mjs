/* eslint-env node */
// Browser check for the product page payment options (Pay Online / Cash on
// Delivery) in extensions/cart-drawer/assets/brix_cod.js.
// Run with: node tests/cod/payment-options-browser-check.mjs
// Loads the real script into a Dawn-like product page with every network call
// mocked (no store, no BRIX server). It checks what the page SHOWS; the real
// discount is Shopify's (prepaid Discount Function), which needs a real store.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cod.js'), 'utf8');
const PHP = 'https://php.test';
const shot = (page, name) => page.screenshot({ path: path.join(os.tmpdir(), `brix-pay-${name}.png`), fullPage: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const PREPAID = {
  percent: 10, minSubtotal: 0, currency: 'INR', showBadge: true, showSavingsAmount: true,
  offerTitle: '{percent}% off when you pay online', offerDescription: 'Pay online and save {amount}', minNotMetText: 'Get {percent}% off on orders above {min}',
};
const PAYMENT = {
  heading: 'Choose payment method', defaultMethod: 'online', relabelBuyNow: true,
  online: { enabled: true, label: 'Pay Online', description: 'Get instant savings', buttonText: 'Buy it now', showIcon: true },
  cod: { enabled: true, label: 'Cash on Delivery', description: 'Pay when your order arrives', showIcon: true },
  prepaid: PREPAID,
  layout: { placement: 'before_purchase_buttons', cardLayout: 'horizontal', cardStyle: 'border', selectedStyle: 'radio_border', radius: 8, spacing: 'medium', showRadio: true, showIcons: true, showBanner: true, bannerPlacement: 'above_selector' },
  appearance: { onlineColor: '#008060', codColor: '#111827', cardBackground: '#ffffff', borderColor: '#d1d5db', selectedBackground: '#f0fdf4', badgeBackground: '#008060', badgeText: '#ffffff' },
};
const COD = {
  success: true, enabled: true, surfaces: { drawer: true, product: true, combo: true }, otpRequired: false,
  minOrder: 0, maxOrder: 0, codFee: 50, showCodFee: true, codFeeLabel: 'Cash on Delivery Fee', shippingFee: 0, freeShippingAbove: 0,
  blockedPincodes: [], excludedProductTags: [], excludedBehavior: 'unavailable', allowCoupons: true, prepaidNudgeText: '',
  buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with Cash on Delivery', bg: '#111827', color: '#ffffff', style: 'filled', radius: 12 },
  productButton: { replaceBuyNow: true, marginTop: 10, marginBottom: 0, paddingY: 14, paddingX: 16, radius: 12 },
  sheet: {}, tracking: { ga4Id: '', metaPixelId: '', metaContentId: 'shopify', dataLayer: true },
};

let config = null; // what cod_storefront.php returns
let configStatus = 200;
let prices = [110000, 150000];
const posted = [];
const navigations = [];

const BUY_NOW_HTML = '<div data-shopify="payment-button" class="shopify-payment-button"><shopify-accelerated-checkout><button type="button" class="shopify-payment-button__button shopify-payment-button__button--unbranded">Buy it now</button></shopify-accelerated-checkout></div>';

// A Dawn-like product page. The theme's own JS sets the hidden variant id
// WITHOUT firing an event and redraws the price (like Dawn), and its quantity
// buttons fire `change`.
function productPage({ buyNow = true, block = false, pageType = 'product' } = {}) {
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:Arial,sans-serif;margin:0}main{max-width:1100px;margin:0 auto;padding:16px}
  .product{display:grid;grid-template-columns:1fr 1fr;gap:32px}@media (max-width:749px){.product{grid-template-columns:1fr}}
  .media{background:#eee;aspect-ratio:1}button{text-transform:uppercase;letter-spacing:2px;min-height:48px;width:100%}
  .product-form__buttons>*{margin-bottom:10px}</style></head><body><main>
  <section class="shopify-section"><div class="product">
    <div class="media"></div>
    <div class="product__info-wrapper grid__item">
      <h1>Cold Brew Kit</h1>
      <div id="price-template--main" class="price"><span class="price-item">Rs. 1,100.00</span></div>
      ${block ? '<div data-brix-pay-slot></div>' : ''}
      <variant-selects><label>Size <select id="opt"><option value="21">M</option><option value="22">L</option></select></label></variant-selects>
      <div class="product-form__input product-form__quantity"><quantity-input class="quantity"><button type="button" id="minus" style="width:40px">-</button><input id="qty" name="quantity" form="product-form-main" value="1" style="width:50px"><button type="button" id="plus" style="width:40px">+</button></quantity-input></div>
      <form action="/cart/add" id="product-form-main"><input type="hidden" name="id" value="21">
        <div class="product-form__buttons"><button type="submit" name="add">Add to cart</button>${buyNow ? BUY_NOW_HTML : ''}</div>
      </form>
    </div>
  </div></section></main>
  <script>
    window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'},currency:{active:'INR'}};
    window.ShopifyAnalytics={meta:{page:{pageType:'${pageType}'},product:{variants:[{id:21},{id:22}]}}};
    window.dataLayer=[];
    window.__events=[];document.addEventListener('brix:payment:track',function(e){window.__events.push(e.detail);});
    document.getElementById('opt').addEventListener('change',function(e){var v=e.target.value;setTimeout(function(){
      document.querySelector('[name="id"]').value=v;
      document.getElementById('price-template--main').innerHTML='<span class="price-item">'+(v==='22'?'Rs. 1,500.00':'Rs. 1,100.00')+'</span>';
    },60);});
    var q=document.getElementById('qty');
    document.getElementById('plus').onclick=function(){q.value=Number(q.value)+1;q.dispatchEvent(new Event('change',{bubbles:true}));};
    document.getElementById('minus').onclick=function(){q.value=Math.max(1,Number(q.value)-1);q.dispatchEvent(new Event('change',{bubbles:true}));};
  </script>
  <script src="https://cdn.test/brix_cod.js" data-php="${PHP}" data-shop="demo.myshopify.com" data-currency="INR"></script></body></html>`;
}

const handler = async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
  if (url.origin === 'https://shop.test' && url.pathname.startsWith('/products/') && url.pathname.endsWith('.js')) {
    return json({ tags: ['coffee'], variants: [{ id: 21, price: prices[0] }, { id: 22, price: prices[1] }] });
  }
  if (url.origin === 'https://shop.test' && url.pathname.startsWith('/products/')) {
    return route.fulfill({ contentType: 'text/html', body: productPage({ buyNow: !url.searchParams.has('nobuynow'), block: url.searchParams.has('block'), pageType: url.searchParams.get('type') || 'product' }) });
  }
  if (url.origin === 'https://shop.test' && url.pathname.startsWith('/cart/')) {
    navigations.push(url.pathname);
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>checkout</title><p>checkout</p>' });
  }
  if (url.href === 'https://cdn.test/brix_cod.js') return route.fulfill({ contentType: 'application/javascript', body: SCRIPT });
  if (url.origin === PHP && url.pathname === '/cod_storefront.php') {
    if (configStatus !== 200) return route.fulfill({ status: configStatus, body: 'oops' });
    return json(config);
  }
  if (url.origin === PHP && url.pathname === '/cod_checkout.php') {
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
    const body = JSON.parse(req.postData());
    posted.push(body);
    return json({ success: true, quote: { currency: 'INR', lines: [{ title: 'Cold Brew Kit', variantTitle: 'M', quantity: 1, image: null, originalTotal: 1100, total: 1100, unitPrice: 1100, variantId: '21', productId: '1', sku: 'C' }], itemsTotal: 1100, subtotal: 1100, discounts: 0, shipping: 0, codFee: 50, tax: 0, taxesIncluded: true, total: 1150, coupon: null } });
  }
  return route.fulfill({ status: 404, body: '' });
};

const browser = await chromium.launch();
const errors = [];
async function openPage(query = '', viewport = { width: 1200, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${query}: ${m.text()}`); });
  await page.route('**/*', handler);
  await page.goto(`https://shop.test/products/cold-brew-kit${query}`);
  await page.waitForFunction(() => window.BrixCod);
  return page;
}
const settle = (page, ms = 800) => page.waitForTimeout(ms);
const state = (page) => page.evaluate(() => {
  const box = document.querySelector('[data-brix-pay]');
  const card = (m) => box && box.querySelector(`.bxpay-card[data-method="${m}"]`);
  const bin = document.querySelector('.shopify-payment-button');
  const binBtn = bin && bin.querySelector('button');
  const cta = document.querySelector('[data-brix-pay-cta]');
  return {
    boxes: document.querySelectorAll('[data-brix-pay]').length,
    ctas: document.querySelectorAll('[data-brix-pay-cta]').length,
    online: card('online') ? { checked: card('online').getAttribute('aria-checked'), text: card('online').textContent } : null,
    cod: card('cod') ? { checked: card('cod').getAttribute('aria-checked'), text: card('cod').textContent, disabled: card('cod').getAttribute('aria-disabled') } : null,
    banner: box && box.querySelector('[data-brix-pay-banner]') ? box.querySelector('[data-brix-pay-banner]').textContent : null,
    nativeShown: bin ? getComputedStyle(bin).display !== 'none' : null,
    nativeText: binBtn ? binBtn.textContent : null,
    codBtn: cta && cta.querySelector('[data-brix-cod-btn]') ? cta.querySelector('[data-brix-cod-btn]').textContent : null,
    onlineBtn: cta && cta.querySelector('[data-brix-pay-online]') ? cta.querySelector('[data-brix-pay-online]').textContent : null,
    legacyCod: document.querySelectorAll('[data-brix-cod-slot]').length,
    events: window.__events.map((e) => e.event + (e.payment_method ? ':' + e.payment_method : '')),
    dataLayer: window.dataLayer.filter((e) => e && typeof e.event === 'string' && e.event.startsWith('brix_')).length,
  };
});

/* ── 1. both methods, verified 10% prepaid, desktop ───────────────────────── */
config = { ...COD, productPayment: PAYMENT };
let page = await openPage();
await page.locator('[data-brix-pay] .bxpay-card').first().waitFor({ timeout: 5000 });
await settle(page);
let s = await state(page);
check('loads: one payment selector, two cards', s.boxes === 1 && s.online && s.cod, JSON.stringify({ boxes: s.boxes }));
check('loads: Pay Online selected by default', s.online.checked === 'true' && s.cod.checked === 'false');
check('Pay Online card: "Save 10%" and ₹990 (was ₹1,100), savings ₹110', /Save 10%/.test(s.online.text) && /990/.test(s.online.text) && /1,100/.test(s.online.text) && /save ₹110/.test(s.online.text), s.online.text);
check('COD card: ₹1,100 + ₹50 COD fee, no discount', /Pay ₹1,100/.test(s.cod.text) && /₹50(\.00)? Cash on Delivery Fee/.test(s.cod.text) && !/990/.test(s.cod.text), s.cod.text);
check('offer banner: "10% off when you pay online · Pay online and save ₹110"', s.banner && s.banner.includes('10% off when you pay online') && s.banner.includes('Pay online and save ₹110'), s.banner);
check('Shopify Buy it now relabelled "Buy it now · Save 10%" and shown', s.nativeText === 'Buy it now · Save 10%' && s.nativeShown === true, s.nativeText);
check('no COD button while Pay Online is selected; old COD button not added', !s.codBtn && s.legacyCod === 0);
const order = await page.evaluate(() => {
  const box = document.querySelector('[data-brix-pay]');
  const buttons = document.querySelector('.product-form__buttons');
  return Boolean(box.compareDocumentPosition(buttons) & Node.DOCUMENT_POSITION_FOLLOWING);
});
check('placement: above the purchase buttons', order);
const desk = await page.evaluate(() => [...document.querySelectorAll('.bxpay-card')].map((c) => Math.round(c.getBoundingClientRect().top)));
check('desktop: cards side by side', desk.length === 2 && desk[0] === desk[1], JSON.stringify(desk));
await shot(page, '1-desktop-online');

/* ── 2. switching, no reload ──────────────────────────────────────────────── */
await page.locator('.bxpay-card[data-method="cod"]').click();
await settle(page, 300);
s = await state(page);
check('select COD: COD card selected, Pay Online not', s.cod.checked === 'true' && s.online.checked === 'false');
check('select COD: "Buy with Cash on Delivery" shown, Buy it now hidden', (s.codBtn || '').includes('Buy with Cash on Delivery') && s.nativeShown === false, JSON.stringify({ codBtn: s.codBtn, native: s.nativeShown }));
await shot(page, '2-desktop-cod');
await page.locator('.bxpay-card[data-method="online"]').click();
await settle(page, 300);
s = await state(page);
check('back to Pay Online: Buy it now · Save 10% again, COD button gone', s.online.checked === 'true' && s.nativeShown === true && s.nativeText === 'Buy it now · Save 10%' && !s.codBtn);

/* ── 3. variant + quantity ────────────────────────────────────────────────── */
await page.selectOption('#opt', '22');
await settle(page, 1000);
s = await state(page);
check('variant ₹1,500: online ₹1,350, COD ₹1,500', /1,350/.test(s.online.text) && /Pay ₹1,500/.test(s.cod.text) && /save ₹150/.test(s.online.text), `${s.online.text} | ${s.cod.text}`);
check('variant: banner savings updated (₹150)', s.banner && s.banner.includes('₹150'), s.banner);
await page.selectOption('#opt', '21');
await page.click('#plus');
await settle(page, 1000);
s = await state(page);
check('quantity 2 of ₹1,100: online ₹1,980, COD ₹2,200', /1,980/.test(s.online.text) && /Pay ₹2,200/.test(s.cod.text) && /save ₹220/.test(s.online.text), `${s.online.text} | ${s.cod.text}`);
check('quantity: Buy it now label never stacks', s.nativeText === 'Buy it now · Save 10%', s.nativeText);
const snap = await page.evaluate(() => window.BrixCod.paymentSnapshot());
check('snapshot: variant 21 × 2, subtotal 2200, online 1980', snap.variantId === '21' && snap.quantity === 2 && snap.pricing.subtotal === 2200 && snap.pricing.online === 1980, JSON.stringify(snap));

/* ── 4. theme redraws (AJAX section rendering) ────────────────────────────── */
await page.evaluate((html) => {
  const row = document.querySelector('.product-form__buttons');
  row.outerHTML = `<div class="product-form__buttons"><button type="submit" name="add">Add to cart</button>${html}</div>`;
}, BUY_NOW_HTML);
await settle(page, 1200);
s = await state(page);
check('redraw: still one selector and one purchase slot', s.boxes === 1 && s.ctas === 1, JSON.stringify({ boxes: s.boxes, ctas: s.ctas }));
check('redraw: new Buy it now relabelled once ("Buy it now · Save 10%")', s.nativeText === 'Buy it now · Save 10%', s.nativeText);
// A theme that copies our relabelled text into a new button must not get "Save 10% · Save 10%".
await page.evaluate(() => { const b = document.querySelector('.shopify-payment-button__button'); const c = b.cloneNode(true); c.removeAttribute('data-brix-pay-orig'); b.replaceWith(c); });
await settle(page, 1200);
s = await state(page);
check('redraw with copied text: no duplicate "Save 10%"', s.nativeText === 'Buy it now · Save 10%', s.nativeText);
const before = s.events.length;
await page.evaluate(() => { for (let i = 0; i < 50; i++) document.querySelector('h1').setAttribute('data-x', String(i)); document.querySelector('h1').append(' '); });
await settle(page, 2000);
s = await state(page);
check('MutationObserver: busy page does not re-fire events or relabel again', s.events.length === before && s.nativeText === 'Buy it now · Save 10%', JSON.stringify(s.events));

/* ── 5. keyboard ──────────────────────────────────────────────────────────── */
await page.focus('.bxpay-card[data-method="online"]');
await page.keyboard.press('ArrowRight');
await settle(page, 300);
let focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-method'));
s = await state(page);
check('keyboard: Arrow key moves to Cash on Delivery, selects and focuses it', s.cod.checked === 'true' && focused === 'cod', focused);
await page.keyboard.press('ArrowLeft');
await settle(page, 300);
await page.keyboard.press(' ');
focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-method'));
s = await state(page);
check('keyboard: back with Arrow, Space keeps it, focus stays', s.online.checked === 'true' && focused === 'online');
const a11y = await page.evaluate(() => {
  const group = document.querySelector('[role="radiogroup"]');
  const cards = [...document.querySelectorAll('[role="radio"]')];
  return { label: group && document.getElementById(group.getAttribute('aria-labelledby')) ? document.getElementById(group.getAttribute('aria-labelledby')).textContent : '', tab: cards.map((c) => c.tabIndex), radio: Boolean(document.querySelector('.bxpay-card[aria-checked="true"] .bxpay-radio')) };
});
check('a11y: radiogroup labelled "Choose payment method", roving tabindex, radio dot (not colour only)', a11y.label === 'Choose payment method' && a11y.tab.join() === '0,-1' && a11y.radio, JSON.stringify(a11y));

/* ── 6. analytics ─────────────────────────────────────────────────────────── */
s = await state(page);
const count = (n) => s.events.filter((e) => e === n).length;
check('analytics: viewed once, prepaid offer viewed once', count('brix_payment_method_viewed') === 1 && count('brix_prepaid_offer_viewed') === 1, JSON.stringify(s.events));
check('analytics: one "selected" per real change (cod, online, cod, online)', s.events.filter((e) => e.startsWith('brix_payment_method_selected')).join() === 'brix_payment_method_selected:cod,brix_payment_method_selected:online,brix_payment_method_selected:cod,brix_payment_method_selected:online', JSON.stringify(s.events));
check('analytics: pushed to GTM dataLayer too', s.dataLayer === s.events.length, `${s.dataLayer} vs ${s.events.length}`);

/* ── 7. COD → existing BRIX COD popup ─────────────────────────────────────── */
await page.locator('.bxpay-card[data-method="cod"]').click();
await settle(page, 300);
await page.locator('[data-brix-pay-cta] [data-brix-cod-btn]').click();
await page.locator('[data-brix-cod-sheet]').waitFor({ timeout: 5000 });
await settle(page, 1500);
const quote = posted.find((p) => p.endpoint === 'quote');
check('COD: opens the existing BRIX COD popup, priced through the PHP relay', Boolean(quote) && quote.surface === 'product', JSON.stringify(quote));
check('COD: buys the selected variant and quantity', quote && quote.items[0].variantId === '21' && quote.items[0].quantity === 2, JSON.stringify(quote && quote.items));
check('COD popup: no payment selector inside it', await page.evaluate(() => {
  const host = document.querySelector('[data-brix-cod-sheet]');
  const root = host.shadowRoot || host;
  return !root.querySelector('.bxpay, [data-brix-pay]');
}));
await page.close();

/* ── 8. refresh returns to the default ────────────────────────────────────── */
page = await openPage();
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
await settle(page);
s = await state(page);
check('refresh: back to the configured default (Pay Online)', s.online.checked === 'true' && s.cod.checked === 'false');
await page.close();

/* ── 9. mobile ────────────────────────────────────────────────────────────── */
page = await openPage('', { width: 375, height: 800 });
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
await settle(page);
const mobile = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.bxpay-card')].map((c) => c.getBoundingClientRect());
  return { stacked: cards.length === 2 && cards[1].top >= cards[0].bottom, minH: Math.min(...cards.map((r) => r.height)), overflow: document.documentElement.scrollWidth > window.innerWidth };
});
check('mobile: cards stack, easy to tap (≥ 44px), no horizontal scroll', mobile.stacked && mobile.minH >= 44 && !mobile.overflow, JSON.stringify(mobile));
await shot(page, '3-mobile-online');
await page.locator('.bxpay-card[data-method="cod"]').click();
await settle(page, 300);
await shot(page, '4-mobile-cod');
await page.close();

/* ── 10. minimum not met → no false savings; variant meets it ─────────────── */
prices = [79900, 150000];
config = { ...COD, productPayment: { ...PAYMENT, prepaid: { ...PREPAID, minSubtotal: 999 } } };
page = await openPage();
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
await settle(page);
s = await state(page);
check('below minimum (₹799 < ₹999): no "Save", plain "Pay ₹799"', !/Save/.test(s.online.text) && /Pay ₹799/.test(s.online.text), s.online.text);
check('below minimum: banner says "Get 10% off on orders above ₹999"', s.banner && s.banner.includes('Get 10% off on orders above ₹999'), s.banner);
check('below minimum: Buy it now keeps its own text', s.nativeText === 'Buy it now', s.nativeText);
await page.selectOption('#opt', '22');
await settle(page, 1000);
s = await state(page);
check('variant over the minimum: saving appears (₹1,350)', /Save 10%/.test(s.online.text) && /1,350/.test(s.online.text) && s.nativeText === 'Buy it now · Save 10%', `${s.online.text} | ${s.nativeText}`);
await page.close();
prices = [110000, 150000];

/* ── 11. prepaid not verified / off → never "Save" ────────────────────────── */
config = { ...COD, productPayment: { ...PAYMENT, prepaid: null } };
page = await openPage();
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
await settle(page);
s = await state(page);
check('no verified prepaid: no "Save", no banner, Buy it now untouched', !/Save/.test(s.online.text) && !s.banner && s.nativeText === 'Buy it now', JSON.stringify({ t: s.online.text, b: s.banner, n: s.nativeText }));
await page.close();

/* ── 12. online only / COD only / both off ────────────────────────────────── */
config = { ...COD, productPayment: { ...PAYMENT, cod: { ...PAYMENT.cod, enabled: false } } };
page = await openPage();
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
await settle(page);
s = await state(page);
check('online only: just the Pay Online card, Buy it now shown, no COD button anywhere', s.online && !s.cod && s.nativeShown && !s.codBtn && s.legacyCod === 0);
await page.close();

config = { ...COD, productPayment: { ...PAYMENT, online: { ...PAYMENT.online, enabled: false }, prepaid: null } };
page = await openPage();
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
await settle(page);
s = await state(page);
check('COD only: just the COD card, selected; COD button shown, Buy it now hidden', !s.online && s.cod && s.cod.checked === 'true' && (s.codBtn || '').includes('Buy with Cash on Delivery') && s.nativeShown === false);
await page.close();

config = { ...COD, productPayment: { ...PAYMENT, online: { ...PAYMENT.online, enabled: false }, cod: { ...PAYMENT.cod, enabled: false } } };
page = await openPage();
await settle(page, 1200);
s = await state(page);
check('both off: no selector, no empty container, no COD button, page unchanged', s.boxes === 0 && s.ctas === 0 && s.legacyCod === 0 && s.nativeShown === true && s.nativeText === 'Buy it now', JSON.stringify(s));
await page.close();

/* ── 13. COD off in BRIX: Pay Online still works with its offer ───────────── */
config = { success: true, enabled: false, productPayment: { ...PAYMENT, cod: { ...PAYMENT.cod, enabled: false } } };
page = await openPage();
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
await settle(page);
s = await state(page);
check('COD off: Pay Online card with "Save 10%", no COD card', s.online && /Save 10%/.test(s.online.text) && !s.cod);
await page.close();

/* ── 14. theme without Buy it now: BRIX Pay Online button → checkout ─────── */
config = { ...COD, productPayment: PAYMENT };
page = await openPage('?nobuynow=1');
await page.locator('[data-brix-pay-online]').waitFor({ timeout: 5000 });
s = await state(page);
check('no Buy it now: BRIX "Buy it now · Save 10%" button', s.onlineBtn === 'Buy it now · Save 10%', s.onlineBtn);
await Promise.all([page.waitForURL('**/cart/21:1'), page.locator('[data-brix-pay-online]').click()]);
check('Pay Online: goes to Shopify checkout with this item (prepaid discount applied there)', navigations.includes('/cart/21:1'), navigations.join());
await page.close();

/* ── 15. placements ───────────────────────────────────────────────────────── */
config = { ...COD, productPayment: { ...PAYMENT, layout: { ...PAYMENT.layout, placement: 'below_price', bannerPlacement: 'in_online_card' } } };
page = await openPage();
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
await settle(page);
const belowPrice = await page.evaluate(() => {
  const box = document.querySelector('[data-brix-pay]');
  return { afterPrice: box.previousElementSibling && box.previousElementSibling.id === 'price-template--main', inCard: (document.querySelector('.bxpay-card[data-method="online"] .bxpay-o') || {}).textContent || '', banners: document.querySelectorAll('[data-brix-pay-banner]').length };
});
check('placement below price; offer inside the Pay Online card, shown once', belowPrice.afterPrice && belowPrice.inCard === '10% off when you pay online' && belowPrice.banners === 0, JSON.stringify(belowPrice));
await page.close();

config = { ...COD, productPayment: { ...PAYMENT, layout: { ...PAYMENT.layout, placement: 'below_variants' } } };
page = await openPage();
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
const belowVariants = await page.evaluate(() => document.querySelector('[data-brix-pay]').previousElementSibling.tagName);
check('placement below the variant options', belowVariants === 'VARIANT-SELECTS', belowVariants);
await page.close();

config = { ...COD, productPayment: { ...PAYMENT, layout: { ...PAYMENT.layout, placement: 'below_quantity' } } };
page = await openPage();
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
const belowQty = await page.evaluate(() => { const p = document.querySelector('[data-brix-pay]').previousElementSibling; return p && p.className; });
check('placement below the quantity', /product-form__quantity/.test(belowQty || ''), belowQty);
await page.close();

config = { ...COD, productPayment: PAYMENT };
page = await openPage('?block=1');
await page.locator('.bxpay-card').first().waitFor({ timeout: 5000 });
const inBlock = await page.evaluate(() => Boolean(document.querySelector('[data-brix-pay-slot] [data-brix-pay]')));
check('theme block: shown inside the "Payment options" block', inBlock);
await page.close();

/* ── 16. failures and other pages ─────────────────────────────────────────── */
configStatus = 500;
page = await openPage();
await settle(page, 1200);
s = await state(page);
check('config unavailable: nothing added, Buy it now untouched, no errors', s.boxes === 0 && s.legacyCod === 0 && s.nativeText === 'Buy it now' && s.nativeShown === true);
await page.close();
configStatus = 200;

page = await openPage('?type=collection');
await settle(page, 1200);
s = await state(page);
check('not a product page: no payment selector', s.boxes === 0);
await page.close();

check('no console errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed (screenshots: ${path.join(os.tmpdir(), 'brix-pay-*.png')})`);
process.exit(failed ? 1 : 0);

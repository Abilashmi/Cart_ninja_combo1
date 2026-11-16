/* eslint-env node */
// Browser check for the BRIX Cart Drawer's upsell products and stock
// (extensions/cart-drawer/assets/cart_drawer_inline.js): the first IN-STOCK
// variant is the default, a variant dropdown lists the options (sold-out ones
// can't be picked), Add adds the chosen variant, a sold-out pick is replaced
// with Shopify's related products (or hidden), and a refused add says
// "Sold out". Run from the repo root:
//   node tests/cart-drawer/upsell-stock-browser-check.mjs
// Every network call is mocked (cart.js, products.json, recommendations, PHP).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const JS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/cart_drawer_inline.js'), 'utf8');
const CSS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/cart_drawer_inline.css'), 'utf8');
const UI_CSS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cart_ui.css'), 'utf8');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const CART = [{
  key: 'k1', product_id: 1, variant_id: 10, handle: 'p1', product_title: 'Boys Joggers', variant_title: '8-9 Y',
  product_has_only_default_variant: false, quantity: 1, final_price: 27500, original_price: 27500,
  final_line_price: 27500, original_line_price: 27500, image: '', properties: {},
}];

// /products.json shape: prices as "449.00".
const v = (id, title, price, available, compare = null) => ({ id, title, price, compare_at_price: compare, available, featured_image: { src: `https://img.test/v${id}.svg` } });
const PRODUCTS = [
  { id: 101, title: 'Girls Grey Denim Jeans', handle: 'jeans', images: [{ src: 'https://img.test/jeans.svg' }],
    variants: [v(1011, '5-6 years', '899.00', false, '1299.00'), v(1012, '7-8 years', '899.00', true, '1299.00'), v(1013, '9-10 years', '949.00', true, '1299.00')] },
  { id: 102, title: 'Navy Co-ord Set', handle: 'coord', images: [{ src: 'https://img.test/coord.svg' }],
    variants: [v(1021, '5-6 Y', '1099.00', false), v(1022, '7-8 Y', '1099.00', false)] },
  { id: 103, title: 'Cotton Socks', handle: 'socks', images: [{ src: 'https://img.test/socks.svg' }],
    variants: [v(1031, 'Default Title', '199.00', true)] },
];
// /recommendations/products.json shape: prices in paise.
const rec = (id, title, price, available) => ({ id, title, handle: `r${id}`, featured_image: `https://img.test/r${id}.svg`, price: price * 100, available,
  variants: [{ id: id * 10, title: 'Default Title', price: price * 100, compare_at_price: null, available }] });
const RELATED = {
  102: [rec(1, 'Boys Joggers', 275, true), rec(202, 'Sold Out Cap', 299, false), rec(201, 'Blue Co-ord Set', 999, true)],
  // For the cart's Boys Joggers (product 1): Shopify's own related products.
  1: [rec(301, 'Kids Cap', 299, true), rec(302, 'Sold Out Belt', 199, false), rec(1, 'Boys Joggers', 275, true), rec(303, 'Sun Hat', 349, true), rec(305, 'Rain Boots', 799, true)],
};
// intent=complementary (the merchant's Search & Discovery picks).
const COMPLEMENTARY = { 1: [rec(304, 'Matching Tee', 399, true)] };

function config(upsell = {}) {
  return {
    status: 'success',
    data: {
      cartStatus: '1', checkoutName: 'Checkout', header_title: 'Your Cart',
      upsell_status: 1,
      upsell_data: JSON.stringify({
        enabled: true, useAI: false, position: 'bottom', direction: 'vertical', layout: 'carousel', buttonText: 'Add',
        manualRules: [{ id: 'r1', enabled: true, triggerType: 'all', triggerProductIds: [], upsellProductIds: ['gid://shopify/Product/101', 'gid://shopify/Product/102', 'gid://shopify/Product/103'] }],
        ...upsell,
      }),
    },
  };
}

const page0 = () => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8">
  <style>body{margin:0;font-family:Arial,sans-serif} select{width:100%;height:50px;text-transform:uppercase}</style>
  <link rel="stylesheet" href="https://cdn.test/cart_drawer_inline.css"><link rel="stylesheet" href="https://cdn.test/brix_cart_ui.css"></head>
  <body><main><h1>Store</h1></main>
  <div id="cc-root" data-shop="demo.myshopify.com" data-currency="INR"></div>
  <script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'},currency:{active:'INR'}};</script>
  <script src="https://cdn.test/cart_drawer_inline.js"></script></body></html>`;

const browser = await chromium.launch();

async function open({ cfg = config(), refuse = [], width = 1280, slowCatalog = 0, cart = CART, slowRelated = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const net = { adds: [], related: [], intents: [] };
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://cdn.test') {
      const body = { '/cart_drawer_inline.js': JS, '/cart_drawer_inline.css': CSS, '/brix_cart_ui.css': UI_CSS }[url.pathname];
      return route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8', body });
    }
    if (url.origin === 'https://img.test') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>' });
    if (url.origin === 'https://int.thebrix.io') {
      if (url.pathname === '/save_cart_drawer.php') return json(cfg);
      return json({ status: 'success', data: [] });
    }
    if (url.origin === 'https://shop.test') {
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: page0() });
      if (url.pathname === '/cart.js') return json({ items: cart, item_count: cart.length, total_price: cart.reduce((n, it) => n + it.final_line_price, 0), currency: 'INR' });
      if (url.pathname === '/products.json') {
        if (slowCatalog) await new Promise((r) => setTimeout(r, slowCatalog));
        return json({ products: url.searchParams.get('page') ? [] : PRODUCTS });
      }
      if (url.pathname === '/recommendations/products.json') {
        if (slowRelated) await new Promise((r) => setTimeout(r, slowRelated));
        const intent = url.searchParams.get('intent');
        net.intents.push(`${intent}:${url.searchParams.get('product_id')}`);
        if (intent === 'complementary') return json({ products: COMPLEMENTARY[url.searchParams.get('product_id')] || [] });
        net.related.push(url.searchParams.get('product_id'));
        return json({ products: RELATED[url.searchParams.get('product_id')] || [] });
      }
      if (url.pathname === '/cart/add.js') {
        const body = JSON.parse(req.postData() || '{}');
        const id = body.items?.[0]?.id;
        net.adds.push(id);
        if (refuse.includes(id)) return json({ status: 422, description: 'All 1 of this item are in your cart.' }, 422);
        return json({ items: body.items });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://shop.test/');
  await page.waitForFunction(() => typeof window.testCart === 'function');
  await page.waitForTimeout(300);
  const t0 = Date.now();
  await page.evaluate(() => window.testCart());
  await page.waitForSelector('#cc-overlay.active .bxcd-item', { timeout: 8000 });
  page.openMs = Date.now() - t0;
  await page.waitForSelector('.cc-upsell-card', { timeout: slowCatalog + 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  page.net = net;
  return page;
}

const titles = (page) => page.$$eval('.cc-upsell-card', (cards) => cards.map((c) => (c.querySelector('.cc-upsell-v-title, .cc-upsell-title, p') || {}).textContent.trim()));
const card = (page, title) => page.locator('.cc-upsell-card', { hasText: title });

// ── default: replace sold-out, dropdown, in-stock default variant ──
{
  const page = await open({ refuse: [1013] });
  const t = await titles(page);
  check('sold-out pick hidden, its spot filled by Shopify related (in stock, not in cart)',
    t.length === 3 && t.includes('Girls Grey Denim Jeans') && t.includes('Cotton Socks') && t.includes('Blue Co-ord Set') && !t.includes('Navy Co-ord Set'), JSON.stringify(t));
  check('related products asked for the sold-out product first', page.net.related[0] === '102', JSON.stringify(page.net.related));

  const jeans = card(page, 'Girls Grey Denim Jeans');
  const select = jeans.locator('select.cc-upsell-variant');
  check('multi-variant product gets a dropdown', (await select.count()) === 1);
  check('dropdown defaults to the first IN-STOCK size', (await select.inputValue()) === '1012');
  const opts = await select.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, d: o.disabled, t: o.textContent })));
  check('sold-out size is listed but cannot be picked', opts.length === 3 && opts[0].d === true && opts[0].t.includes('Sold out') && !opts[1].d, JSON.stringify(opts));
  check('single-variant product has no dropdown', (await card(page, 'Cotton Socks').locator('select').count()) === 0);
  const box = await select.boundingBox();
  check('dropdown fits the card (theme select styles overridden)', box && box.height <= 32, JSON.stringify(box));

  // Count full drawer redraws from the tap on (extrokids: 4 in half a second
  // looked like the cart opening twice).
  await page.evaluate(() => {
    window.__redraws = 0;
    new MutationObserver(() => { window.__redraws++; }).observe(document.getElementById('cc-drawer'), { childList: true });
  });
  await jeans.locator('.cc-add-btn').click();
  await page.waitForTimeout(300);
  check('Add adds the in-stock size, not the sold-out first variant', page.net.adds[0] === 1012, JSON.stringify(page.net.adds));

  await page.waitForTimeout(1700);
  const redraws = await page.evaluate(() => window.__redraws);
  check('an upsell Add redraws the open drawer once, not again on timers', redraws === 1, `${redraws} redraws`);
  const jeans2 = card(page, 'Girls Grey Denim Jeans');
  await jeans2.locator('select.cc-upsell-variant').selectOption('1013');
  check('picking a size updates the price', (await jeans2.locator('.cc-upsell-price').textContent()).includes('949'), await jeans2.locator('.cc-upsell-price').textContent());
  await jeans2.locator('.cc-add-btn').click();
  await page.waitForTimeout(300);
  check('Add adds the picked size', page.net.adds.includes(1013), JSON.stringify(page.net.adds));
  check('a refused add says Sold out', (await jeans2.locator('.cc-add-btn').textContent()).includes('Sold out'));
  const after = await jeans2.locator('select.cc-upsell-variant').evaluate((s) => ({ value: s.value, refusedDisabled: [...s.options].find((o) => o.value === '1013').disabled }));
  check('refused size is marked sold out and the dropdown moves to an in-stock size', after.refusedDisabled && after.value === '1012', JSON.stringify(after));
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.close();
}

// ── Shopify recommendations mode (big catalogues: no rules, any product) ──
{
  const page = await open({ cfg: config({ useAI: true, upsellMode: 'shopify', limit: 3 }) });
  const t = await titles(page);
  check('shopify mode: complementary first, then related, sold-out and in-cart left out, up to the limit',
    JSON.stringify(t) === JSON.stringify(['Matching Tee', 'Kids Cap', 'Sun Hat']), JSON.stringify(t));
  check('shopify mode: the merchant\'s rules are not used', !t.includes('Cotton Socks') && !t.includes('Girls Grey Denim Jeans'));
  check('shopify mode: asked Shopify about the cart\'s product', page.net.intents.includes('complementary:1') && page.net.intents.includes('related:1'), JSON.stringify(page.net.intents));
  check('shopify mode: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.close();
}

// ── AI mode: a cart no generated rule covers is filled from Shopify ──
{
  const rules = [{ id: 'ai1', aiGenerated: true, enabled: true, triggerType: 'specific', triggerProductIds: ['gid://shopify/Product/999'], upsellProductIds: ['gid://shopify/Product/103'] }];
  const page = await open({ cfg: config({ useAI: true, upsellMode: 'ai', limit: 2, manualRules: rules }) });
  const t = await titles(page);
  check('ai mode: no rule for the cart → Shopify\'s recommendations instead of nothing', JSON.stringify(t) === JSON.stringify(['Matching Tee', 'Kids Cap']), JSON.stringify(t));
  await page.close();
}

// ── Manual mode is unchanged: only the merchant's picks, no recommendations ──
{
  const rules = [{ id: 'm1', enabled: true, triggerType: 'specific', triggerProductIds: ['gid://shopify/Product/999'], upsellProductIds: ['gid://shopify/Product/103'] }];
  const page = await open({ cfg: config({ useAI: false, manualRules: rules }) });
  check('manual mode: no rule matches → no upsells, nothing asked of Shopify', (await titles(page)).length === 0 && page.net.intents.length === 0, JSON.stringify(page.net.intents));
  await page.close();
}

// ── "Just hide it" ──
{
  const page = await open({ cfg: config({ soldOutBehavior: 'hide' }) });
  const t = await titles(page);
  check('hide: sold-out pick left out, nothing added in its place', t.length === 2 && !t.includes('Blue Co-ord Set'), JSON.stringify(t));
  check('hide: no related products fetched', page.net.related.length === 0);
  await page.close();
}

// ── a slow catalogue never holds the drawer back (it made every add after the
// first slow: a new product in the cart needs more catalogue pages) ──
{
  const page = await open({ slowCatalog: 3000 });
  check('slow catalogue: the drawer opens with the cart at once', page.openMs < 1200, `${page.openMs} ms`);
  const t = await titles(page);
  check('slow catalogue: the upsells fill in once it answers, drawer still open', t.length === 3 && await page.locator('#cc-overlay.active').count() === 1, JSON.stringify(t));
  check('slow catalogue: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.close();
}

// ── A product the drawer offers, then added from its own product page while
// the new cart's picks are still loading: the drawer used to open with the
// old picks (still offering it) and, opened more than once by the add, kept
// them for good (pabra: "it sticks the cart upsell product"). ──
{
  // Nothing related for the sold-out pick or the joggers: the new cart's
  // picks need a fresh (slow) lookup for the product just added.
  const saved = { 102: RELATED[102], 1: RELATED[1] };
  RELATED[102] = []; RELATED[1] = [];
  const cart = CART.slice();
  const page = await open({ cart, slowRelated: 1500 });
  await page.waitForTimeout(3500);
  const before = await page.$$eval('.cc-upsell-card', (cards) => cards.map((c) => c.getAttribute('data-cc-product')));
  check('in cart: the drawer offers Cotton Socks first', before.includes('103'), JSON.stringify(before));
  await page.evaluate(() => document.getElementById('cc-overlay').classList.remove('active'));
  cart.push({ ...CART[0], key: 'k2', product_id: 103, variant_id: 1031, handle: 'socks', product_title: 'Cotton Socks', variant_title: null, product_has_only_default_variant: true, final_price: 19900, original_price: 19900, final_line_price: 19900, original_line_price: 19900 });
  // The product page's own add (the theme's fetch), then the drawer opens.
  await page.evaluate(() => fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 1031, quantity: 1 }] }) }));
  await page.waitForSelector('#cc-overlay.active', { timeout: 5000 });
  await page.waitForTimeout(400);
  const opening = await page.$$eval('.cc-upsell-card', (cards) => cards.map((c) => c.getAttribute('data-cc-product')));
  check('in cart: while the new picks load, the product just added is not offered', !opening.includes('103'), JSON.stringify(opening));
  await page.evaluate(() => window.testCart());
  await page.waitForTimeout(3500);
  const settled = await page.$$eval('.cc-upsell-card', (cards) => cards.map((c) => c.getAttribute('data-cc-product')));
  check('in cart: the new picks replace the old ones, the added product never comes back', settled.length > 0 && !settled.includes('103'), JSON.stringify(settled));
  check('in cart: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.close();
  Object.assign(RELATED, saved);
}

// ── grid and compact card styles also get the dropdown ──
for (const [name, upsell] of [['grid', { layout: 'grid' }], ['compact', { direction: 'horizontal' }]]) {
  const page = await open({ cfg: config(upsell) });
  const sel = card(page, 'Girls Grey Denim Jeans').locator('select.cc-upsell-variant');
  check(`${name} card has the dropdown on the in-stock size`, (await sel.count()) === 1 && (await sel.inputValue()) === '1012');
  await page.close();
}

// ── Slider (one product at a time): full-width list rows, one per slide.
// Desktop: arrows outside the row. Phones: no arrows, the row as wide as the
// section, and it moves on its own (back to the first after the last) ──
{
  const page = await open({ cfg: config({ direction: 'vertical', layout: 'carousel', listSlider: true }), width: 1280 });
  await page.waitForSelector('.cc-upsell-card--row', { timeout: 8000 }).catch(() => {});
  const m = await page.evaluate(() => {
    const list = document.getElementById('cc-upsell-list');
    const rows = [...document.querySelectorAll('.cc-upsell-card--row')];
    const lr = list.getBoundingClientRect();
    const r0 = rows[0] && rows[0].getBoundingClientRect();
    const right = document.getElementById('upsell-nav-right'), left = document.getElementById('upsell-nav-left');
    const rr = right && right.getBoundingClientRect();
    return { n: rows.length, fill: r0 ? Math.abs(r0.width - lr.width) < 1 : false,
      oneShown: rows.filter((r) => { const b = r.getBoundingClientRect(); return b.left >= lr.left - 1 && b.right <= lr.right + 1; }).length,
      rightShown: !!right && getComputedStyle(right).display !== 'none', leftShown: !!left && getComputedStyle(left).display !== 'none',
      arrowOutside: rr ? rr.left >= lr.right - 6 : false, page: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  check('slider (desktop): one full-width row per slide, the next one hidden', m.n === 3 && m.fill && m.oneShown === 1, JSON.stringify(m));
  check('slider (desktop): → shown outside the row, ← hidden at the start, no page scroll', m.rightShown && !m.leftShown && m.arrowOutside && !m.page, JSON.stringify(m));
  await page.locator('#upsell-nav-right').click();
  await page.waitForTimeout(700);
  const second = await page.evaluate(() => {
    const list = document.getElementById('cc-upsell-list'), lr = list.getBoundingClientRect();
    const shown = [...document.querySelectorAll('.cc-upsell-card--row')].findIndex((r) => Math.abs(r.getBoundingClientRect().left - lr.left) < 2);
    return { shown, left: getComputedStyle(document.getElementById('upsell-nav-left')).display !== 'none' };
  });
  check('slider (desktop): → moves exactly one product, ← appears', second.shown === 1 && second.left, JSON.stringify(second));
  await page.waitForTimeout(4200);
  check('slider (desktop): never moves on its own', await page.evaluate(() => [...document.querySelectorAll('.cc-upsell-card--row')].findIndex((r) => Math.abs(r.getBoundingClientRect().left - document.getElementById('cc-upsell-list').getBoundingClientRect().left) < 2)) === 1);
  // Closed and opened again: the drawer reuses the list it built for this
  // cart; its arrows used to stay hidden until an add (pabra).
  await page.click('#cc-backdrop', { position: { x: 5, y: 5 } }).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => window.testCart());
  await page.waitForSelector('#cc-overlay.active .cc-upsell-card--row', { timeout: 5000 });
  await page.waitForTimeout(600);
  const reopened = await page.evaluate(() => ({
    right: getComputedStyle(document.getElementById('upsell-nav-right')).display !== 'none',
  }));
  check('slider (desktop): opened again, the → arrow shows without an add', reopened.right, JSON.stringify(reopened));
  await page.locator('#upsell-nav-right').click();
  await page.waitForTimeout(700);
  check('slider (desktop): opened again, → still moves one product', await page.evaluate(() => [...document.querySelectorAll('.cc-upsell-card--row')].findIndex((r) => Math.abs(r.getBoundingClientRect().left - document.getElementById('cc-upsell-list').getBoundingClientRect().left) < 2)) === 1);
  await page.close();
}
{
  const page = await open({ cfg: config({ direction: 'vertical', layout: 'carousel', listSlider: true }), width: 390 });
  await page.waitForSelector('.cc-upsell-card--row', { timeout: 8000 }).catch(() => {});
  const shownNow = () => page.evaluate(() => {
    const lr = document.getElementById('cc-upsell-list').getBoundingClientRect();
    return [...document.querySelectorAll('.cc-upsell-card--row')].findIndex((r) => Math.abs(r.getBoundingClientRect().left - lr.left) < 2);
  });
  const m = await page.evaluate(() => {
    const row = document.querySelector('.cc-upsell-card--row').getBoundingClientRect();
    const title = document.querySelector('.cc-upsell-section p').getBoundingClientRect();
    return { arrows: [...document.querySelectorAll('#upsell-nav-left, #upsell-nav-right')].filter((b) => getComputedStyle(b).display !== 'none').length,
      left: Math.round(row.left - title.left), right: Math.round(title.right - row.right), page: document.documentElement.scrollWidth > innerWidth + 1 };
  });
  check('slider (phone): no arrows, the row as wide as the section (100%)', m.arrows === 0 && Math.abs(m.left) <= 1 && Math.abs(m.right) <= 1 && !m.page, JSON.stringify(m));
  await page.locator('.cc-upsell-section').screenshot({ path: path.join(os.tmpdir(), 'upsell-list-slider-390.png') }).catch(() => {});
  const seen = [await shownNow()];
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(3700); seen.push(await shownNow()); }
  check('slider (phone): slides on its own, one product at a time, back to the first after the last', JSON.stringify(seen) === '[0,1,2,0]', JSON.stringify(seen));
  // A swipe pauses it.
  await page.locator('#cc-upsell-list').dispatchEvent('pointerdown');
  const before = await shownNow();
  await page.waitForTimeout(4000);
  check('slider (phone): a touch pauses the auto slide', (await shownNow()) === before, String(before));
  await page.close();
}
{
  const page = await open({ cfg: config({ direction: 'vertical', layout: 'carousel', listSlider: true }) });
  const jeans = card(page, 'Girls Grey Denim Jeans');
  const sel = jeans.locator('select.cc-upsell-variant');
  check('slider row: dropdown on the in-stock size', (await sel.count()) === 1 && (await sel.inputValue()) === '1012');
  await sel.selectOption('1013');
  check('slider row: picking a size changes the price', ((await jeans.locator('.cc-upsell-price').textContent()) || '').includes('949'));
  check('slider row: Add carries the picked size', (await jeans.locator('.cc-add-btn').getAttribute('data-cc-id')) === '1013');
  // A tap that started on one card's Add and lands on another's (the row slid
  // under the finger, or the drawer redrew) adds nothing (pabra: "adds another product").
  const moved = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.cc-upsell-card .cc-add-btn')];
    btns[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    btns[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return btns[1].getAttribute('data-cc-id');
  });
  await page.waitForTimeout(600);
  check('slider row: a tap that slid onto another card adds nothing', page.net.adds.length === 0, JSON.stringify(page.net.adds) + ' (other card ' + moved + ')');
  await page.waitForTimeout(1500); // the press guard's window
  await jeans.locator('.cc-add-btn').click();
  await page.waitForTimeout(600);
  check('slider row: a normal tap still adds that card\'s product', JSON.stringify(page.net.adds) === '[1013]', JSON.stringify(page.net.adds));
  await page.close();
}
{
  // One product: no arrows, so no space kept for them: the row is as wide as the section title.
  const one = [{ id: 'r1', enabled: true, triggerType: 'all', triggerProductIds: [], upsellProductIds: ['gid://shopify/Product/103'] }];
  const page = await open({ cfg: config({ direction: 'vertical', layout: 'carousel', listSlider: true, manualRules: one }), width: 390 });
  await page.waitForSelector('.cc-upsell-card--row', { timeout: 8000 }).catch(() => {});
  const m = await page.evaluate(() => {
    const row = document.querySelector('.cc-upsell-card--row').getBoundingClientRect();
    const title = document.querySelector('.cc-upsell-section p').getBoundingClientRect();
    const sel = document.querySelector('.cc-upsell-card--row .cc-upsell-variant');
    return { rowLeft: Math.round(row.left), titleLeft: Math.round(title.left), rowRight: Math.round(row.right), titleRight: Math.round(title.right),
      arrows: [...document.querySelectorAll('#upsell-nav-left, #upsell-nav-right')].filter((b) => getComputedStyle(b).display !== 'none').length,
      selH: sel ? Math.round(sel.getBoundingClientRect().height) : null };
  });
  check('slider, one product: no arrows, the row lines up with the section title (no empty sides)', m.arrows === 0 && Math.abs(m.rowLeft - m.titleLeft) <= 1 && Math.abs(m.rowRight - m.titleRight) <= 1, JSON.stringify(m));
  await page.locator('.cc-upsell-section').screenshot({ path: path.join(os.tmpdir(), 'upsell-list-slider-one-390.png') }).catch(() => {});
  await page.close();
}
{
  const page = await open({ cfg: config({ direction: 'vertical', layout: 'grid', listSlider: true }) });
  check('listSlider only counts with Carousel: Grid stays a grid', (await page.locator('.cc-upsell-card--row').count()) === 0 && (await page.locator('.cc-layout-grid').count()) > 0);
  await page.close();
}

// ── Sticky at the bottom: on a short cart it sits right on the footer (it
// used to sit after the items with empty space below it); with a bottom
// coupon section after it, that keeps its place under the upsell ──
for (const width of [1280, 390]) {
  const page = await open({ cfg: config({ sticky: true, position: 'bottom', layout: 'carousel', listSlider: true }), width });
  await page.waitForSelector('.cc-upsell-section--sticky', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const up = document.querySelector('.cc-upsell-section--sticky').getBoundingClientRect();
    const foot = document.getElementById('cc-drawer-footer').getBoundingClientRect();
    const items = document.querySelector('.bxcd-items').getBoundingClientRect();
    return { gap: Math.round(foot.top - up.bottom), spaceAbove: Math.round(up.top - items.bottom) };
  });
  check(`sticky bottom upsell (${width}px): sits right on the footer, the free space above it`, Math.abs(m.gap) <= 1 && m.spaceAbove > 20, JSON.stringify(m));
  if (width === 390) await page.screenshot({ path: path.join(os.tmpdir(), 'upsell-sticky-bottom-390.png') }).catch(() => {});
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

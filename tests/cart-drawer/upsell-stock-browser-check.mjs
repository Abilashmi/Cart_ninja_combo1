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
};

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

async function open({ cfg = config(), refuse = [], width = 1280 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const net = { adds: [], related: [] };
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
      if (url.pathname === '/cart.js') return json({ items: CART, item_count: 1, total_price: 27500, currency: 'INR' });
      if (url.pathname === '/products.json') return json({ products: url.searchParams.get('page') ? [] : PRODUCTS });
      if (url.pathname === '/recommendations/products.json') {
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
  await page.evaluate(() => window.testCart());
  await page.waitForSelector('#cc-drawer', { timeout: 5000 });
  await page.waitForSelector('.cc-upsell-card', { timeout: 5000 }).catch(() => {});
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

  await jeans.locator('.cc-add-btn').click();
  await page.waitForTimeout(300);
  check('Add adds the in-stock size, not the sold-out first variant', page.net.adds[0] === 1012, JSON.stringify(page.net.adds));

  await page.waitForTimeout(1700);
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

// ── "Just hide it" ──
{
  const page = await open({ cfg: config({ soldOutBehavior: 'hide' }) });
  const t = await titles(page);
  check('hide: sold-out pick left out, nothing added in its place', t.length === 2 && !t.includes('Blue Co-ord Set'), JSON.stringify(t));
  check('hide: no related products fetched', page.net.related.length === 0);
  await page.close();
}

// ── grid and compact card styles also get the dropdown ──
for (const [name, upsell] of [['grid', { layout: 'grid' }], ['compact', { direction: 'horizontal' }]]) {
  const page = await open({ cfg: config(upsell) });
  const sel = card(page, 'Girls Grey Denim Jeans').locator('select.cc-upsell-variant');
  check(`${name} card has the dropdown on the in-stock size`, (await sel.count()) === 1 && (await sel.inputValue()) === '1012');
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

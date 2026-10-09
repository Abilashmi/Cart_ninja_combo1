/* eslint-env node */
// Browser check: the FBT v2 storefront widget (extensions/cart-drawer/assets/brix_fbt.js)
// on a mocked Dawn-like product page. Every network call is mocked: the PHP
// settings endpoint, /products/<handle>.js, collections, Shopify
// recommendations and /cart/add.js.
// Run from the repo root: node tests/fbt/storefront-browser-check.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ASSET = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_fbt.js'), 'utf8');
const shots = path.join(os.tmpdir(), 'brix-fbt');
fs.mkdirSync(shots, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const v = (id, title, price, extra = {}) => ({ id, title, public_title: title === 'Default Title' ? null : title, price, compare_at_price: null, available: true, ...extra });
const PRODUCTS = {
  tee: { id: 1, handle: 'tee', title: 'Classic Tee', featured_image: '//cdn.shopify.com/tee.jpg', variants: [v(11, 'S', 59900), v(12, 'M', 59900)] },
  shorts: { id: 2, handle: 'shorts', title: 'Denim Shorts', featured_image: '//cdn.shopify.com/shorts.jpg', variants: [v(21, 'Default Title', 39900, { compare_at_price: 49900 })] },
  'sold-out': { id: 3, handle: 'sold-out', title: 'Sold Out Shorts', variants: [v(31, 'Default Title', 29900, { available: false })] },
  cap: { id: 4, handle: 'cap', title: 'Cap', featured_image: '//cdn.shopify.com/cap.jpg', variants: [v(41, 'Black', 19900), v(42, 'White', 24900)] },
  socks: { id: 5, handle: 'socks', title: 'Socks', variants: [v(51, 'Default Title', 9900)] },
  belt: { id: 6, handle: 'belt', title: 'Belt', variants: [v(61, 'Default Title', 14900)] },
};
const CONFIG = {
  version: 2, style: 'bundle', title: 'Frequently bought together', maxItems: 3, placement: 'below_cart',
  sources: { orders: true, carts: true, ai: true, shopify: true },
  rules: [
    { id: 'r1', when: { type: 'collections', collections: [{ id: '50', handle: 'tees', title: 'Tees' }] }, show: { type: 'collection', collection: { id: '60', handle: 'bottoms', title: 'Bottoms' } } },
  ],
  pairs: { 1: [{ id: '4', handle: 'cap', source: 'orders' }, { id: '5', handle: 'socks', source: 'orders' }] },
};

function page(product = 'tee', collections = '50', handles = 'tees') {
  const p = PRODUCTS[product];
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:0}main{max-width:900px;margin:0 auto;padding:16px}
    button{text-transform:uppercase;letter-spacing:2px;width:100%;min-height:48px;border-radius:0;background:#000;color:#fff}</style></head><body><main>
    <h1>${p.title}</h1>
    <form action="/cart/add" id="product-form"><select name="id" id="variant">${p.variants.map((x) => `<option value="${x.id}">${x.title}</option>`).join('')}</select>
      <div class="product-form__buttons"><button type="submit" name="add" id="atc">Add to cart</button></div></form>
    <p id="after">description</p>
    <div data-brix-fbt data-shop="demo.myshopify.com" data-product-id="${p.id}" data-product-handle="${p.handle}" data-collection-ids="${collections}" data-collection-handles="${handles}" data-money-format="Rs. {{amount}}" data-in-section="" data-design-mode="false" style="display:none"></div>
    </main><script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};window.__opened=0;document.addEventListener('cart:open',function(){window.__opened++;});</script>
    <script src="https://cdn.test/brix_fbt.js" defer></script></body></html>`;
}

const browser = await chromium.launch();
const errors = [];

async function open({ data, product, viewport = { width: 1200, height: 900 }, recs = [], addStatus = 200 } = {}) {
  const ctx = await browser.newContext({ viewport });
  const pg = await ctx.newPage();
  const net = { adds: [], recs: 0, settings: 0 };
  pg.on('pageerror', (e) => errors.push(e.message));
  await pg.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.href === 'https://cdn.test/brix_fbt.js') return route.fulfill({ contentType: 'application/javascript', body: ASSET });
    if (url.origin === 'https://int.thebrix.io' && url.pathname === '/save_fbt_widget.php') { net.settings++; return json({ status: 'success', data }); }
    if (url.hostname === 'cdn.shopify.com') {
      const hue = [...url.pathname].reduce((n, c) => n + c.charCodeAt(0), 0) % 360;
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="hsl(${hue},60%,85%)"/><circle cx="150" cy="140" r="70" fill="hsl(${hue},55%,55%)"/></svg>` });
    }
    if (url.origin !== 'https://shop.test') return route.fulfill({ status: 404, body: '' });
    let m = /^\/products\/([^/]+)\.js$/.exec(url.pathname);
    if (m) return PRODUCTS[m[1]] ? json(PRODUCTS[m[1]]) : json({}, 404);
    m = /^\/collections\/([^/]+)\/products\.json$/.exec(url.pathname);
    if (m) return json({ products: m[1] === 'bottoms' ? [PRODUCTS['sold-out'], PRODUCTS.shorts, PRODUCTS.tee] : [] });
    if (url.pathname === '/recommendations/products.json') { net.recs++; return json({ products: recs.map((h) => PRODUCTS[h]) }); }
    if (url.pathname === '/cart/add.js') {
      net.adds.push(JSON.parse(route.request().postData()));
      return addStatus === 200 ? json({ items: [] }) : json({ status: 422, description: 'Only 1 left in stock.' }, 422);
    }
    if (url.pathname.startsWith('/products/')) return route.fulfill({ contentType: 'text/html', body: page(product || url.pathname.split('/')[2]) });
    return route.fulfill({ status: 404, body: '' });
  });
  await pg.goto(`https://shop.test/products/${product || 'tee'}`);
  await pg.waitForSelector('.bxf', { timeout: 5000 }).catch(() => null);
  pg.net = net;
  return pg;
}
const settings = (config, extra = {}) => ({ isEnabled: true, publishable: true, selectedTemp: 'fbt1', temp1: JSON.stringify({}), condition: null, config_v2: JSON.stringify(config), ...extra });
const view = (pg) => pg.evaluate(() => {
  const root = document.querySelector('.bxf');
  if (!root) return null;
  return {
    names: [...root.querySelectorAll('.bxf-name')].map((n) => n.textContent.trim()),
    pics: root.querySelectorAll('.bxf-pic').length,
    plus: root.querySelectorAll('.bxf-plus').length,
    total: (root.querySelector('.bxf-total') || {}).textContent || '',
    button: (root.querySelector('[data-fbt-addall]') || {}).textContent || '',
    afterAtc: Boolean(document.querySelector('.product-form__buttons').nextElementSibling?.matches('[data-brix-fbt]')),
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  };
});

/* 1. bundle: collection rule (sold out skipped, the viewed product never offered), then automatic pairs */
{
  const pg = await open({ data: settings(CONFIG) });
  const s = await view(pg);
  check('bundle: "This item" + collection rule products + pairs, up to 3 offers', JSON.stringify(s?.names) === JSON.stringify(['This item: Classic Tee', 'Denim Shorts', 'Cap', 'Socks']), JSON.stringify(s?.names));
  check('bundle: 4 pictures joined by 3 "+"', s.pics === 4 && s.plus === 3, `${s.pics}/${s.plus}`);
  check('bundle: total of everything ticked, compare-at struck through, in the shop\'s money format', /Total price: Rs\. 1,296\.00/.test(s.total) && /Rs\. 1,396\.00/.test(s.total), s.total);
  check('bundle: "Add all 4 to cart"', s.button === 'Add all 4 to cart', s.button);
  check('placed under Add to cart', s.afterAtc);
  await pg.screenshot({ path: path.join(shots, 'bundle-desktop.png'), fullPage: true });
  await pg.locator('[data-fbt-toggle="p5"]').uncheck();
  let t = await view(pg);
  check('untick Socks: total and button follow', /Rs\. 1,197\.00/.test(t.total) && t.button === 'Add 3 to cart', `${t.total} | ${t.button}`);
  await pg.selectOption('[data-fbt-variant="p4"]', '42');
  t = await view(pg);
  check('Cap → White (Rs. 249): total follows the variant', /Rs\. 1,247\.00/.test(t.total), t.total);
  await pg.selectOption('#variant', '12');
  await pg.waitForTimeout(1300);
  await pg.click('[data-fbt-addall]');
  await pg.waitForFunction(() => document.querySelector('[data-fbt-addall]').textContent === 'Added to cart', null, { timeout: 4000 }).catch(() => {});
  const add = pg.net.adds[0];
  check('Add: one /cart/add.js with the ticked items, chosen variants, the page\'s variant, marked as FBT',
    JSON.stringify(add?.items) === JSON.stringify([{ id: 12, quantity: 1, properties: { _brix_source: 'fbt' } }, { id: 21, quantity: 1, properties: { _brix_source: 'fbt' } }, { id: 42, quantity: 1, properties: { _brix_source: 'fbt' } }]),
    JSON.stringify(add));
  check('Add: the cart drawer is opened', await pg.evaluate(() => window.__opened) > 0);
  await pg.close();
}

/* 2. cards: each product adds alone; an error is shown */
{
  const pg = await open({ data: settings({ ...CONFIG, style: 'cards' }), addStatus: 422 });
  check('cards: one card per offer, each with its own Add', await pg.locator('.bxf-card').count() === 3 && await pg.locator('[data-fbt-add]').count() === 3);
  await pg.locator('[data-fbt-add="p4"]').click();
  await pg.waitForTimeout(400);
  check('cards: Add sends just that product', pg.net.adds.length === 1 && pg.net.adds[0].items.length === 1 && pg.net.adds[0].items[0].id === 41, JSON.stringify(pg.net.adds));
  check('cards: Shopify\'s error is shown', (await pg.locator('.bxf-status').textContent()).includes('Only 1 left'));
  await pg.screenshot({ path: path.join(shots, 'cards-desktop.png'), fullPage: true });
  await pg.close();
}

/* 3. nothing from rules or pairs: Shopify's recommendations */
{
  const pg = await open({ data: settings({ ...CONFIG, rules: [], pairs: {} }), recs: ['belt', 'tee', 'socks'] });
  const s = await view(pg);
  check('Shopify recommendations fill in (never the viewed product)', JSON.stringify(s?.names) === JSON.stringify(['This item: Classic Tee', 'Belt', 'Socks']) && pg.net.recs >= 1, JSON.stringify(s?.names));
  await pg.close();
}

/* 4. off / not on the plan: nothing shows */
{
  const pg = await open({ data: settings(CONFIG, { isEnabled: false }) });
  check('off: nothing added to the page', (await pg.locator('.bxf').count()) === 0 && await pg.locator('[data-brix-fbt]').evaluate((el) => getComputedStyle(el).display) === 'none');
  await pg.close();
}

/* 5. a store that never saved the new page: its old rules still show */
{
  const legacy = [{ name: 'Rule 1', displayScope: 'per_product', triggerProducts: [{ id: 'gid://shopify/Product/1', handle: 'tee' }], fbtProducts: [{ id: 'gid://shopify/Product/6', handle: 'belt' }] }];
  const pg = await open({ data: { isEnabled: true, publishable: true, selectedTemp: 'fbt1', temp1: { interactionType: 'classic', widgetPlacement: 'below_cart' }, condition: legacy } });
  const s = await view(pg);
  check('old settings: the old rule still shows, as cards (its old "classic" look)', s && s.names.includes('Belt') && await pg.locator('.bxf--cards').count() === 1, JSON.stringify(s?.names));
  await pg.close();
}

/* 6. phone */
{
  const pg = await open({ data: settings(CONFIG), viewport: { width: 375, height: 800 } });
  const s = await view(pg);
  check('phone: no sideways scroll, full-width button', s && !s.overflow && await pg.locator('[data-fbt-addall]').evaluate((b) => b.getBoundingClientRect().width > 280), JSON.stringify(s));
  await pg.screenshot({ path: path.join(shots, 'bundle-phone.png'), fullPage: true });
  await pg.close();
}

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots in ${shots}`);
process.exit(failed.length ? 1 : 0);

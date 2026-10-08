/* eslint-env node */
// Browser check for the BRIX Cart Drawer on the storefront
// (extensions/cart-drawer/assets/cart_drawer_inline.js + brix_cart_ui.css):
// Cart Image Banner placement and responsive images, empty-cart footer, the
// product row and the pricing summary at desktop and mobile widths.
// Run from the repo root: node tests/cart-drawer/drawer-ui-browser-check.mjs
// Every network call is mocked (cart.js, the BRIX PHP backend, images).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const JS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/cart_drawer_inline.js'), 'utf8');
const CSS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/cart_drawer_inline.css'), 'utf8');
const UI_CSS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cart_ui.css'), 'utf8');
const shotDir = path.join(os.tmpdir(), 'brix-drawer-ui');
fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

// Banner images: a wide desktop one and a squarer mobile one (different ratios so we can tell them apart).
const svg = (w, h, fill, label) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/><text x="50%" y="55%" font-family="Arial" font-size="${Math.round(h / 5)}" fill="#fff" text-anchor="middle">${label}</text></svg>`;
const IMAGES = {
  '/desktop.svg': svg(1200, 300, '#1d4ed8', 'DESKTOP BANNER'),
  '/mobile.svg': svg(800, 400, '#be185d', 'MOBILE BANNER'),
  '/tee.svg': svg(200, 200, '#cbd5e1', ''),
};
const line = (key, title, variant, qty, unit, compare, id) => ({
  key, product_id: id, variant_id: id * 10, handle: `p${id}`, product_title: title, variant_title: variant,
  product_has_only_default_variant: !variant, quantity: qty, final_price: unit * 100, original_price: (compare || unit) * 100,
  final_line_price: unit * qty * 100, original_line_price: (compare || unit) * qty * 100, image: 'https://img.test/tee.svg', properties: {},
});
const CART = [
  line('k1', 'Boys Charcoal Grey Cotton Joggers', 'Grey / 8-9 Y', 1, 275, null, 1),
  line('k2', 'Kids Organic Cotton Hooded Sweatshirt with Kangaroo Pocket and Extra Long Name', null, 2, 899, 999, 2),
];

function config({ banner = {}, progress = null } = {}) {
  return {
    status: 'success',
    data: {
      cartStatus: '1', checkoutName: 'Checkout', checkoutFooterText: 'Shipping and taxes calculated at checkout',
      header_title: 'Your Cart',
      progress_status: progress ? 1 : 0,
      progress_data: progress ? JSON.stringify({ mode: 'amount', position: progress, showWhenEmpty: true, tiers: [{ id: 't1', minimumSpend: 5000, title: 'Free shipping', rewardType: 'free_shipping' }] }) : '{}',
      banner_enabled: banner.enabled === false ? 0 : 1,
      banner_desktop_src: banner.desktop === undefined ? 'https://img.test/desktop.svg' : banner.desktop,
      banner_mobile_src: banner.mobile === undefined ? 'https://img.test/mobile.svg' : banner.mobile,
      banner_placement: banner.placement || 'above_progress',
      banner_alt: 'Free shipping over ₹999',
      ...(banner.marginTop !== undefined ? { banner_margin_top: banner.marginTop, banner_margin_bottom: banner.marginBottom } : {}),
    },
  };
}

const page0 = () => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8">
  <style>body{margin:0;font-family:Arial,sans-serif} button{text-transform:uppercase;letter-spacing:2px;min-height:44px;padding:0 20px;border-radius:0} img{max-width:100%}</style>
  <link rel="stylesheet" href="https://cdn.test/cart_drawer_inline.css"><link rel="stylesheet" href="https://cdn.test/brix_cart_ui.css"></head>
  <body><header><a href="/cart" id="cart-icon-bubble">Cart</a></header><main><h1>Store</h1></main>
  <div id="cc-root" data-shop="demo.myshopify.com" data-currency="INR"></div>
  <script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'},currency:{active:'INR'}};</script>
  <script src="https://cdn.test/cart_drawer_inline.js"></script></body></html>`;

const browser = await chromium.launch();

async function open({ width, cart = CART, cfg = config() }) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const net = { images: [], changes: [], nav: [] };
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  let currentCart = [...cart];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://cdn.test') {
      const body = { '/cart_drawer_inline.js': JS, '/cart_drawer_inline.css': CSS, '/brix_cart_ui.css': UI_CSS }[url.pathname];
      return route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8', body });
    }
    if (url.origin === 'https://img.test') { net.images.push(url.pathname); return route.fulfill({ contentType: 'image/svg+xml', body: IMAGES[url.pathname] || '' }); }
    if (url.origin === 'https://int.thebrix.io') {
      if (url.pathname === '/save_cart_drawer.php') return json(cfg);
      if (url.pathname === '/save_coupon.php') return json({ status: 'success', data: [] });
      return json({ status: 'success' });
    }
    if (url.origin === 'https://shop.test') {
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: page0() });
      if (url.pathname === '/cart.js') {
        const total = currentCart.reduce((n, l) => n + l.final_line_price, 0);
        return json({ items: currentCart, item_count: currentCart.reduce((n, l) => n + l.quantity, 0), total_price: total, currency: 'INR' });
      }
      if (url.pathname === '/cart/change.js') {
        const body = JSON.parse(req.postData() || '{}');
        net.changes.push(body);
        currentCart = currentCart.flatMap((l) => (l.key !== body.id ? [l] : body.quantity > 0 ? [{ ...l, quantity: body.quantity, final_line_price: l.final_price * body.quantity, original_line_price: l.original_price * body.quantity }] : []));
        return json({ items: currentCart });
      }
      if (url.pathname.startsWith('/checkout')) { net.nav.push(url.pathname); return route.fulfill({ contentType: 'text/html', body: '<p>checkout</p>' }); }
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://shop.test/');
  await page.waitForFunction(() => typeof window.testCart === 'function');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.testCart());
  await page.waitForSelector('#cc-drawer', { timeout: 5000 });
  await page.waitForTimeout(700);
  page.net = net;
  return page;
}

// Geometry of the drawer: overflow, row parts, summary alignment, banner.
const measure = (page) => page.evaluate(() => {
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const overlap = (a, b) => a && b && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const inside = (a, box) => a.left >= box.left - 0.5 && a.right <= box.right + 0.5 && a.top >= box.top - 0.5 && a.bottom <= box.bottom + 0.5;
  const drawer = document.getElementById('cc-drawer');
  const body = document.getElementById('cc-drawer-body');
  const items = [...document.querySelectorAll('#cc-drawer .bxcd-item')].map((it) => {
    const box = r(it);
    const parts = Object.fromEntries(['media', 'title', 'remove', 'variant', 'price', 'qty', 'total'].map((k) => [k, r(it.querySelector(`.bxcd-item__${k}`))]));
    const title = it.querySelector('.bxcd-item__title');
    // The title's own text (its box includes padding reserved for the remove button).
    const titleText = (() => { if (!title) return null; const rg = document.createRange(); rg.selectNodeContents(title); return rg.getBoundingClientRect(); })();
    return {
      ok: Object.values(parts).filter(Boolean).every((p) => inside(p, box)),
      titleVsRemove: overlap(titleText, parts.remove),
      titleVsPrice: overlap(parts.title, parts.price), // visible box: a clamped title's hidden lines don't count
      qtyVsTotal: overlap(parts.qty, parts.total),
      priceVsTotal: overlap(parts.price, parts.total),
      removeTopRight: parts.remove ? box.right - parts.remove.right < 16 && parts.remove.top - box.top < 16 : false,
      titleClipped: title ? title.scrollHeight > title.clientHeight + 1 && getComputedStyle(title).webkitLineClamp === 'none' : false,
      titleLines: title ? Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)) : 0,
      media: parts.media ? Math.round(parts.media.width) : 0,
      qtyBtn: it.querySelector('.bxcd-qty') ? Math.round(r(it.querySelector('.bxcd-qty')).height) : 0,
      minusDisabled: it.querySelector('.bxcd-qty__btn') ? it.querySelector('.bxcd-qty__btn').disabled : null,
      totalNoWrap: parts.total ? parts.total.height < 40 : false,
    };
  });
  const values = [...document.querySelectorAll('#cc-drawer .bxcd-summary__value')].map((v) => Math.round(r(v).right));
  const labels = [...document.querySelectorAll('#cc-drawer .bxcd-summary__label')].map((v) => Math.round(r(v).left));
  const img = document.querySelector('#cc-image-banner img');
  return {
    drawerOverflow: drawer.scrollWidth > drawer.clientWidth + 1,
    bodyOverflow: body.scrollWidth > body.clientWidth + 1,
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    items,
    valuesAligned: values.length >= 2 && Math.max(...values) - Math.min(...values) <= 1,
    labelsAligned: labels.length >= 2 && Math.max(...labels) - Math.min(...labels) <= 1,
    banner: img ? {
      src: img.currentSrc, w: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height),
      ratio: img.naturalWidth ? img.naturalWidth / img.naturalHeight : 0, bodyW: Math.round(body.clientWidth), alt: img.alt,
    } : null,
    footer: Boolean(document.getElementById('cc-drawer-footer')),
    checkout: Boolean(document.querySelector('#cc-checkout-wrap a, #cc-checkout-wrap button, #cc-swipe-track')),
    empty: Boolean([...document.querySelectorAll('#cc-drawer-body p')].find((p) => /cart is empty/i.test(p.textContent))),
  };
});

// Order of sections inside the body, top to bottom on screen.
const order = (page) => page.evaluate(() => {
  const pick = { banner: '#cc-image-banner', progress: '[data-cc-section="progress"]', items: '#cc-drawer .bxcd-items', empty: '#cc-drawer-body > div[style*="padding:40px 20px"]' };
  return Object.entries(pick)
    .map(([k, sel]) => [k, document.querySelector(sel)])
    .filter(([, el]) => el)
    .map(([k, el]) => [k, el.getBoundingClientRect().top])
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k)
    .join(' > ');
});

const allErrors = [];

/* 1. Responsive QA at desktop and mobile widths */
for (const width of [1440, 1280, 1024, 430, 390, 375]) {
  const page = await open({ width });
  const m = await measure(page);
  const mobile = width <= 480;
  const tag = `${width}px`;
  check(`${tag}: no horizontal scrolling (drawer, body, page)`, !m.drawerOverflow && !m.bodyOverflow && !m.pageOverflow, JSON.stringify({ d: m.drawerOverflow, b: m.bodyOverflow, p: m.pageOverflow }));
  check(`${tag}: every row part stays inside its card`, m.items.length === 2 && m.items.every((i) => i.ok));
  check(`${tag}: title never collides with remove, price, quantity or subtotal`, m.items.every((i) => !i.titleVsRemove && !i.titleVsPrice && !i.qtyVsTotal && !i.priceVsTotal), JSON.stringify(m.items.map((i) => [i.titleVsRemove, i.titleVsPrice, i.qtyVsTotal, i.priceVsTotal])));
  check(`${tag}: remove button top-right of each row`, m.items.every((i) => i.removeTopRight));
  check(`${tag}: long title wraps instead of being cut on one line`, m.items[1].titleLines >= 2 && !m.items[0].titleClipped, `lines ${m.items.map((i) => i.titleLines)}`);
  check(`${tag}: ${mobile ? 'mobile' : 'desktop'} layout (image ${mobile ? 64 : 76}px, quantity control ${mobile ? 36 : 34}px tall)`, m.items.every((i) => i.media === (mobile ? 64 : 76) && i.qtyBtn === (mobile ? 36 : 34)), JSON.stringify(m.items.map((i) => [i.media, i.qtyBtn])));
  check(`${tag}: subtotal on one line`, m.items.every((i) => i.totalNoWrap));
  check(`${tag}: pricing summary labels left-aligned, amounts right-aligned`, m.labelsAligned && m.valuesAligned);
  check(`${tag}: banner fits the drawer, keeps its aspect ratio, ${mobile ? 'mobile' : 'desktop'} image`, Boolean(m.banner) && m.banner.w <= m.banner.bodyW && Math.abs(m.banner.w / m.banner.h - m.banner.ratio) < 0.02 && m.banner.src.endsWith(mobile ? '/mobile.svg' : '/desktop.svg'), JSON.stringify(m.banner));
  check(`${tag}: only the ${mobile ? 'mobile' : 'desktop'} banner image is downloaded`, page.net.images.includes(mobile ? '/mobile.svg' : '/desktop.svg') && !page.net.images.includes(mobile ? '/desktop.svg' : '/mobile.svg'), page.net.images.join(','));
  check(`${tag}: footer with checkout shown for a cart with items`, m.footer && m.checkout);
  await page.screenshot({ path: path.join(shotDir, `items-${width}.png`) });
  allErrors.push(...page.errors);
  await page.context().close();
}

/* 2. Quantity selector + remove keep using the cart API */
{
  const page = await open({ width: 1280 });
  let m = await measure(page);
  check('quantity: minus disabled at 1, enabled at 2', m.items[0].minusDisabled === true && m.items[1].minusDisabled === false);
  await page.locator('#cc-drawer [data-item-key="k1"] [aria-label="Increase quantity"]').click();
  await page.waitForTimeout(500);
  await page.locator('#cc-drawer [data-item-key="k2"] [aria-label="Remove product"]').click();
  await page.waitForTimeout(500);
  m = await measure(page);
  check('quantity + and remove call /cart/change.js and redraw the drawer', JSON.stringify(page.net.changes) === '[{"id":"k1","quantity":2},{"id":"k2","quantity":0}]' && m.items.length === 1, JSON.stringify(page.net.changes));
  await page.locator('#cc-drawer [aria-label="Remove product"]').click();
  await page.waitForTimeout(600);
  m = await measure(page);
  check('removing the last product: empty state, no pricing summary, no checkout', m.empty && !m.footer && !m.checkout, JSON.stringify({ empty: m.empty, footer: m.footer, checkout: m.checkout }));
  allErrors.push(...page.errors);
  await page.context().close();
}

/* 3. Empty cart */
for (const width of [1280, 390]) {
  const page = await open({ width, cart: [], cfg: config({ banner: { placement: 'above_products' } }) });
  const m = await measure(page);
  check(`empty cart (${width}px): empty state shown, no checkout footer, no checkout button, no totals`,
    m.empty && !m.footer && !m.checkout && (await page.locator('#cc-drawer .bxcd-summary').count()) === 0, JSON.stringify({ empty: m.empty, footer: m.footer, checkout: m.checkout }));
  check(`empty cart (${width}px): banner still shows above where products go`, (await order(page)) === 'banner > empty', await order(page));
  await page.screenshot({ path: path.join(shotDir, `empty-${width}.png`) });
  allErrors.push(...page.errors);
  await page.context().close();
}

/* 4. Placement */
const expectations = [
  ['above_progress', 'top', 'banner > progress > items'],
  ['below_progress', 'top', 'progress > banner > items'],
  ['above_products', 'top', 'progress > banner > items'],
  ['below_products', 'top', 'progress > items > banner'],
  ['above_checkout', 'top', 'progress > items > banner'],
  ['above_progress', 'bottom', 'items > banner > progress'],
  ['below_progress', 'bottom', 'items > progress > banner'],
  ['above_checkout', 'bottom', 'items > progress > banner'],
  ['above_progress', null, 'banner > items'],
  ['below_products', null, 'items > banner'],
];
for (const [placement, progress, want] of expectations) {
  const page = await open({ width: 1280, cfg: config({ banner: { placement }, progress }) });
  const got = await order(page);
  check(`placement ${placement} with ${progress ? `progress bar at the ${progress}` : 'no progress bar'}: ${want}`, got === want, got);
  if (placement === 'above_progress' && progress === 'top') await page.screenshot({ path: path.join(shotDir, 'default-order.png') });
  if (placement === 'above_checkout') {
    const last = await page.evaluate(() => {
      const body = document.getElementById('cc-drawer-body');
      const kids = [...body.children].filter((c) => c.getBoundingClientRect().height > 0);
      kids.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      return kids[kids.length - 1].id;
    });
    check(`placement above_checkout (${progress ? 'with' : 'no'} bar): banner is the last thing before the checkout footer`, last === 'cc-image-banner', last);
  }
  allErrors.push(...page.errors);
  await page.context().close();
}

/* 5. Banner off / no image / only one image */
{
  let page = await open({ width: 1280, cfg: config({ banner: { enabled: false } }) });
  check('banner off: nothing rendered', (await page.locator('#cc-image-banner').count()) === 0 && page.net.images.every((p) => p === '/tee.svg'));
  await page.context().close();
  page = await open({ width: 1280, cfg: config({ banner: { desktop: '', mobile: '' } }) });
  check('banner on but no image: nothing rendered', (await page.locator('#cc-image-banner').count()) === 0);
  await page.context().close();
  page = await open({ width: 390, cfg: config({ banner: { mobile: '' } }) });
  check('only a desktop image: phones use it', ((await measure(page)).banner?.src || '').endsWith('/desktop.svg'));
  await page.context().close();
  page = await open({ width: 1280, cfg: config({ banner: { desktop: '' } }) });
  check('only a mobile image: desktops use it', ((await measure(page)).banner?.src || '').endsWith('/mobile.svg'));
  check('banner image has the merchant\'s alt text', (await measure(page)).banner?.alt === 'Free shipping over ₹999');
  await page.context().close();
}

/* 5b. Space above / below the banner (Below Progress Bar: bar above, items below) */
const bannerGaps = (page) => page.evaluate(() => {
  const banner = document.getElementById('cc-image-banner').getBoundingClientRect();
  const bar = document.querySelector('#cc-drawer [data-cc-section="progress"]').getBoundingClientRect();
  const items = document.querySelector('#cc-drawer .bxcd-items').previousElementSibling.getBoundingClientRect();
  return { above: Math.round(banner.top - bar.bottom), below: Math.round(items.top - banner.bottom) };
});
for (const width of [1280, 390]) {
  for (const [top, bottom] of [[0, 0], [24, 6]]) {
    const page = await open({ width, cfg: config({ banner: { placement: 'below_progress', marginTop: top, marginBottom: bottom }, progress: 'top' }) });
    const gaps = await bannerGaps(page);
    check(`banner spacing ${top}/${bottom}px (${width}px): the gaps match`, gaps.above === top && gaps.below === bottom, JSON.stringify(gaps));
    await page.context().close();
  }
}

/* 5c. Phones: tight body and footer spacing */
{
  const page = await open({ width: 390 });
  const sp = await page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const body = cs(document.getElementById('cc-drawer-body'));
    const footer = cs(document.getElementById('cc-drawer-footer'));
    return { bodyTop: body.paddingTop, bodyBottom: body.paddingBottom, gap: body.rowGap, footerTop: footer.paddingTop };
  });
  check('phone: body and footer padding are tight', sp.bodyTop === '10px' && sp.bodyBottom === '12px' && sp.gap === '8px' && sp.footerTop === '12px', JSON.stringify(sp));
  await page.context().close();
}

/* 6. Checkout still works */
{
  const page = await open({ width: 1280 });
  const btn = page.locator('#cc-checkout-wrap a, #cc-checkout-wrap button').first();
  await Promise.all([page.waitForURL('**/checkout**', { timeout: 5000 }).catch(() => null), btn.click()]);
  check('checkout button still goes to /checkout', page.net.nav.some((p) => p.startsWith('/checkout')), page.net.nav.join(','));
  allErrors.push(...page.errors);
  await page.context().close();
}

check('no page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed · screenshots in ${shotDir}`);
process.exit(failed.length ? 1 : 0);

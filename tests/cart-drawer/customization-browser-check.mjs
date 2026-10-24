/* eslint-env node */
// Browser check for the cart drawer customization fixes on the storefront:
//  - drawer (assets/cart_drawer_inline.js): rotating announcement bar with
//    arrows, progress bar colours over stale flat keys, coupon card size and
//    long text, upsell colours + title, free gift variant and badge, ₹ icon
//  - FBT widget (snippets/fbt-widget-render.liquid): heading / title colours,
//    Classic "Added" colour, Add-all loading and success colours
//  - Coupon Banner (snippets/coupon-slider-render.liquid): card width and
//    long text at desktop and phone widths
// Every request is mocked. Run from the repo root:
//   node tests/cart-drawer/customization-browser-check.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const JS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/cart_drawer_inline.js'), 'utf8');
const COD_JS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cod.js'), 'utf8');
const CHECKOUT_JS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_checkout.js'), 'utf8');
const CSS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/cart_drawer_inline.css'), 'utf8');
const UI_CSS = fs.readFileSync(path.resolve('extensions/cart-drawer/assets/brix_cart_ui.css'), 'utf8');
// Scripts a snippet loads from the extension's assets are inlined (no Shopify CDN here).
const snippet = (f) => fs.readFileSync(path.resolve('extensions/cart-drawer/snippets', f), 'utf8')
  .replace(/<script src="\{\{ '([\w.-]+\.js)' \| asset_url \}\}" defer><\/script>/g, (_, a) => `<script>${fs.readFileSync(path.resolve('extensions/cart-drawer/assets', a), 'utf8')}</script>`);
const shotDir = path.join(os.tmpdir(), 'brix-customization');
fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const allErrors = [];

const line = (key, id, title, unit, extra = {}) => ({
  key, product_id: id, variant_id: id * 10, handle: `p${id}`, product_title: title, variant_title: null,
  product_has_only_default_variant: true, quantity: 1, final_price: unit * 100, original_price: unit * 100,
  final_line_price: unit * 100, original_line_price: unit * 100, image: '', properties: {}, ...extra,
});
const CART = [line('k1', 1, 'Boys Joggers', 900)];
const v = (id, title, price, available) => ({ id, title, price, compare_at_price: null, available });
const PRODUCTS = [
  { id: 101, title: 'Gift Mug', handle: 'mug', variants: [v(1011, 'Red', '300.00', true), v(1012, 'Blue', '300.00', true), v(1013, 'Green', '320.00', true)] },
  { id: 102, title: 'Socks', handle: 'socks', variants: [v(1021, 'Default Title', '199.00', true)] },
];

// cod: also load brix_cod.js (its settings mocked), as the app embed does;
// headJs: a script that runs first (another app's embed, e.g. GoKwik).
const drawerPage = (cod = false, headJs = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8">
  <style>body{margin:0;font-family:Arial,sans-serif}</style>
  <link rel="stylesheet" href="https://cdn.test/cart_drawer_inline.css"><link rel="stylesheet" href="https://cdn.test/brix_cart_ui.css"></head>
  <body><main><h1>Store</h1></main><div id="cc-root" data-shop="demo.myshopify.com" data-currency="INR"></div>
  <script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'},currency:{active:'INR'}};</script>
  ${headJs ? `<script>${headJs}</script>` : ''}
  <script src="https://cdn.test/brix_checkout.js"></script>
  ${cod ? '<script src="https://cdn.test/brix_cod.js" data-php="https://int.thebrix.io" data-shop="demo.myshopify.com" data-currency="INR"></script>' : ''}
  <script src="https://cdn.test/cart_drawer_inline.js"></script></body></html>`;

const browser = await chromium.launch();

// cod: brix_cod.js's settings (cod_storefront.php?action=config); cartExtra: more cart.js fields.
async function openDrawer({ data, cart = CART, width = 1280, storefrontApi = null, opens = 1, slowProducts = 0, cod = null, cartExtra = null, headJs = '' }) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const net = { adds: [], storefrontApi: [] };
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  let current = [...cart];
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (d) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://cdn.test') {
      const body = { '/cart_drawer_inline.js': JS, '/brix_cod.js': COD_JS, '/brix_checkout.js': CHECKOUT_JS, '/cart_drawer_inline.css': CSS, '/brix_cart_ui.css': UI_CSS }[url.pathname];
      return route.fulfill({ contentType: url.pathname.endsWith('.js') ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8', body });
    }
    if (url.origin === 'https://int.thebrix.io') {
      if (url.pathname === '/cod_storefront.php') return json(cod || { success: true, enabled: false });
      if (url.pathname === '/save_cart_drawer.php') return json({ status: 'success', data: { cartStatus: '1', checkoutName: 'Checkout', header_title: 'Your Cart', ...data } });
      return json({ status: 'success', data: [] });
    }
    if (url.origin === 'https://shop.test') {
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: drawerPage(Boolean(cod), headJs) });
      if (url.pathname === '/cart.js') {
        return json({ items: current, item_count: current.length, total_price: current.reduce((n, l) => n + l.final_line_price, 0), currency: 'INR', ...(cartExtra || {}) });
      }
      if (url.pathname === '/products.json') {
        if (slowProducts) await new Promise((r) => setTimeout(r, slowProducts));
        return json({ products: url.searchParams.get('page') && url.searchParams.get('page') !== '1' ? [] : PRODUCTS });
      }
      if (url.pathname === '/cart/add.js') {
        const body = JSON.parse(req.postData() || '{}');
        net.adds.push(body);
        return json({ items: body.items || [] });
      }
      if (url.pathname === '/recommendations/products.json') return json({ products: [] });
      // Shopify's tokenless Storefront API (reward products past the first catalogue page).
      if (/^\/api\/[\d-]+\/graphql\.json$/.test(url.pathname)) {
        const body = JSON.parse(req.postData() || '{}');
        net.storefrontApi.push(body);
        return storefrontApi ? json(storefrontApi(body)) : route.fulfill({ status: 404, body: '' });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://shop.test/');
  await page.waitForFunction(() => typeof window.testCart === 'function');
  await page.waitForTimeout(300);
  // opens: several opens at once (an add and a cart icon tap close together).
  await page.evaluate((n) => { for (let i = 0; i < n; i++) window.testCart(); }, opens);
  await page.waitForSelector('#cc-drawer', { timeout: 5000 });
  await page.waitForTimeout(800);
  page.net = net;
  return page;
}
const close = async (page) => { allErrors.push(...page.errors); await page.context().close(); };

/* 0. Two opens at once build ONE drawer (the second used to sit on top, stale) */
{
  // Upsells to load (a slow catalogue): each open waits on them, so both are
  // in flight together; the older one finishing first used to build a 2nd drawer.
  const upsell = { upsell_status: 1, upsell_data: JSON.stringify({ enabled: true, useAI: false, manualRules: [{ id: 'r1', enabled: true, triggerType: 'all', triggerProductIds: [], upsellProductIds: [`gid://shopify/Product/${PRODUCTS[0].id}`] }] }) };
  const page = await openDrawer({ data: upsell, opens: 2, slowProducts: 500 });
  await page.waitForTimeout(600);
  check('two opens at once: one drawer', (await page.locator('#cc-drawer').count()) === 1 && (await page.locator('#cc-overlay').count()) === 1, String(await page.locator('#cc-drawer').count()));
  await close(page);
}

/* 1. Rotating announcement bar */
{
  const data = { announcement_enabled: 1, announcement_text: 'One', announcement_messages: JSON.stringify(['One', 'Two <b>bold</b>', 'Three']), announcement_auto_rotate: 1, announcement_interval: 2, announcement_show_arrows: 1, announcement_bg_color: '#111827', announcement_text_color: '#ffffff' };
  const page = await openDrawer({ data });
  const shown = () => page.$$eval('#cc-announcement-bar .cc-ann-msg', (els) => els.filter((e) => getComputedStyle(e).visibility === 'visible').map((e) => e.textContent));
  await page.waitForTimeout(400);
  check('announcements: one message at a time, first one first', JSON.stringify(await shown()) === '["One"]', JSON.stringify(await shown()));
  check('announcements: side arrows shown', (await page.locator('#cc-announcement-bar .cc-ann-arrow').count()) === 2);
  check('announcements: text is escaped', (await page.locator('#cc-announcement-bar b').count()) === 0);
  await page.locator('#cc-announcement-bar .cc-ann-next').click();
  await page.waitForTimeout(450);
  check('announcements: next arrow moves to message 2', JSON.stringify(await shown()) === '["Two <b>bold</b>"]', JSON.stringify(await shown()));
  await page.locator('#cc-announcement-bar .cc-ann-prev').click();
  await page.locator('#cc-announcement-bar .cc-ann-prev').click();
  await page.waitForTimeout(450);
  check('announcements: previous arrow wraps around to the last message', JSON.stringify(await shown()) === '["Three"]', JSON.stringify(await shown()));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(2500);
  check('announcements: rotates on its own every interval', JSON.stringify(await shown()) === '["One"]', JSON.stringify(await shown()));
  await page.locator('#cc-announcement-bar').hover();
  const before = await shown();
  await page.waitForTimeout(2500);
  check('announcements: hovering pauses the rotation', JSON.stringify(await shown()) === JSON.stringify(before));
  await page.screenshot({ path: path.join(shotDir, 'announcements-desktop.png') });
  await close(page);

  const phone = await openDrawer({ data, width: 375 });
  const geo = await phone.evaluate(() => {
    const bar = document.getElementById('cc-announcement-bar');
    return { overflow: bar.scrollWidth > bar.clientWidth + 1, page: document.documentElement.scrollWidth > innerWidth + 1, h: bar.getBoundingClientRect().height };
  });
  check('announcements (375px): no horizontal overflow, compact height', !geo.overflow && !geo.page && geo.h < 60, JSON.stringify(geo));
  await phone.screenshot({ path: path.join(phone === null ? shotDir : shotDir, 'announcements-375.png') });
  await close(phone);

  const single = await openDrawer({ data: { announcement_enabled: 1, announcement_text: 'Just one', announcement_messages: null } });
  check('announcements: a bar saved before rotation shows its one text, no arrows', (await single.locator('#cc-announcement-bar').textContent()) === 'Just one' && (await single.locator('.cc-ann-arrow').count()) === 0);
  await close(single);
}

/* 2. Progress bar colours win over stale flat keys */
{
  const progress = { mode: 'amount', position: 'top', showWhenEmpty: true, barBackgroundColor: '#e2e8f0', barForegroundColor: '#2563eb', fill_color: '#2563eb', colors: { background: '#ff0000', fill: '#00aa00', message: '#0000ff' }, tiers: [{ id: 't1', minimumSpend: 5000, title: 'Free shipping', rewardType: 'free_shipping' }] };
  const page = await openDrawer({ data: { progress_status: 1, progress_data: JSON.stringify(progress) } });
  const c = await page.evaluate(() => {
    const sec = document.querySelector('[data-cc-section="progress"]');
    const track = [...sec.querySelectorAll('div')].find((d) => d.style.height === '8px');
    const fill = track && track.firstElementChild;
    return { track: track && getComputedStyle(track).backgroundColor, fill: fill && getComputedStyle(fill).backgroundColor, msg: getComputedStyle(sec.querySelector('p')).color };
  });
  check('progress bar: background colour from the picker, not the stale key', c.track === 'rgb(255, 0, 0)', JSON.stringify(c));
  check('progress bar: fill colour from the picker', c.fill === 'rgb(0, 170, 0)', c.fill);
  check('progress bar: progress message uses the message colour (like the preview)', c.msg === 'rgb(0, 0, 255)', c.msg);
  await close(page);
}

/* 3. Coupon cards: size and long text */
const LONG = 'EXTRALONGCOUPONCODEFORTESTING2025';
const couponData = (extra = {}) => JSON.stringify({
  enabled: true, position: 'top', template: 'template2', sectionTitle: 'Coupons', ...extra,
  selectedCoupons: [
    { id: 'c1', code: LONG, labelText: `${LONG} gets you 20% off everything in store`, description: 'Valid on all products including sale items and new arrivals this week', bgColor: '#4f46e5', textColor: '#ffffff', icon: 'rupee', borderRadius: 8, buttonText: 'Apply now please' },
    { id: 'c2', code: 'SAVE10', labelText: 'SAVE10', description: '10% off', bgColor: '#be185d', textColor: '#ffffff', icon: 'discount', borderRadius: 8, buttonText: 'Apply' },
  ],
});
for (const [width, template] of [[1280, 'template2'], [375, 'template2'], [1280, 'template1'], [375, 'template3'], [1280, 'template3']]) {
  const page = await openDrawer({ width, data: { coupon_status: 1, coupon_data: couponData({ template, cardWidth: 200, cardMinHeight: 150 }) } });
  const m = await page.evaluate(() => {
    const card = document.querySelector('.cc-coupon-card');
    const all = [...card.querySelectorAll('div,span,button')];
    const clipped = all.some((e) => getComputedStyle(e).textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1);
    const overflowing = all.some((e) => e.getBoundingClientRect().right > card.getBoundingClientRect().right + 1);
    const btn = card.querySelector('button');
    return { w: Math.round(card.getBoundingClientRect().width), h: Math.round(card.getBoundingClientRect().height), clipped, overflowing, btnInside: btn ? btn.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom + 1 : true, page: document.documentElement.scrollWidth > innerWidth + 1, text: card.textContent };
  });
  const tag = `coupons ${template} (${width}px)`;
  check(`${tag}: card is the merchant's 200px wide`, m.w === 200, String(m.w));
  check(`${tag}: card at least the merchant's 150px tall, growing with long text`, m.h >= 150, String(m.h));
  check(`${tag}: long code / label shown in full, nothing clipped or overflowing`, !m.clipped && !m.overflowing && m.text.includes(LONG), JSON.stringify({ clipped: m.clipped, overflowing: m.overflowing }));
  check(`${tag}: button stays inside the card, no page scroll`, m.btnInside && !m.page);
  if (width === 375) await page.screenshot({ path: path.join(shotDir, `coupons-${template}-375.png`) });
  await close(page);
}
{
  const page = await openDrawer({ width: 320, data: { coupon_status: 1, coupon_data: couponData({ cardWidth: 360 }) } });
  const w = await page.evaluate(() => document.querySelector('.cc-coupon-card').getBoundingClientRect().width);
  check('coupons (320px phone): a 360px card is capped at 85% of the screen', w <= 320 * 0.85 + 1, String(w));
  const icon = await page.evaluate(() => document.querySelector('.cc-coupon-card svg')?.innerHTML || '');
  check('coupons: ₹ icon drawn from SVG paths', icon.includes('M7.6 5.9h4.8') && !icon.includes('₹'));
  await close(page);
}

/* 4. Upsell colours and title */
{
  const upsell = {
    enabled: true, useAI: false, position: 'bottom', direction: 'vertical', layout: 'carousel', buttonText: 'Add',
    title: 'Picked for you', titleColor: '#ff0000', titleAlign: 'center',
    useCheckoutButtonColors: false, buttonColor: '#008060', buttonTextColor: '#000000', productTitleColor: '#333333', priceColor: '#ff5733',
    manualRules: [{ id: 'r1', enabled: true, triggerType: 'all', triggerProductIds: [], upsellProductIds: ['gid://shopify/Product/102'] }],
  };
  const page = await openDrawer({ data: { upsell_status: 1, upsell_data: JSON.stringify(upsell), checkout_button_style: JSON.stringify({ backgroundColor: '#111111', textColor: '#ffffff' }) } });
  await page.waitForSelector('.cc-upsell-card', { timeout: 5000 }).catch(() => {});
  const c = await page.evaluate(() => {
    const card = document.querySelector('.cc-upsell-card');
    if (!card) return null;
    const cs = (sel) => getComputedStyle(card.querySelector(sel));
    const heading = [...document.querySelectorAll('#cc-drawer p')].find((p) => p.textContent.trim() === 'Picked for you');
    return { btnBg: cs('.cc-add-btn').backgroundColor, btnFg: cs('.cc-add-btn').color, title: cs('.cc-upsell-v-title').color, price: cs('.cc-upsell-price').color, heading: heading && [getComputedStyle(heading).color, getComputedStyle(heading).textAlign] };
  });
  check('upsell: the merchant\'s title text, colour and alignment reach the store', c && c.heading && c.heading[0] === 'rgb(255, 0, 0)' && c.heading[1] === 'center', JSON.stringify(c && c.heading));
  check('upsell: own Add button colours', c && c.btnBg === 'rgb(0, 128, 96)' && c.btnFg === 'rgb(0, 0, 0)', JSON.stringify(c));
  check('upsell: product title and price colours', c && c.title === 'rgb(51, 51, 51)' && c.price === 'rgb(255, 87, 51)', JSON.stringify(c));
  await close(page);

  const follow = await openDrawer({ data: { upsell_status: 1, upsell_data: JSON.stringify({ ...upsell, useCheckoutButtonColors: undefined }), checkout_button_style: JSON.stringify({ backgroundColor: '#111111', textColor: '#ffffff' }) } });
  await follow.waitForSelector('.cc-upsell-card', { timeout: 5000 }).catch(() => {});
  const bg = await follow.evaluate(() => getComputedStyle(document.querySelector('.cc-upsell-card .cc-add-btn')).backgroundColor);
  check('upsell: drawers saved before keep the checkout button colours', bg === 'rgb(17, 17, 17)', bg);
  await close(follow);
}

/* 5. Free gift: chosen variant, badge text */
{
  const tiers = [{ id: 't1', minimumSpend: 500, title: 'Gift', rewardType: 'product', rewardProducts: ['gid://shopify/Product/101'], rewardPricing: 'regular', rewardVariants: { 'gid://shopify/Product/101': 'gid://shopify/ProductVariant/1013' }, rewardBadgeLabel: 'VIP BONUS' }];
  const progress = { mode: 'amount', position: 'top', showWhenEmpty: true, colors: {}, tiers };
  const page = await openDrawer({ data: { progress_status: 1, progress_data: JSON.stringify(progress) } });
  await page.waitForTimeout(800);
  const add = page.net.adds.find((b) => Array.isArray(b.items) && b.items.some((i) => i.properties && i.properties._brixReward === 'true'));
  check('free gift: the variant the merchant picked is added', add && add.items[0].id === 1013, JSON.stringify(page.net.adds));
  await close(page);

  const gift = line('g1', 101, 'Gift Mug', 320, { properties: { _brixReward: 'true' }, variant_title: 'Green', product_has_only_default_variant: false });
  const withGift = await openDrawer({ data: { progress_status: 1, progress_data: JSON.stringify(progress) }, cart: [...CART, gift] });
  const badge = await withGift.locator('.bxcd-item--gift .bxcd-item__badge').textContent();
  check('free gift: the badge shows the merchant\'s text', badge.trim() === 'VIP BONUS', badge);
  await close(withGift);

  // A big store (extrokids: 4000+ products): the reward isn't in the first
  // /products.json page, so the drawer asks the Storefront API by product id.
  const farTiers = [{ id: 't1', minimumSpend: 500, title: 'Gift', rewardType: 'product', rewardProducts: ['gid://shopify/Product/9001'], rewardPricing: 'regular' }];
  const far = await openDrawer({
    data: { progress_status: 1, progress_data: JSON.stringify({ ...progress, tiers: farTiers }) },
    storefrontApi: (body) => ({ data: { nodes: (body.variables.ids || []).map((id) => (id === 'gid://shopify/Product/9001' ? {
      id, title: 'Story Book Gift', handle: 'story-book-gift', featuredImage: null,
      variants: { nodes: [
        { id: 'gid://shopify/ProductVariant/90011', title: 'Hardcover', availableForSale: false, price: { amount: '199.0' }, compareAtPrice: null, image: null },
        { id: 'gid://shopify/ProductVariant/90012', title: 'Paperback', availableForSale: true, price: { amount: '99.0' }, compareAtPrice: null, image: null },
      ] },
    } : null)) } }),
  });
  await far.waitForTimeout(800);
  const farAdd = far.net.adds.find((b) => Array.isArray(b.items) && b.items.some((i) => i.properties && i.properties._brixReward === 'true'));
  check('free gift past the first 250 products: found by id and added (in-stock variant)', farAdd && farAdd.items[0].id === 90012, JSON.stringify(far.net.adds));
  check('free gift past the first 250 products: one Storefront API lookup by product id', far.net.storefrontApi.length === 1 && JSON.stringify(far.net.storefrontApi[0].variables.ids) === '["gid://shopify/Product/9001"]', JSON.stringify(far.net.storefrontApi));
  await close(far);

  // extrokids' ₹1300 milestone: the editor left the older `products` copy
  // as loaded ([]) next to the picked `rewardProducts`; the gift must still go in.
  const stale = await openDrawer({
    data: { progress_status: 1, progress_data: JSON.stringify({ ...progress, tiers: [{ ...tiers[0], rewardType: 'free_shipping', products: [], rewardVariants: {} }] }) },
  });
  await stale.waitForTimeout(800);
  const staleAdd = stale.net.adds.find((b) => Array.isArray(b.items) && b.items.some((i) => i.properties && i.properties._brixReward === 'true'));
  check('free gift saved with an empty older `products` list next to rewardProducts: still added', Boolean(staleAdd), JSON.stringify(stale.net.adds).slice(0, 200));
  await close(stale);

  const gone = await openDrawer({
    data: { progress_status: 1, progress_data: JSON.stringify({ ...progress, tiers: farTiers }) },
    storefrontApi: () => ({ data: { nodes: [null] } }),
  });
  await gone.evaluate(() => window.testCart());
  await gone.waitForTimeout(800);
  check('free gift not on the Online Store: nothing added, looked up once per visit', !gone.net.adds.some((b) => Array.isArray(b.items) && b.items.some((i) => i.properties && i.properties._brixReward === 'true')) && gone.net.storefrontApi.length === 1, JSON.stringify(gone.net.storefrontApi.length));
  await close(gone);

  const freeWord = JSON.stringify({ ...progress, tiers: [{ ...tiers[0], rewardBadgeLabel: 'Free mug' }] });
  const charged = await openDrawer({ data: { progress_status: 1, progress_data: freeWord }, cart: [...CART, gift] });
  const b2 = await charged.locator('.bxcd-item--gift .bxcd-item__badge').textContent();
  check('free gift: text saying "free" is not shown on a charged gift', b2.trim() === 'REWARD', b2);
  await close(charged);
}

/* 6. FBT widget colours and states */
{
  const fbt = snippet('fbt-widget-render.liquid')
    .replace('{{ product.id }}', '100').replace('{{ shop.permanent_domain }}', 'demo.myshopify.com').replace('{{ shop.currency }}', 'INR')
    .replace("{{ block.settings.placement | default: 'below_atc' }}", 'below_cart').replace('{{ request.design_mode }}', 'false');
  const temp1 = {
    layout: 'carousel', interactionType: 'classic', showPrices: true, showAddAllButton: true, widgetPlacement: 'below_cart',
    textColor: '#111827', buttonColor: '#111827', buttonTextColor: '#ffffff',
    headingColor: '#ff0000', titleColor: '#00aa00', selectedBgColor: '#123456', selectedTextColor: '#fedcba',
    loadingBgColor: '#999999', successBgColor: '#0000ff', successTextColor: '#ffff00', buttonHoverColor: '#ff00ff',
  };
  const cfg = { status: 'success', data: { selectedTemp: 'fbt1', temp1, condition: [{ id: 'r1', displayScope: 'all', fbtProducts: [{ id: 'gid://shopify/Product/201', title: 'Socks', handle: 'socks', price: '99' }, { id: 'gid://shopify/Product/202', title: 'Cap', handle: 'cap', price: '450' }] }] } };
  const catalog = { products: [{ id: 201, variants: [{ id: 9201, available: true, price: '199.00' }] }, { id: 202, variants: [{ id: 9202, available: true, price: '500.00' }] }] };
  const page = await browser.newPage();
  page.on('pageerror', (e) => allErrors.push(e.message));
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('https://int.thebrix.io/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(cfg) }));
  await page.route('http://shop.test/**', async (r) => {
    const url = new URL(r.request().url());
    if (url.pathname === '/products.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog) });
    if (url.pathname === '/cart/add.js') { await gate; return r.fulfill({ contentType: 'application/json', body: '{"items":[]}' }); }
    return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><form action="/cart/add"><button name="add" type="submit">Add to cart</button></form>${fbt}</body></html>` });
  });
  await page.goto('http://shop.test/products/tee');
  await page.waitForSelector('ps-fbt-widget .ps-product-card', { timeout: 10000 });
  const c = await page.evaluate(() => ({
    heading: getComputedStyle(document.querySelector('ps-fbt-widget .ps-fbt-title')).color,
    title: getComputedStyle(document.querySelector('ps-fbt-widget .ps-product-title')).color,
    added: (() => { const b = document.querySelector('ps-fbt-widget .ps-classic-btn'); return [b.textContent, getComputedStyle(b).backgroundColor, getComputedStyle(b).color]; })(),
  }));
  check('fbt: heading colour', c.heading === 'rgb(255, 0, 0)', c.heading);
  check('fbt: product title colour', c.title === 'rgb(0, 170, 0)', c.title);
  check('fbt: Classic "Added" uses the merchant\'s selected colours (not fixed green)', c.added[0] === 'Added' && c.added[1] === 'rgb(18, 52, 86)' && c.added[2] === 'rgb(254, 220, 186)', JSON.stringify(c.added));
  const addAll = page.locator('ps-fbt-widget .ps-fbt-addall');
  await addAll.hover();
  check('fbt: Add-all hover colour', (await addAll.evaluate((b) => getComputedStyle(b).backgroundColor)) === 'rgb(255, 0, 255)');
  await addAll.click();
  await page.waitForFunction(() => /Adding/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
  check('fbt: "Adding..." uses the loading colour', (await addAll.evaluate((b) => b.style.background)) === 'rgb(153, 153, 153)');
  release();
  await page.waitForFunction(() => /Added/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
  const done = await addAll.evaluate((b) => [getComputedStyle(b).backgroundColor, getComputedStyle(b).color]);
  check('fbt: "Added" (success) uses the success colours', done[0] === 'rgb(0, 0, 255)' && done[1] === 'rgb(255, 255, 0)', JSON.stringify(done));
  await page.waitForTimeout(1400);
  const back = await addAll.evaluate((b) => [b.textContent, b.style.background]);
  check('fbt: Add-all returns to its normal colour afterwards', /to Cart/.test(back[0]) && back[1] === 'rgb(17, 24, 39)', JSON.stringify(back));
  await page.close();

  // A widget saved before the new colours: looks as it did.
  const old = await browser.newPage();
  const oldCfg = { status: 'success', data: { ...cfg.data, temp1: { layout: 'carousel', interactionType: 'classic', showPrices: true, showAddAllButton: true, textColor: '#111827', buttonColor: '#111827' } } };
  await old.route('https://int.thebrix.io/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(oldCfg) }));
  await old.route('http://shop.test/**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname === '/products.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog) });
    return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><form action="/cart/add"><button name="add" type="submit">Add</button></form>${fbt}</body></html>` });
  });
  await old.goto('http://shop.test/products/tee');
  await old.waitForSelector('ps-fbt-widget .ps-product-card', { timeout: 10000 });
  const o = await old.evaluate(() => [getComputedStyle(document.querySelector('ps-fbt-widget .ps-fbt-title')).color, getComputedStyle(document.querySelector('ps-fbt-widget .ps-classic-btn')).backgroundColor]);
  check('fbt: a widget saved before keeps its heading colour and green "Added"', o[0] === 'rgb(17, 24, 39)' && o[1] === 'rgb(0, 128, 96)', JSON.stringify(o));
  await old.close();
}

/* 7. Coupon Banner: card width and long text */
{
  const coupon = snippet('coupon-slider-render.liquid').split('\n').slice(1).join('\n');
  const el = '<ps-coupon-slider id="ps-coupon-slider-b1" data-shop="demo.myshopify.com" data-product-handle="tee" data-collection-handles="" data-product-tags="" data-placement="custom" data-design-mode="false" style="display:none"><div>Loading coupons...</div></ps-coupon-slider>';
  for (const tpl of ['template1', 'template2', 'template3']) {
    for (const width of [1280, 375]) {
      const key = { template1: 'temp1', template2: 'temp2', template3: 'temp3' }[tpl];
      const data = {
        is_enabled: 1, widgetPlacement: 'custom', selectedTemplate: tpl,
        selectedCouponsGlobal: ['custom:SAVE10', `custom:${LONG}`],
        [`${key}DefaultStyle`]: { headingText: 'Get twenty percent off on every single order this festive season', subtextText: 'Apply at checkout on all products including the newest arrivals and sale items', cardWidth: 260, padding: 12 },
        [`${key}CouponStyle`]: { 'custom:SAVE10': { couponCode: 'SAVE10' }, [`custom:${LONG}`]: { couponCode: LONG } },
        [`${key}CouponCondition`]: [],
      };
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on('pageerror', (e) => allErrors.push(e.message));
      await page.route('https://int.thebrix.io/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 'success', data }) }));
      await page.route('http://shop.test/**', (r) => {
        if (new URL(r.request().url()).pathname === '/cart.js') return r.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
        return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"></head><body style="margin:0;padding:0 12px"><form action="/cart/add"><button name="add">Add</button></form>${el}\n${coupon}</body></html>` });
      });
      await page.goto('http://shop.test/products/tee');
      await page.waitForSelector('.ps-card', { timeout: 10000 });
      const m = await page.evaluate((long) => {
        const cards = [...document.querySelectorAll('.ps-card')];
        const card = cards[1];
        const all = [...card.querySelectorAll('div,span,button')];
        return {
          w: Math.round(card.getBoundingClientRect().width),
          clipped: all.some((e) => (getComputedStyle(e).textOverflow === 'ellipsis' || getComputedStyle(e).webkitLineClamp !== 'none') && e.scrollHeight > e.clientHeight + 1),
          // The ticket's punched half-circles sit outside the card on purpose.
          overflowing: all.filter((e) => getComputedStyle(e).position !== 'absolute').map((e) => (e.getBoundingClientRect().right > card.getBoundingClientRect().right + 1 ? (e.className || e.tagName) + ':' + e.textContent.slice(0, 20) : '')).filter(Boolean),
          hasCode: card.textContent.includes(long),
          page: document.documentElement.scrollWidth > innerWidth + 1,
        };
      }, LONG);
      const tag = `coupon banner ${tpl} (${width}px)`;
      check(`${tag}: card ${width > 400 ? "is the merchant's 260px" : 'fits the phone'}`, width > 400 ? m.w === 260 : m.w <= Math.round(width * 0.85) + 1, String(m.w));
      // Classic Banner (template1) never shows the code, only its Copy button.
      check(`${tag}: long heading, subtext${tpl === 'template1' ? '' : ' and code'} shown in full`, !m.clipped && m.overflowing.length === 0 && (tpl === 'template1' || m.hasCode), JSON.stringify(m));
      check(`${tag}: no page scroll`, !m.page);
      if (width === 375) await page.screenshot({ path: path.join(shotDir, `banner-${tpl}-375.png`) });
      await page.close();
    }
  }
}

/* Checkout button: text size and height (padding) from checkout_button_style */
{
  const cbBox = (page, sel) => page.evaluate((q) => {
    const b = document.querySelector(q);
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { fs: cs.fontSize, pt: cs.paddingTop, pb: cs.paddingBottom, h: Math.round(b.getBoundingClientRect().height) };
  }, sel);
  const sized = await openDrawer({ data: { checkout_button_style: JSON.stringify({ backgroundColor: '#111111', textColor: '#ffffff', borderRadius: 8, fontSize: 19, paddingY: 22 }) } });
  await sized.waitForSelector('#cc-checkout-wrap button', { timeout: 5000 }).catch(() => {});
  const b = await cbBox(sized, '#cc-checkout-wrap button');
  check('checkout button: the merchant\'s text size and padding', b && b.fs === '19px' && b.pt === '22px' && b.pb === '22px', JSON.stringify(b));
  await close(sized);

  const plain = await openDrawer({ data: { checkout_button_style: JSON.stringify({ backgroundColor: '#111111', textColor: '#ffffff' }) } });
  await plain.waitForSelector('#cc-checkout-wrap button', { timeout: 5000 }).catch(() => {});
  const d = await cbBox(plain, '#cc-checkout-wrap button');
  check('checkout button: drawers saved before keep 15px text and 16px padding', d && d.fs === '15px' && d.pt === '16px', JSON.stringify(d));
  await close(plain);

  const wild = await openDrawer({ data: { checkout_button_style: JSON.stringify({ fontSize: 99, paddingY: -3 }) } });
  await wild.waitForSelector('#cc-checkout-wrap button', { timeout: 5000 }).catch(() => {});
  const w = await cbBox(wild, '#cc-checkout-wrap button');
  check('checkout button: out-of-range values are clamped (22px, 8px)', w && w.fs === '22px' && w.pt === '8px', JSON.stringify(w));
  await close(wild);

  const swipe = await openDrawer({ width: 390, data: { checkout_button_style: JSON.stringify({ mobileButtonType: 'swipe', paddingY: 22, fontSize: 18 }) } });
  await swipe.waitForSelector('#cc-swipe-track', { timeout: 5000 }).catch(() => {});
  const sw = await swipe.evaluate(() => {
    const t = document.querySelector('#cc-swipe-track');
    return t && { h: Math.round(t.getBoundingClientRect().height), thumb: Math.round(document.querySelector('#cc-swipe-thumb').getBoundingClientRect().height), fs: getComputedStyle(document.querySelector('#cc-swipe-label')).fontSize };
  });
  check('swipe button: height follows the padding (64px), thumb fits, label size', sw && sw.h === 64 && sw.thumb === 58 && sw.fs === '16px', JSON.stringify(sw));
  await close(swipe);
}

/* Price tags in the Checkout text (Cart Editor → Checkout Button) */
{
  const label = (page) => page.evaluate(() => [...document.querySelectorAll('#cc-checkout-wrap [data-cc-checkout-label]')].map((e) => e.textContent).join('|'));
  const plain = await openDrawer({ data: { checkoutName: 'Pay {price} now' } });
  check('checkout text: {price} = the cart total', /^Pay ₹900(\.00)? now$/.test(await label(plain)), await label(plain));
  await close(plain);

  // Prepaid offer, "Create the discount" off (show only): the drawer takes it off itself.
  const showOnly = await openDrawer({
    data: { checkoutName: 'Pay {prepaid_price} · save {saving}' },
    cod: { success: true, enabled: false, productPayment: { cards: false, prepaid: { showOnly: true, percent: 10, minSubtotal: 0, maxDiscount: 0 } } },
  });
  check('checkout text (show-only prepaid): {prepaid_price} and {saving}', /^Pay ₹810(\.00)? · save ₹90(\.00)?$/.test(await label(showOnly)), await label(showOnly));
  await close(showOnly);

  // BRIX's prepaid discount is live: Shopify already took it off the cart.
  const live = await openDrawer({
    data: { checkoutName: 'Pay {prepaid_price} · save {saving}' },
    cod: { success: true, enabled: false, productPayment: { cards: false, prepaid: { verified: true, percent: 10, title: 'Prepaid 10% off' } } },
    cartExtra: { total_price: 81000, items_subtotal_price: 90000, cart_level_discount_applications: [{ title: 'Prepaid 10% off', total_allocated_amount: 9000, value_type: 'percentage', value: '10.0' }] },
  });
  check('checkout text (prepaid in the cart): the total already has it, {saving} from the cart', /^Pay ₹810(\.00)? · save ₹90(\.00)?$/.test(await label(live)), await label(live));
  await close(live);

  // No prepaid offer: {saving} is left out, {prepaid_price} = the total.
  const none = await openDrawer({ data: { checkoutName: 'Pay {prepaid_price} {saving}' }, cod: { success: true, enabled: false } });
  check('checkout text (no prepaid offer): {prepaid_price} = total, no {saving}', /^Pay ₹900(\.00)?$/.test(await label(none)), await label(none));
  await close(none);
}

/* GoKwik checkout (Kwik COD Checkout embed, e.g. fabimore.com): Checkout opens GoKwik */
{
  // What GoKwik's embed + gokwik-sso-sdk.js put on the page.
  const GOKWIK = "window.gkShopDomain='demo.myshopify.com';window.initiateLogin=function(){window.__gkOpened=(window.__gkOpened||0)+1;};";
  const gk = await openDrawer({ data: {}, headJs: GOKWIK });
  check('GoKwik: the drawer draws its scripted Checkout button (not a /checkout link)', await gk.locator('#cc-standard-checkout-btn').count() === 1);
  await gk.click('#cc-standard-checkout-btn');
  await gk.waitForFunction(() => window.__gkOpened === 1, null, { timeout: 4000 }).catch(() => {});
  const gkState = await gk.evaluate(() => ({ opened: window.__gkOpened || 0, path: location.pathname, drawerOpen: Boolean(document.querySelector('#cc-overlay.active')) }));
  check('GoKwik: Checkout opens GoKwik, stays on the page and closes the drawer', gkState.opened === 1 && gkState.path === '/' && !gkState.drawerOpen, JSON.stringify(gkState));
  await close(gk);

  // fabimore.com: BRIX's Shiprocket switch is on, but the store runs GoKwik (no Shiprocket script).
  const both = await openDrawer({ data: { shiprocket_enabled: '1' }, headJs: GOKWIK });
  await both.click('#cc-standard-checkout-btn');
  await both.waitForFunction(() => window.__gkOpened === 1, null, { timeout: 4000 }).catch(() => {});
  const bothState = await both.evaluate(() => ({ opened: window.__gkOpened || 0, path: location.pathname }));
  check('GoKwik + Shiprocket switch on but no Shiprocket on the page: GoKwik opens', bothState.opened === 1 && bothState.path === '/', JSON.stringify(bothState));
  await close(both);

  // A combo box line is priced by a Shopify Function: Shopify checkout, not GoKwik.
  const box = await openDrawer({ data: {}, headJs: GOKWIK, cart: [line('k1', 1, 'Boys Joggers', 900, { properties: { _brix_combo_id: '7' } })] });
  await box.click('#cc-standard-checkout-btn');
  await box.waitForURL(/\/checkout/, { timeout: 4000 }).catch(() => {});
  check('GoKwik: a cart with a combo box goes to Shopify checkout', /\/checkout/.test(box.url()) && !(await box.evaluate(() => window.__gkOpened || 0)), box.url());
  await close(box);

  const plain = await openDrawer({ data: {} });
  check('no GoKwik: the Checkout link as before', await plain.locator('#cc-standard-checkout-btn').count() === 0 && await plain.locator('#cc-checkout-wrap a[href="/checkout"]').count() === 1);
  await close(plain);
}

check('no page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${shotDir}`);
process.exit(failed ? 1 : 0);

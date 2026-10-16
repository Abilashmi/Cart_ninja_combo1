/* eslint-env node */
// Browser check for the Quick Shop combo template (layout6,
// app/utils/combo-quickshop.shared.js via app/routes/combo-page[.]js.jsx).
// Run with:
//   node tests/combo-weight/quickshop-browser-check.mjs
// Loads the real storefront script into a blank page with every network call
// mocked (no store, no BRIX server). Proves the page's behaviour and what it
// sends to the cart; not that Shopify checkout then applies the discount.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loadComboPageScript } from './storefront-script.mjs';
import { normalizeWeightPricing } from '../../app/utils/combo-weight.shared.js';

const SCRIPT = loadComboPageScript();
const API = 'https://app.test';
const SHOTS = path.resolve('tests/combo-weight/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
const img = (label, fill = '#f6e3e3') => ({ url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${fill}"/><text x="100" y="105" font-size="18" text-anchor="middle" fill="#555">${label}</text></svg>`)}`, altText: label });
const product = (n, title, { price, compare = null, grams = null, vendor = 'Nandus', type = 'Chicken', tags = [], summary = '', variants = null, available = true, images = null } = {}) => ({
  id: P(n), title, handle: `p${n}`, price, currency: 'INR', image: images ? images[0] : img(title.split(' ')[1] || title), images: images || [img(title)],
  summary, vendor, productType: type, tags,
  variants: variants || [{ id: V(n * 10), title: 'Default Title', price, compareAtPrice: compare, grams, available, image: null }],
  variantId: V(n * 10),
});
const productsByHandle = {
  chicken: [
    product(1, 'Nandus Chicken Curry Cut - Skinless', {
      price: '168.00', summary: 'No Antibiotics', tags: ['Bestseller', 'Curry Cut'],
      variants: [
        { id: V(10), title: '500 g', price: '168.00', compareAtPrice: '179.00', grams: 500, available: true, image: null },
        { id: V(11), title: '1 kg', price: '320.00', compareAtPrice: '358.00', grams: 1000, available: true, image: null },
      ],
    }),
    product(2, 'Nandus Chicken Breast Boneless', {
      price: '259.00', grams: 450, summary: 'Clean, lean and boneless chicken breast pieces', tags: ['Boneless'],
      images: [img('Breast 1', '#e3eef6'), img('Breast 2', '#e6f6e3'), img('Breast 3', '#f6f0e3')],
    }),
    product(3, 'Licious Chicken Curry Cut (Large Pieces)', {
      price: '199.00', compare: '229.00', grams: 450, vendor: 'Licious', tags: ['Curry Cut'],
      // A long option name, like "Light Blue / 5-6 Y" on clothing stores.
      variants: [
        { id: V(30), title: 'Large Family Pack / Skin On / 12-14 Pieces', price: '199.00', compareAtPrice: '229.00', grams: 450, available: true, image: null },
        { id: V(31), title: 'Small / Skinless', price: '149.00', compareAtPrice: null, grams: 300, available: true, image: null },
      ],
    }),
  ],
  mutton: [
    product(4, 'Mutton Drumstick Pack', { price: '399.00', grams: 500, type: 'Mutton', vendor: 'Licious', tags: ['Drumstick'] }),
    product(5, 'Sold Out Chops', { price: '450.00', grams: 500, type: 'Mutton', available: false }),
  ],
};
const ALL_IDS = [1, 2, 3, 4, 5].map(P);

function wp(raw, patch = {}) {
  const { value, errors } = normalizeWeightPricing(raw);
  if (errors.length) throw new Error(JSON.stringify(errors));
  return {
    enabled: true, reason: null, hash: value.hash, measure: value.measure || 'weight', unit: value.unit, maxGrams: value.max_grams,
    tiers: value.tiers, messages: value.messages, qualifyingProductIds: ALL_IDS, ...patch,
  };
}
const t = (min, type, value, label = '') => ({ min_grams: min, type, value, label });
const QUANTITY = { measure: 'quantity', max_grams: 10, tiers: [t(3, 'percentage', 5), t(5, 'percentage', 10)], messages: { unlocked: 'You unlocked {{tier}}' } };
const VALUE = { measure: 'value', tiers: [t(500, 'fixed_amount', 50, 'FREE DELIVERY'), t(1000, 'percentage', 10)], messages: { unlocked: 'You unlocked {{tier}}' } };
const WEIGHT = { unit: 'kg', max_grams: 2000, tiers: [t(1000, 'percentage', 10)] };

const baseConfig = {
  layout: 'layout6', pricing_mode: 'weight', tab_count: 2, col_1: 'chicken', col_2: 'mutton',
  collection_title: 'Fresh meat box', qs_card_eyebrow: '8 MINS', qs_filter_custom: true, qs_filter_custom_label: 'Cut', qs_filter_custom_tags: 'Curry Cut, Boneless, Drumstick',
};

// A Dawn-shaped page: header group, the page section (title + .rte holding
// the mount point), another template section, footer group, fixed drawer.
const DAWN_PAGE = '<div id="shopify-section-sections--1__header" class="shopify-section shopify-section-group-header-group section-header"><sticky-header class="header-wrapper"><header class="header">Store header</header></sticky-header></div>'
  + '<cart-drawer class="drawer" style="position:fixed;right:0;top:0;width:10px;height:10px">drawer</cart-drawer>'
  + '<main id="MainContent"><section id="shopify-section-template--1__main" class="shopify-section section"><div class="page-width page-width--narrow">'
  // As on a live store: the title carries a "page-header" class, inside an extra .container.
  + '<div class="container"><h1 class="main-page-title page-header">Meat Box</h1><div class="rte"><p class="intro">Page text</p><div data-brix-combo-root data-shop="demo.myshopify.com" data-template-id="9"></div></div></div></div></section>'
  + '<section id="shopify-section-template--1__rich" class="shopify-section"><div class="rich-text">Other section</div></section></main>'
  + '<div id="shopify-section-sections--1__footer" class="shopify-section shopify-section-group-footer-group"><footer class="footer">Store footer</footer></div>';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();

// shiprocket: { code } = Shiprocket on for the shop, BrixCheckout stubbed, the
// box-code API answers with that code ('fail' = a 502).
// loader: { dataDelay, loaderDelay, loader (the /api/combo-loader answer's loader keys), dataStatus, wait = false }
async function openCombo(config, pricing, { cod = false, shiprocket = null, viewport = { width: 1280, height: 900 }, loader = null, themeCss = '', wholePrices = false, data = {} } = {}) {
  const page = await browser.newPage({ viewport });
  if (wholePrices) await page.addInitScript(() => { window.__brixWholePrices = true; });
  const log = { add: [], update: [], navigations: [], cod: [], boxCode: [], loader: 0 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms || 0));
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://store.test') {
      if (url.pathname === '/pages/box') {
        const srStub = shiprocket ? 'window.__sr = []; window.BrixCheckout = { checkoutItems: function (o) { window.__sr.push(o); } };' : '';
        const stubs = srStub + (cod ? `window.__cod = []; window.BrixCod = { isAvailable: function () { return Promise.resolve(true); }, open: function (o) { window.__cod.push(o); }, comboButton: function () { return Promise.resolve({ text: "Pay cash", icon: "", css: "background:#be185d;color:#ffffff;", placement: ${JSON.stringify(cod.placement || 'below')} }); } };` : '');
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><script>${stubs}</script><style>/* Dawn hides empty divs; the progress fills are empty divs */ div:empty{display:none} .theme-fixed{position:fixed;left:0;right:0;bottom:0;height:40px;z-index:100} ${themeCss}</style></head><body style="margin:0">${DAWN_PAGE}<script src="${API}/combo-page.js"></script></body></html>` });
      }
      if (url.pathname === '/cart.js') return json({ items: [] });
      if (url.pathname === '/cart/update.js') { log.update.push(JSON.parse(req.postData())); return json({ items: [] }); }
      if (url.pathname === '/cart/add.js') { log.add.push(JSON.parse(req.postData())); return json({ items: [] }); }
      log.navigations.push(url.pathname);
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>next</body></html>' });
    }
    if (url.pathname === '/combo-page.js') return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: SCRIPT });
    if (url.pathname === '/api/combo-loader') {
      log.loader += 1;
      await sleep(loader?.loaderDelay);
      return json({ success: true, loader: loader?.loader || {} });
    }
    if (url.pathname === '/api/combo-page-data') {
      await sleep(loader?.dataDelay);
      if (loader?.dataStatus) return json({ success: false }, loader.dataStatus);
      return json({ success: true, data: { templateId: 9, templateName: 'Meat Box', config, productsByHandle, collectionNameMap: { chicken: 'Chicken', mutton: 'Mutton' }, activeDiscounts: [], weightPricing: pricing, shiprocketEnabled: Boolean(shiprocket), ...data } });
    }
    if (url.pathname === '/api/combo-box-code') {
      log.boxCode.push({ body: JSON.parse(req.postData()), contentType: req.headers()['content-type'] });
      return shiprocket.code === 'fail' ? json({ success: false }, 502) : json({ success: true, code: shiprocket.code });
    }
    if (url.pathname === '/api/bundle-analytics') return json({ success: true });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://store.test/pages/box');
  if (!loader || loader.wait) await page.waitForSelector('.bxq-card');
  return { page, log };
}

const card = (n) => `.bxq-card[data-product-id="${P(n)}"]`;
const plus = (page, n) => page.click(`${card(n)} [data-combo-action="qty-inc"]`);
const minus = (page, n) => page.click(`${card(n)} [data-combo-action="qty-dec"]`);
const titles = (page) => page.$$eval('.bxq-name', (els) => els.map((e) => e.textContent));
const text = (page, sel) => page.textContent(sel).then((s) => (s || '').replace(/\s+/g, ' ').trim()).catch(() => '');

// ── quantity: cards, filters, sort, + stepper, bar, progress ──
{
  const { page, log } = await openCombo(baseConfig, wp(QUANTITY));
  check('all 5 products from both collections', (await titles(page)).length === 5);
  const shown = (sel) => page.$eval(sel, (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0).catch(() => false);
  check('combo page hides the theme page title', !(await shown('.main-page-title')));
  check('combo page hides the page text and other sections', !(await shown('.intro')) && !(await shown('.rich-text')));
  check('combo page keeps the header, footer and the theme cart drawer', (await shown('header.header')) && (await shown('footer.footer')) && (await page.$eval('cart-drawer', (e) => getComputedStyle(e).display !== 'none')));
  const c1 = await text(page, card(1));
  check('card: eyebrow, subtitle, badge, OFF and compare price', c1.includes('8 MINS') && c1.includes('No Antibiotics') && c1.includes('Bestseller') && c1.includes('6% OFF') && c1.includes('₹168') && c1.includes('₹179'), c1);
  check('card: variant dropdown with weights', (await page.$$eval(`${card(1)} select option`, (o) => o.map((x) => x.textContent))).join('|') === '500 g|1 kg');
  check('card: single variant shows its weight', (await text(page, card(2))).includes('450 g'));
  check('card: sold out has no + button', (await page.$(`${card(5)} [data-combo-action="qty-inc"]`)) === null && (await text(page, card(5))).includes('Out of stock'));
  check('no bar while the box is empty', (await page.$('.bxq-bar')) === null);
  check('top milestones: first tier message', (await text(page, '.bxq-top')).includes('Add 3 items more to unlock 5% OFF'), await text(page, '.bxq-top'));

  // filters
  const chipLabels = await page.$$eval('.bxq-chip', (els) => els.map((e) => e.textContent.trim()));
  check('chips: All + collections + Type / Brand / Cut / Sort menus', ['All', 'Chicken', 'Mutton', 'Type', 'Brand', 'Cut', 'Sort By'].every((l) => chipLabels.includes(l)), chipLabels.join(','));
  await page.click('[data-combo-action="qs-chip"][data-value="c:mutton"]');
  check('collection chip filters', (await titles(page)).length === 2);
  await page.click('[data-combo-action="qs-chip"][data-value="all"]');
  await page.click('[data-combo-action="qs-menu"][data-menu="brand"]');
  await page.click('[data-combo-action="qs-pick"][data-menu="brand"][data-value="Licious"]');
  check('Brand menu filters to Licious', (await titles(page)).length === 2 && (await text(page, '[data-menu="brand"]')).includes('Licious'));
  await page.click('[data-combo-action="qs-menu"][data-menu="custom"]');
  await page.click('[data-combo-action="qs-pick"][data-menu="custom"][data-value="Curry Cut"]');
  check('Cut (tags) + Brand together', (await titles(page)).join('|') === 'Licious Chicken Curry Cut (Large Pieces)', (await titles(page)).join('|'));
  await page.click('[data-combo-action="qs-clear"]');
  check('clear filters shows all again', (await titles(page)).length === 5);
  await page.click('[data-combo-action="qs-menu"][data-menu="sort"]');
  await page.click('[data-combo-action="qs-pick"][data-menu="sort"][data-value="price_desc"]');
  check('sort high to low', (await titles(page))[0] === 'Sold Out Chops');
  await page.click('[data-combo-action="qs-menu"][data-menu="sort"]');
  await page.click('[data-combo-action="qs-pick"][data-menu="sort"][data-value="discount"]');
  check('sort by biggest discount', (await titles(page))[0].startsWith('Licious'), (await titles(page))[0]);
  await page.click('[data-combo-action="qs-clear"]');

  // + → stepper, bar
  await plus(page, 1);
  check('+ turns into a stepper with 1', (await text(page, `${card(1)} .bxq-stepper`)).includes('1'));
  check('bar appears: 1 Item, ₹11 saved (compare-at)', (await text(page, '.bxq-bar')).includes('1 Item') && (await text(page, '.bxq-bar')).includes('₹11 saved'), await text(page, '.bxq-bar'));
  check('bar message: 2 more items for 5% OFF', (await text(page, '.bxq-msg')).includes('Add 2 items more to unlock 5% OFF'), await text(page, '.bxq-msg'));
  await plus(page, 2); await plus(page, 3);
  const bar3 = await text(page, '.bxq-bar');
  check('3 items unlock 5% OFF, bolded, celebrating', bar3.includes('You unlocked 5% OFF') && (await page.$('.bxq-bar.is-celebrate')) !== null && (await text(page, '.bxq-msg b')) === '5% OFF', bar3);
  // 168 + 259 + 199 = 626; 5% = 31.30; compare: 11 + 30 = 41 → 72.30
  check('savings = compare-at + box discount, "more coming up"', bar3.includes('₹72.30 saved, more coming up!'), bar3);
  const fills = await page.$$eval('.bxq-miles-fill, .bxq-fill, .bxq-step-fill, .bxq-slim-fill', (els) => els.map((e) => [getComputedStyle(e).display, e.getBoundingClientRect().width]));
  check('progress fill shows on a theme that hides div:empty', fills.length > 0 && fills.every(([d, w]) => d !== 'none' && w > 0), JSON.stringify(fills));
  check('bottom bar sits above theme sticky/fixed bits and chat widgets (on <body>, top layer)', (await page.$eval('.bxq-bar', (e) => Number(getComputedStyle(e).zIndex) >= 2147483646 && e.closest('[data-brix-combo-popup]')?.parentElement === document.body)));
  check('milestone 1 hit, 2 is next', (await page.$$eval('.bxq-mile', (els) => els.map((e) => e.className))).join('|').match(/is-hit.*\|.*is-next/) !== null);
  await plus(page, 3);
  check('celebrates once, not on every render', (await page.$('.bxq-bar.is-celebrate')) === null);
  await minus(page, 3);
  await page.selectOption(`${card(1)} select`, V(11));
  check('variant switch shows the 1 kg price and + again', (await text(page, card(1))).includes('₹320') && (await page.$(`${card(1)} .bxq-add`)) !== null);
  await page.click('[data-combo-action="box-open"]');
  check('items sheet lists the box', (await page.$$('.bxq-line')).length === 3);
  await page.click('[data-combo-action="box-inc"]');
  check('sheet + adds one', (await text(page, '.bxq-count')).includes('4 Items'));
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-quantity-desktop.png'), fullPage: true });

  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(400);
  const lines = log.add[0]?.items || [];
  check('Go to Cart adds the box with combo properties and goes to checkout',
    lines.length === 3 && lines.every((l) => l.properties?._brix_combo_id === '9' && l.properties._brix_combo_group) && log.navigations.includes('/checkout'), JSON.stringify(log));
  await page.close();
}

// ── title (Content settings), banner, SVG icons (no emoji) ──
{
  const BANNER = 'https://cdn.example.com/banner.jpg';
  const config = {
    ...baseConfig, collection_description: 'Pick any 3', heading_align: 'center', heading_size: 30, heading_color: '#ff0000',
    heading_align_mobile: 'right', description_align: 'center', show_banner: true, banner_image_url: BANNER, banner_height_desktop: 200,
    qs_tier_icons: '🎁, truck', qs_bar_icon_done: '🎉',
  };
  const { page } = await openCombo(config, wp(QUANTITY));
  const title = await page.$eval('.bxq-title', (e) => { const cs = getComputedStyle(e); return { align: cs.textAlign, size: cs.fontSize, color: cs.color }; });
  check('title follows Content: centred, 30px, red', title.align === 'center' && title.size === '30px' && title.color === 'rgb(255, 0, 0)', JSON.stringify(title));
  check('description follows its own alignment', (await page.$eval('.bxq-desc', (e) => getComputedStyle(e).textAlign)) === 'center');
  check('banner shows above the title', (await page.$eval('.bxq', (e) => { const b = e.querySelector('.bxq-banner img'); const h = e.querySelector('.bxq-head'); return !!b && b.getAttribute('src') === 'https://cdn.example.com/banner.jpg' && b.closest('.bxq-banner').getBoundingClientRect().height === 200 && !!(b.compareDocumentPosition(h) & 4); })));
  const miles = await page.$$eval('.bxq-mile-dot', (els) => els.map((e) => ({ svg: !!e.querySelector('svg'), text: e.textContent.trim() })));
  check('milestones draw SVG icons, never emoji (old 🎁 kept as the gift icon)', miles.length === 2 && miles.every((m) => m.svg && m.text === ''), JSON.stringify(miles));
  const paths = await page.$$eval('.bxq-mile-dot svg', (els) => els.map((e) => e.innerHTML));
  check('each tier gets a different icon', paths.length === 2 && paths[0] !== paths[1]);
  await plus(page, 1); await plus(page, 2); await plus(page, 3);
  check('bar icon is an SVG, no emoji', (await page.$eval('.bxq-msg-icon', (e) => !!e.querySelector('svg') && e.textContent.trim() === '')));
  check('no emoji anywhere on the page', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(await page.textContent('.bxq')));
  await page.close();

  const same = await openCombo({ ...config, qs_tier_icons: 'percent, percent' }, wp(QUANTITY));
  const samePaths = await same.page.$$eval('.bxq-mile-dot svg', (els) => els.map((e) => e.innerHTML));
  check('the same icon can be picked for every tier', samePaths.length === 2 && samePaths[0] === samePaths[1] && samePaths[0].includes('M19 5 5 19'), JSON.stringify(samePaths));
  await same.page.close();

  const phone = await openCombo(config, wp(QUANTITY), { viewport: { width: 390, height: 800 } });
  check('phone: title uses the mobile alignment', (await phone.page.$eval('.bxq-title', (e) => getComputedStyle(e).textAlign)) === 'right');
  await phone.page.close();

  const hidden = await openCombo({ ...config, show_title_description: false, show_banner: false }, wp(QUANTITY));
  check('Show title & description off hides the title', (await hidden.page.$('.bxq-head')) === null);
  check('Show banner off hides the banner', (await hidden.page.$('.bxq-banner')) === null);
  await hidden.page.close();
}

// ── Shiprocket: BRIX one-time code / merchant's own offer / fallback ──
{
  const config = { ...baseConfig, qs_checkout_with: 'shiprocket' };
  const { page, log } = await openCombo(config, wp(QUANTITY), { shiprocket: { code: 'BXTESTCODE22' } });
  await plus(page, 1); await plus(page, 2); await plus(page, 3);
  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(400);
  const sr = await page.evaluate(() => window.__sr);
  const req = log.boxCode[0];
  check('Shiprocket: asks BRIX for the box code with the box items (simple CORS request)',
    req && req.body.shop === 'demo.myshopify.com' && String(req.body.templateId) === '9' && req.body.items.length === 3 && req.contentType.startsWith('text/plain'), JSON.stringify(req));
  check('Shiprocket: opens with the items and the code, nothing added to the cart',
    sr.length === 1 && sr[0].coupon === 'BXTESTCODE22' && sr[0].items.length === 3 && sr[0].items.every((i) => !i.properties) && log.add.length === 0, JSON.stringify(sr));
  check('Shiprocket: Shopify fallback carries the same items and code',
    /\/cart\/10:1,20:1,30:1\?.*discount=BXTESTCODE22/.test(sr[0]?.fallbackUrl || ''), sr[0]?.fallbackUrl);
  await page.close();
}
{
  const config = { ...baseConfig, qs_checkout_with: 'shiprocket_own' };
  const { page, log } = await openCombo(config, wp(QUANTITY), { shiprocket: { code: 'UNUSED' } });
  await plus(page, 1);
  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(400);
  const sr = await page.evaluate(() => window.__sr);
  check('Shiprocket own offer: no BRIX code asked for or sent', log.boxCode.length === 0 && sr.length === 1 && sr[0].coupon === null, JSON.stringify(sr));
  await page.close();
}
{
  const config = { ...baseConfig, qs_checkout_with: 'shiprocket' };
  const { page, log } = await openCombo(config, wp(QUANTITY), { shiprocket: { code: 'fail' } });
  await plus(page, 1);
  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(500);
  const sr = await page.evaluate(() => window.__sr || []); // the page has moved on to /checkout
  check('Shiprocket: no code → box goes to Shopify checkout as before',
    sr.length === 0 && log.add.length === 1 && log.add[0].items[0].properties?._brix_combo_id === '9' && log.navigations.includes('/checkout'), JSON.stringify(log));
  await page.close();
}
{
  // Shop without Shiprocket: the setting is ignored.
  const config = { ...baseConfig, qs_checkout_with: 'shiprocket' };
  const { page, log } = await openCombo(config, wp(QUANTITY));
  await plus(page, 1);
  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(400);
  check('Shiprocket off for the shop: Shopify checkout', log.boxCode.length === 0 && log.navigations.includes('/checkout'));
  await page.close();
}

// ── value: FREE DELIVERY at ₹500, bar style + cart destination ──
{
  const config = { ...baseConfig, qs_top_style: 'bar', qs_bar_style: 'slim', qs_btn_action: 'cart' };
  const { page, log } = await openCombo(config, wp(VALUE));
  await plus(page, 2);
  check('value: Add ₹241 more to unlock FREE DELIVERY', (await text(page, '.bxq-msg')).includes('Add ₹241 more to unlock FREE DELIVERY'), await text(page, '.bxq-msg'));
  check('slim bar has its line', (await page.$('.bxq-slim')) !== null);
  check('top progress uses the bar style with tick labels', (await page.$$('.bxq-tick-label')).length === 2);
  await plus(page, 4);
  check('value: ₹658 unlocks FREE DELIVERY', (await text(page, '.bxq-msg')).includes('You unlocked FREE DELIVERY'));
  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(400);
  check('Go to Cart → /cart when the merchant picks the cart', log.navigations.includes('/cart'), JSON.stringify(log.navigations));
  await page.close();
}

// ── Quantity Box (layout7): normal cards, "Any 2 for ₹999" box price ──
{
  const BUY2 = { measure: 'quantity', max_grams: 2, tiers: [t(2, 'fixed_price', 999)], messages: { unlocked: 'You unlocked {{tier}}' } };
  const config = { ...baseConfig, layout: 'layout7', qs_card_layout: 'normal', qs_add_label: 'Add to box' };
  const { page, log } = await openCombo(config, wp(BUY2));
  check('Quantity Box is drawn with the box design', (await page.$('.bxq')) !== null);
  check('normal cards: Add button under each card, no + on the image', (await page.$$('.bxq-cta')).length >= 4 && (await page.$$('.bxq-add')).length === 0);
  check('normal cards: the merchant\'s button text', (await text(page, `.bxq-card[data-product-id="${P(1)}"] .bxq-cta`)) === 'Add to box', await text(page, `.bxq-card[data-product-id="${P(1)}"] .bxq-cta`));
  await page.click(`.bxq-card[data-product-id="${P(1)}"] .bxq-cta`);
  check('added card turns into a stepper', (await page.$(`.bxq-card[data-product-id="${P(1)}"] .bxq-cta--stepper`)) !== null);
  await page.click(`.bxq-card[data-product-id="${P(2)}"] .bxq-cta`);
  check('2 items unlock the box price', (await text(page, '.bxq-msg')).includes('You unlocked'), await text(page, '.bxq-msg'));
  await page.click(`.bxq-card[data-product-id="${P(3)}"] .bxq-cta`);
  check('max 2 items enforced', (await page.$$('.bxq-cta--stepper')).length === 2);
  await page.screenshot({ path: path.join(SHOTS, 'quantity-box-normal-cards.png') });
  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(500);
  const props = log.add[0]?.items?.[0]?.properties || {};
  check('checkout: box lines carry the combo id', props._brix_combo_id === '9' && log.navigations.includes('/checkout'), JSON.stringify(log.add[0]));
  await page.close();
}

// ── page loader: default round spinner → the merchant's loader → products ──
{
  const mine = { loader_style: 'dots', loader_color: '#be185d', loader_bg: '#fff7ed', loader_logo: 'https://cdn.example.com/logo.png', loader_logo_place: 'above', loader_text: 'Packing your box…' };
  const config = { ...baseConfig, layout: 'layout7', ...mine };
  const { page, log } = await openCombo(config, wp(QUANTITY), { loader: { dataDelay: 2500, loaderDelay: 700, loader: mine } });
  await page.waitForSelector('.bxl', { timeout: 5000 });
  check('loader: the default round spinner shows at once', (await page.$('.bxl.bxl--ring')) !== null && (await page.$('.bxl img')) === null);
  check('loader: the theme page text is hidden while loading', !(await page.isVisible('.intro')));
  await page.waitForSelector('.bxl.bxl--dots', { timeout: 3000 });
  check('loader: the merchant\'s loader replaces it (dots, logo above, text, colours)',
    (await page.$('.bxl-above img[src="https://cdn.example.com/logo.png"]')) !== null && (await text(page, '.bxl-text')) === 'Packing your box…'
    && (await page.$eval('.bxl', (el) => getComputedStyle(el).backgroundColor)) === 'rgb(255, 247, 237)'
    && (await page.$eval('.bxl-dots span', (el) => getComputedStyle(el).backgroundColor)) === 'rgb(190, 24, 93)');
  await page.screenshot({ path: path.join(SHOTS, 'combo-loader.png') });
  await page.waitForSelector('.bxq-card', { timeout: 6000 });
  check('loader: gone once the products are shown', (await page.$('.bxl')) === null);
  check('loader: asked the loader endpoint once', log.loader === 1, String(log.loader));

  // Next visit: this browser remembers the look, so no default spinner first.
  await page.reload();
  await page.waitForSelector('.bxl', { timeout: 5000 });
  check('loader: on the next visit the merchant\'s loader shows straight away', (await page.$('.bxl.bxl--dots')) !== null);
  await page.waitForSelector('.bxq-card', { timeout: 6000 });
  check('loader: no second loader request on the next visit', log.loader === 1, String(log.loader));
  await page.close();
}
{
  const config = { ...baseConfig, loader_enabled: false };
  const { page } = await openCombo(config, wp(VALUE), { loader: { dataDelay: 1500, loaderDelay: 100, loader: { loader_enabled: false } } });
  await page.waitForTimeout(600);
  check('loader off: nothing drawn while loading', (await page.$('.bxl')) === null);
  await page.waitForSelector('.bxq-card', { timeout: 6000 });
  await page.close();
}
{
  const { page } = await openCombo(baseConfig, wp(VALUE), { loader: { dataDelay: 800, loaderDelay: 50, dataStatus: 500 } });
  await page.waitForSelector('.bxl', { timeout: 5000 });
  await page.waitForTimeout(1500);
  check('loader: if the combo can\'t load, the theme page comes back', (await page.$('.bxl')) === null && await page.isVisible('.intro'));
  await page.close();
}

// ── weight + over the max, steps style, ring bar ──
{
  const config = { ...baseConfig, qs_top_style: 'steps', qs_bar_style: 'ring' };
  const { page } = await openCombo(config, wp(WEIGHT));
  await plus(page, 4); await plus(page, 4); // 1 kg
  check('weight: 1 kg unlocks 10% OFF', (await text(page, '.bxq-msg')).includes('You unlocked 10% OFF') || (await text(page, '.bxq-msg')).includes('10% OFF unlocked'), await text(page, '.bxq-msg'));
  check('ring shows the item count', (await text(page, '.bxq-ring')) === '2');
  await plus(page, 4); await plus(page, 4); await plus(page, 4); // 2.5 kg → blocked at 2 kg
  check('weight max blocks adding past 2 kg', (await text(page, `${card(4)} .bxq-stepper`)).includes('4'), await text(page, `${card(4)} .bxq-stepper`));
  check('steps style renders a step per tier', (await page.$$('.bxq-step')).length === 1);
  await page.close();
}

// ── not live: no offers promised, plain cart lines ──
{
  const { page, log } = await openCombo(baseConfig, wp(QUANTITY, { enabled: false, reason: 'not_live' }));
  check('not live: no top progress', (await page.$('.bxq-top')) === null);
  await plus(page, 1); await plus(page, 2); await plus(page, 3);
  const bar = await text(page, '.bxq-bar');
  check('not live: no unlock message, only compare-at savings', !bar.includes('unlocked') && bar.includes('₹41 saved!'), bar);
  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(400);
  check('not live: lines carry no box properties', (log.add[0]?.items || []).every((l) => !l.properties));
  await page.close();
}

// ── COD next to Go to Cart, phone layout ──
{
  const { page } = await openCombo({ ...baseConfig, qs_bar_style: 'full' }, wp(QUANTITY), { cod: { placement: 'below' }, viewport: { width: 390, height: 844 } });
  check('phone layout class', (await page.$('.bxq.bxq--m')) !== null);
  check('phone: 2 columns', (await page.$eval('.bxq-grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)) === 2);
  await plus(page, 1); await plus(page, 2); await plus(page, 3);
  await page.waitForSelector('.bxq-bar [data-combo-action="cod"]', { timeout: 3000 }).catch(() => {});
  const order = await page.$$eval('.bxq-actions button', (els) => els.map((e) => e.getAttribute('data-combo-action')).join(','));
  check('COD button after Go to Cart', order === 'checkout,cod', order);
  await page.click('.bxq-bar [data-combo-action="cod"]');
  const cod = await page.evaluate(() => window.__cod);
  check('COD opens with the box items + properties', cod.length === 1 && cod[0].items.length === 3 && cod[0].items.every((i) => i.properties?._brix_combo_id === '9'));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('phone: no sideways scroll', !overflow);
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-phone.png'), fullPage: false });
  await page.close();
}

/* Product popup: a tap on a card's picture or name opens it, with thumbnails. */
{
  const { page, log } = await openCombo(baseConfig, wp(QUANTITY));
  await page.waitForSelector(card(2));
  check('popup: card picture and name open it (marked clickable)', await page.$eval(`${card(2)} .bxq-media img`, (e) => e.getAttribute('data-combo-action')) === 'qs-view'
    && await page.$eval(`${card(2)} .bxq-name`, (e) => e.getAttribute('data-combo-action')) === 'qs-view');
  await page.click(`${card(2)} .bxq-media img`);
  await page.waitForSelector('.bxq-pop');
  const mainSrc = () => page.$eval('.bxq-pop-main img', (e) => decodeURIComponent(e.getAttribute('src')));
  let pop = await page.$eval('.bxq-pop', (e) => ({ text: e.textContent, thumbs: e.querySelectorAll('.bxq-pop-thumb').length, on: e.querySelector('.bxq-pop-thumb.is-on') ? [...e.querySelectorAll('.bxq-pop-thumb')].indexOf(e.querySelector('.bxq-pop-thumb.is-on')) : -1 }));
  check('popup: name, price, full description, 1 / 3 and three thumbnails (first selected)', pop.text.includes('Nandus Chicken Breast Boneless') && pop.text.includes('₹259') && pop.text.includes('Clean, lean and boneless chicken breast pieces') && pop.text.includes('1 / 3') && pop.thumbs === 3 && pop.on === 0, JSON.stringify(pop));
  check('popup: the page behind stops scrolling', await page.evaluate(() => document.documentElement.style.overflow) === 'hidden');
  await page.click('.bxq-pop-thumb:nth-child(3)');
  check('popup: a thumbnail switches the big picture', (await mainSrc()).includes('Breast 3') && (await page.$eval('.bxq-pop', (e) => e.textContent)).includes('3 / 3'));
  await page.click('.bxq-pop-nav.is-next');
  check('popup: next wraps round to the first picture', (await mainSrc()).includes('Breast 1'));
  await page.keyboard.press('ArrowLeft');
  check('popup: ← goes back (to the last picture)', (await mainSrc()).includes('Breast 3'));
  await page.keyboard.press('Escape');
  check('popup: Esc closes it and the page scrolls again', !(await page.$('.bxq-pop')) && await page.evaluate(() => document.documentElement.style.overflow) === '');
  await page.click(`${card(2)} .bxq-media img`);
  await page.waitForSelector('.bxq-pop');
  await page.click('.bxq-pop-cta [data-combo-action="qty-inc"]');
  await page.waitForTimeout(300);
  check('popup: Add puts it in the box and closes the popup', !(await page.$('.bxq-pop')) && (await text(page, '.bxq-bar')).includes('1 Item') && await page.evaluate(() => document.documentElement.style.overflow) === '', await text(page, '.bxq-bar'));
  await page.click(`${card(2)} .bxq-name`);
  await page.waitForSelector('.bxq-pop');
  await page.click('.bxq-pop-cta [data-combo-action="qty-inc"]');
  await page.waitForTimeout(300);
  check('popup: already in the box → the stepper\'s + adds one more and the popup stays', (await page.$('.bxq-pop')) !== null && (await page.$eval('.bxq-pop-cta', (e) => e.textContent)).includes('2'), await page.$eval('.bxq-pop-cta', (e) => e.textContent).catch(() => 'closed'));
  await page.keyboard.press('Escape');
  await page.click(`${card(2)} .bxq-name`);
  await page.waitForSelector('.bxq-pop');
  await page.click('.bxq-pop-scrim', { position: { x: 5, y: 5 } });
  check('popup: tapping outside closes it', !(await page.$('.bxq-pop')));
  void log;
  await page.close();

  const phone = await openCombo(baseConfig, wp(QUANTITY), { viewport: { width: 390, height: 844 } });
  await phone.page.waitForSelector(card(2));
  await phone.page.click(`${card(2)} .bxq-name`);
  await phone.page.waitForSelector('.bxq-pop');
  await phone.page.waitForTimeout(400); // the sheet slides up
  const sheet = await phone.page.$eval('.bxq-pop-box', (e) => { const r = e.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), w: window.innerWidth, h: window.innerHeight }; });
  check('popup on a phone: a full-width sheet from the bottom', sheet.left === 0 && sheet.right === sheet.w && Math.abs(sheet.bottom - sheet.h) <= 1, JSON.stringify(sheet));
  check('popup on a phone: no sideways scroll', !(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await phone.page.screenshot({ path: path.join(SHOTS, 'quickshop-popup-phone.png') });
  await phone.page.close();

  const off = await openCombo({ ...baseConfig, qs_product_popup: false }, wp(QUANTITY));
  await off.page.waitForSelector(card(2));
  await off.page.click(`${card(2)} .bxq-media img`);
  await off.page.waitForTimeout(200);
  check('popup switched off: pictures and names are not clickable', !(await off.page.$('.bxq-pop')) && await off.page.$eval(`${card(2)} .bxq-name`, (e) => e.getAttribute('data-combo-action')) === null);
  await off.page.close();
}

/* Sticky progress stays below the theme's sticky header (here 120px), and
   moves up when the theme slides its header away while scrolling. */
{
  const { page } = await openCombo({ ...baseConfig, qs_top_style: 'milestones', qs_top_sticky: true }, wp(QUANTITY), {
    viewport: { width: 390, height: 640 },
    themeCss: '.section-header{position:sticky;top:0;z-index:50;background:#fff;transition:transform .15s} .section-header .header{height:120px;display:block} .section-header.is-hidden{transform:translateY(-100%)}',
  });
  await page.waitForSelector('.bxq-top.is-sticky');
  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForTimeout(600);
  const at = () => page.evaluate(() => Math.round(document.querySelector('.bxq-top').getBoundingClientRect().top));
  let top = await at();
  check('sticky progress: stays just below a 120px sticky theme header, not behind it', Math.abs(top - 120) <= 2, String(top));
  // Adding redraws the page: the bar must not flash to the top and slide back.
  const tops = await page.evaluate(() => new Promise((done) => {
    const seen = [];
    const t0 = performance.now();
    const tick = () => {
      seen.push(Math.round(document.querySelector('.bxq-top').getBoundingClientRect().top));
      if (performance.now() - t0 < 700) requestAnimationFrame(tick); else done(seen);
    };
    requestAnimationFrame(tick);
    setTimeout(() => document.querySelector('.bxq-add').click(), 60);
  }));
  check('sticky progress: adding a product never moves the bar (no flash to the top)', tops.every((y) => Math.abs(y - 120) <= 2) && (await text(page, '.bxq-bar')).includes('1 Item'), JSON.stringify([...new Set(tops)]));
  await page.evaluate(() => { document.querySelector('.section-header').classList.add('is-hidden'); window.scrollBy(0, 40); });
  await page.waitForTimeout(700);
  top = await at();
  check('sticky progress: moves up to the top when the theme hides its header', Math.abs(top) <= 2, String(top));
  await page.evaluate(() => { document.querySelector('.section-header').classList.remove('is-hidden'); window.scrollBy(0, -20); });
  await page.waitForTimeout(700);
  check('sticky progress: back under the header when it comes back', Math.abs((await at()) - 120) <= 2, String(await at()));
  await page.close();

  const own = await openCombo({ ...baseConfig, qs_top_sticky: true, qs_top_offset: 60 }, wp(QUANTITY), { viewport: { width: 390, height: 640 } });
  await own.page.waitForSelector('.bxq-top.is-sticky');
  await own.page.evaluate(() => window.scrollTo(0, 700));
  await own.page.waitForTimeout(600);
  check('sticky progress: no sticky header → the merchant\'s own space (60px) still applies', Math.abs((await own.page.evaluate(() => document.querySelector('.bxq-top').getBoundingClientRect().top)) - 60) <= 2);
  await own.page.close();
}

/* Phone layout on a theme that styles every <select> (display:block, its
   own width): a long option name stays inside the card, nothing scrolls
   sideways; the title follows desktop's Center on phones (builder's old
   saved phone "left"); tall photos fill a Tall (2:3) frame. */
{
  const { page } = await openCombo({
    ...baseConfig, show_title_description: true, collection_title: 'Create Your Perfect Combo Box',
    heading_align: 'center', heading_align_mobile: 'left', qs_image_ratio: 'tall', qs_image_fit: 'cover',
  }, wp(QUANTITY), { viewport: { width: 390, height: 844 }, themeCss: 'select{display:block;font-size:16px;padding:0 12px}' });
  await page.waitForSelector(card(3));
  const g = await page.evaluate(() => {
    const c = document.querySelector('.bxq-card[data-product-id$="/3"]').getBoundingClientRect();
    const sel = document.querySelector('.bxq-card[data-product-id$="/3"] .bxq-variant select').getBoundingClientRect();
    const media = document.querySelector('.bxq-media').getBoundingClientRect();
    return {
      docW: document.documentElement.scrollWidth, W: window.innerWidth, selRight: Math.round(sel.right), cardRight: Math.round(c.right),
      title: getComputedStyle(document.querySelector('.bxq-title')).textAlign,
      ratio: Math.round((media.height / media.width) * 100) / 100, fit: getComputedStyle(document.querySelector('.bxq-media img')).objectFit,
    };
  });
  check('phone: a long option name stays inside its card', g.selRight <= g.cardRight + 1, JSON.stringify(g));
  check('phone: nothing scrolls sideways', g.docW <= g.W, `${g.docW} > ${g.W}`);
  check('phone: title follows desktop Center (old saved phone "left" ignored)', g.title === 'center', g.title);
  check('Tall (2:3) frame, filled', Math.abs(g.ratio - 1.5) < 0.02 && g.fit === 'cover', JSON.stringify(g));
  await page.close();
}

/* Popup on a theme that animates page content with a transform (Dawn's
   scroll-trigger, knitnknot.in) under a sticky header: still on screen,
   above the header, and it still works. */
{
  const { page } = await openCombo(baseConfig, wp(QUANTITY), {
    viewport: { width: 390, height: 844 },
    themeCss: '.rte{transform:matrix(1,0,0,1,0,0)} .section-header{position:sticky;top:0;z-index:50;background:#fff} .section-header .header{height:120px;display:block}',
  });
  await page.waitForSelector(card(2));
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(300);
  await page.click(`${card(2)} .bxq-media img`);
  await page.waitForSelector('.bxq-pop');
  await page.waitForTimeout(400);
  const g = await page.evaluate(() => {
    const box = document.querySelector('.bxq-pop-box').getBoundingClientRect();
    const close = document.querySelector('.bxq-pop-close').getBoundingClientRect();
    const top = document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2);
    return {
      box: [Math.round(box.left), Math.round(box.top), Math.round(box.right), Math.round(box.bottom)], h: window.innerHeight, w: window.innerWidth,
      closeOnTop: Boolean(top && top.closest('.bxq-pop-close')), onBody: document.querySelector('.bxq-pop').closest('[data-brix-combo-popup]')?.parentElement === document.body,
    };
  });
  check('transformed theme: the popup is on screen (a sheet at the bottom), not lost in the page', g.box[0] === 0 && g.box[2] === g.w && Math.abs(g.box[3] - g.h) <= 1 && g.box[1] >= 0, JSON.stringify(g));
  check('transformed theme: above the sticky header (its close button is what you tap)', g.closeOnTop && g.onBody, JSON.stringify(g));
  await page.click('.bxq-pop-thumb:nth-child(2)');
  const fits = await page.evaluate(() => { const m = document.querySelector('.bxq-pop-main').getBoundingClientRect(); return m.right <= window.innerWidth; });
  check('popup on a phone: the big picture stays inside the screen', fits);
  check('transformed theme: thumbnails still work', decodeURIComponent(await page.$eval('.bxq-pop-main img', (e) => e.getAttribute('src'))).includes('Breast 2'));
  await page.click('.bxq-pop-cta [data-combo-action="qty-inc"]');
  await page.waitForTimeout(300);
  check('transformed theme: Add works and closes it', !(await page.$('.bxq-pop')) && (await text(page, '.bxq-bar')).includes('1 Item'));
  await page.close();
}

/* A chat widget frame over the bottom-right (knitnknot.in: 230×84, z-index
   2147483640) inside a transformed theme: Go to Cart stays tappable; locked
   checkout (first offer required) explains itself instead of doing nothing. */
{
  const { page, log } = await openCombo({ ...baseConfig, qs_require_first_tier: true }, wp(QUANTITY), {
    viewport: { width: 390, height: 664 },
    themeCss: '.rte{transform:matrix(1,0,0,1,0,0)}',
  });
  await page.evaluate(() => { const f = document.createElement('iframe'); f.id = 'chat'; f.setAttribute('style', 'position:fixed !important;bottom:0;right:0;width:230px;height:84px;border:0;background:transparent;z-index:2147483640 !important'); document.body.appendChild(f); });
  await page.waitForSelector(card(1));
  await plus(page, 1);
  await page.waitForTimeout(300);
  const go = '.bxq-bar [data-combo-action="checkout-locked"], .bxq-bar .bxq-go';
  const hit = () => page.evaluate((sel) => { const b = document.querySelector(sel); const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return Boolean(t && t.closest('.bxq-go')); }, go);
  check('chat widget over the corner: Go to Cart is what you tap', await hit());
  check('locked (1 item, first offer at 3): dimmed but not dead', await page.$eval(go, (e) => e.classList.contains('is-locked') && !e.disabled && e.getAttribute('aria-disabled') === 'true'));
  await page.click(go, { force: true }); // aria-disabled: Playwright won't tap it, shoppers can
  await page.waitForTimeout(200);
  const toast = await page.evaluate(() => (document.querySelector('[data-brix-combo-toast]') || {}).textContent || '');
  check('locked: a tap says why ("Add 2 items more to unlock 5% OFF")', toast.includes('Add 2 items more to unlock 5% OFF') && log.navigations.length === 0, toast);
  check('the message shows on screen (not lost inside the transformed page)', await page.evaluate(() => { const t = document.querySelector('[data-brix-combo-toast]'); const r = t.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; }));
  await plus(page, 2); await plus(page, 3);
  await page.waitForTimeout(300);
  check('first offer reached: a real Go to Cart, still on top of the chat frame', await page.$eval('.bxq-bar .bxq-go', (e) => e.getAttribute('data-combo-action') === 'checkout' && !e.disabled) && await hit());
  check('the page keeps room at its end for the bar', await page.evaluate(() => parseInt(document.querySelector('.bxq').style.paddingBottom, 10) > 40));
  await page.close();
}

/* "Hide decimals in prices": whole rupees everywhere on the page (display only). */
{
  const { page } = await openCombo({ ...baseConfig, qs_hide_decimals: true }, wp(QUANTITY));
  await page.waitForSelector(card(1));
  await plus(page, 1); await plus(page, 2); await plus(page, 3);
  await page.waitForTimeout(300);
  // 168 + 259 + 199 = 626; 5% = 31.30 → ₹594.70 total, ₹72.30 saved
  const bar = await text(page, '.bxq-bar');
  check('hide decimals: bar shows ₹72 saved, no paise anywhere', bar.includes('₹72 saved') && !/\d\.\d\d/.test(bar), bar);
  await page.click('.bxq-bar [data-combo-action="box-open"]');
  await page.waitForTimeout(200);
  const all = await page.evaluate(() => document.body.innerText);
  check('hide decimals: no prices with paise on the page', !/₹\d+\.\d\d/.test(all), (all.match(/₹\d+\.\d\d/) || [''])[0]);
  await page.close();
  const plain = await openCombo(baseConfig, wp(QUANTITY));
  await plain.page.waitForSelector(card(1));
  await plus(plain.page, 1); await plus(plain.page, 2); await plus(plain.page, 3);
  await plain.page.waitForTimeout(300);
  check('decimals shown by default (₹72.30 saved)', (await text(plain.page, '.bxq-bar')).includes('₹72.30 saved'));
  await plain.page.close();
  // The store-wide switch (Account → Price display) hides them too.
  const store = await openCombo(baseConfig, wp(QUANTITY), { wholePrices: true });
  await store.page.waitForSelector(card(1));
  await plus(store.page, 1); await plus(store.page, 2); await plus(store.page, 3);
  await store.page.waitForTimeout(300);
  check('store-wide "Hide decimals" also applies to box pages (₹72 saved)', (await text(store.page, '.bxq-bar')).includes('₹72 saved'));
  await store.page.close();
}

/* Milestones close together by weight (1 kg, 2 kg of 5 kg, as on a live books
   box): evenly spaced on a phone, labels never overlap, the fill meets the dots. */
{
  const BOOKS = {
    unit: 'kg', max_grams: 5000,
    tiers: [t(1000, 'fixed_price', 999, '1kg Box at ₹999'), t(2000, 'fixed_price', 1999, '2kg Box at ₹1999'), t(5000, 'fixed_price', 2000, '5kg Box at ₹2000')],
  };
  const { page } = await openCombo({ ...baseConfig, qs_top_style: 'milestones' }, wp(BOOKS), { viewport: { width: 390, height: 844 } });
  await page.waitForSelector('.bxq-mile');
  const geo = () => page.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const labels = [...document.querySelectorAll('.bxq-mile-label')].map((e) => { const b = r(e); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; });
    const dots = [...document.querySelectorAll('.bxq-mile-dot')].map((e) => { const b = r(e); return (b.left + b.right) / 2; });
    const line = r(document.querySelector('.bxq-miles-line'));
    const fill = r(document.querySelector('.bxq-miles-fill'));
    const top = r(document.querySelector('.bxq-top'));
    return { labels, dots, lineLeft: line.left, fillRight: fill.left + fill.width, topBottom: top.bottom };
  });
  let g = await geo();
  const overlaps = g.labels.some((a, i) => g.labels.some((b, j) => j > i && a.r > b.l + 0.5 && b.r > a.l + 0.5 && a.b > b.t && b.b > a.t));
  check('phone milestones (1 kg / 2 kg / 5 kg): no label overlaps another', !overlaps, JSON.stringify(g.labels.map((x) => [Math.round(x.l), Math.round(x.r)])));
  const gaps = g.dots.slice(1).map((d, i) => Math.round(d - g.dots[i]));
  check('phone milestones: evenly spaced', gaps.every((x) => Math.abs(x - gaps[0]) <= 2), JSON.stringify(gaps));
  check('phone milestones: labels stay inside the progress box', g.labels.every((x) => x.b <= g.topBottom + 0.5), `${JSON.stringify(g.labels.map((x) => Math.round(x.b)))} vs ${Math.round(g.topBottom)}`);
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-milestones-phone.png') });
  // 1 kg in the box (the chicken 1 kg variant): the fill reaches the first dot.
  await page.selectOption(`${card(1)} select`, V(11));
  await plus(page, 1);
  await page.waitForTimeout(500);
  g = await geo();
  check('phone milestones: at 1 kg the fill ends on the first dot', Math.abs(g.fillRight - g.dots[0]) <= 3, `${Math.round(g.fillRight)} vs ${Math.round(g.dots[0])}`);
  await page.close();
}

/* Filters by variant weight (dropdown, slider), price slider and collection
   filter groups; milestone icon size, label lines; hidden card price. */
{
  const slide = (page, id, end, value) => page.evaluate(([sel, i, v]) => {
    const input = document.querySelectorAll(sel)[i];
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return document.querySelector(`.bxq-range[aria-label] input[data-combo-range="${input.getAttribute('data-combo-range')}"]`).closest('.bxq-range').querySelector('.bxq-range-val').textContent;
  }, [`input[data-combo-range="${id}"]`, end, value]);
  const letGo = (page, id, end) => page.evaluate(([sel, i]) => { document.querySelectorAll(sel)[i].dispatchEvent(new Event('change', { bubbles: true })); }, [`input[data-combo-range="${id}"]`, end]);
  const qty = { qs_filter_type: false, qs_filter_brand: false, qs_filter_custom: false, qs_filter_sort: false, qs_chips_source: 'none' };

  // Weight dropdown: 1 kg shows the curry cut with its 1 kg variant, and + adds that variant.
  let { page } = await openCombo({ ...baseConfig, ...qty, qs_filter_weight: true }, wp(QUANTITY));
  const weights = await page.$$eval('[data-menu="weight"]', (els) => els.length);
  check('weight dropdown shown', weights === 1);
  await page.click('[data-combo-action="qs-menu"][data-menu="weight"]');
  check('weight options = the page\'s variant weights', (await page.$$eval('[data-combo-action="qs-pick"][data-menu="weight"]', (els) => els.map((e) => e.textContent))).join('|') === 'All|300 g|450 g|500 g|1 kg');
  await page.click('[data-combo-action="qs-pick"][data-menu="weight"][data-value="w:1000"]');
  check('1 kg: only the product with a 1 kg variant', (await titles(page)).join('|') === 'Nandus Chicken Curry Cut - Skinless', (await titles(page)).join('|'));
  check('1 kg: the card shows its 1 kg variant and price', (await page.$eval(`${card(1)} select`, (e) => e.value)) === V(11) && (await text(page, card(1))).includes('₹320'));
  await plus(page, 1);
  await page.waitForSelector('.bxq-bar');
  await page.click('[data-combo-action="qs-clear"]');
  check('+ added the 1 kg variant; it stays picked after clearing', (await page.$eval(`${card(1)} select`, (e) => e.value)) === V(11) && (await text(page, `${card(1)} .bxq-stepper`)).includes('1'));
  await page.close();

  // Weight + price sliders.
  ({ page } = await openCombo({ ...baseConfig, ...qty, qs_filter_weight: true, qs_filter_weight_mode: 'slider', qs_filter_price: true, qs_filter_price_label: 'Budget' }, wp(QUANTITY), { viewport: { width: 390, height: 844 } }));
  check('two sliders: weight and price', (await page.$$eval('.bxq-range .bxq-gchips-label', (els) => els.map((e) => e.textContent))).join('|') === 'Weight|Budget');
  check('weight slider spans the lightest to heaviest', (await text(page, '.bxq-range[aria-label="Weight"] .bxq-range-val')) === '300 g – 1 kg');
  const live = await slide(page, 'weight', 0, 900);
  check('dragging updates the text only (no filtering yet)', live === '900 g – 1 kg' && (await titles(page)).length === 5, live);
  await letGo(page, 'weight', 0);
  await page.waitForFunction(() => document.querySelectorAll('.bxq-card').length === 1);
  check('letting go filters: 900 g – 1 kg', (await titles(page)).join('|') === 'Nandus Chicken Curry Cut - Skinless' && (await page.$eval(`${card(1)} select`, (e) => e.value)) === V(11));
  check('handles can\'t cross', (await slide(page, 'weight', 1, 400)) === '900 g – 900 g');
  // Dragged back to the full span = no weight filter.
  await slide(page, 'weight', 1, 1000);
  await slide(page, 'weight', 0, 300);
  await letGo(page, 'weight', 0);
  await page.waitForFunction(() => document.querySelectorAll('.bxq-card').length === 5);
  check('price slider spans ₹145 – ₹450 (round steps)', (await text(page, '.bxq-range[aria-label="Budget"] .bxq-range-val')) === '₹145 – ₹450', await text(page, '.bxq-range[aria-label="Budget"] .bxq-range-val'));
  await slide(page, 'price', 1, 200);
  await letGo(page, 'price', 1);
  await page.waitForFunction(() => document.querySelectorAll('.bxq-card').length === 2);
  check('price ₹145 – ₹200: two products', (await titles(page)).join('|') === 'Nandus Chicken Curry Cut - Skinless|Licious Chicken Curry Cut (Large Pieces)', (await titles(page)).join('|'));
  check('the large-pieces card shows its ₹199 variant (in budget)', (await text(page, card(3))).includes('₹199'));
  const box = await page.$eval('.bxq-range-box', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, right: r.right }; });
  check('phone: slider fits the screen', box.w >= 120 && box.right <= 390, JSON.stringify(box));
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-sliders-phone.png') });
  await page.close();

  // Collection filter groups (members from the server), as chips.
  ({ page } = await openCombo({
    ...baseConfig, ...qty,
    qs_filter_groups: [{ id: 'age', label: 'Years', style: 'chips', options: [{ handle: 'age-1', label: '1-2 Y' }, { handle: 'age-3', label: '3-4 Y' }, { handle: 'age-9', label: '9 Y' }] }],
  }, wp(QUANTITY), { data: { collectionMembers: { 'age-1': [P(1), P(2)], 'age-3': [P(4)], 'age-9': [] } } }));
  check('collection group chips: options with products only', (await page.$$eval('.bxq-gchips [data-combo-action="qs-group"]', (els) => els.map((e) => e.textContent))).join('|') === '1-2 Y|3-4 Y');
  await page.click('[data-combo-action="qs-group"][data-value="age-1"]');
  check('collection group filters', (await titles(page)).length === 2);
  await page.click('[data-combo-action="qs-group"][data-value="age-1"]');
  check('tap again clears', (await titles(page)).length === 5);
  await page.close();

  // Filters in a left column (desktop) and a slider inside a dropdown.
  ({ page } = await openCombo({ ...baseConfig, ...qty, qs_filter_position: 'left', qs_filter_weight: true, qs_filter_price: true, qs_filter_brand: true }, wp(QUANTITY)));
  const side = await page.$eval('.bxq-side', (e) => { const r = e.getBoundingClientRect(); const g = document.querySelector('.bxq-grid').getBoundingClientRect(); return { w: Math.round(r.width), left: r.left < g.left, top: Math.abs(r.top - g.top) < 4 }; });
  check('left column beside the grid', side.w === 240 && side.left && side.top, JSON.stringify(side));
  await page.click('.bxq-side [data-combo-action="qs-pick"][data-menu="weight"][data-value="w:1000"]');
  check('left column: picking 1 kg filters', (await titles(page)).length === 1);
  await page.click('.bxq-side-clear');
  check('left column: Clear all', (await titles(page)).length === 5);
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-filters-left.png') });
  await page.close();

  ({ page } = await openCombo({ ...baseConfig, ...qty, qs_filter_weight: true, qs_filter_weight_mode: 'slider', qs_slider_look: 'dropdown' }, wp(QUANTITY), { viewport: { width: 390, height: 844 } }));
  await page.click('[data-combo-action="qs-menu"][data-menu="weight"]');
  await page.waitForSelector('.bxq-menu--range input[data-combo-range="weight"]');
  await slide(page, 'weight', 0, 900);
  await letGo(page, 'weight', 0);
  await page.waitForFunction(() => document.querySelectorAll('.bxq-card').length === 1);
  check('slider dropdown: filters and stays open', !!(await page.$('.bxq-menu--range')));
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-slider-dropdown-phone.png') });
  await page.click('.bxq-scrim');
  check('slider dropdown: chip shows the span', (await text(page, '[data-combo-action="qs-menu"][data-menu="weight"]')) === '900 g – 1 kg');
  await page.close();

  // Dropdowns stay under their chip: a theme wrapper with a transform (which
  // moves position:fixed boxes) and a scrolled page, as on a live store.
  // Plain themes (a fixed box doesn't scroll: the list used to stay put while
  // the chip scrolled away) and themes with a transformed wrapper.
  for (const [viewport, themeCss] of [
    [{ width: 1280, height: 900 }, '.bxq{padding-top:60px} footer.footer{height:1500px}'],
    [{ width: 390, height: 844 }, '.bxq{padding-top:60px} footer.footer{height:1500px}'],
    [{ width: 1280, height: 900 }, 'main{transform:translateZ(0);margin-top:120px} .bxq{padding-top:60px} footer.footer{height:1500px}'],
  ]) {
    ({ page } = await openCombo({ ...baseConfig, ...qty, qs_filter_weight: true, qs_filter_brand: true }, wp(QUANTITY), { viewport, themeCss }));
    await page.evaluate(() => window.scrollTo(0, 150));
    await page.click('[data-combo-action="qs-menu"][data-menu="weight"]');
    await page.waitForSelector('.bxq-dd.is-open .bxq-menu');
    const gap = () => page.evaluate(() => {
      const chip = document.querySelector('.bxq-dd.is-open [data-combo-action="qs-menu"]').getBoundingClientRect();
      const menu = document.querySelector('.bxq-dd.is-open .bxq-menu').getBoundingClientRect();
      return { dy: Math.round(menu.top - chip.bottom), dx: Math.round(menu.left - Math.max(8, Math.min(chip.left, innerWidth - menu.width - 8))) };
    });
    let g = await gap();
    const theme = themeCss.includes('transform') ? ', transformed theme' : '';
    check(`${viewport.width}px${theme}: the Weight list opens right under its chip`, g.dy === 6 && Math.abs(g.dx) <= 1, JSON.stringify(g));
    await page.evaluate(() => window.scrollBy(0, 120));
    await page.waitForTimeout(150);
    g = await gap();
    check(`${viewport.width}px${theme}: and stays there while the page scrolls`, g.dy === 6 && Math.abs(g.dx) <= 1, JSON.stringify(g));
    if (viewport.width === 390 && !theme) await page.screenshot({ path: path.join(SHOTS, 'quickshop-dropdown-phone.png') });
    await page.close();
  }

  // Milestone look and hidden card price.
  ({ page } = await openCombo({ ...baseConfig, ...qty, qs_top_style: 'milestones', qs_mile_icon_size: 30, qs_top_show_amount: false, qs_top_label_size: 16, qs_show_price: false }, wp(QUANTITY)));
  const mile = await page.$eval('.bxq-mile-dot', (e) => { const r = e.getBoundingClientRect(); const icon = e.querySelector('.bxq-mile-icon').getBoundingClientRect(); return { dot: Math.round(r.width), icon: Math.round(icon.width) }; });
  check('milestone icon 30px in a 46px circle', mile.dot === 46 && mile.icon === 30, JSON.stringify(mile));
  check('milestone amount hidden, name 16px', (await page.$('.bxq-mile-label small')) === null && (await page.$eval('.bxq-mile-label b', (e) => getComputedStyle(e).fontSize)) === '16px');
  check('card selling price hidden, MRP kept', !(await text(page, `${card(1)} .bxq-price`)).includes('₹168') && (await text(page, `${card(1)} .bxq-price`)).includes('₹179'));
  await page.close();
}

/* Slots bottom bar on a quantity box (as on veeba.in): empty boxes from the
   start, pictures as items go in, tap one to take it out. */
{
  const BUNDLE = { measure: 'quantity', max_grams: 10, tiers: [t(3, 'fixed_price', 469, 'the bundle at ₹469'), t(5, 'percentage', 10)], messages: { locked: 'Select {{remaining}} more to get {{tier}}', unlocked: 'You unlocked {{tier}}' } };
  const { page, log } = await openCombo({ ...baseConfig, qs_bar_style: 'slots' }, wp(BUNDLE), { viewport: { width: 390, height: 844 } });
  await page.waitForSelector('.bxq-bar--slots');
  const empty = await page.evaluate(() => ({ msg: document.querySelector('.bxq-slots-msg')?.textContent, slots: document.querySelectorAll('.bxq-slot').length, filled: document.querySelectorAll('.bxq-slot.is-filled').length, go: !!document.querySelector('.bxq-bar .bxq-go') }));
  check('slots: on arrival, "Select 3 more…" over 3 empty boxes, no button yet', empty.msg === 'Select 3 items more to get the bundle at ₹469' && empty.slots === 3 && empty.filled === 0 && !empty.go, JSON.stringify(empty));
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-slots-empty-phone.png') });
  await plus(page, 2);
  await page.click(`${card(4)} [data-combo-action="qty-inc"]`);
  await page.waitForFunction(() => document.querySelectorAll('.bxq-slot.is-filled').length === 2);
  const two = await page.evaluate(() => ({ msg: document.querySelector('.bxq-slots-msg')?.textContent, imgs: [...document.querySelectorAll('.bxq-slot.is-filled img')].length, go: !!document.querySelector('.bxq-bar .bxq-go') }));
  check('slots: two items = two pictures, one + left, Go to Cart shown', two.msg === 'Select 1 item more to get the bundle at ₹469' && two.imgs === 2 && two.go, JSON.stringify(two));
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-slots-phone.png') });
  await page.click('.bxq-slot.is-filled');
  await page.waitForFunction(() => document.querySelectorAll('.bxq-slot.is-filled').length === 1);
  check('slots: tapping a picture takes that item out', (await page.$$('.bxq-slot.is-filled')).length === 1);
  const fits = await page.evaluate(() => { const r = document.querySelector('.bxq-bar').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
  check('slots: the bar fits the phone screen', fits);
  void log;
  await page.close();
}

/* Icons on a theme that sizes every svg and every "*icon*" class (seen on a
   live mobile theme: milestone icons drawn a few px wide inside their circles). */
{
  const FIVE = {
    unit: 'kg', max_grams: 5000,
    tiers: [1, 2, 3, 4, 5].map((kg) => t(kg * 1000, 'fixed_price', kg * 500, `${kg}kg Box`)),
  };
  const themeCss = 'svg{width:6px;height:6px} [class*="icon"]{width:9px;height:9px} span svg{width:.5em}';
  const { page } = await openCombo({ ...baseConfig, qs_top_style: 'milestones', qs_bar_style: 'full' }, wp(FIVE), { viewport: { width: 390, height: 844 }, themeCss });
  await page.waitForSelector('.bxq-mile-icon svg');
  const sizes = await page.$$eval('.bxq-mile-icon', (els) => els.map((e) => { const s = e.querySelector('svg').getBoundingClientRect(); return [Math.round(e.getBoundingClientRect().width), Math.round(s.width), Math.round(s.height)]; }));
  check('theme svg rules: every milestone icon is 18px, its svg fills it', sizes.length === 5 && sizes.every((x) => x.join() === '18,18,18'), JSON.stringify(sizes));
  const plus = await page.$eval(`${card(2)} .bxq-add svg`, (e) => Math.round(e.getBoundingClientRect().width));
  check('theme svg rules: + icon keeps 22px', plus === 22, String(plus));
  const chevron = await page.$eval('.bxq-dd .bxq-chip svg', (e) => Math.round(e.getBoundingClientRect().width));
  check('theme svg rules: dropdown arrows keep 16px', chevron === 16, String(chevron));
  await page.click(`${card(2)} [data-combo-action="qty-inc"]`);
  await page.waitForSelector('.bxq-msg-glyph svg');
  const glyph = await page.$eval('.bxq-msg-glyph svg', (e) => Math.round(e.getBoundingClientRect().width));
  check('theme svg rules: bottom bar icon keeps 26px', glyph === 26, String(glyph));
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-icons-theme-phone.png') });
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

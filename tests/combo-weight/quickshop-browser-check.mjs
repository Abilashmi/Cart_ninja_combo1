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
const product = (n, title, { price, compare = null, grams = null, vendor = 'Nandus', type = 'Chicken', tags = [], summary = '', variants = null, available = true } = {}) => ({
  id: P(n), title, handle: `p${n}`, price, currency: 'INR', image: img(title.split(' ')[1] || title), images: [img(title)],
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
    product(2, 'Nandus Chicken Breast Boneless', { price: '259.00', grams: 450, summary: 'Clean, lean and boneless chicken breast pieces', tags: ['Boneless'] }),
    product(3, 'Licious Chicken Curry Cut (Large Pieces)', { price: '199.00', compare: '229.00', grams: 450, vendor: 'Licious', tags: ['Curry Cut'] }),
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
async function openCombo(config, pricing, { cod = false, shiprocket = null, viewport = { width: 1280, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport });
  const log = { add: [], update: [], navigations: [], cod: [], boxCode: [] };
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://store.test') {
      if (url.pathname === '/pages/box') {
        const srStub = shiprocket ? 'window.__sr = []; window.BrixCheckout = { checkoutItems: function (o) { window.__sr.push(o); } };' : '';
        const stubs = srStub + (cod ? `window.__cod = []; window.BrixCod = { isAvailable: function () { return Promise.resolve(true); }, open: function (o) { window.__cod.push(o); }, comboButton: function () { return Promise.resolve({ text: "Pay cash", icon: "", css: "background:#be185d;color:#ffffff;", placement: ${JSON.stringify(cod.placement || 'below')} }); } };` : '');
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><script>${stubs}</script><style>/* Dawn hides empty divs; the progress fills are empty divs */ div:empty{display:none} .theme-fixed{position:fixed;left:0;right:0;bottom:0;height:40px;z-index:100}</style></head><body style="margin:0">${DAWN_PAGE}<script src="${API}/combo-page.js"></script></body></html>` });
      }
      if (url.pathname === '/cart.js') return json({ items: [] });
      if (url.pathname === '/cart/update.js') { log.update.push(JSON.parse(req.postData())); return json({ items: [] }); }
      if (url.pathname === '/cart/add.js') { log.add.push(JSON.parse(req.postData())); return json({ items: [] }); }
      log.navigations.push(url.pathname);
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>next</body></html>' });
    }
    if (url.pathname === '/combo-page.js') return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: SCRIPT });
    if (url.pathname === '/api/combo-page-data') {
      return json({ success: true, data: { templateId: 9, templateName: 'Meat Box', config, productsByHandle, collectionNameMap: { chicken: 'Chicken', mutton: 'Mutton' }, activeDiscounts: [], weightPricing: pricing, shiprocketEnabled: Boolean(shiprocket) } });
    }
    if (url.pathname === '/api/combo-box-code') {
      log.boxCode.push({ body: JSON.parse(req.postData()), contentType: req.headers()['content-type'] });
      return shiprocket.code === 'fail' ? json({ success: false }, 502) : json({ success: true, code: shiprocket.code });
    }
    if (url.pathname === '/api/bundle-analytics') return json({ success: true });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://store.test/pages/box');
  await page.waitForSelector('.bxq-card');
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
  check('bottom bar sits above theme sticky/fixed bits (z-index 999)', (await page.$eval('.bxq-bar', (e) => getComputedStyle(e).zIndex)) === '999');
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

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

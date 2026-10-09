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

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();

async function openCombo(config, pricing, { cod = false, viewport = { width: 1280, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport });
  const log = { add: [], update: [], navigations: [], cod: [] };
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://store.test') {
      if (url.pathname === '/pages/box') {
        const stubs = cod ? `window.__cod = []; window.BrixCod = { isAvailable: function () { return Promise.resolve(true); }, open: function (o) { window.__cod.push(o); }, comboButton: function () { return Promise.resolve({ text: "Pay cash", icon: "", css: "background:#be185d;color:#ffffff;", placement: ${JSON.stringify(cod.placement || 'below')} }); } };` : '';
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><script>${stubs}</script></head><body style="margin:0"><main><div data-brix-combo-root data-shop="demo.myshopify.com" data-template-id="9"></div></main><script src="${API}/combo-page.js"></script></body></html>` });
      }
      if (url.pathname === '/cart.js') return json({ items: [] });
      if (url.pathname === '/cart/update.js') { log.update.push(JSON.parse(req.postData())); return json({ items: [] }); }
      if (url.pathname === '/cart/add.js') { log.add.push(JSON.parse(req.postData())); return json({ items: [] }); }
      log.navigations.push(url.pathname);
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>next</body></html>' });
    }
    if (url.pathname === '/combo-page.js') return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: SCRIPT });
    if (url.pathname === '/api/combo-page-data') {
      return json({ success: true, data: { templateId: 9, templateName: 'Meat Box', config, productsByHandle, collectionNameMap: { chicken: 'Chicken', mutton: 'Mutton' }, activeDiscounts: [], weightPricing: pricing, shiprocketEnabled: false } });
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

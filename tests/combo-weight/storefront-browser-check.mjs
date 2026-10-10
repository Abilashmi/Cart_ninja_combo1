/* eslint-env node */
// Browser check for weight-priced combo pages (app/routes/combo-page[.]js.jsx,
// config.pricing_mode 'weight'). Run with:
//   node tests/combo-weight/storefront-browser-check.mjs
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
const img = (label) => ({ url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#efe7da"/><text x="100" y="105" font-size="18" text-anchor="middle" fill="#555">${label}</text></svg>`)}`, altText: label });
const book = (n, title, price, grams) => ({
  id: P(n), title, handle: `b${n}`, price, currency: 'INR', image: img(title.split(' ')[0]), images: [img(title.split(' ')[0])],
  variants: [{ id: V(n * 10), title: 'Default Title', price, image: null, grams }], variantId: V(n * 10),
});
const productsByHandle = {
  books: [book(1, 'Novel', '110.00', 300), book(2, 'Atlas', '120.00', 450), book(3, 'Poster Pack', '100.00', null), book(4, 'Lamp', '900.00', 2000)],
};
const weightRaw = {
  unit: 'kg', max_grams: 2200,
  tiers: [{ min_grams: 1000, type: 'percentage', value: 10, label: '10% off' }, { min_grams: 2000, type: 'fixed_price', value: 1700, label: '2 kg box for ₹1700' }],
};
const { value: weight } = normalizeWeightPricing(weightRaw);
const weightPricing = (patch = {}) => ({
  enabled: true, reason: null, hash: weight.hash, unit: 'kg', maxGrams: 2200,
  tiers: weight.tiers, messages: weight.messages,
  qualifyingProductIds: [P(1), P(2), P(3)], // the lamp doesn't qualify
  ...patch,
});
const baseConfig = {
  layout: 'layout1', max_products: 3, show_preview_bar: true, step_1_collection: 'books', step_1_title: 'Pick your books',
  pricing_mode: 'weight', weight_pricing: weight,
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();

async function openCombo(config, { wp = weightPricing(), cartItems = [], shiprocket = false, cod = false, addStatus = 200, viewport = { width: 1280, height: 900 } } = {}) {
  const page = await browser.newPage({ viewport });
  const log = { add: [], update: [], navigations: [], shiprocket: [], cod: [] };
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  // Recorded in Node so it survives the page navigating to checkout.
  await page.exposeFunction('__srCalled', (o) => { log.shiprocket.push(o); });
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.origin === 'https://store.test') {
      if (url.pathname === '/pages/box') {
        const stubs = `
          ${shiprocket ? 'window.BrixCheckout = { checkoutItems: function (o) { window.__srCalled(o); }, checkoutCart: function () {} };' : ''}
          ${cod ? `window.__cod = []; window.BrixCod = { isAvailable: function () { return Promise.resolve(true); }, open: function (o) { window.__cod.push(o); }, comboButton: function () { return Promise.resolve({ text: "Pay cash", icon: "", css: "background:#be185d;color:#ffffff;box-shadow:none;border:none;border-radius:4px;font-size:16px;font-weight:700;"${cod.placement ? `, placement: ${JSON.stringify(cod.placement)}` : ''}${cod.tags ? ', label: function (p) { return "Pay Rs " + (p + 40) + " cash"; }' : ''} }); } };` : ''}`;
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><script>${stubs}</script></head><body><main><div data-brix-combo-root data-shop="demo.myshopify.com" data-template-id="7"></div></main><script src="${API}/combo-page.js"></script></body></html>` });
      }
      if (url.pathname === '/cart.js') return json({ items: cartItems });
      if (url.pathname === '/cart/update.js') { log.update.push(JSON.parse(req.postData())); return json({ items: [] }); }
      if (url.pathname === '/cart/add.js') {
        log.add.push(JSON.parse(req.postData()));
        return addStatus === 200 ? json({ items: [] }) : json({ status: 422, description: 'Only 2 Atlas left in stock.' }, 422);
      }
      log.navigations.push(url.pathname + url.search);
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>checkout</body></html>' });
    }
    // The permalink checkout of classic combos goes to the shop's own domain.
    if (url.origin === 'https://demo.myshopify.com') {
      log.navigations.push(url.pathname + url.search);
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>cart</body></html>' });
    }
    // Same header as the real route (combo-page[.]js.jsx loader).
    if (url.pathname === '/combo-page.js') return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: SCRIPT });
    if (url.pathname === '/api/combo-page-data') {
      return json({ success: true, data: { templateId: 7, templateName: 'Book Box', config, productsByHandle, collectionNameMap: { books: 'Books', comics: 'Comics' }, activeDiscounts: [], weightPricing: config.pricing_mode === 'weight' || config.layout === 'layout5' ? wp : null, shiprocketEnabled: shiprocket } });
    }
    if (url.pathname === '/api/bundle-analytics') return json({ success: true });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://store.test/pages/box');
  await page.waitForSelector('.brix-combo-card, .bxq-card');
  return { page, log };
}

const card = (n) => `.brix-combo-card[data-product-id="${P(n)}"]`;
const add = (page, n) => page.click(`${card(n)} [data-combo-action="card-add"]`);
const inc = (page, n) => page.click(`${card(n)} [data-combo-action="qty-inc"]`);
const meterText = (page) => page.textContent('.brix-combo-weight');
const checkoutBtn = '[data-combo-action="checkout"]';

// ── weight meter, tiers, chips, max weight ──
{
  const { page } = await openCombo(baseConfig);
  check('meter starts at 0 kg of 2.2 kg max', /0 kg\s*\/\s*2\.2 kg max/.test(await meterText(page)));
  check('locked message names the first tier', (await meterText(page)).includes('Add 1 kg more to unlock 10% off'));
  check('weight chip on a weighed book', (await page.textContent(card(1))).includes('300 g'));
  check('"Not counted" on a book without weight', (await page.textContent(card(3))).includes('Not counted in box'));
  check('"Not counted" on a product that does not qualify', (await page.textContent(card(4))).includes('Not counted in box'));
  check('checkout disabled below the first tier', await page.$eval(checkoutBtn, (b) => b.disabled));

  await add(page, 1); await inc(page, 1); await inc(page, 1); // 900 g
  check('0.9 kg box is locked', (await meterText(page)).includes('Add 0.1 kg more to unlock 10% off'));
  await add(page, 3);
  check('unweighed item noted in the meter', (await meterText(page)).includes("1 selected item has no weight and doesn't count"));
  await add(page, 2); // 1.35 kg
  const text = await meterText(page);
  check('1.35 kg unlocks the 10% tier and points at the next one', text.includes('1.35 kg') && text.includes('10% off unlocked!') && text.includes('to unlock 2 kg box for ₹1700'), text.replace(/\s+/g, ' '));
  check('checkout enabled once a tier is reached', !(await page.$eval(checkoutBtn, (b) => b.disabled)));
  // Novel ×3 (330) + Poster (100, not counted) + Atlas (120) = 550; 10% off the counted 450 = 45
  const bar = await page.evaluate(() => document.body.innerText);
  check('price shows the box discount from the shared core', bar.includes('Final: ₹505.00') && bar.includes('Total: ₹550.00'), bar.split('\n').filter((l) => /₹/.test(l)).join(' | '));

  await inc(page, 2); // +450 = 1.8 kg
  await inc(page, 1); // +300 = 2.1 kg
  await inc(page, 1); // +300 = 2.4 kg → blocked
  const toast = await page.textContent('[role="alert"]').catch(() => '');
  check('adding past the max weight is blocked with the merchant message', toast.includes('Your box can weigh up to 2.2 kg'), toast);
  check('meter stays at 2.1 kg after the block', (await meterText(page)).includes('2.1 kg'));
  await page.screenshot({ path: path.join(SHOTS, 'weight-meter-desktop.png'), fullPage: true });
  await page.close();
}

// ── checkout: one box per combo in the real cart, no Shiprocket ──
{
  const old = { key: 'old-line-1', properties: { _brix_combo_id: '7', _brix_combo_group: 'old' } };
  const other = { key: 'keep-me', properties: {} };
  const { page, log } = await openCombo(baseConfig, { cartItems: [old, other], shiprocket: true });
  await add(page, 2); await inc(page, 2); await inc(page, 2); // 1.35 kg
  await page.click(checkoutBtn);
  await page.waitForTimeout(500);
  check('the earlier box of this combo is removed, other cart lines stay', JSON.stringify(log.update[0]) === JSON.stringify({ updates: { 'old-line-1': 0 } }), JSON.stringify(log.update));
  const items = log.add[0]?.items || [];
  const props = items[0]?.properties || {};
  check('/cart/add.js gets the box with its line properties', items.length === 1 && items[0].id === 20 && items[0].quantity === 3
    && props._brix_combo_id === '7' && props._brix_combo_version === weight.hash && /^b[a-z0-9]+$/.test(props._brix_combo_group), JSON.stringify(log.add));
  check('combo attributes go to /cart/update.js', log.update[1]?.attributes?.combo_template_id === '7');
  check('then Shopify checkout (never Shiprocket, never a discount code)', log.navigations.includes('/checkout') && !log.navigations.some((n) => n.includes('discount')));
  check('Shiprocket not used for a weight box', log.shiprocket.length === 0);
  await page.close();
}

// ── a 422 from the cart keeps the shopper on the page ──
{
  const { page, log } = await openCombo(baseConfig, { addStatus: 422 });
  await add(page, 2); await inc(page, 2); await inc(page, 2);
  await page.click(checkoutBtn);
  await page.waitForSelector('[role="alert"]');
  check('cart error is shown and the page stays', (await page.textContent('[role="alert"]')).includes('Only 2 Atlas left') && log.navigations.length === 0);
  check('checkout can be tried again', !(await page.$eval(checkoutBtn, (b) => b.disabled)));
  await page.close();
}

// ── COD carries the box properties ──
{
  const { page } = await openCombo(baseConfig, { cod: true });
  await page.waitForSelector('[data-combo-action="cod"]');
  await page.waitForFunction(() => document.querySelector('[data-combo-action="cod"]')?.textContent.includes('Pay cash'), null, { timeout: 3000 }).catch(() => {});
  const codLook = await page.$eval('[data-combo-action="cod"]', (b) => ({ text: b.textContent, bg: getComputedStyle(b).backgroundColor, radius: getComputedStyle(b).borderRadius }));
  check('combo COD button uses the combo page button design from COD settings', codLook.text.includes('Pay cash') && codLook.bg === 'rgb(190, 24, 93)' && codLook.radius === '4px', JSON.stringify(codLook));
  await add(page, 2); await inc(page, 2); await inc(page, 2);
  await page.click('[data-combo-action="cod"]');
  const opened = await page.evaluate(() => window.__cod[0]);
  check('COD sheet gets the items with box properties and no coupon', opened?.surface === 'combo' && opened.items[0].properties?._brix_combo_id === '7' && opened.coupon === null, JSON.stringify(opened));
  await page.close();
}

// ── box discount not live: no tiers promised, no properties sent ──
{
  const { page, log } = await openCombo(baseConfig, { wp: weightPricing({ enabled: false, reason: 'not_live' }) });
  check('no tier promises when the discount is not live', !(await meterText(page)).includes('unlock') && (await meterText(page)).includes('to complete your box'));
  await add(page, 2); await inc(page, 2); await inc(page, 2);
  const summary = await page.evaluate(() => document.body.innerText);
  check('no discounted price shown', !summary.includes('Total: ₹') && summary.includes('Final: ₹360.00'));
  await page.click(checkoutBtn);
  await page.waitForTimeout(400);
  check('box added without BRIX properties', log.add[0]?.items?.[0] && !('properties' in log.add[0].items[0]), JSON.stringify(log.add));
  await page.close();
}

// ── The Weight Box template (layout5): the Quick Shop design, priced by weight ──
{
  const boxConfig = {
    layout: 'layout5', collection_title: 'Build your book box', collection_description: 'Fill a box by weight. Heavier boxes cost less per book.',
    col_1: 'books', col_2: 'comics', tab_count: 2, weight_pricing: weight,
  };
  productsByHandle.comics = [book(5, 'Comic Vol 1', '90.00', 200)];
  const qsCard = (n) => `.bxq-card[data-product-id="${P(n)}"]`;
  const qsPlus = (pg, n) => pg.click(`${qsCard(n)} [data-combo-action="qty-inc"]`);
  const { page, log } = await openCombo(boxConfig, { cod: true });
  check('Weight Box is drawn with the Quick Shop design (not the old box page)', (await page.$('.bxq')) !== null && (await page.$('.bxw')) === null);
  const top = await page.textContent('.bxq-top');
  check('top progress shows the weight tiers', top.includes('1 kg') && top.includes('10%') && top.includes('2 kg'), top.replace(/\s+/g, ' '));
  check('filter chips: All + both collections', ((t) => t.includes('Books') && t.includes('Comics'))(await page.textContent('.bxq-filters')));
  await qsPlus(page, 2); await qsPlus(page, 2); await qsPlus(page, 2); // Atlas ×3 = 1.35 kg
  const msg = await page.textContent('.bxq-msg');
  check('1.35 kg unlocks the 1 kg tier in the bottom bar (the store\'s own wording)', msg.includes('10% off unlocked'), msg.replace(/\s+/g, ' '));
  await page.click('[data-combo-action="qs-chip"][data-value="c:comics"]');
  check('chip switches the grid', (await page.$$('.bxq-card')).length === 1 && (await page.textContent('.bxq-card')).includes('Comic Vol 1'));
  await page.click('[data-combo-action="qs-chip"][data-value="all"]');
  await page.screenshot({ path: path.join(SHOTS, 'weight-box-desktop.png'), fullPage: true });
  await page.click('.bxq-go');
  await page.waitForTimeout(400);
  check('checkout puts the box in the cart (combo properties) and goes to checkout', log.add[0]?.items?.[0]?.properties?._brix_combo_id === '7' && log.navigations.includes('/checkout'), JSON.stringify(log.add[0]));
  await page.close();

  const phone = await openCombo(boxConfig, { viewport: { width: 390, height: 844 } });
  check('phone: Quick Shop phone layout with the sticky bottom bar', (await phone.page.$('.bxq.bxq--m, .bxq--m')) !== null);
  await qsPlus(phone.page, 1);
  check('phone: bottom bar counts the item', (await phone.page.textContent('.bxq-bar')).includes('1 Item'));
  await phone.page.screenshot({ path: path.join(SHOTS, 'weight-box-phone.png') });
  await phone.page.close();
}

// ── COD position next to Checkout (COD → Customize → Position in combo page) ──
{
  const order = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.getAttribute('data-combo-action')));
  const bar = '[data-combo-action="checkout"], [data-combo-action="cod"]';
  for (const [placement, want] of [[null, 'checkout,cod'], ['above', 'cod,checkout'], ['replace', 'cod'], ['below', 'checkout,cod']]) {
    const { page } = await openCombo(baseConfig, { cod: { placement, tags: true } });
    await page.waitForFunction(() => document.querySelector('[data-combo-action="cod"]')?.textContent.includes('cash'), null, { timeout: 3000 }).catch(() => {});
    const got = (await order(page, bar)).join(',');
    check(`combo bar, COD ${placement || 'not set (old settings)'}: ${want}`, got === want, got);
    if (placement === 'above') {
      await add(page, 1);
      await page.waitForTimeout(200);
      const text = await page.textContent('[data-combo-action="cod"]');
      check('combo bar: COD text gets the combo price filled in (label(finalPrice))', /Pay Rs \d+(\.\d+)? cash/.test(text) && !text.includes('{'), text);
    }
    await page.close();
  }
  const boxConfig = { layout: 'layout5', col_1: 'books', tab_count: 1, weight_pricing: weight };
  for (const [placement, want] of [['above', 'cod,checkout'], ['replace', 'cod']]) {
    const { page } = await openCombo(boxConfig, { cod: { placement } });
    // Quick Shop's bottom bar (Checkout + COD) shows once the box has something in it.
    await page.click(`.bxq-card[data-product-id="${P(2)}"] [data-combo-action="qty-inc"]`);
    await page.waitForSelector('.bxq [data-combo-action="cod"]', { timeout: 3000 }).catch(() => {});
    const got = (await order(page, '.bxq [data-combo-action="checkout"], .bxq [data-combo-action="cod"]')).join(',');
    check(`Weight Box, COD ${placement}: ${want}`, got === want, got);
    await page.close();
  }
}

// ── classic item-count combos are unchanged: cart permalink + Shiprocket ──
{
  const countConfig = { ...baseConfig, pricing_mode: 'count', weight_pricing: undefined, max_products: 2 };
  const { page, log } = await openCombo(countConfig);
  check('no weight meter on a count combo', (await page.$('.brix-combo-weight')) === null);
  await add(page, 1); await add(page, 2);
  await page.click(checkoutBtn);
  await page.waitForTimeout(400);
  check('count combo still checks out through the /cart permalink', log.navigations.some((n) => n.startsWith('/cart/10:1,20:1')) && log.add.length === 0, JSON.stringify(log.navigations));
  await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

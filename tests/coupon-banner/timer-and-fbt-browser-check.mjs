// Real-browser check for two storefront snippets:
//  - Coupon Banner countdown (snippets/coupon-slider-render.liquid): 'loop'
//    mode starts again at zero; 'session' mode still shows the expired label.
//  - FBT widget (snippets/fbt-widget-render.liquid): live compare-at prices
//    struck through on each product and on the total; "Added" has no tick.
//
//   node tests/coupon-banner/timer-and-fbt-browser-check.mjs
//
// Liquid attributes are replaced with fixed values and every request is
// mocked, so no store or database is involved.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const read = (f) => fs.readFileSync(path.join(process.cwd(), 'extensions', 'cart-drawer', 'snippets', f), 'utf8');

const browser = await chromium.launch();

/* ── Coupon Banner countdown ── */
const coupon = read('coupon-slider-render.liquid').split('\n').slice(1).join('\n');
const couponEl = '<ps-coupon-slider id="ps-coupon-slider-b1" data-shop="demo.myshopify.com" data-product-handle="tee" data-collection-handles="" data-product-tags="" data-placement="custom" data-design-mode="false" style="display:none"><div>Loading coupons...</div></ps-coupon-slider>';

async function couponPage(timerMode) {
  const config = {
    status: 'success',
    data: {
      is_enabled: 1, widgetPlacement: 'custom', selectedTemplate: 'template1',
      selectedCouponsGlobal: ['custom:SAVE10'],
      temp1DefaultStyle: { headingText: 'GET 10% OFF!', subtextText: 'Apply at checkout' },
      temp1CouponStyle: { 'custom:SAVE10': { couponCode: 'SAVE10' } },
      temp1CouponCondition: [],
      timerEnabled: 1, timerHours: 0, timerMins: 1, timerMode,
      timerLabel: 'Offer expires in', timerExpired: 'Offer expired!',
    },
  };
  const page = await browser.newPage();
  await page.clock.install();
  await page.route('https://int.thebrix.io/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(config) }));
  await page.route('http://shop.test/**', (r) => {
    if (new URL(r.request().url()).pathname === '/cart.js') return r.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
    return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><form action="/cart/add"><button name="add">Add</button></form>${couponEl}\n${coupon}</body></html>` });
  });
  await page.goto('http://shop.test/products/tee');
  await page.waitForFunction(() => /\d\d:\d\d/.test(document.querySelector('.ps-timer-text')?.textContent || ''), null, { timeout: 10000 });
  return page;
}
const timerState = (page) => page.evaluate(() => ({ label: document.querySelector('.ps-timer-label').textContent, text: document.querySelector('.ps-timer-text').textContent }));

let page = await couponPage('loop');
await page.clock.runFor(61_000);
let t = await timerState(page);
check('coupon timer: loop mode starts again after reaching zero', t.label === 'Offer expires in' && /^00:5\d$/.test(t.text), JSON.stringify(t));
await page.clock.runFor(180_000);
t = await timerState(page);
check('coupon timer: loop mode keeps looping', t.label === 'Offer expires in' && /^00:\d\d$/.test(t.text), JSON.stringify(t));
await page.close();

page = await couponPage('session');
await page.clock.runFor(61_000);
t = await timerState(page);
check('coupon timer: session mode still ends on the expired label', t.label === 'Offer expired!' && t.text === '', JSON.stringify(t));
await page.close();

/* ── FBT widget ── */
const fbt = read('fbt-widget-render.liquid')
  .replace('{{ product.id }}', '100')
  .replace('{{ shop.permanent_domain }}', 'demo.myshopify.com')
  .replace('{{ shop.currency }}', 'INR')
  .replace("{{ block.settings.placement | default: 'below_atc' }}", 'below_cart')
  .replace('{{ request.design_mode }}', 'false');

const fbtConfig = {
  status: 'success',
  data: {
    selectedTemp: 'fbt1',
    temp1: { layout: 'carousel', interactionType: 'classic', showPrices: true, showAddAllButton: true, widgetPlacement: 'below_cart' },
    // Saved prices are stale on purpose: the widget must show the live ones.
    condition: [{ id: 'r1', displayScope: 'all', fbtProducts: [
      { id: 'gid://shopify/Product/201', title: 'Socks', handle: 'socks', price: '99' },
      { id: 'gid://shopify/Product/202', title: 'Cap', handle: 'cap', price: '450' },
    ] }],
  },
};
const catalog = { products: [
  { id: 201, variants: [{ id: 9201, available: true, price: '199.00', compare_at_price: '299.00' }] },
  { id: 202, variants: [{ id: 9202, available: true, price: '500.00', compare_at_price: null }] },
] };

page = await browser.newPage();
const added = [];
await page.route('https://int.thebrix.io/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(fbtConfig) }));
await page.route('http://shop.test/**', (r) => {
  const url = new URL(r.request().url());
  if (url.pathname === '/products.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog) });
  if (url.pathname === '/cart/add.js') { added.push(r.request().postDataJSON()); return r.fulfill({ contentType: 'application/json', body: '{"items":[]}' }); }
  return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><form action="/cart/add"><button name="add" type="submit">Add to cart</button></form>${fbt}</body></html>` });
});
await page.goto('http://shop.test/products/tee');
await page.waitForSelector('ps-fbt-widget .ps-product-card', { timeout: 10000 });

const prices = await page.locator('ps-fbt-widget .ps-product-price').evaluateAll((els) => els.map((e) => ({ text: e.textContent, struck: e.querySelector('s')?.textContent || '' })));
check('fbt: product with a higher compare-at price shows it struck through', prices[0]?.struck === '₹299' && prices[0]?.text === '₹299₹199', JSON.stringify(prices[0]));
check('fbt: product without a compare-at price shows the price only', prices[1]?.struck === '' && prices[1]?.text === '₹500', JSON.stringify(prices[1]));

const total = await page.locator('ps-fbt-widget .ps-total-price').evaluate((e) => ({ text: e.textContent, struck: e.querySelector('s')?.textContent || '' }));
check('fbt: total shows the compare-at total struck through', total.struck === '₹799' && total.text === '₹799₹699', JSON.stringify(total));

const firstBtn = page.locator('ps-fbt-widget .ps-classic-btn').first();
check('fbt: "Added" button has no tick', (await firstBtn.textContent()) === 'Added' && (await firstBtn.locator('svg').count()) === 0);
await firstBtn.click();
const after = await page.locator('ps-fbt-widget .ps-total-price').evaluate((e) => ({ text: e.textContent, struck: e.querySelector('s')?.textContent || '' }));
check('fbt: total without a discounted item drops the strike', after.struck === '' && after.text === '₹500', JSON.stringify(after));

await page.locator('ps-fbt-widget .ps-fbt-addall').click();
await page.waitForFunction(() => /Added/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
const addAll = page.locator('ps-fbt-widget .ps-fbt-addall');
check('fbt: Add all shows "Added" with no tick', (await addAll.textContent()) === 'Added' && (await addAll.locator('svg').count()) === 0);
check('fbt: adds the live variant', added[0]?.items?.[0]?.id === '9202', JSON.stringify(added[0]));
await page.close();

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

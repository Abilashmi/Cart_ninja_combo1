// Real-browser check for the Coupon Banner countdown
// (snippets/coupon-slider-render.liquid): 'loop' mode starts again at zero;
// 'session' mode still shows the expired label.
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

// The FBT widget's sale prices, totals and adding are checked against the
// v2 widget in tests/fbt/storefront-browser-check.mjs.

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

// Real-browser check: the storefront Coupon Banner (snippets/coupon-slider-render.liquid)
// renders custom (external) coupons from the saved config, exactly like store coupons.
//
//   node tests/coupon-banner/storefront-browser-check.mjs
//
// The snippet's Liquid attributes are replaced with fixed values and the PHP
// config endpoint is mocked, so no store or database is involved.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const snippet = fs.readFileSync(path.join(process.cwd(), 'extensions', 'cart-drawer', 'snippets', 'coupon-slider-render.liquid'), 'utf8');
const [, ...rest] = snippet.split('\n');
const element = '<ps-coupon-slider id="ps-coupon-slider-b1" data-shop="demo.myshopify.com" data-product-handle="tee" data-collection-handles="" data-product-tags="" data-placement="custom" data-design-mode="false" style="display:none"><div>Loading coupons...</div></ps-coupon-slider>';
assert.doesNotMatch(rest.join('\n'), /\{\{|\{%/, 'only the first line of the snippet uses Liquid');

const config = {
  status: 'success',
  data: {
    is_enabled: 1, widgetPlacement: 'custom', selectedTemplate: 'template1',
    selectedCouponsGlobal: ['custom:SHIPROCKET10', 'gid://shopify/DiscountCodeNode/1', 'custom:2024'],
    temp1DefaultStyle: { headingText: 'GET 10% OFF!', subtextText: 'Apply at checkout' },
    temp1CouponStyle: {
      'custom:SHIPROCKET10': { couponCode: 'SHIPROCKET10' },
      'gid://shopify/DiscountCodeNode/1': { couponCode: 'SAVE10' },
      'custom:2024': { couponCode: '2024' },
    },
    temp1CouponCondition: [],
  },
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('https://int.thebrix.io/**', (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(config) }));
await page.route('http://shop.test/**', (route) => {
  const url = new URL(route.request().url());
  if (url.pathname === '/cart.js') return route.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
  return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><form action="/cart/add"><button name="add">Add</button></form>${element}\n${rest.join('\n')}</body></html>` });
});
await page.goto('http://shop.test/products/tee');
// Each card's Copy button carries the code shoppers copy (data-code).
await page.waitForFunction(() => document.querySelectorAll('ps-coupon-slider .ps-btn[data-code]').length >= 3, null, { timeout: 10000 });
const codes = await page.locator('ps-coupon-slider .ps-btn[data-code]').evaluateAll((els) => els.map((e) => e.getAttribute('data-code')));
assert.deepEqual(codes, ['SHIPROCKET10', 'SAVE10', '2024'], 'custom + store codes in saved order; numeric-only custom code kept as-is');
assert.doesNotMatch(await page.locator('ps-coupon-slider').evaluate((el) => el.innerHTML), /custom:/, 'the internal id prefix never reaches shoppers');
console.log('  ✓ storefront renders custom + store coupons from the same saved config (incl. numeric-only code)');

// Text offers ("text:<id>"): heading + subtext only, no code, no Copy button,
// on every template; merchant text is escaped.
for (const tpl of ['template1', 'template2', 'template3']) {
  const n = tpl.slice(-1);
  config.data = {
    is_enabled: 1, widgetPlacement: 'custom', selectedTemplate: tpl,
    selectedCouponsGlobal: ['text:abc123', 'gid://shopify/DiscountCodeNode/1'],
    [`temp${n}DefaultStyle`]: { headingText: 'GET 10% OFF!', subtextText: 'Apply at checkout' },
    [`temp${n}CouponStyle`]: {
      'text:abc123': { headingText: 'Free shipping <b>today</b>', subtextText: 'Orders over ₹999 & up', textOnly: true },
      'gid://shopify/DiscountCodeNode/1': { couponCode: 'SAVE10' },
    },
    [`temp${n}CouponCondition`]: [],
  };
  await page.goto('http://shop.test/products/tee');
  await page.waitForFunction(() => document.querySelectorAll('ps-coupon-slider .ps-card').length === 2, null, { timeout: 10000 });
  const cards = await page.locator('ps-coupon-slider .ps-card').evaluateAll((els) => els.map((e) => ({ text: e.textContent, buttons: e.querySelectorAll('.ps-btn').length, bold: e.querySelectorAll('b').length })));
  assert.equal(cards[0].buttons, 0, `${tpl}: text offer has no Copy button`);
  assert.match(cards[0].text, /Free shipping <b>today<\/b>/, `${tpl}: heading shown as plain text (escaped)`);
  assert.match(cards[0].text, /Orders over ₹999 & up/, `${tpl}: subtext shown`);
  assert.equal(cards[0].bold, 0, `${tpl}: merchant text is not run as HTML`);
  assert.doesNotMatch(cards[0].text, /text:|abc123|Your Code/i, `${tpl}: no code or internal id`);
  assert.equal(cards[1].buttons, 1, `${tpl}: the real coupon keeps its Copy button`);
  assert.equal(await page.locator('ps-coupon-slider .ps-btn').first().getAttribute('data-code'), 'SAVE10');
}
console.log('  ✓ text offers show heading + subtext only (no code, no Copy) on all 3 templates; text escaped');
await browser.close();

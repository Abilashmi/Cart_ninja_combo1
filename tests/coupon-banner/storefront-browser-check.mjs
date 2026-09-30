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
await browser.close();

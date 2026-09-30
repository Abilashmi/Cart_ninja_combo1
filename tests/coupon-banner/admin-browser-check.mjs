// Real-browser check of the Coupon Banner "+ Custom Coupon" feature.
//
//   node tests/coupon-banner/admin-browser-check.mjs
//
// Bundles the REAL app.productwidget.jsx + app.discounts.create.jsx with
// tests/coupon-banner/harness (Vite) using mock loaders and stubbed App Bridge,
// and mocks the page's own action, so this checks the UI end to end without
// Shopify or any database. Storage itself is covered by
// tests/ai-handoff/custom-coupon.test.mjs.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { COUPON_BANNER_TEMPLATE_DEFAULTS } from '../../app/config/coupon-banner.js';

const root = path.join(process.cwd(), 'tests', 'coupon-banner', 'harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const DISCOUNTS = [
  { id: 'gid://shopify/DiscountCodeNode/1', code: 'SAVE10', title: 'SAVE10' },
  { id: 'gid://shopify/DiscountCodeNode/2', code: 'WELCOME20', title: 'Welcome offer' },
];
const pageData = ({ customCoupons = [], selected = [] } = {}) => ({
  couponConfig: { activeTemplate: 'template1', selectedActiveCoupons: selected, templates: COUPON_BANNER_TEMPLATE_DEFAULTS, temp1CouponStyle: {}, temp1CouponCondition: [], is_enabled: 1, layout: 'list', position: 'above_cart' },
  fbtConfig: {}, products: [], shop: 'demo.myshopify.com', discounts: DISCOUNTS, customCoupons, couponEmbedEnabled: true, fbtEmbedEnabled: true,
});
const SHIPROCKET = { id: 'custom:SHIPROCKET10', code: 'SHIPROCKET10', type: 'custom', source: 'external', createdAt: '2026-09-30T00:00:00.000Z' };

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (error) { results.push(false); console.log('  ✗', name, '\n     ', String(error.message).split('\n')[0]); }
};

const browser = await chromium.launch();

// `respond(body)` answers the page action; returns what it should send back.
async function open({ data = pageData(), respond = () => ({ success: true }), delayMs = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const posts = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((d) => { window.__DATA__ = { page: d }; }, data);
  await page.route('http://harness.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/harness/productwidget-action') {
      const body = JSON.parse(route.request().postData());
      posts.push(body);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(respond(body)) });
    }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://harness.test/');
  await page.getByRole('button', { name: 'Coupon Selection' }).click();
  await page.getByText('SAVE10').first().waitFor();
  return { page, context, posts, errors };
}

const couponRow = (page, code) => page.locator('button', { hasText: code }).first();
const openDialog = async (page) => {
  await page.getByRole('button', { name: 'Add custom coupon code' }).click();
  await page.getByRole('dialog').getByText('Add Custom Coupon').waitFor();
};
const codeField = (page) => page.getByRole('dialog').getByRole('textbox', { name: 'Coupon Code' });
const selectedCount = (page) => page.getByText(/\d+ coupons? selected/).textContent().catch(() => null);

console.log('\nCoupon Banner — Custom Coupon checks');

await check('existing coupons still load, select and deselect; Save posts their real codes', async () => {
  const { page, context, posts, errors } = await open();
  await couponRow(page, 'SAVE10').click();
  assert.equal(await selectedCount(page), '1 coupon selected');
  await couponRow(page, 'WELCOME20').click();
  assert.equal(await selectedCount(page), '2 coupons selected');
  await couponRow(page, 'WELCOME20').click();
  assert.equal(await selectedCount(page), '1 coupon selected');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  const save = posts.find((p) => p.selectedActiveCoupons);
  assert.deepEqual(save.selectedActiveCoupons, ['gid://shopify/DiscountCodeNode/1']);
  assert.equal(save.couponStyles['gid://shopify/DiscountCodeNode/1'].couponCode, 'SAVE10');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('screenshot: Custom Coupon button in the selection panel', async () => {
  const { page, context } = await open({ data: pageData({ customCoupons: [SHIPROCKET], selected: ['custom:SHIPROCKET10'] }) });
  const shotDir = path.join(process.cwd(), 'tests', 'coupon-banner', 'screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  const panel = page.locator('#pw-section-coupon');
  await panel.screenshot({ path: path.join(shotDir, 'coupon-selection.png') });
  await context.close();
});

await check('dialog shows the two flows; empty / whitespace code is rejected without posting', async () => {
  const { page, context, posts } = await open();
  await openDialog(page);
  const dialog = page.getByRole('dialog');
  for (const text of ['How do you want to use this coupon?', 'Just add this coupon code', 'I already created this coupon somewhere else. Just add the code to BRIX.', 'Create this coupon in BRIX', 'Create and manage this discount through the BRIX Discount Engine.']) {
    assert.ok(await dialog.getByText(text).isVisible(), text);
  }
  await dialog.getByRole('button', { name: 'Add Coupon' }).click();
  await dialog.getByText('Enter a coupon code.').waitFor();
  await codeField(page).fill('    ');
  await dialog.getByRole('button', { name: 'Add Coupon' }).click();
  await dialog.getByText('Enter a coupon code.').waitFor();
  assert.equal(posts.length, 0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await context.close();
});

await check('Just add: trims, posts only the code, shows "Adding coupon…", then lists it selected with a Custom coupon label', async () => {
  const { page, context, posts } = await open({ respond: () => ({ success: true, coupon: SHIPROCKET }), delayMs: 600 });
  await openDialog(page);
  await codeField(page).fill('  SHIPROCKET10  ');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Coupon' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Adding coupon/ }).waitFor();
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: /Adding coupon/ }).isDisabled(), true);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.deepEqual(posts, [{ intent: 'add_custom_coupon', code: 'SHIPROCKET10' }]);
  assert.ok(await couponRow(page, 'SHIPROCKET10').isVisible());
  assert.ok(await couponRow(page, 'SHIPROCKET10').getByText('Custom coupon').isVisible());
  assert.equal(await selectedCount(page), '1 coupon selected');
  assert.deepEqual(await page.evaluate(() => window.__toasts), [{ message: 'Coupon added successfully' }]);
  // It sits above the store's own coupons.
  const order = await page.locator('button').evaluateAll((els) => els.map((e) => e.textContent).filter((t) => /SHIPROCKET10|SAVE10|WELCOME20/.test(t)).map((t) => t.match(/SHIPROCKET10|SAVE10|WELCOME20/)[0]));
  assert.deepEqual(order.slice(0, 3), ['SHIPROCKET10', 'SAVE10', 'WELCOME20']);
  await context.close();
});

await check('Save sends the custom coupon through the normal selection + couponCode path', async () => {
  const { page, context, posts } = await open({ respond: (b) => (b.intent ? { success: true, coupon: SHIPROCKET } : { success: true }) });
  await openDialog(page);
  await codeField(page).fill('SHIPROCKET10');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Coupon' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await couponRow(page, 'SAVE10').click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(400);
  const save = posts.find((p) => p.selectedActiveCoupons);
  assert.deepEqual(save.selectedActiveCoupons, ['custom:SHIPROCKET10', 'gid://shopify/DiscountCodeNode/1']);
  assert.equal(save.couponStyles['custom:SHIPROCKET10'].couponCode, 'SHIPROCKET10');
  assert.equal(save.couponStyles['gid://shopify/DiscountCodeNode/1'].couponCode, 'SAVE10');
  await context.close();
});

await check('duplicates: an existing custom code or store code says "Coupon already exists." and nothing is posted', async () => {
  const { page, context, posts } = await open({ data: pageData({ customCoupons: [SHIPROCKET] }) });
  await openDialog(page);
  for (const dup of ['SHIPROCKET10', 'shiprocket10', 'save10']) {
    await codeField(page).fill(dup);
    await page.getByRole('dialog').getByRole('button', { name: 'Add Coupon' }).click();
    await page.getByRole('dialog').getByText('Coupon already exists.').waitFor();
  }
  assert.equal(posts.length, 0);
  assert.equal(await page.locator('button', { hasText: 'SHIPROCKET10' }).count(), 1);
  await context.close();
});

await check('server-side refusal / failure shows a friendly message and keeps the dialog open', async () => {
  const { page, context } = await open({ respond: () => ({ success: false, error: 'save_failed', message: 'Couldn’t add the coupon right now. Please try again.' }) });
  await openDialog(page);
  await codeField(page).fill('NEWCODE5');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Coupon' }).click();
  await page.getByRole('dialog').getByText('Couldn’t add the coupon right now. Please try again.').waitFor();
  assert.equal(await page.locator('button', { hasText: 'NEWCODE5' }).count(), 0);
  await context.close();
});

await check('after a refresh: saved custom coupon is listed, labelled and still selected', async () => {
  const { page, context } = await open({ data: pageData({ customCoupons: [SHIPROCKET], selected: ['custom:SHIPROCKET10'] }) });
  assert.ok(await couponRow(page, 'SHIPROCKET10').getByText('Custom coupon').isVisible());
  assert.equal(await selectedCount(page), '1 coupon selected');
  await context.close();
});

await check('Create in BRIX: no post, opens the Discount Creator with the code already filled in', async () => {
  const { page, context, posts } = await open();
  await openDialog(page);
  await codeField(page).fill(' TEST10 ');
  await page.getByRole('dialog').getByText('Create this coupon in BRIX').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Discount code').waitFor();
  assert.equal(await page.evaluate(() => window.__router.state.location.pathname + window.__router.state.location.search), '/app/discounts/create?prefillCode=TEST10');
  assert.equal(await page.getByLabel('Discount code').inputValue(), 'TEST10');
  assert.equal(posts.length, 0, 'nothing created before the merchant finishes the Discount Creator');
  await context.close();
});

await check('Create in BRIX also refuses a duplicate code', async () => {
  const { page, context } = await open();
  await openDialog(page);
  await codeField(page).fill('WELCOME20');
  await page.getByRole('dialog').getByText('Create this coupon in BRIX').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('dialog').getByText('Coupon already exists.').waitFor();
  assert.equal(await page.evaluate(() => window.__router.state.location.pathname), '/app/productwidget');
  await context.close();
});

await check('Create in BRIX warns about unsaved changes', async () => {
  const { page, context } = await open();
  await couponRow(page, 'SAVE10').click();
  await openDialog(page);
  await page.getByRole('dialog').getByText('Create this coupon in BRIX').click();
  assert.ok(await page.getByRole('dialog').getByText(/You have unsaved changes on this page/).isVisible());
  await context.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

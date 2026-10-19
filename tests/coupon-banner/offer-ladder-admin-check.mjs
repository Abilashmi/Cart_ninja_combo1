// Real-browser check of the Coupon Banner "Add an offer ladder" editor:
// text-only by default, button and auto-apply switched on by the merchant.
//
//   node tests/coupon-banner/offer-ladder-admin-check.mjs
//
// Same harness as admin-browser-check.mjs: the REAL app.productwidget.jsx
// bundled by Vite with mock loader data, the page action mocked.
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
const shotDir = path.join(process.cwd(), 'tests', 'coupon-banner', 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const DISCOUNTS = [
  { id: 'gid://shopify/DiscountCodeNode/1', code: 'BUY2', title: 'Buy 2 save 10' },
  { id: 'gid://shopify/DiscountCodeNode/2', code: 'BUY3', title: 'BUY3' },
  { id: 'gid://shopify/DiscountCodeNode/3', code: 'SAVE10', title: 'SAVE10' },
];
const pageData = ({ selected = [], styles = {} } = {}) => ({
  couponConfig: { activeTemplate: 'template1', selectedActiveCoupons: selected, templates: COUPON_BANNER_TEMPLATE_DEFAULTS, temp1CouponStyle: styles, temp1CouponCondition: [], is_enabled: 1, layout: 'list', position: 'above_cart' },
  fbtConfig: {}, products: [], shop: 'demo.myshopify.com', discounts: DISCOUNTS, customCoupons: [], couponEmbedEnabled: true, fbtEmbedEnabled: true,
});

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (error) { results.push(false); console.log('  ✗', name, '\n     ', String(error.message).split('\n')[0]); }
};
const browser = await chromium.launch();

async function open(data = pageData()) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  const posts = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((d) => { window.__DATA__ = { page: d }; }, data);
  await page.route('http://harness.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/harness/productwidget-action') {
      posts.push(JSON.parse(route.request().postData()));
      return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
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
const ladderText = (page) => page.locator('.pw-ladder .psl').first().textContent();

console.log('\nCoupon Banner — offer ladder admin checks');

await check('Add an offer ladder: editor opens with two offers (text only), preview is just the text', async () => {
  const { page, context, errors } = await open();
  await page.getByRole('button', { name: 'Add an offer ladder' }).click();
  await page.getByText('Offers', { exact: true }).waitFor();
  // (The Coupon Selection panel closes as the editor opens, so check the editor's own list.)
  assert.deepEqual(await page.getByLabel('Editing coupon').locator('option').allTextContents(), ['Offer ladder: Buy any 2 Get 10% Off | Buy any 3 Get 15% Off']);
  assert.equal(await page.locator('.pw-ladder-tier').count(), 2);
  assert.equal(await page.getByLabel('Items in cart').count(), 0, 'no item counts until auto-apply is on');
  assert.equal(await page.getByLabel('Coupon to apply').count(), 0);
  assert.equal(await ladderText(page), 'Buy any 2 Get 10% Off|Buy any 3 Get 15% Off', 'just the offers');
  assert.equal(await page.locator('.pw-ladder .psl-btn').count(), 0, 'no button by default');
  assert.equal(await page.locator('.ps-card, .pw-layout').count(), 0, 'only a ladder selected: no coupon card in the preview');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('button + auto-apply are opt-in; Save posts a clean ladder', async () => {
  const { page, context, posts, errors } = await open();
  await page.getByRole('button', { name: 'Add an offer ladder' }).click();
  const tier = (i) => page.locator('.pw-ladder-tier').nth(i);
  await tier(0).getByLabel('Offer text').fill('Buy any 2 & get 10% <off>');
  await page.getByRole('button', { name: 'Add an offer' }).click();
  await tier(2).getByLabel('Offer text').fill('Buy any 4 Get 20% Off');
  await page.getByLabel('Subtext (optional)').fill('Applied at checkout');
  await page.getByLabel('Style').selectOption('ticker');
  assert.deepEqual(await page.getByLabel('Style').locator('option').allTextContents(), ['One line: every offer, divided', 'Scrolling ticker', 'Rotating: one offer at a time'], 'no steps look');
  // Button: needs a code before it shows.
  await page.getByLabel('Show a button').check();
  await page.getByText('Pick the code the button uses').waitFor();
  assert.equal(await page.locator('.pw-ladder .psl-btn').count(), 0);
  await page.getByLabel('Coupon code').selectOption('SAVE10');
  await page.getByLabel('When tapped').selectOption('apply');
  assert.equal(await page.locator('.pw-ladder .psl-btn').textContent(), 'Apply coupon');
  await page.getByLabel('Button text').fill('Grab SAVE10');
  assert.equal(await page.locator('.pw-ladder .psl-btn').textContent(), 'Grab SAVE10');
  // Auto-apply: item counts + codes appear.
  await page.getByLabel('Apply codes automatically as the cart grows').check();
  await tier(0).getByLabel('Coupon to apply').selectOption('BUY2');
  await tier(1).getByLabel('Coupon to apply').selectOption('BUY3');
  await page.getByText('Give each discount the same minimum quantity in Shopify').waitFor();
  await tier(2).getByLabel('Items in cart').fill('3');
  await page.getByText('Another offer needs the same number').first().waitFor();
  await tier(2).getByLabel('Items in cart').fill('4');
  const pv = await page.locator('.pw-ladder').evaluate((e) => ({ text: e.textContent, tags: e.querySelectorAll('off').length }));
  assert.match(pv.text, /Buy any 2 & get 10% <off>/, 'shown as text');
  assert.doesNotMatch(pv.text, /more item|unlock/i, 'no progress line');
  assert.equal(await page.locator('.pw-ladder .psl-status, .pw-ladder .psl-bar').count(), 0);
  await page.locator('.pw-ladders').screenshot({ path: path.join(shotDir, 'offer-ladder-preview.png') });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(400);
  const save = posts.find((p) => p.couponStyles);
  const id = save.selectedActiveCoupons[0];
  assert.match(id, /^ladder:[a-z0-9]+$/);
  const st = save.couponStyles[id];
  assert.equal(st.ladder, true);
  assert.deepEqual(st.tiers, [
    { text: 'Buy any 2 & get 10% <off>', qty: 2, code: 'BUY2' },
    { text: 'Buy any 3 Get 15% Off', qty: 3, code: 'BUY3' },
    { text: 'Buy any 4 Get 20% Off', qty: 4, code: '' },
  ]);
  assert.deepEqual([st.look, st.subtextText, st.autoApply, st.buttonShow, st.buttonAction, st.buttonCode, st.buttonText], ['ticker', 'Applied at checkout', true, true, 'apply', 'SAVE10', 'Grab SAVE10']);
  assert.equal(st.textOnly, undefined);
  assert.equal(st.couponCode, undefined, 'a ladder has no code of its own');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('a saved ladder loads back; ladder above a coupon card; editing it leaves the card\'s look alone', async () => {
  const ladder = { ladder: true, autoApply: true, tiers: [{ text: 'Buy any 2 Get 10% Off', qty: 2, code: 'BUY2' }], look: 'strip', bgColor: '#7c2d12', textColor: '#fff7ed', accentColor: '#fdba74' };
  const { page, context, errors } = await open(pageData({ selected: ['ladder:saved1', 'gid://shopify/DiscountCodeNode/3'], styles: { 'ladder:saved1': ladder, 'gid://shopify/DiscountCodeNode/3': { couponCode: 'SAVE10' } } }));
  assert.ok(await page.getByText('Offer ladder: Buy any 2 Get 10% Off').first().isVisible(), 'listed with its offers');
  await page.getByRole('button', { name: 'Customize Coupon' }).click();
  assert.equal(await page.locator('.pw-ladder-tier').count(), 1, 'editing the ladder (first selected)');
  assert.equal(await page.locator('.pw-ladder-tier').first().getByLabel('Coupon to apply').inputValue(), 'BUY2');
  const layout = await page.evaluate(() => {
    const l = document.querySelector('.pw-ladder').getBoundingClientRect(), c = document.querySelector('.pw-layout').getBoundingClientRect();
    return { above: l.bottom <= c.top, ladderBg: getComputedStyle(document.querySelector('.pw-ladder .psl')).backgroundColor, cardBg: getComputedStyle(document.querySelector('.pw-layout > div > div > div')).backgroundColor, cardButton: !!document.querySelector('.pw-layout button') };
  });
  assert.equal(layout.above, true);
  assert.equal(layout.ladderBg, 'rgb(124, 45, 18)');
  assert.notEqual(layout.cardBg, 'rgb(124, 45, 18)', 'the card keeps its own colours');
  assert.equal(layout.cardButton, true, 'card is the real coupon (Copy button), not the ladder');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('offers direction, button position and box size: preview follows, Save posts them', async () => {
  const { page, context, posts, errors } = await open();
  await page.getByRole('button', { name: 'Add an offer ladder' }).click();
  await page.getByLabel('Offer direction').selectOption('column');
  assert.equal(await page.getByLabel('Divider between offers').count(), 0, 'no divider when stacked');
  assert.match(await page.locator('.pw-ladder .psl').getAttribute('class'), /psl--col/);
  assert.equal(await page.getByLabel('Button position').count(), 0, 'position shows with the button');
  await page.getByLabel('Show a button').check();
  await page.getByLabel('Coupon code').selectOption('SAVE10');
  assert.deepEqual(await page.getByLabel('Button position').locator('option').allTextContents(), ['Right side', 'Centre, next to the text', 'Below the text, centred']);
  await page.getByLabel('Button position').selectOption('below');
  assert.match(await page.locator('.pw-ladder .psl').getAttribute('class'), /psl--btn-below/);
  await page.getByLabel('Width', { exact: true }).selectOption('atc');
  await page.getByText('Lines up with your theme').waitFor();
  const atc = await page.evaluate(() => { const l = document.querySelector('.pw-ladder .psl').getBoundingClientRect(), b = [...document.querySelectorAll('.pw-ladder-atc > div')].pop().getBoundingClientRect(); return { same: Math.round(l.width) === Math.round(b.width), tall: l.height >= 46 }; });
  assert.deepEqual(atc, { same: true, tall: true }, 'preview: same width as the stand-in Add to cart button, at least as tall');
  await page.locator('.pw-ladders').screenshot({ path: path.join(shotDir, 'offer-ladder-layout.png') });
  await page.getByLabel('Width', { exact: true }).selectOption('custom');
  assert.equal(await page.getByLabel('Box width').count() > 0, true);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(400);
  const save = posts.find((p) => p.couponStyles);
  const st = save.couponStyles[save.selectedActiveCoupons[0]];
  assert.deepEqual([st.direction, st.buttonPlace, st.boxSize], ['column', 'below', 'custom']);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('coupon ticket: cut-out shape, a line under each offer, left text, button in the stub; Save posts them', async () => {
  const { page, context, posts, errors } = await open();
  await page.getByRole('button', { name: 'Add an offer ladder' }).click();
  await page.getByLabel('Shape').selectOption('ticket');
  await page.getByLabel('Offer direction').selectOption('column');
  const tier = (i) => page.locator('.pw-ladder-tier').nth(i);
  await tier(0).getByLabel('Line under it (optional)').fill('(On all Orders)');
  assert.equal(await page.getByLabel('Text alignment').inputValue(), 'left', 'a ticket starts left-aligned');
  const cls = await page.locator('.pw-ladder .psl').getAttribute('class');
  assert.match(cls, /psl--ticket/);
  assert.match(cls, /psl--left/);
  assert.equal(await page.locator('.pw-ladder .psl-tier-sub').first().textContent(), '(On all Orders)');
  assert.equal(await page.locator('.pw-ladder .psl-stub').count(), 1, 'the stub on the right');
  await page.getByLabel('Show a button').check();
  await page.getByLabel('Coupon code').selectOption('SAVE10');
  assert.equal(await page.getByLabel('Button position').count(), 0, 'a ticket\'s button always sits in the stub');
  assert.equal(await page.locator('.pw-ladder .psl-stub .psl-btn').count(), 1);
  await page.locator('.pw-ladders').screenshot({ path: path.join(shotDir, 'offer-ladder-ticket.png') });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(400);
  const save = posts.find((p) => p.couponStyles);
  const st = save.couponStyles[save.selectedActiveCoupons[0]];
  assert.equal(st.shape, 'ticket');
  assert.equal(st.tiers[0].sub, '(On all Orders)');
  assert.equal('sub' in st.tiers[1], false, 'no empty line saved for an offer without one');
  assert.deepEqual(errors, []);
  await context.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

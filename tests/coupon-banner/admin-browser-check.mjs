// Real-browser check of the Coupon Banner admin page (app.productwidget.jsx):
// one simple page (1 coupons to show, 2 design, 3 where it shows, 4 timer,
// More options), each coupon's Edit popup, "+ Custom Coupon", saved texts.
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
  await page.locator('[data-section="coupons"] .cbz-sec-btn').click();
  await page.locator('[data-section="coupons"]').getByText('SAVE10').first().waitFor();
  return { page, context, posts, errors };
}

// "1. Coupons to show": one tick box per code.
const tickBox = (page, code) => page.locator('[data-section="coupons"]').getByRole('checkbox', { name: new RegExp(`^${code}`) });
const rowTitles = async (page) => { await openCard(page, 'coupons'); return page.locator('[data-section="coupons"] .cbz-crow-t').allTextContents(); };
const ticked = async (page) => { await openCard(page, 'coupons'); return page.locator('[data-section="coupons"] .cbz-crow.is-on .cbz-crow-t').allTextContents(); };
const popup = (page) => page.getByRole('dialog');
const editCoupon = async (page, name) => { await openCard(page, 'coupons'); await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click(); await popup(page).waitFor(); };
const done = async (page) => { await popup(page).getByRole('button', { name: 'Done' }).click(); await popup(page).waitFor({ state: 'detached' }); };
const fold = (page, title) => popup(page).getByRole('button', { name: new RegExp(`^${title}`) }).click();
// More options, then one of its cards (other-offers | headings | layout), each closed until clicked.
// Every card starts closed and one opens at a time: open(page) opens Coupons to show; others via openCard.
const openCard = async (page, card) => { if (await cardHead(page, card).getAttribute('aria-expanded') !== 'true') await cardHead(page, card).click(); };
const cardHead = (page, card) => page.locator(`[data-section="${card}"] .cbz-sec-btn`);
const moreOptions = async (page, card) => {
  const btn = page.getByRole('button', { name: /^More options/ });
  if (await btn.getAttribute('aria-expanded') !== 'true') await btn.click();
  if (card && await cardHead(page, card).getAttribute('aria-expanded') !== 'true') await cardHead(page, card).click();
};
const radio = (page, group, name) => page.getByRole('radiogroup', { name: group, exact: true }).getByRole('radio', { name, exact: true });
const save = async (page) => { await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForTimeout(400); };
const openDialog = async (page) => {
  await page.getByRole('button', { name: 'Add a code from another app' }).click();
  await page.getByRole('dialog').getByText('Add Custom Coupon').waitFor();
};
const codeField = (page) => page.getByRole('dialog').getByRole('textbox', { name: 'Coupon Code' });

console.log('\nCoupon Banner — the simple page');

await check('one simple page: every card starts closed, one opens at a time, each says what is set', async () => {
  const data = pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] });
  const { page, context, errors } = await open({ data });
  await moreOptions(page);
  const cards = ['coupons', 'design', 'position', 'timer', 'other-offers', 'headings', 'layout'];
  const expanded = () => Promise.all(cards.map((c) => cardHead(page, c).getAttribute('aria-expanded')));
  assert.deepEqual(await page.locator('.cbz-sec-t').allTextContents(), ['Coupons to show', 'Design', 'Where it shows', 'Countdown timer (optional)', 'Text offers and offer ladders', 'Headings', 'Layout and size']);
  // open() opened Coupons to show; close it: nothing is open.
  await cardHead(page, 'coupons').click();
  assert.deepEqual(await expanded(), cards.map(() => 'false'), 'all closed');
  assert.deepEqual(await page.locator('.cbz-sum').allTextContents(), ['1 shown', 'Classic Banner', 'Above Add to cart', 'Off', 'None added', '“Apply Coupon”', 'List · Full width']);
  for (const hidden of ['Banner title', 'Add an offer ladder', 'Corner roundness', 'Show a countdown timer on each coupon']) assert.equal(await page.getByLabel(hidden).count() + await page.getByRole('button', { name: hidden }).count(), 0, `${hidden} folded away`);
  // One open at a time; a second click closes it.
  await cardHead(page, 'headings').click();
  assert.deepEqual(await expanded(), cards.map((c) => String(c === 'headings')));
  await page.getByLabel('Banner title').waitFor();
  await cardHead(page, 'layout').click();
  assert.deepEqual(await expanded(), cards.map((c) => String(c === 'layout')), 'opening Layout closes Headings');
  assert.equal(await page.getByLabel('Banner title').count(), 0);
  await cardHead(page, 'layout').click();
  assert.deepEqual(await expanded(), cards.map(() => 'false'));
  assert.deepEqual(errors, []);
  await context.close();
});

await check('countdown timer: a saved timer loads closed with a summary; ticking the box shows its settings', async () => {
  const data = pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] });
  data.couponConfig = { ...data.couponConfig, timerEnabled: true, timerHours: 1, timerMins: 30, timerLabel: 'Ends in' };
  let { page, context, errors } = await open({ data });
  assert.equal(await cardHead(page, 'timer').getAttribute('aria-expanded'), 'false', 'saved timer: closed on load');
  assert.match(await page.locator('[data-section="timer"] .cbz-sum').textContent(), /1 h 30 min · “Ends in”/);
  assert.equal(await page.getByLabel('Hours').count(), 0);
  await openCard(page, 'timer');
  assert.equal(await page.getByLabel('Timer text').inputValue(), 'Ends in');
  assert.deepEqual(errors, []);
  await context.close();
  ({ page, context } = await open({ data: pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] }) }));
  await openCard(page, 'timer');
  await page.getByLabel('Show a countdown timer on each coupon').check();
  assert.equal(await page.getByLabel('Timer text').inputValue(), 'Offer expires in');
  await context.close();
});

await check('tick and untick codes; Save posts their real codes', async () => {
  const { page, context, posts, errors } = await open();
  await tickBox(page, 'SAVE10').check();
  await tickBox(page, 'WELCOME20').check();
  assert.deepEqual(await ticked(page), ['SAVE10', 'WELCOME20']);
  assert.equal(await page.getByText('2 shown on your banner').count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Edit WELCOME20' }).count(), 1, 'a ticked code gets an Edit button');
  await tickBox(page, 'WELCOME20').uncheck();
  assert.equal(await page.getByRole('button', { name: 'Edit WELCOME20' }).count(), 0);
  await save(page);
  const body = posts.find((p) => p.selectedActiveCoupons);
  assert.deepEqual(body.selectedActiveCoupons, ['gid://shopify/DiscountCodeNode/1']);
  assert.equal(body.couponStyles['gid://shopify/DiscountCodeNode/1'].couponCode, 'SAVE10');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('screenshot: the Coupons to show card', async () => {
  const { page, context } = await open({ data: pageData({ customCoupons: [SHIPROCKET], selected: ['custom:SHIPROCKET10'] }) });
  const shotDir = path.join(process.cwd(), 'tests', 'coupon-banner', 'screenshots');
  fs.mkdirSync(shotDir, { recursive: true });
  await page.locator('[data-section="coupons"]').screenshot({ path: path.join(shotDir, 'coupon-selection.png') });
  await context.close();
});

console.log('\nCoupon Banner — Custom Coupon checks');

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

await check('Just add: trims, posts only the code, shows "Adding coupon…", then lists it ticked as a code from another app', async () => {
  const { page, context, posts } = await open({ respond: () => ({ success: true, coupon: SHIPROCKET }), delayMs: 600 });
  await openDialog(page);
  await codeField(page).fill('  SHIPROCKET10  ');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Coupon' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Adding coupon/ }).waitFor();
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: /Adding coupon/ }).isDisabled(), true);
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  assert.deepEqual(posts, [{ intent: 'add_custom_coupon', code: 'SHIPROCKET10' }]);
  assert.equal(await tickBox(page, 'SHIPROCKET10').isChecked(), true);
  assert.ok(await page.locator('[data-offer="custom:SHIPROCKET10"]').getByText('Code from another app').isVisible());
  assert.deepEqual(await page.evaluate(() => window.__toasts), [{ message: 'Coupon added successfully' }]);
  // It sits above the store's own coupons.
  assert.deepEqual((await rowTitles(page)).slice(0, 3), ['SHIPROCKET10', 'SAVE10', 'WELCOME20']);
  await context.close();
});

await check('Save sends the custom coupon through the normal selection + couponCode path', async () => {
  const { page, context, posts } = await open({ respond: (b) => (b.intent ? { success: true, coupon: SHIPROCKET } : { success: true }) });
  await openDialog(page);
  await codeField(page).fill('SHIPROCKET10');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Coupon' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await tickBox(page, 'SAVE10').check();
  await save(page);
  const body = posts.find((p) => p.selectedActiveCoupons);
  assert.deepEqual(body.selectedActiveCoupons, ['custom:SHIPROCKET10', 'gid://shopify/DiscountCodeNode/1']);
  assert.equal(body.couponStyles['custom:SHIPROCKET10'].couponCode, 'SHIPROCKET10');
  assert.equal(body.couponStyles['gid://shopify/DiscountCodeNode/1'].couponCode, 'SAVE10');
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
  assert.equal((await rowTitles(page)).filter((t) => t === 'SHIPROCKET10').length, 1);
  await context.close();
});

await check('server-side refusal / failure shows a friendly message and keeps the dialog open', async () => {
  const { page, context } = await open({ respond: () => ({ success: false, error: 'save_failed', message: 'Couldn’t add the coupon right now. Please try again.' }) });
  await openDialog(page);
  await codeField(page).fill('NEWCODE5');
  await page.getByRole('dialog').getByRole('button', { name: 'Add Coupon' }).click();
  await page.getByRole('dialog').getByText('Couldn’t add the coupon right now. Please try again.').waitFor();
  assert.ok(!(await rowTitles(page)).includes('NEWCODE5'));
  await context.close();
});

await check('after a refresh: saved custom coupon is listed, labelled and still ticked', async () => {
  const { page, context } = await open({ data: pageData({ customCoupons: [SHIPROCKET], selected: ['custom:SHIPROCKET10'] }) });
  assert.ok(await page.locator('[data-offer="custom:SHIPROCKET10"]').getByText('Code from another app').isVisible());
  assert.deepEqual(await ticked(page), ['SHIPROCKET10']);
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
  await tickBox(page, 'SAVE10').check();
  await openDialog(page);
  await page.getByRole('dialog').getByText('Create this coupon in BRIX').click();
  assert.ok(await page.getByRole('dialog').getByText(/You have unsaved changes on this page/).isVisible());
  await context.close();
});

console.log('\nCoupon Banner — a coupon\'s Edit popup, text offers');

await check('reopening the page shows each coupon\'s saved heading / subtext / button text (template2 too)', async () => {
  for (const tpl of ['template1', 'template2']) {
    const n = tpl.slice(-1);
    const data = pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] });
    data.couponConfig = { ...data.couponConfig, activeTemplate: tpl, [`temp${n}CouponStyle`]: { 'gid://shopify/DiscountCodeNode/1': { couponCode: 'SAVE10', headingText: 'FIRST ORDER', subtextText: 'Get 10% Discount', buttonText: 'Grab it' } }, [`temp${n}CouponCondition`]: [] };
    const { page, context, posts } = await open({ data });
    await editCoupon(page, 'SAVE10');
    assert.equal(await popup(page).getByLabel('Heading', { exact: true }).inputValue(), 'FIRST ORDER', tpl);
    assert.equal(await popup(page).getByLabel('Subtext', { exact: true }).inputValue(), 'Get 10% Discount', tpl);
    assert.equal(await popup(page).getByLabel('Button Text', { exact: true }).inputValue(), 'Grab it', tpl);
    await done(page);
    // Saving after an unrelated change keeps them (they used to be sent empty).
    await moreOptions(page, 'layout');
    await radio(page, 'How coupon cards are arranged', 'Grid').click();
    await save(page);
    const style = posts.at(-1)?.couponStyles?.['gid://shopify/DiscountCodeNode/1'] || {};
    assert.equal(style.headingText, 'FIRST ORDER', `${tpl} save keeps heading`);
    assert.equal(style.buttonText, 'Grab it', `${tpl} save keeps button text`);
    await context.close();
  }
});

await check('the popup shows the coupon as it looks, edits it live, and its colours are folded away', async () => {
  const { page, context, posts, errors } = await open({ data: pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] }) });
  await editCoupon(page, 'SAVE10');
  assert.equal(await popup(page).getByLabel('Background', { exact: true }).count(), 0, 'colours folded');
  await popup(page).getByLabel('Heading', { exact: true }).fill('Members save 10%');
  assert.match(await popup(page).locator('.cbz-modal-pv').textContent(), /Members save 10%/, 'popup preview');
  assert.match(await page.locator('.cbz-pv .pw-layout').textContent(), /Members save 10%/, 'page preview');
  await fold(page, 'Colours');
  await popup(page).getByRole('textbox', { name: /^Background/ }).fill('#fef3c7');
  await done(page);
  await save(page);
  const st = posts.at(-1).couponStyles['gid://shopify/DiscountCodeNode/1'];
  assert.deepEqual([st.headingText, st.bgColor], ['Members save 10%', '#fef3c7']);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('a click on a coupon in the preview opens its popup; each card shows its own text; Remove from banner unticks it', async () => {
  const { page, context, posts, errors } = await open({ data: pageData({ selected: ['gid://shopify/DiscountCodeNode/1', 'gid://shopify/DiscountCodeNode/2'] }) });
  const cards = page.locator('.cbz-pv .pw-layout > [data-pick]');
  await cards.nth(1).click();
  await popup(page).getByText('Edit: WELCOME20').waitFor();
  await popup(page).getByLabel('Heading', { exact: true }).fill('Welcome back');
  assert.match(await cards.nth(1).textContent(), /Welcome back/);
  assert.match(await cards.nth(0).textContent(), /GET 10% OFF!/, 'the other card keeps its own heading');
  await popup(page).getByRole('button', { name: 'Remove from banner' }).click();
  await popup(page).waitFor({ state: 'detached' });
  assert.deepEqual(await ticked(page), ['SAVE10']);
  await save(page);
  assert.deepEqual(posts.at(-1).selectedActiveCoupons, ['gid://shopify/DiscountCodeNode/1']);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Add a text offer: shown ticked, its popup opens, no Button Text, saved with no code; preview has no button', async () => {
  const { page, context, posts } = await open();
  await moreOptions(page, 'other-offers');
  await page.getByRole('button', { name: 'Add a text offer with no code' }).click();
  await popup(page).waitFor();
  await popup(page).getByLabel('Heading', { exact: true }).fill('Free shipping over ₹999');
  await popup(page).getByLabel('Subtext', { exact: true }).fill('Automatic at checkout');
  assert.equal(await popup(page).getByLabel('Button Text', { exact: true }).count(), 0, 'no button text field for a text offer');
  await done(page);
  assert.ok(await page.locator('.cbz-pv').getByText('Free shipping over ₹999', { exact: true }).isVisible(), 'preview shows the heading');
  assert.equal(await page.getByRole('button', { name: 'Copy Code', exact: true }).count(), 0, 'preview has no Copy button for a text offer');
  assert.deepEqual(await ticked(page), ['Free shipping over ₹999']);
  await save(page);
  const body = posts.at(-1);
  const id = (body.selectedActiveCoupons || []).find((x) => x.startsWith('text:'));
  assert.ok(id, 'text offer id saved in the selected list');
  assert.deepEqual({ ...body.couponStyles[id] }, { headingText: 'Free shipping over ₹999', subtextText: 'Automatic at checkout', textOnly: true });
  await context.close();
});

await check('a saved text offer comes back in the list with its heading', async () => {
  const data = pageData({ selected: ['text:k9'] });
  data.couponConfig = { ...data.couponConfig, temp1CouponStyle: { 'text:k9': { headingText: 'Free gift over ₹1499', textOnly: true } } };
  const { page, context } = await open({ data });
  const row = page.locator('[data-offer="text:k9"]');
  assert.equal(await row.locator('.cbz-crow-t').textContent(), 'Free gift over ₹1499');
  assert.match(await row.locator('.cbz-crow-s').textContent(), /^Text offer/);
  assert.equal(await row.getByRole('checkbox').isChecked(), true);
  await context.close();
});

await check('subtitle font, Copied colours and icon: in the preview and saved', async () => {
  const { page, context, posts } = await open({ data: pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] }) });
  await editCoupon(page, 'SAVE10');
  await fold(page, 'Text size and icon');
  await popup(page).getByLabel('Size', { exact: true }).fill('18');
  await popup(page).getByLabel('Weight', { exact: true }).selectOption('800');
  const subStyle = await page.locator('.cbz-pv .pw-sub').first().evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight]);
  assert.deepEqual(subStyle, ['18px', '800'], 'preview subtitle follows the font settings');
  assert.equal(await page.locator('.cbz-pv .pw-coupon-icon').count(), 0, 'Classic Banner: no icon by default');
  await popup(page).getByLabel('Show icon').check();
  await popup(page).getByRole('radio', { name: 'Gift' }).click();
  assert.equal(await page.locator('.cbz-pv .pw-coupon-icon svg').count(), 1, 'icon shows in the preview once switched on');
  await popup(page).getByLabel('Icon size').fill('28');
  assert.equal(await page.locator('.cbz-pv .pw-coupon-icon svg').getAttribute('width'), '28');
  await done(page);
  await save(page);
  const st = posts.at(-1).couponStyles['gid://shopify/DiscountCodeNode/1'];
  assert.deepEqual({ size: st.subFontSize, weight: st.subFontWeight, show: st.iconShow, icon: st.icon, iconSize: st.iconSize }, { size: 18, weight: '800', show: true, icon: 'gift', iconSize: 28 });
  await context.close();
});

await check('text offers have no Copied colour or button colour settings', async () => {
  const { page, context } = await open();
  await moreOptions(page, 'other-offers');
  await page.getByRole('button', { name: 'Add a text offer with no code' }).click();
  await popup(page).waitFor();
  await fold(page, 'Colours');
  assert.equal(await popup(page).getByText('Copied button background').count(), 0);
  assert.equal(await popup(page).getByLabel('Button text', { exact: true }).count(), 0, 'no button colours either');
  await fold(page, 'Text size and icon');
  assert.equal(await popup(page).getByLabel('Show icon').count(), 1, 'icon settings still there');
  await context.close();
});

console.log('\nCoupon Banner — design, where it shows, More options');

await check('the design note shows only when switching would drop something (not for a timer change)', async () => {
  const { page, context } = await open({ data: pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] }) });
  const note = async () => { await openCard(page, 'design'); return page.getByText(/switching design drops/).count(); };
  await openCard(page, 'timer');
  await page.getByLabel('Show a countdown timer on each coupon').check();
  assert.equal(await note(), 0, 'timer changes are kept on a switch');
  await editCoupon(page, 'SAVE10');
  await popup(page).getByLabel('Heading', { exact: true }).fill('Changed');
  await done(page);
  assert.equal(await note(), 1, 'coupon words would be dropped');
  await openCard(page, 'design');
  await radio(page, 'Design', 'Minimal Card').click();
  assert.equal(await note(), 0, 'switched: nothing left to drop');
  await context.close();
});

await check('where it shows: the preview puts the banner above / below the Add to cart button; saved', async () => {
  const { page, context, posts } = await open({ data: pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] }) });
  const order = () => page.evaluate(() => [...document.querySelector('.cbz-pv-page').children]
    .map((e) => (e.classList.contains('pw-banner') ? 'banner' : e.classList.contains('pw-atc-standin') ? 'atc' : '')).filter(Boolean));
  assert.deepEqual(await order(), ['banner', 'atc']);
  await openCard(page, 'position');
  await page.getByText('Below the Add to cart button', { exact: true }).click();
  assert.deepEqual(await order(), ['atc', 'banner']);
  await page.getByText("I'll place it myself (theme editor)", { exact: true }).click();
  assert.deepEqual(await order(), ['banner'], 'placed by hand: no Add to cart drawn');
  assert.ok(await page.getByRole('link', { name: 'Open theme editor' }).or(page.getByRole('button', { name: 'Open theme editor' })).first().isVisible());
  await save(page);
  assert.equal(posts.at(-1).widgetPlacement, 'custom');
  await context.close();
});

await check('banner layout: the preview arranges the coupons as the store will (list / grid / carousel)', async () => {
  const data = pageData({ selected: ['gid://shopify/DiscountCodeNode/1', 'gid://shopify/DiscountCodeNode/2', 'gid://shopify/DiscountCodeNode/3'] });
  const { page, context } = await open({ data });
  await moreOptions(page, 'layout');
  const shape = () => page.evaluate(() => {
    const box = document.querySelector('.cbz-pv .pw-layout');
    const kids = [...box.children].map((c) => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
    return { layout: box.dataset.layout, kids };
  });
  await radio(page, 'How coupon cards are arranged', 'List').click();
  let g = await shape();
  assert.ok(g.layout === 'list' && g.kids.length === 3 && g.kids.every((k, i) => i === 0 || (k[1] > g.kids[i - 1][1] && k[0] === g.kids[0][0])), `list stacked ${JSON.stringify(g)}`);
  await radio(page, 'How coupon cards are arranged', 'Grid').click();
  g = await shape();
  assert.ok(g.layout === 'grid' && g.kids[0][1] === g.kids[1][1] && g.kids[2][1] > g.kids[0][1], `grid 2 columns ${JSON.stringify(g)}`);
  await radio(page, 'How coupon cards are arranged', 'Carousel').click();
  g = await shape();
  assert.ok(g.layout === 'carousel' && g.kids[0][1] === g.kids[1][1] && g.kids[1][0] > g.kids[0][0], `carousel one row ${JSON.stringify(g)}`);
  await context.close();
});

await check('section title: defaults to "Apply Coupon", editable (text, size, colour, alignment), previewed, saved; empty hides it', async () => {
  const { page, context, posts } = await open();
  await tickBox(page, 'SAVE10').check();
  assert.equal(await page.locator('.pw-section-title').textContent(), 'Apply Coupon');
  // A click on the title in the preview opens More options at Headings.
  await page.locator('.pw-section-title').click();
  const field = page.getByLabel('Banner title');
  await field.waitFor();
  assert.equal(await field.inputValue(), 'Apply Coupon');
  await field.fill('Exclusive offers for you');
  await page.getByLabel('Title size').fill('20');
  await page.getByRole('textbox', { name: /^Title colour/ }).fill('#be185d');
  await radio(page, 'Title alignment', 'Centre').click();
  await page.waitForTimeout(200);
  const pv = await page.locator('.pw-section-title').evaluate((e) => [e.textContent, getComputedStyle(e).fontSize, getComputedStyle(e).color, getComputedStyle(e).textAlign]);
  assert.deepEqual(pv, ['Exclusive offers for you', '20px', 'rgb(190, 24, 93)', 'center']);
  await save(page);
  const body = posts.find((p) => p.template);
  assert.deepEqual(body.template.title, { text: 'Exclusive offers for you', fontSize: 20, textColor: '#be185d', alignment: 'center' });
  await field.fill('');
  assert.equal(await page.locator('.pw-section-title').count(), 0, 'empty = no title in the preview');
  assert.equal(await page.getByLabel('Title size').count(), 0, 'size / colour / alignment hidden while empty');
  await context.close();
});

await check('own headings above the offer ladder and above the coupon cards: off by default, previewed in place, saved, load back', async () => {
  const data = pageData({ selected: ['ladder:abc', 'gid://shopify/DiscountCodeNode/1'] });
  data.couponConfig.temp1CouponStyle = { 'ladder:abc': { ladder: true, tiers: [{ text: 'Buy any 2 Get 10% Off', qty: 2 }] } };
  let { page, context, posts, errors } = await open({ data });
  await moreOptions(page, 'headings');
  assert.equal(await page.getByLabel('Offer ladder heading').inputValue(), '', 'not saved = no ladder heading');
  assert.equal(await page.getByLabel('Coupon cards heading').inputValue(), '', 'not saved = no cards heading');
  assert.equal(await page.locator('.pw-ladders-title, .pw-cards-title').count(), 0);
  assert.equal(await page.getByLabel('Ladder heading size').count(), 0, 'style fields hidden while empty');
  await page.getByLabel('Banner title').fill('');
  await page.getByLabel('Offer ladder heading').fill('Bundle offers');
  await page.getByLabel('Ladder heading size').fill('18');
  await page.getByRole('textbox', { name: /^Ladder heading colour/ }).fill('#be185d');
  await radio(page, 'Ladder heading alignment', 'Centre').click();
  await page.getByLabel('Coupon cards heading').fill('Apply a coupon');
  await page.waitForTimeout(200);
  // Preview order: ladder heading → ladder → cards heading → cards.
  const order = await page.evaluate(() => [...document.querySelectorAll('.pw-banner .pw-section-title, .pw-banner .pw-ladders-title, .pw-banner .pw-ladders, .pw-banner .pw-cards-title, .pw-banner .pw-layout')].map((e) => e.className));
  assert.deepEqual(order, ['pw-ladders-title', 'pw-ladders', 'pw-cards-title', 'pw-layout']);
  const pv = await page.locator('.pw-ladders-title').evaluate((e) => [e.textContent, getComputedStyle(e).fontSize, getComputedStyle(e).color, getComputedStyle(e).textAlign]);
  assert.deepEqual(pv, ['Bundle offers', '18px', 'rgb(190, 24, 93)', 'center']);
  await save(page);
  const body = posts.find((p) => p.template);
  assert.equal(body.template.title.text, '');
  assert.deepEqual(body.template.ladderTitle, { text: 'Bundle offers', fontSize: 18, textColor: '#be185d', alignment: 'center' });
  assert.deepEqual(body.template.cardsTitle, { text: 'Apply a coupon', fontSize: 14, textColor: '#111827', alignment: 'left' });
  assert.deepEqual(errors, []);
  await context.close();
  data.couponConfig.templates = { ...data.couponConfig.templates, template1: { ...data.couponConfig.templates.template1, ladderTitle: body.template.ladderTitle, cardsTitle: body.template.cardsTitle } };
  ({ page, context } = await open({ data }));
  await moreOptions(page, 'headings');
  assert.equal(await page.getByLabel('Offer ladder heading').inputValue(), 'Bundle offers');
  assert.equal(await page.locator('.pw-cards-title').textContent(), 'Apply a coupon');
  await context.close();
});

await check('banner width: full / same as Add to cart / custom; preview follows; saved; loads back', async () => {
  const data = pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] });
  let { page, context, posts, errors } = await open({ data });
  await moreOptions(page, 'layout');
  assert.equal(await radio(page, 'Banner width', 'Full width').getAttribute('aria-checked'), 'true', 'not saved = full width');
  const outer = () => page.evaluate(() => { const b = document.querySelector('.pw-banner').getBoundingClientRect(), p = document.querySelector('.pw-banner').parentElement.getBoundingClientRect(); return { banner: Math.round(b.width), room: Math.round(p.width - 36), standin: !!document.querySelector('.pw-atc-standin') }; });
  let g = await outer();
  assert.ok(Math.abs(g.banner - g.room) <= 3 && g.standin, 'full (page padding aside), Add to cart drawn under it ' + JSON.stringify(g));
  await radio(page, 'Banner width', 'Add to cart width').click();
  await page.getByText('the title, offer ladders and coupons take its width').waitFor();
  g = await outer();
  assert.ok(g.standin && g.banner < g.room, 'atc: narrower, with a stand-in Add to cart ' + JSON.stringify(g));
  const sameW = await page.evaluate(() => Math.round(document.querySelector('.pw-layout').getBoundingClientRect().width) === Math.round(document.querySelector('.pw-atc-standin').getBoundingClientRect().width));
  assert.ok(sameW, 'coupon as wide as the stand-in button');
  await page.locator('.pw-banner').locator('..').screenshot({ path: path.join(process.cwd(), 'tests', 'coupon-banner', 'screenshots', 'banner-width-atc.png') });
  await radio(page, 'Banner width', 'Custom').click();
  await page.getByLabel('Banner width (px)').waitFor();
  g = await outer();
  assert.ok(g.banner <= 400, 'custom 400px ' + JSON.stringify(g));
  await radio(page, 'Banner width', 'Add to cart width').click();
  await save(page);
  const tpl = posts.at(-1).template;
  assert.deepEqual([tpl.bannerWidth, tpl.bannerWidthPx], ['atc', 400]);
  assert.deepEqual(errors, []);
  await context.close();
  // Saved settings come back (the loader merges tempNDefaultStyle into the template).
  const saved = pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] });
  saved.couponConfig.templates = { ...saved.couponConfig.templates, template1: { ...saved.couponConfig.templates.template1, bannerWidth: 'custom', bannerWidthPx: 520 } };
  ({ page, context } = await open({ data: saved }));
  await moreOptions(page, 'layout');
  assert.equal(await radio(page, 'Banner width', 'Custom').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('.pw-banner').evaluate((e) => e.style.maxWidth), '520px');
  await context.close();
});

await check('empty banner: a sample card and a hint to tick a coupon', async () => {
  const { page, context } = await open();
  assert.equal(await page.getByText('None shown yet').count(), 1);
  assert.match(await page.locator('.cbz-pv-cta').textContent(), /This is a sample\. Tick a coupon/);
  await tickBox(page, 'SAVE10').check();
  assert.equal(await page.locator('.cbz-pv-cta').count(), 0);
  await context.close();
});

await check('Discard puts back the saved settings (it used to only grey out Save and keep the edits)', async () => {
  const { page, context, posts } = await open({ data: pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] }) });
  await tickBox(page, 'WELCOME20').check();
  await moreOptions(page, 'layout');
  await radio(page, 'How coupon cards are arranged', 'Grid').click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true);
  assert.deepEqual(await ticked(page), ['SAVE10'], 'WELCOME20 unticked again');
  await moreOptions(page, 'layout');
  assert.equal(await radio(page, 'How coupon cards are arranged', 'List').getAttribute('aria-checked'), 'true');
  assert.equal(posts.length, 0, 'nothing saved');
  await context.close();
});

await check('the "Settings saved!" toast shows at the top, clear of the floating Brix AI bar (app/global.css)', async () => {
  const { page, context } = await open({ data: pageData({ selected: ['gid://shopify/DiscountCodeNode/1'] }) });
  // The app's own global stylesheet (the harness loads only Polaris's) and a
  // bar where BrixBar floats (BrixBar.jsx: fixed, bottom 20, centred, z-index 9998).
  await page.addStyleTag({ content: fs.readFileSync(path.join(process.cwd(), 'app', 'global.css'), 'utf8') });
  await page.evaluate(() => {
    const bar = document.createElement('div');
    bar.id = 'brixbar-standin';
    bar.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:calc(100% - 40px);max-width:720px;height:52px;background:#111;z-index:9998';
    document.body.appendChild(bar);
  });
  await tickBox(page, 'WELCOME20').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.Polaris-Frame-Toast').waitFor();
  await page.waitForTimeout(700); // slide-in done
  const t = await page.evaluate(() => {
    const el = document.querySelector('.Polaris-Frame-Toast');
    const b = el.getBoundingClientRect();
    const bar = document.getElementById('brixbar-standin').getBoundingClientRect();
    return { text: el.textContent, top: Math.round(b.top), centred: Math.abs((b.left + b.right) / 2 - innerWidth / 2) < 2, uncovered: el.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)), clearOfBar: b.bottom < bar.top };
  });
  assert.deepEqual(t, { text: 'Settings saved!', top: 16, centred: true, uncovered: true, clearOfBar: true });
  await context.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

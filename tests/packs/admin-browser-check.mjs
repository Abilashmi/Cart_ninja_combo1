// Real-browser check of the BRIX Packs ADMIN pages (list, detail, builder).
//
//   node --import ./tests/packs/register.mjs tests/packs/admin-browser-check.mjs
//
// The real page components are bundled by tests/packs/harness (Vite) with mock
// loaders, a stubbed App Bridge and Polaris; /api/packs is mocked with
// Playwright routes. This verifies UI behaviour end to end (routing between the
// list/new/detail/edit pages, builder steps, validation, calculations, drafts,
// delete/enable flows, plan restrictions, error states, mobile layout). It does
// not talk to Shopify or any database.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { calculateTier, defaultCustomization, normalizeTiers, validateTiers } from '../../app/utils/packs.shared.js';

const root = path.join(process.cwd(), 'tests', 'packs', 'harness');
const SHOT_DIR = path.join(process.cwd(), 'tests', 'packs', 'screenshots');
fs.mkdirSync(SHOT_DIR, { recursive: true });
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

const SHOP = 'demo.myshopify.com';
const currency = { code: 'INR', locale: 'en-IN', symbol: '₹' };
const RAW_TIERS = [
  { name: '', quantity: 1, discountType: 'none', discountValue: 0, badge: '' },
  { name: '', quantity: 2, discountType: 'percentage', discountValue: 5, badge: '' },
  { name: 'Family pack', quantity: 3, discountType: 'percentage', discountValue: 10, badge: 'Best value' },
];
const calcTiers = (tiers = RAW_TIERS, price = 80) => normalizeTiers(tiers).map((tier) => ({ ...tier, ...calculateTier(price, tier, { currencyCode: 'INR', locale: 'en-IN' }) }));
const pack = (over = {}) => ({
  id: 55, shop: SHOP, productId: '100', variantId: '200', productTitle: 'Tee', variantTitle: 'M', productImage: '', basePrice: 80, status: 'draft', displayStatus: 'draft', enabled: false,
  template: 'same_variant', version: 2, tiers: calcTiers(), customization: defaultCustomization(), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  priceVerified: true, issue: null, available: true, maxQuantity: null, currency, ...over,
});
const product = { id: '100', title: 'Tee', handle: 'tee', status: 'ACTIVE', image: '', variants: [
  { id: '200', title: 'M', price: 80, availableForSale: true, maxQuantity: 25, inventoryQuantity: 25, inventoryPolicy: 'DENY', image: '' },
  { id: '201', title: 'L', price: 100, availableForSale: false, maxQuantity: null, inventoryQuantity: 0, inventoryPolicy: 'DENY', image: '' },
] };

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log('  ✓', name); } catch (error) { results.push({ name, ok: false }); console.log('  ✗', name, '\n     ', String(error.message).split('\n').slice(0, 3).join(' | ')); }
};

const browser = await chromium.launch();

/** Open the harness at `start` with mock loader data and API handlers. */
async function open({ start, data, viewport = { width: 1200, height: 900 }, api = {}, picker, context: existingContext, keepStorage }) {
  const context = existingContext || (await browser.newContext({ viewport }));
  const page = await context.newPage();
  const calls = [];
  await page.route('http://harness.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/packs') {
      const request = route.request();
      const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
      calls.push({ method: request.method(), query: Object.fromEntries(url.searchParams), body });
      const handler = request.method() === 'POST' ? api[body.action] : api.product;
      const response = handler ? await handler(body, url) : { status: 500, body: { success: false, error: 'no mock' } };
      return route.fulfill({ status: response.status || 200, contentType: 'application/json', body: JSON.stringify(response.body) });
    }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(dist) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.addInitScript(({ start, data, picker }) => { window.__START__ = start; window.__DATA__ = data; window.__pickerResult = picker; }, { start, data, picker });
  await page.goto('http://harness.test/');
  return { page, context, calls };
}

const builderData = (planState = 'enabled') => ({ builder: { shop: SHOP, planState, currency } });
const productApi = { product: () => ({ body: { success: true, product, currency } }) };
const previewApi = {
  preview: (body) => {
    const tiers = normalizeTiers(body.tiers);
    const check = validateTiers(tiers, { basePrice: 80, currencyCode: 'INR' });
    return { body: { success: true, valid: check.valid, errors: check.errors, currency, variant: { id: '200', title: 'M', price: 80, availableForSale: true, maxQuantity: 25, inventoryQuantity: 25 }, tiers: check.valid ? calcTiers(body.tiers) : [] } };
  },
};
const pickerResult = [{ id: 'gid://shopify/Product/100', title: 'Tee', images: [] }];

async function pickProduct(page) {
  await page.getByRole('button', { name: 'Choose product' }).click();
  await page.getByLabel('Variant').waitFor();
  await page.getByLabel('Variant').selectOption('200');
}

console.log('\nBRIX Packs admin — browser checks');

await check('routing: list -> Create Pack opens the builder (not the list); /new and refresh work; back returns to the list', async () => {
  const { page, context } = await open({ start: '/app/packs', data: { list: { packs: [], planState: 'enabled', currency, checkoutDiscount: null, loadError: null }, builder: { shop: SHOP, planState: 'enabled', currency } } });
  await page.getByText('Create your first Pack').waitFor();
  await page.getByRole('button', { name: 'Create Pack' }).first().click();
  await page.getByRole('tab', { name: /Step 1: Product/ }).waitFor();
  assert.equal(await page.evaluate(() => window.__router.state.location.pathname), '/app/packs/new');
  assert.equal(await page.getByRole('heading', { name: 'Create Pack' }).count() + await page.getByText('Create Pack').count() > 0, true);
  await page.getByRole('button', { name: 'Packs' }).first().click(); // back action
  await page.getByText('Create your first Pack').waitFor();
  await context.close();
});

await check('list: rows show product, variant, offer summary, status, updated; filters; Enable is gated by plan; actions link to the right pack', async () => {
  const packs = [
    pack({ id: 1, productTitle: 'Tee', variantTitle: 'M', status: 'active', displayStatus: 'active', enabled: true }),
    pack({ id: 2, productTitle: 'Mug', variantTitle: 'Blue', status: 'draft', displayStatus: 'draft' }),
    pack({ id: 3, productTitle: 'Cap', variantTitle: 'Red', status: 'active', displayStatus: 'configuration_error', issue: 'The Shopify variant for this Pack no longer exists.', priceVerified: false }),
  ];
  const { page, context } = await open({ start: '/app/packs', data: { list: { packs, planState: 'preview', currency, checkoutDiscount: null, loadError: null }, edit: { pack: pack({ id: 1 }), shop: SHOP, planState: 'preview', currency } } });
  await page.getByText('Packs preview mode').waitFor();
  const rows = page.getByRole('row');
  assert.match(await page.locator('table').innerText(), /3 tiers · 1–3 items · save up to 10%/);
  assert.match(await page.locator('table').innerText(), /Base price ₹80\.00/);
  assert.match(await page.locator('table').innerText(), /The Shopify variant for this Pack no longer exists\./);
  assert.match(await page.locator('table').innerText(), /Configuration error/);
  // Free plan: cannot enable a non-active pack, can still disable active
  assert.equal(await page.getByRole('button', { name: 'Enable Pack for Mug' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Disable Pack for Tee' }).isDisabled(), false);
  assert.equal(await page.getByRole('button', { name: 'Edit' }).count(), 3);
  await page.getByPlaceholder('Search product or variant').fill('mug');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByPlaceholder('Search product or variant').fill('');
  await page.getByLabel('Status').selectOption('configuration_error');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.screenshot({ path: path.join(SHOT_DIR, 'admin_list.png') });
  await page.getByLabel('Status').selectOption('all');
  await page.getByRole('button', { name: 'Edit' }).first().click();
  assert.equal(await page.evaluate(() => window.__navCalls.at(-1)), '/app/packs/1/edit');
  await context.close();
});

await check('list: enable/disable posts to /api/packs and shows the server error inline when refused; load errors are visible with Try again', async () => {
  const { page, context, calls } = await open({
    start: '/app/packs',
    data: { list: { packs: [pack({ id: 2, status: 'inactive', displayStatus: 'inactive' })], planState: 'enabled', currency, checkoutDiscount: { verified: false, state: 'discount_missing', message: 'The Packs checkout discount is not installed on this store.' }, loadError: null } },
    api: { status: () => ({ status: 403, body: { success: false, error: 'Publishing Packs requires an eligible plan.', code: 'plan_restricted' } }) },
  });
  await page.getByText('Checkout discount isn’t active yet').waitFor();
  assert.match(await page.locator('body').innerText(), /shoppers won’t see your active Packs/);
  await page.getByRole('button', { name: /Enable Pack for Tee/ }).click();
  await page.getByText('Publishing Packs requires an eligible plan.').waitFor();
  assert.deepEqual(calls.at(-1).body, { action: 'status', id: 2, status: 'active' });
  await context.close();
  const broken = await open({ start: '/app/packs', data: { list: { packs: [], planState: 'enabled', currency, checkoutDiscount: null, loadError: 'Packs storage is not set up yet. Run migrations/create_brix_packs.sql on the database (see CLAUDE.md).' } } });
  await broken.page.getByText('Couldn’t load your Packs').waitFor();
  assert.match(await broken.page.locator('body').innerText(), /create_brix_packs\.sql/);
  assert.equal(await broken.page.getByRole('button', { name: 'Try again' }).count(), 1);
  assert.equal(await broken.page.getByRole('button', { name: 'Create Pack' }).count(), 1); // only the page-header action, no duplicate empty-state CTA on an error
  await broken.context.close();
});

await check('builder: full 5-step create flow (product -> template -> tiers -> customization -> review -> save draft) sends a correct, server-verifiable payload', async () => {
  const { page, context, calls } = await open({
    start: '/app/packs/new', data: { ...builderData('preview'), detail: { pack: pack({ id: 77 }), planState: 'preview', currency, checkoutDiscount: null } }, picker: pickerResult,
    api: { ...productApi, ...previewApi, save: () => ({ body: { success: true, pack: pack({ id: 77 }), checkoutDiscount: null, warning: null } }) },
  });
  await page.getByRole('tab', { name: /Step 1: Product/ }).waitFor();
  // gating: cannot continue without product
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Choose a Shopify product and variant first.').waitFor();
  await pickProduct(page);
  assert.match(await page.locator('body').innerText(), /₹80\.00/);
  assert.match(await page.locator('body').innerText(), /In stock/);
  assert.match(await page.locator('body').innerText(), /25/); // inventory
  assert.match(await page.getByLabel('Variant').innerText(), /L — ₹100\.00 \(out of stock\)/);
  await page.getByRole('button', { name: 'Continue' }).click();
  // template step: three templates, pick visual_offer
  for (const name of ['Same Variant', 'Choose Each Item', 'Visual Offer']) assert.ok(await page.getByRole('radio', { name: new RegExp(name) }).count() > 0);
  await page.getByRole('radio', { name: /Visual Offer/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  // tiers step: default Buy1 / 5% / 10% with correct calculations in shop currency
  await page.getByText('Pack tiers').waitFor();
  const body = await page.locator('body').innerText();
  assert.match(body, /₹240\.00/); // normal subtotal of tier 3
  assert.match(body, /−₹24\.00/); // discount
  assert.match(body, /₹216\.00/); // pack price
  assert.match(body, /₹72\.00/); // per item
  await page.screenshot({ path: path.join(SHOT_DIR, 'admin_tiers.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  // customization step
  await page.getByText('Live preview').waitFor();
  await page.getByLabel('Accent / selected border', { exact: true }).fill('#ff0000');
  await page.getByLabel('Heading', { exact: true }).fill('Stock up & save');
  await page.screenshot({ path: path.join(SHOT_DIR, 'admin_customization.png'), fullPage: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  // review
  await page.getByText('Calculated by BRIX from the live Shopify price').waitFor();
  assert.match(await page.locator('table').innerText(), /₹216\.00/);
  assert.match(await page.locator('table').innerText(), /Buy 3/);
  // Free plan: activation is unavailable and explained; draft saving works
  assert.equal(await page.getByRole('button', { name: /Save & activate/ }).isDisabled(), true);
  await page.getByText('Publishing requires an eligible plan').waitFor();
  await page.screenshot({ path: path.join(SHOT_DIR, 'admin_review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await page.getByRole('heading', { name: 'Tee' }).waitFor(); // landed on the detail page
  assert.equal(await page.evaluate(() => window.__router.state.location.pathname), '/app/packs/77');
  const save = calls.find((call) => call.body?.action === 'save').body;
  assert.equal(save.status, 'draft');
  assert.equal(save.productId, '100'); // numeric id, not a GID
  assert.equal(save.variantId, '200');
  assert.equal(save.template, 'visual_offer');
  assert.equal(save.id, null);
  assert.equal(save.tiers.length, 3);
  assert.equal(save.customization.colors.primary, '#ff0000');
  assert.equal(save.customization.content.heading, 'Stock up & save');
  // nested defaults survived the colour/heading edit (no shallow-merge loss)
  assert.equal(save.customization.typography.headingSize, 20);
  assert.equal(save.customization.spacing.cardGap, 10);
  assert.equal(save.customization.borders.radius, 8);
  assert.equal(save.customization.colors.text, '#202223');
  assert.equal('price' in save, false); // never sends a browser-computed price
  await context.close();
});

await check('tiers: inline validation (quantity, duplicates, percentage, fixed) blocks progress; add/remove limits; sorting', async () => {
  const { page, context } = await open({ start: '/app/packs/new', data: builderData(), picker: pickerResult, api: { ...productApi, ...previewApi } });
  await pickProduct(page);
  await page.getByRole('tab', { name: /Step 3: Tiers/ }).click();
  await page.getByText('Pack tiers').waitFor();
  const qty = page.getByLabel('Quantity');
  await qty.nth(1).fill('3'); // duplicate of tier 3
  await page.getByText('Each tier needs a unique quantity.').first().waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText(/Fix the Pack tiers first/).waitFor();
  await qty.nth(1).fill('2');
  await qty.nth(0).fill('0');
  await page.getByText('Quantity must be a positive whole number.').first().waitFor();
  await qty.nth(0).fill('1.5');
  await page.getByText('Quantity must be a positive whole number.').first().waitFor();
  await qty.nth(0).fill('1');
  await page.getByLabel('Value').nth(1).fill('150');
  await page.getByText('Percentage must be greater than 0 and at most 100.').waitFor();
  await page.getByLabel('Value').nth(1).fill('5');
  await page.getByLabel('Discount').nth(1).selectOption('fixed');
  await page.getByLabel('Value').nth(1).fill('9999');
  await page.getByText('Fixed discount cannot be larger than the Pack subtotal.').waitFor();
  await page.getByLabel('Value').nth(1).fill('20');
  assert.equal(await page.getByText('Fixed discount cannot be larger than the Pack subtotal.').count(), 0);
  assert.match(await page.locator('body').innerText(), /₹140\.00/); // 160 - 20
  // ordering: typing a smaller quantity into the last tier and leaving the field sorts the list
  await qty.nth(2).fill('1');
  await qty.nth(2).blur();
  await qty.nth(2).fill('7');
  await qty.nth(2).blur();
  // add up to the limit of 6 tiers
  for (let i = 0; i < 5; i += 1) { const add = page.getByRole('button', { name: 'Add tier' }); if (await add.isDisabled()) break; await add.click(); }
  assert.equal(await page.getByRole('button', { name: 'Add tier' }).isDisabled(), true);
  assert.equal(await page.getByLabel('Quantity').count(), 6);
  await page.getByRole('button', { name: /Remove tier 6/ }).click();
  assert.equal(await page.getByLabel('Quantity').count(), 5);
  // 'none' discount disables the value field
  await page.getByLabel('Discount').nth(0).selectOption('none');
  assert.equal(await page.getByLabel('Value').nth(0).isDisabled(), true);
  await context.close();
});

await check('customization: invalid values are reported and block continuing; preview reflects valid ones', async () => {
  const { page, context } = await open({ start: '/app/packs/new', data: builderData(), picker: pickerResult, api: { ...productApi, ...previewApi } });
  await pickProduct(page);
  await page.getByRole('tab', { name: /Step 4: Customization/ }).click();
  await page.getByText('Live preview').waitFor();
  await page.getByLabel('Button color', { exact: true }).fill('not-a-color');
  await page.getByText('colors.button must be a hex color like #008060.').first().waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText(/Fix the customization first/).waitFor();
  await page.getByLabel('Button color', { exact: true }).fill('#123456');
  await page.getByLabel('Corner radius').fill('999');
  await page.getByText('borders.radius must be between 0 and 32.').first().waitFor();
  await page.getByLabel('Corner radius').fill('12');
  await page.getByLabel('Button label').fill('Grab this pack');
  assert.equal(await page.getByRole('button', { name: 'Grab this pack' }).count(), 1);
  const bg = await page.getByRole('button', { name: 'Grab this pack' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, 'rgb(18, 52, 86)');
  // image controls only exist for the template that renders them
  assert.match(await page.locator('body').innerText(), /Image options are available with the Visual Offer template/);
  await context.close();
});

await check('edit: opens at ?step=customization with the pack prefilled; active pack saves with status "keep"; duplicate -> clear banner + link to existing pack', async () => {
  const active = pack({ id: 55, status: 'active', displayStatus: 'active', enabled: true, customization: { ...defaultCustomization(), content: { ...defaultCustomization().content, heading: 'Saved heading' } } });
  const { page, context, calls } = await open({
    start: '/app/packs/55/edit', data: { edit: { pack: active, shop: SHOP, planState: 'enabled', currency }, detail: { pack: active, planState: 'enabled', currency, checkoutDiscount: null } },
    api: { ...productApi, ...previewApi, save: (body) => (body.variantId === '201' ? { status: 409, body: { success: false, error: 'A Pack already exists for this product and variant. Edit the existing Pack instead.', code: 'duplicate', details: { existingId: 9 } } } : { body: { success: true, pack: active, checkoutDiscount: { verified: true, state: 'active' }, warning: null } }) },
  });
  await page.getByRole('tab', { name: /Step 1: Product/ }).waitFor();
  assert.equal(await page.getByRole('tab', { name: /Step 1: Product/ }).getAttribute('aria-selected'), 'true');
  await page.getByLabel('Variant').waitFor();
  assert.equal(await page.getByLabel('Variant').inputValue(), '200'); // prefilled
  await context.close();
  const step = await open({
    start: '/app/packs/55/edit?step=customization', data: { edit: { pack: active, shop: SHOP, planState: 'enabled', currency }, detail: { pack: active, planState: 'enabled', currency, checkoutDiscount: null } },
    api: { ...productApi, ...previewApi, save: (body) => (body.variantId === '201' ? { status: 409, body: { success: false, error: 'A Pack already exists for this product and variant. Edit the existing Pack instead.', code: 'duplicate', details: { existingId: 9 } } } : { body: { success: true, pack: active, checkoutDiscount: { verified: true, state: 'active' }, warning: null } }) },
  });
  await step.page.getByText('Live preview').waitFor();
  assert.equal(await step.page.getByLabel('Heading', { exact: true }).inputValue(), 'Saved heading');
  await step.page.getByRole('tab', { name: /Step 1: Product/ }).click();
  await step.page.getByLabel('Variant').selectOption('201'); // L (out of stock but draft-able) -> triggers duplicate mock
  await step.page.getByRole('tab', { name: /Step 5: Review/ }).click();
  await step.page.getByRole('button', { name: 'Save changes' }).waitFor();
  await step.page.getByRole('button', { name: 'Save changes' }).click();
  await step.page.getByText('This product variant already has a Pack').waitFor();
  await step.page.getByRole('button', { name: 'Open existing Pack' }).click();
  assert.equal(await step.page.evaluate(() => window.__navCalls.at(-1)), '/app/packs/9/edit');
  assert.equal(step.calls.find((call) => call.body?.action === 'save').body.status, 'keep');
  assert.equal(step.calls.find((call) => call.body?.action === 'save').body.id, 55);
  await step.context.close();
});

await check('review: server-side preview errors are shown; Starter/Pro can save & activate; activation payload is only a request', async () => {
  const { page, context, calls } = await open({
    start: '/app/packs/new', data: { ...builderData('enabled'), detail: { pack: pack({ id: 88, status: 'active', displayStatus: 'active' }), planState: 'enabled', currency, checkoutDiscount: { verified: false, state: 'discount_missing', message: 'The Packs checkout discount is not installed on this store.' } } }, picker: pickerResult,
    api: { ...productApi, ...previewApi, save: () => ({ body: { success: true, pack: pack({ id: 88, status: 'active', displayStatus: 'active' }), checkoutDiscount: { verified: false, state: 'discount_missing', message: 'The Packs checkout discount is not installed on this store.' }, warning: { code: 'function_not_deployed', message: 'The BRIX Packs checkout discount function is not deployed to this store yet.' } } }) },
  });
  await pickProduct(page);
  await page.getByRole('tab', { name: /Step 5: Review/ }).click();
  await page.getByText('Calculated by BRIX from the live Shopify price').waitFor();
  assert.equal(await page.getByRole('button', { name: /Save & activate/ }).isDisabled(), false);
  await page.getByRole('button', { name: /Save & activate/ }).click();
  await page.getByText('Checkout discount needs attention').waitFor(); // detail page surfaces the sync warning
  assert.match(await page.locator('body').innerText(), /function is not deployed to this store yet/);
  assert.match(await page.locator('body').innerText(), /Shoppers won’t see this Pack until the discount is verified/);
  assert.equal(calls.find((call) => call.body?.action === 'save').body.status, 'active');
  await context.close();
});

await check('detail: shows tiers/price math and status; delete waits for the server, shows failures, and only navigates on success', async () => {
  let attempt = 0;
  const { page, context, calls } = await open({
    start: '/app/packs/55', data: { detail: { pack: pack({ id: 55 }), planState: 'enabled', currency, checkoutDiscount: null }, list: { packs: [], planState: 'enabled', currency, checkoutDiscount: null, loadError: null } },
    api: { delete: async () => { attempt += 1; await new Promise((resolve) => setTimeout(resolve, 600)); return attempt === 1 ? { status: 503, body: { success: false, error: 'Could not reach Packs storage. Please try again in a moment.', code: 'database_error' } } : { body: { success: true, deleted: true } }; } },
  });
  await page.getByText('Pack tiers').waitFor();
  const table = await page.locator('table').innerText();
  assert.match(table, /Family pack/);
  assert.match(table, /₹240\.00/);
  assert.match(table, /₹216\.00/);
  assert.match(table, /₹72\.00/);
    await page.screenshot({ path: path.join(SHOT_DIR, 'admin_detail.png'), fullPage: true });
  await page.getByRole('button', { name: 'Delete' }).first().click();
  await page.getByRole('button', { name: 'Delete Pack' }).click();
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__router.state.location.pathname), '/app/packs/55'); // still here while the request is pending
  await page.getByText('Couldn’t delete this Pack').waitFor();
  assert.match(await page.locator('body').innerText(), /Could not reach Packs storage/);
  assert.equal(await page.evaluate(() => window.__router.state.location.pathname), '/app/packs/55'); // failure: no navigation
  await page.getByRole('button', { name: 'Delete Pack' }).click();
  await page.waitForFunction(() => window.__router.state.location.pathname === '/app/packs', null, { timeout: 5000 });
  assert.equal(calls.filter((call) => call.body?.action === 'delete').length, 2);
  await context.close();
});

await check('detail: Free plan cannot enable; enabling posts the request; invalid pack ids never reach the UI silently', async () => {
  const free = await open({ start: '/app/packs/55', data: { detail: { pack: pack({ id: 55 }), planState: 'preview', currency, checkoutDiscount: null }, edit: { pack: pack({ id: 55 }), shop: SHOP, planState: 'preview', currency } } });
  await free.page.getByText('Pack tiers').waitFor();
  assert.match(await free.page.locator('body').innerText(), /Preview mode/);
  assert.equal(await free.page.getByRole('button', { name: 'Enable' }).isDisabled(), true);
  await free.page.getByRole('button', { name: 'Customize' }).click();
  assert.equal(await free.page.evaluate(() => window.__navCalls.at(-1)), '/app/packs/55/edit?step=customization');
  await free.page.getByRole('tab', { name: /Step 4: Customization/ }).waitFor();
  assert.equal(await free.page.getByRole('tab', { name: /Step 4: Customization/ }).getAttribute('aria-selected'), 'true'); // deep link opened the customization step
  await free.context.close();
});

await check('drafts: autosave -> stale draft is OFFERED (not applied) -> restore / discard; scoped per pack; autosave keeps working after discard', async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const key = (id) => `brix-packs-draft:${SHOP}:${id}`;
  const load = (start, data) => open({ start, data, context, picker: pickerResult, api: { ...productApi, ...previewApi } });
  let { page } = await load('/app/packs/new', builderData());
  await page.getByRole('tab', { name: /Step 4: Customization/ }).click().catch(() => {});
  await pickProduct(page);
  await page.getByRole('tab', { name: /Step 4: Customization/ }).click();
  await page.getByLabel('Heading', { exact: true }).fill('My draft heading');
  await page.waitForTimeout(900);
  assert.ok(await page.evaluate((k) => localStorage.getItem(k), key('new')), 'draft should be autosaved to localStorage');
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('brix-packs-draft')).length), 1);
  await page.close();
  // a fresh "Create Pack" must NOT silently show the old draft — it only offers it
  ({ page } = await load('/app/packs/new', builderData()));
  await page.getByText('Unsaved draft found').waitFor();
  await page.getByRole('tab', { name: /Step 4: Customization/ }).click().catch(() => {});
  assert.notEqual(await page.getByLabel('Heading', { exact: true }).inputValue().catch(() => 'n/a'), 'My draft heading');
  await page.getByRole('button', { name: 'Restore draft' }).click();
  await page.getByText(/Draft restored/).waitFor();
  await page.getByRole('tab', { name: /Step 4: Customization/ }).click();
  assert.equal(await page.getByLabel('Heading', { exact: true }).inputValue(), 'My draft heading');
  await page.close();
  // another pack's editor must not see the "new" draft (different key)
  const other = pack({ id: 55 });
  ({ page } = await load('/app/packs/55/edit', { edit: { pack: other, shop: SHOP, planState: 'enabled', currency } }));
  await page.getByRole('tab', { name: /Step 1: Product/ }).waitFor();
  assert.equal(await page.getByText('Unsaved draft found').count(), 0);
  await page.close();
  // discard removes it for good
  ({ page } = await load('/app/packs/new', builderData()));
  await page.getByText('Unsaved draft found').waitFor();
  await page.getByRole('button', { name: 'Discard draft' }).click();
  assert.equal(await page.getByText('Unsaved draft found').count(), 0);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), key('new')), null);
  // regression (skipLocalDraft): after discarding/resetting, further edits must autosave again
  await pickProduct(page);
  await page.getByRole('tab', { name: /Step 4: Customization/ }).click();
  await page.getByLabel('Heading', { exact: true }).fill('Edit after reset');
  await page.waitForTimeout(900);
  assert.ok(await page.evaluate((k) => localStorage.getItem(k), key('new')));
  await page.getByRole('button', { name: 'Discard changes' }).click().catch(() => {});
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard changes' }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByLabel('Heading', { exact: true }).fill('Second edit');
  await page.waitForTimeout(900);
  const stored = await page.evaluate((k) => localStorage.getItem(k), key('new'));
  assert.match(stored, /Second edit/);
  await context.close();
});

await check('drafts: stale local draft older than the saved pack is dropped in edit mode; successful save clears the draft', async () => {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const key = `brix-packs-draft:${SHOP}:55`;
  const stalePack = pack({ id: 55, updatedAt: '2026-06-01T00:00:00Z' });
  const stale = { savedAt: Date.parse('2026-01-01T00:00:00Z'), form: { productId: '100', productTitle: 'Tee', productImage: '', variantId: '200', template: 'visual_offer', tiers: [], customization: defaultCustomization() } };
  await context.addInitScript(({ key, stale }) => { if (!localStorage.getItem('__seeded')) { localStorage.setItem(key, JSON.stringify(stale)); localStorage.setItem('__seeded', '1'); } }, { key, stale });
  const { page } = await open({ start: '/app/packs/55/edit', data: { edit: { pack: stalePack, shop: SHOP, planState: 'enabled', currency } }, context, api: { ...productApi, ...previewApi } });
  await page.getByRole('tab', { name: /Step 1: Product/ }).waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.getByText('Unsaved draft found').count(), 0);
  assert.equal(await page.evaluate((k) => localStorage.getItem(k), key), null);
  await context.close();
});

await check('mobile (375px): list, builder steps and review have no horizontal overflow', async () => {
  const viewport = { width: 375, height: 800 };
  const list = await open({ viewport, start: '/app/packs', data: { list: { packs: [pack({ id: 1 }), pack({ id: 2, productTitle: 'A much longer product title for wrapping', variantTitle: 'Midnight blue / XL' })], planState: 'enabled', currency, checkoutDiscount: null, loadError: null } } });
  await list.page.getByText('A much longer product title for wrapping').waitFor();
  const wide = await list.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // the IndexTable scrolls inside its own container; the PAGE must not
  assert.ok(wide <= 0, `list page overflows by ${wide}px`);
  await list.page.screenshot({ path: path.join(SHOT_DIR, 'admin_mobile_list.png') });
  await list.context.close();
  const builder = await open({ viewport, start: '/app/packs/new', data: builderData(), picker: pickerResult, api: { ...productApi, ...previewApi } });
  await pickProduct(builder.page);
  for (const [index, label] of [[2, /Step 3: Tiers/], [3, /Step 4: Customization/], [4, /Step 5: Review/]]) {
    await builder.page.getByRole('tab', { name: label }).click();
    await builder.page.waitForTimeout(400);
    const overflow = await builder.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `builder step ${index + 1} overflows by ${overflow}px`);
    await builder.page.screenshot({ path: path.join(SHOT_DIR, `admin_mobile_step${index + 1}.png`), fullPage: true });
  }
  await builder.context.close();
});

await browser.close();
const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

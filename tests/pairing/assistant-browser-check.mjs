/* eslint-env node */
// Real-browser check of the Pairing Assistant ("Describe in words" / "From
// past orders") on the REAL FBT page and the REAL Cart Editor Upsell section,
// bundled by tests/pairing/harness (Vite) with server modules stubbed. The
// /api/pairing-assistant answers and the FBT page's own save are mocked, so
// no store, database or model is touched. Run from the repo root:
//   node tests/pairing/assistant-browser-check.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(process.cwd(), 'tests', 'pairing', 'harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const shotDir = path.join(os.tmpdir(), 'brix-pairing');
fs.mkdirSync(shotDir, { recursive: true });

const gid = (n) => `gid://shopify/Product/${n}`;
const prod = (n, title, active = true) => ({ id: gid(n), title, handle: title.toLowerCase().replace(/\s+/g, '-'), image: '', price: '499.00', active });
const JOGGERS = prod(1, 'Boys Joggers');
const SOCKS = prod(2, 'Ankle Socks');
const CAP = prod(3, 'Summer Cap');
const OLD = prod(9, 'Old Tee', false);

const ORDERS = {
  success: true, intent: 'orders', days: 90, totalOrders: 120, multiItemOrders: 48, shopifyOrders: 80, recordedOrders: 52, stoppedEarly: false,
  pairs: [
    { a: JOGGERS, b: SOCKS, together: 21, aOrders: 40, bOrders: 30, aToB: 53, bToA: 70, lift: 2.1 },
    { a: JOGGERS, b: CAP, together: 9, aOrders: 40, bOrders: 20, aToB: 23, bToA: 45, lift: 1.4 },
    { a: SOCKS, b: OLD, together: 4, aOrders: 30, bOrders: 6, aToB: 13, bToA: 67, lift: 2.6 },
  ],
};
const promptReply = () => ({
  success: true, intent: 'prompt', usedAi: true, question: null,
  warnings: ['No product called "Unicorn Hat" in your store (recommend).'],
  rules: [
    { name: 'Boys Joggers', allProducts: false, triggerProducts: [JOGGERS], offerProducts: [SOCKS, CAP], basis: 'prompt' },
    { name: 'All products', allProducts: true, triggerProducts: [], offerProducts: [CAP], basis: 'prompt' },
  ],
});

const fbtData = {
  shop: 'demo.myshopify.com',
  allProducts: [JOGGERS, SOCKS, CAP].map((p) => ({ id: p.id, title: p.title, handle: p.handle, image: p.image, price: p.price })),
  manualRules: [{ id: 1, name: 'Existing', displayScope: 'per_product', triggerProducts: [SOCKS], fbtProducts: [JOGGERS] }],
  fbtEmbedEnabled: true,
  hasSavedFbtConfig: true,
  fbtConfig: {
    is_enabled: 1, activeTemplate: 'fbt1', mode: 'manual', layout: 'horizontal', interactionType: 'classic', showPrices: true, showAddAllButton: true,
    bgColor: '#ffffff', textColor: '#111827', priceColor: '#059669', buttonColor: '#111827', buttonTextColor: '#ffffff', borderColor: '#e5e7eb',
    borderRadius: 8, aiEnabled: false, aiProductCount: 3, widgetPlacement: 'above_cart',
  },
};

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (error) { results.push(false); console.log('  ✗', name, '\n     ', String(error.message).split('\n').slice(0, 6).join('\n      ')); }
};

const browser = await chromium.launch();

const AI_COVERAGE = {
  totalProducts: 40, productsCovered: 31, productsSkipped: 9, truncated: false, pinnedProducts: 2,
  instructions: { rules: 1, warnings: ['No product called "Unicorn Hat" in your store (recommend).'], fromCache: false },
};

async function open(start, { width = 1280, fbt = fbtData } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage();
  const posts = { assistant: [], fbt: [] };
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((d) => {
    window.__DATA__ = d;
    try { localStorage.setItem('cn_fbt_setup_tour_dismissed:demo.myshopify.com', '1'); } catch { /* ignore */ }
  }, { start, fbt, allProducts: fbtData.allProducts, upsellRecord: { is_enabled: 1, display_limit: 2, manual_rules: [] } });
  await page.route('http://harness.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/harness/pairing-assistant') {
      const body = JSON.parse(route.request().postData());
      posts.assistant.push(body);
      const reply = body.intent === 'orders' ? ORDERS : promptReply();
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(reply) });
    }
    if (url.pathname === '/harness/fbt-action') {
      const body = JSON.parse(route.request().postData());
      posts.fbt.push(body);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, aiCoverage: body.regenerateAi ? AI_COVERAGE : null, offerSync: { state: 'not_deployed', message: 'The bundle offer discount is not installed on this store yet.' } }) });
    }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://harness.test/');
  return { page, context, posts, errors };
}

async function openFbtConfigure(page) {
  await page.getByRole('button', { name: 'Configure', exact: true }).first().click();
  await page.getByRole('dialog').getByText('Frequently Bought Together — Configuration').waitFor();
}

console.log('\nPairing Assistant — FBT page');

await check('FBT Manual mode offers Pick products / Describe in words / From past orders; Pick is the default', async () => {
  const { page, context, errors } = await open('/app/fbt');
  await openFbtConfigure(page);
  const dialog = page.getByRole('dialog');
  for (const name of ['Pick products', 'Describe in words', 'From past orders']) await dialog.getByRole('button', { name, exact: true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Pick products', exact: true }).getAttribute('aria-pressed'), 'true');
  await dialog.getByText('Trigger products').first().waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Describe in words: prompt is posted, suggested rules + warnings shown, chosen ones join Saved rules and Save posts them', async () => {
  const { page, context, posts, errors } = await open('/app/fbt');
  await openFbtConfigure(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Describe in words', exact: true }).click();
  await dialog.getByRole('button', { name: 'Show socks with every jogger' }).click();
  assert.equal(await dialog.getByLabel('Describe what should be recommended with what').inputValue(), 'Show socks with every jogger');
  await dialog.getByRole('button', { name: 'Suggest rules' }).click();
  await dialog.getByText('Suggested rules (2)').waitFor();
  assert.deepEqual(posts.assistant[0], { intent: 'prompt', prompt: 'Show socks with every jogger', maxOffers: 3 });
  await dialog.getByText('No product called "Unicorn Hat"').waitFor();
  await dialog.getByText('Every product', { exact: true }).first().waitFor();
  await page.screenshot({ path: path.join(shotDir, 'fbt-describe.png') });
  // Untick the "every product" rule, add the other.
  await dialog.getByRole('checkbox').nth(1).uncheck({ force: true });
  await dialog.getByRole('button', { name: 'Add 1 rule' }).click();
  await dialog.getByText('1 rule added. Save to publish.').waitFor();
  await dialog.getByText('Saved rules (2)').waitFor();
  await dialog.getByText('Already added').waitFor();
  // Save from the modal's primary action posts both rules.
  await page.getByRole('button', { name: /^(Save|Save & close|Done|Save configuration)$/ }).last().click();
  await page.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 400));
  const saved = posts.fbt.at(-1);
  assert.ok(saved, 'FBT save posted');
  assert.equal(saved.mode, 'manual');
  assert.equal(saved.manualRules.length, 2);
  const added = saved.manualRules[1];
  assert.equal(added.displayScope, 'per_product');
  assert.deepEqual(added.triggerProducts.map((p) => p.title), ['Boys Joggers']);
  assert.deepEqual(added.fbtProducts.map((p) => p.title), ['Ankle Socks', 'Summer Cap']);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('From past orders: pairs with order counts and shares; one-way, both-ways and inactive products', async () => {
  const { page, context, posts, errors } = await open('/app/fbt');
  await openFbtConfigure(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'From past orders', exact: true }).click();
  await dialog.getByText('Boys Joggers + Ankle Socks').waitFor();
  assert.deepEqual(posts.assistant[0], { intent: 'orders', days: 90, fresh: false });
  await dialog.getByText('120 orders checked (48 with 2 or more products)', { exact: false }).waitFor();
  await dialog.getByText('Together in 21 orders · 53% of Boys Joggers orders · 70% of Ankle Socks orders').waitFor();
  await dialog.getByText('Not active').waitFor();
  await page.screenshot({ path: path.join(shotDir, 'fbt-orders.png') });
  // Existing rule is Socks → Joggers, so that direction shows as added already.
  assert.equal(await dialog.getByRole('button', { name: 'Added' }).count(), 1);
  // Joggers + Cap has neither direction yet: "Both ways" adds two rules.
  assert.equal(await dialog.getByRole('button', { name: 'Both ways' }).count(), 1);
  await dialog.getByRole('button', { name: 'Both ways' }).click();
  await dialog.getByText('Saved rules (3)').waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Added' }).count(), 3);
  // The open direction of Joggers + Socks adds one more.
  await dialog.getByRole('button', { name: 'On Boys Joggers, show Ankle Socks' }).click();
  await dialog.getByText('Saved rules (4)').waitFor();
  assert.equal(await dialog.getByRole('button', { name: 'Both ways' }).count(), 0);
  // Period change re-reads.
  await dialog.getByLabel('Orders from').selectOption('365');
  await page.waitForFunction(() => true);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(posts.assistant.at(-1).days, 365);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('From past orders: bulk "Add N rules (top 3 per product)" adds one rule per active product, skipping existing', async () => {
  const { page, context, errors } = await open('/app/fbt');
  await openFbtConfigure(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'From past orders', exact: true }).click();
  // Joggers → Socks, Cap; Socks → Joggers (exists already); Cap → Joggers. Old Tee inactive.
  await dialog.getByRole('button', { name: 'Add 2 rules (top 3 per product)' }).click();
  await dialog.getByText('Saved rules (3)').waitFor();
  await dialog.getByRole('button', { name: 'All added' }).waitFor();
  assert.deepEqual(errors, []);
  await context.close();
});

await check('AI-Powered: instructions box; Configure AI sends them with regenerateAi and shows what they became', async () => {
  const { page, context, posts, errors } = await open('/app/fbt');
  await openFbtConfigure(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'AI-Powered' }).click();
  const box = dialog.getByLabel('Your instructions (optional)');
  await box.waitFor();
  await box.fill('Always show socks with joggers');
  await dialog.getByRole('button', { name: 'For the Summer collection, recommend what customers usually buy with each product' }).click();
  assert.equal(await box.inputValue(), 'Always show socks with joggers\nFor the Summer collection, recommend what customers usually buy with each product');
  await dialog.getByRole('button', { name: 'Configure AI' }).click();
  await dialog.getByText('Recommendations ready for 31 of 40 products.', { exact: false }).waitFor();
  await dialog.getByText('Your instructions became 1 rule, applied first on 2 products.', { exact: false }).waitFor();
  await dialog.getByText('No product called "Unicorn Hat"').waitFor();
  const saved = posts.fbt.at(-1);
  assert.equal(saved.mode, 'ai');
  assert.equal(saved.regenerateAi, true);
  assert.equal(saved.aiInstructions, 'Always show socks with joggers\nFor the Summer collection, recommend what customers usually buy with each product');
  await page.screenshot({ path: path.join(shotDir, 'fbt-ai-instructions.png') });
  assert.deepEqual(errors, []);
  await context.close();
});

await check('AI-Powered: saved instructions come back on reload and plain Save keeps them without regenerating', async () => {
  const fbt = { ...fbtData, fbtConfig: { ...fbtData.fbtConfig, mode: 'ai', aiEnabled: true, aiInstructions: 'Cap with every product' } };
  const { page, context, posts, errors } = await open('/app/fbt', { fbt });
  await openFbtConfigure(page);
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByLabel('Your instructions (optional)').inputValue(), 'Cap with every product');
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();
  await new Promise((r) => setTimeout(r, 400));
  const saved = posts.fbt.at(-1);
  assert.equal(saved.aiInstructions, 'Cap with every product');
  assert.ok(!saved.regenerateAi, 'a plain Save does not re-run AI');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Bundle offer: switch on, % and text; preview shows the offer; Save sends it and shows Shopify\'s state', async () => {
  const { page, context, posts, errors } = await open('/app/fbt');
  await page.getByRole('button', { name: /Bundle offer/ }).first().click();
  await page.getByText('Give an offer when everything is bought together').click();
  assert.equal(await page.getByLabel('Give an offer when everything is bought together').isChecked(), true);
  await page.getByLabel('Percent off').fill('15');
  await page.getByLabel('Text on the widget').fill('Take all {count}, save {discount}');
  await page.waitForTimeout(200);
  const pv = await page.locator('.fbtpv-offer').textContent();
  assert.equal(pv, 'Take all 4, save 15%', 'preview: 3 products + the one viewed');
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await new Promise((r) => setTimeout(r, 500));
  const saved = posts.fbt.at(-1);
  assert.deepEqual(saved.offer, { enabled: true, type: 'percentage', value: 15, text: 'Take all {count}, save {discount}' });
  await page.getByText('The bundle offer discount is not installed on this store yet.').waitFor();
  await page.screenshot({ path: path.join(shotDir, 'fbt-offer.png') });
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Saved rule: own offer (% off this set) is sent with the rule', async () => {
  const { page, context, posts, errors } = await open('/app/fbt');
  await openFbtConfigure(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Offer', { exact: true }).selectOption('percentage');
  await dialog.getByLabel('Offer value').fill('20');
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();
  await new Promise((r) => setTimeout(r, 500));
  const r0 = posts.fbt.at(-1).manualRules[0];
  assert.equal(r0.offerMode, 'percentage');
  assert.equal(Number(r0.offerValue), 20);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Images and spacing: preview follows; Save sends them in the template', async () => {
  const { page, context, posts, errors } = await open('/app/fbt');
  await page.getByRole('button', { name: /Styling & Display/ }).first().click();
  await page.getByLabel('Image size').fill('100');
  await page.getByLabel('Image corners').fill('50');
  await page.getByLabel('Image fit').selectOption('cover');
  await page.getByLabel('Padding inside the widget').fill('30');
  await page.getByLabel('Space between products').fill('22');
  await page.waitForTimeout(200);
  const pv = await page.evaluate(() => {
    const img = document.querySelector('.fbtpv-img');
    const w = document.querySelector('.fbtpv-widget');
    return { h: getComputedStyle(img).height, r: getComputedStyle(img).borderTopLeftRadius, pad: getComputedStyle(w).paddingTop };
  });
  assert.deepEqual(pv, { h: '100px', r: '50px', pad: '30px' });
  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await new Promise((r) => setTimeout(r, 500));
  const tpl = posts.fbt.at(-1).templates.fbt1;
  assert.deepEqual([tpl.imageSize, tpl.imageRadius, tpl.imageFit, tpl.widgetPadding, tpl.gap, tpl.marginTop], [100, 50, 'cover', 30, 22, 16]);
  assert.deepEqual(errors, []);
  await context.close();
});

console.log('\nPairing Assistant — Cart Editor upsell');

await check('Upsell manual rules: "Describe in words" opens the assistant; added rules use the upsell shape and the cart limit', async () => {
  const { page, context, posts, errors } = await open('/app/cartdrawer');
  await page.getByText('Manual Upsell Rules').waitFor();
  await page.getByRole('button', { name: 'Describe in words' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Create upsell rules').waitFor();
  await dialog.getByLabel('Describe what should be recommended with what').fill('joggers with socks and cap');
  await dialog.getByRole('button', { name: 'Suggest rules' }).click();
  await dialog.getByText('Suggested rules (2)').waitFor();
  assert.equal(posts.assistant[0].maxOffers, 2, 'uses the section\'s "Max upsells to show"');
  await dialog.getByRole('button', { name: 'Add 2 rules' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const rules = await page.evaluate(() => window.__upsellRules);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].triggerType, 'specific');
  assert.deepEqual(rules[0].triggerProductIds, [gid(1)]);
  assert.deepEqual(rules[0].upsellProductIds, [gid(2), gid(3)]);
  assert.equal(rules[0].upsellProductDetails[0].title, 'Ankle Socks');
  assert.equal(rules[1].triggerType, 'all');
  // Rule cards now name the products instead of "N products selected".
  assert.ok(await page.getByText('Ankle Socks, Summer Cap', { exact: true }).count() >= 1);
  await page.screenshot({ path: path.join(shotDir, 'cart-upsell.png') });
  assert.deepEqual(errors, []);
  await context.close();
});

await check('Upsell: "From past orders" opens straight on the orders tab and adds a one-way rule', async () => {
  const { page, context, errors } = await open('/app/cartdrawer');
  await page.getByRole('button', { name: 'From past orders' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Boys Joggers + Ankle Socks').waitFor();
  await dialog.getByRole('button', { name: 'On Ankle Socks, show Boys Joggers' }).click();
  await dialog.getByRole('button', { name: 'Added' }).waitFor();
  const rules = await page.evaluate(() => window.__upsellRules);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].triggerProductIds, [gid(2)]);
  assert.deepEqual(rules[0].upsellProductIds, [gid(1)]);
  assert.deepEqual(errors, []);
  await context.close();
});

await check('phone width: the assistant fits without sideways scrolling', async () => {
  const { page, context } = await open('/app/cartdrawer', { width: 390 });
  await page.getByRole('button', { name: 'From past orders' }).click();
  await page.getByRole('dialog').getByText('Boys Joggers + Ankle Socks').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: path.join(shotDir, 'cart-orders-phone.png') });
  assert.ok(overflow <= 1, `page scrolls sideways by ${overflow}px`);
  await context.close();
});

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed · screenshots in ${shotDir}`);
process.exit(passed === results.length ? 0 : 1);

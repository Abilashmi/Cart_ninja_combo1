/* eslint-env node */
// Browser check for the builder's Quick Shop template (layout6): picker card,
// preview (the storefront's own renderer), measure picker, progress / bar
// style pickers, filters and what is saved.
// Run with: node tests/combo-weight/quickshop-builder-check.mjs
// Builds tests/combo-ai/harness (the REAL builder route with a mocked loader
// and mocked API routes); no store or server.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.join(process.cwd(), 'tests', 'combo-ai', 'harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(dist, p);
  if (p.startsWith('/assets/') && fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': `${MIME[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(dist, 'index.html')));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const SHOTS = path.resolve('tests/combo-weight/screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const P = (n) => `gid://shopify/Product/${n}`;
const QUANTITY = {
  measure: 'quantity', unit: 'kg', max_grams: null,
  tiers: [{ id: 't1', min_grams: 2, type: 'percentage', value: 5, label: '' }, { id: 't2', min_grams: 3, type: 'percentage', value: 10, label: 'FREE DELIVERY' }],
  messages: { unlocked: 'You unlocked {{tier}}' },
};

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();

async function open({ plan = 'pro', quickShop = QUANTITY, layout = 'layout7', fresh = false, shiprocket = false, viewport = { width: 1500, height: 1000 } } = {}) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.addInitScript(({ plan: pl, quickShop: q, layout: l, fresh: f, shiprocket: sr }) => {
    window.__SHIPROCKET = sr;
    window.__QUICK_SHOP_LAYOUT = l;
    window.shopify = { toast: { show: (message, opts) => { (window.__toasts = window.__toasts || []).push({ message, ...(opts || {}) }); } } };
    window.__PLAN = pl;
    if (q) window.__QUICK_SHOP = q;
    if (f) window.__NEW = true;
  }, { plan, quickShop, layout, fresh, shiprocket });
  await page.route('**/api/combo-ai-suggestions', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"enabled":false}}' }));
  await page.goto(`${base}/app/bundles/customize`);
  await page.waitForSelector(fresh ? '.tpl-pick-card' : '.bxq-card', { timeout: 20000 });
  return page;
}
const sidebar = (page) => page.textContent('.cst-sidebar-content');
const text = (page, sel) => page.textContent(sel).then((s) => (s || '').replace(/\s+/g, ' ').trim()).catch(() => '');
const tab = (page, name) => page.click(`.cst-sidebar-tab:has-text("${name}")`);
const section = (page, title) => page.click(`.cst-section-header:has-text("${title}")`);
const plus = (page, n) => page.click(`.bxq-card[data-product-id="${P(n)}"] [data-combo-action="qty-inc"]`);

// ── a saved Quantity Box (layout7, the box design): preview, styles, cards, filters, save ──
{
  const page = await open();
  check('preview shows both collections\' products', (await page.$$('.bxq-card')).length === 4, String((await page.$$('.bxq-card')).length));
  check('compare-at price + % OFF + badge on the serum', ((t) => t.includes('13% OFF') && t.includes('$799') && t.includes('Bestseller'))(await text(page, `.bxq-card[data-product-id="${P(3)}"]`)), await text(page, `.bxq-card[data-product-id="${P(3)}"]`));
  check('chips: All + both collections, Brand menu', ((t) => t.includes('Face Wash') && t.includes('Serums') && t.includes('Brand'))(await text(page, '.bxq-filters')));
  await page.click('[data-combo-action="qs-chip"][data-value="c:serums"]');
  check('chip filters the preview', (await page.$$('.bxq-card')).length === 2);
  await page.click('[data-combo-action="qs-chip"][data-value="all"]');

  await plus(page, 1);
  check('+ adds to the preview box and shows the bar', (await text(page, '.bxq-bar')).includes('1 Item'));
  check('bar: 1 item more for 5% OFF', (await text(page, '.bxq-msg')).includes('Add 1 item more to unlock 5% OFF'), await text(page, '.bxq-msg'));
  await plus(page, 3); await plus(page, 2);
  check('3 items: You unlocked FREE DELIVERY (merchant label)', (await text(page, '.bxq-msg')).includes('You unlocked FREE DELIVERY'), await text(page, '.bxq-msg'));
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-builder.png') });

  // Style tab: progress + bar styles
  await tab(page, 'Style');
  check('Style tab has Top progress, Bottom bar, Page colours', ((t) => t.includes('Top progress') && t.includes('Bottom bar') && t.includes('Page colours') && !t.includes('Theme Presets'))(await sidebar(page)));
  await section(page, 'Top progress');
  await page.click('[role="radiogroup"][aria-label="Style"] [role="radio"]:has-text("Steps")');
  check('Steps style shows in the preview', (await page.$$('.bxq-step')).length === 2);
  await page.click('[role="radiogroup"][aria-label="Style"] [role="radio"]:has-text("Hidden")');
  check('Hidden removes the top progress', (await page.$('.bxq-top')) === null);
  await section(page, 'Bottom bar');
  await page.click('[role="radiogroup"][aria-label="Style"] [role="radio"]:has-text("Ring")');
  check('Ring bar shows the item count', (await text(page, '.bxq-ring')) === '3');
  await page.getByLabel('Button text', { exact: true }).fill('View box');
  check('button text follows the setting', (await text(page, '.bxq-go')) === 'View box');
  check('no Shiprocket choice on a shop without Shiprocket', !(await sidebar(page)).includes('Checkout with'));
  // The box list the bar opens: its line prices can be hidden.
  await page.click('.bxq-bar [data-combo-action="box-open"]');
  check('box list shows each line\'s price by default', (await page.$$('.bxq-sheet .bxq-line-price')).length > 0);
  await page.getByLabel('Prices in the box list').uncheck();
  check('"Prices in the box list" off hides them, lines stay', (await page.$$('.bxq-sheet .bxq-line-price')).length === 0 && (await page.$$('.bxq-sheet .bxq-line')).length > 0);
  await page.getByLabel('Prices in the box list').check();
  await page.click('.bxq-bar [data-combo-action="box-close"]');

  // Clicking the bar opens its settings; clicking a card opens the card settings
  await page.click('.bxq-card .bxq-name');
  await page.waitForTimeout(150);
  check('clicking a card opens Product cards', (await sidebar(page)).includes('Columns (desktop)'));
  check('…and previews the product popup, inside the preview', (await page.$('.bxq-pop')) !== null
    && await page.evaluate(() => { const box = document.querySelector('.bxq-pop').getBoundingClientRect(); const pane = document.querySelector('.bxq').getBoundingClientRect(); return box.left >= pane.left - 30 && box.right <= pane.right + 30; }));
  check('the builder has the popup switch', (await sidebar(page)).includes('Open a product popup on tap'));
  await page.click('.bxq-pop-close');
  check('the popup closes', (await page.$('.bxq-pop')) === null);

  // Layout tab: filters
  await section(page, 'Filters');
  await page.getByLabel('Brand (vendor)').uncheck();
  check('turning Brand off removes it from the page', !(await text(page, '.bxq-filters')).includes('Brand'));

  // Layout → Product cards: the normal card (Add button under the price)
  await tab(page, 'Layout');
  if (!(await sidebar(page)).includes('Card layout')) await section(page, 'Product cards');
  await page.click('button[role="radio"]:has-text("Add button")');
  check('normal cards: an Add button under each card, no + on the image', (await page.$$('.bxq-card .bxq-cta')).length === 4 && (await page.$$('.bxq-card .bxq-add')).length === 0);
  check('normal cards: a card already in the box shows a stepper', (await page.$$('.bxq-cta--stepper')).length >= 1);
  await page.getByLabel('Add button text').fill('Add to box');
  check('Add button text follows the setting', (await text(page, '.bxq-card:not(.is-in) .bxq-cta')).startsWith('Add to box'));
  // Max of each product: the preview's + stops there and says why.
  await page.getByLabel('Max of each product').fill('1');
  check('max per product: the message field appears', (await sidebar(page)).includes('Message when a shopper reaches it'));
  check('max per product: + on a product already in the box is off', await page.$eval('.bxq-cta--stepper [data-combo-action="qty-inc"]', (b) => b.disabled));
  await page.getByLabel('Message when a shopper reaches it').fill('Only {{max}} of each');
  await page.$eval('.bxq-cta--stepper [data-combo-action="qty-inc"]', (b) => { b.disabled = false; b.click(); });
  await page.waitForTimeout(150);
  const limitToast = (await page.evaluate(() => (window.__toasts || []).map((t) => t.message))).at(-1);
  check('max per product: the preview refuses with the merchant\'s text', limitToast === 'Only 1 of each', limitToast);
  await page.getByLabel('Max of each product').fill('');
  check('max per product: emptied = no limit, + is back', !(await page.$eval('.bxq-cta--stepper [data-combo-action="qty-inc"]', (b) => b.disabled)));

  // Advanced: the Quantity Box is always priced by items
  await tab(page, 'Advanced');
  check('no count Progress Bar / AI sections for a box template', !(await sidebar(page)).includes('AI Settings') && !(await sidebar(page)).includes('Progress Bar'));
  await section(page, 'Offer');
  let offer = await sidebar(page);
  check('Quantity Box: priced by items, no measure picker', offer.includes('The Quantity Box is priced by the number of items') && !(await page.$('input[type="radio"][value="value"]')));
  await page.getByRole('button', { name: /Buy N for/ }).click();
  offer = await sidebar(page);
  check('"Buy N for X" adds a box price tier and sets the max items', offer.includes('Price of the whole box') && offer.includes('(max 4 items)'), offer.match(/2 items\+[^)]*\)/)?.[0]);
  check('rare settings are under More options', !offer.includes('Which products count toward the box'));
  await page.click('button:has-text("More options")');
  check('More options opens them', (await sidebar(page)).includes('Which products count toward the box'));

  await page.click('button:has-text("Save Template")');
  await page.waitForSelector('text=Template Title');
  await page.click('.Polaris-Modal-Dialog button:has-text("Save")');
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => window.__SAVED?.[0]);
  const config = saved ? JSON.parse(saved.customization_data) : {};
  check('saved: layout7, box-priced, measured by quantity, with the box price tier', config.layout === 'layout7' && config.pricing_mode === 'weight' && config.weight_pricing?.measure === 'quantity' && config.weight_pricing?.tiers?.some((t) => t.type === 'fixed_price' && t.min_grams === 4), JSON.stringify({ layout: config.layout, measure: config.weight_pricing?.measure, tiers: config.weight_pricing?.tiers }));
  check('saved: the style choices', config.qs_top_style === 'none' && config.qs_bar_style === 'ring' && config.qs_btn_label === 'View box' && config.qs_filter_brand === false && config.qs_card_layout === 'normal' && config.qs_add_label === 'Add to box');
  await page.close();
}

// ── picker: three box templates, each with its preset ──
{
  const cardOf = (p, title) => p.locator('.tpl-pick-card').filter({ has: p.locator('h3', { hasText: new RegExp(`^${title}$`) }) });
  const page = await open({ fresh: true, quickShop: null });
  const titles = await page.$$eval('.tpl-pick-card h3', (els) => els.map((e) => e.textContent.trim()));
  check('picker: Quantity Box, Weight Box, Value Box', titles.join('|') === 'Quantity Box|Weight Box|Value Box', titles.join(', '));
  check('no plan badges on the cards (every plan has all three)', (await page.locator('.tpl-pick-card .tpl-pick-pro').count()) === 0);
  await cardOf(page, 'Value Box').locator('button:has-text("Use This Template")').click();
  await page.waitForSelector('.bxq', { timeout: 15000 });
  check('starts with sample products until collections are chosen', (await page.textContent('body')).includes('Sample products'));
  check('Value Box preset: spend tiers ($999 → $100 OFF, $1999 → 15% OFF)', ((t) => t.includes('$100 OFF') && t.includes('15% OFF') && t.includes('$999'))(await text(page, '.bxq-top')), await text(page, '.bxq-top'));
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-builder-new.png') });
  await page.click('button:has-text("Save Template")');
  await page.waitForTimeout(300);
  check('save needs a collection', (await page.evaluate(() => (window.__toasts || []).map((t) => t.message))).some((m) => m.includes('Choose at least one collection for the box')));
  await page.close();

  const qty = await open({ fresh: true, quickShop: null });
  await cardOf(qty, 'Quantity Box').locator('button:has-text("Use This Template")').click();
  await qty.waitForSelector('.bxq', { timeout: 15000 });
  check('Quantity Box preset: 2 items → 5% OFF, 4 items → 10% OFF', ((t) => t.includes('5% OFF') && t.includes('10% OFF') && t.includes('2 items') && t.includes('4 items'))(await text(qty, '.bxq-top')), await text(qty, '.bxq-top'));
  await qty.close();

  for (const plan of ['free', 'lite', 'starter']) {
    const p = await open({ fresh: true, plan, quickShop: null });
    check(`${plan}: all three usable`, (await p.locator('.tpl-pick-card button:has-text("Use This Template")').count()) === 3);
    await p.close();
  }
}

// ── an older Quick Shop priced by items becomes a Value Box ──
{
  const page = await open({ layout: 'layout6' });
  check('told it is a Value Box now', (await page.evaluate(() => (window.__toasts || []).map((t) => t.message))).some((m) => m.includes('now a Value Box')));
  check('preview shows the value tiers', ((t) => t.includes('$100 OFF') && t.includes('15% OFF'))(await text(page, '.bxq-top')), await text(page, '.bxq-top'));
  await tab(page, 'Advanced');
  await section(page, 'Offer');
  check('Offer: priced by box value, no measure picker', (await sidebar(page)).includes('The Value Box is priced by how much the box costs') && !(await page.$('input[type="radio"][value="quantity"]')));
  await page.click('button:has-text("Save Template")');
  await page.waitForSelector('text=Template Title');
  await page.click('.Polaris-Modal-Dialog button:has-text("Save")');
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => window.__SAVED?.[0]);
  const config = saved ? JSON.parse(saved.customization_data) : {};
  check('saved as value', config.layout === 'layout6' && config.weight_pricing?.measure === 'value', JSON.stringify(config.weight_pricing));
  await page.close();
}

// ── Style → Page loader: preview, style, logo, text, save ──
{
  const page = await open();
  await tab(page, 'Style');
  await section(page, 'Page loader');
  check('Page loader section with the default round spinner preview', (await page.$('[data-testid="loader-preview"] .bxl.bxl--ring')) !== null);
  await page.click('button[role="radio"]:has-text("Dots")');
  check('picking Dots changes the preview', (await page.$('[data-testid="loader-preview"] .bxl.bxl--dots')) !== null);
  await page.getByLabel('Or use an image link').fill('https://cdn.example.com/logo.png');
  await page.click('button:has-text("Use link")');
  check('a logo link shows in the preview', (await page.$('[data-testid="loader-preview"] img.bxl-logo[src="https://cdn.example.com/logo.png"]')) !== null);
  await page.getByLabel('Logo position').selectOption('above');
  check('logo above the loader', (await page.$('[data-testid="loader-preview"] .bxl-above img')) !== null);
  await page.getByLabel('Text under the loader').fill('Packing your box…');
  check('text shows in the preview', (await text(page, '[data-testid="loader-preview"] .bxl-text')) === 'Packing your box…');
  await page.getByLabel('Show a loader while the page loads').uncheck();
  check('turning it off hides the options', (await page.$('[data-testid="loader-preview"]')) === null && !(await sidebar(page)).includes('Text under the loader'));
  await page.getByLabel('Show a loader while the page loads').check();
  check('turning it back on keeps the settings', (await page.$('[data-testid="loader-preview"] .bxl.bxl--dots .bxl-above img')) !== null);
  await page.click('button:has-text("Save Template")');
  await page.waitForSelector('text=Template Title');
  await page.click('.Polaris-Modal-Dialog button:has-text("Save")');
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => window.__SAVED?.[0]);
  const config = saved ? JSON.parse(saved.customization_data) : {};
  check('saved: loader settings', config.loader_style === 'dots' && config.loader_logo === 'https://cdn.example.com/logo.png' && config.loader_logo_place === 'above' && config.loader_text === 'Packing your box…',
    JSON.stringify({ s: config.loader_style, l: config.loader_logo, p: config.loader_logo_place, t: config.loader_text }));
  await page.close();
}

// ── phone preview ──
{
  const page = await open({ viewport: { width: 1500, height: 1000 } });
  await page.click('button:has-text("Mobile")').catch(() => {});
  await page.waitForSelector('.bxq--m', { timeout: 5000 }).catch(() => {});
  check('phone preview uses the phone layout', (await page.$('.bxq--m')) !== null);
  await page.close();
}

// ── icons, banner, title switch ──
{
  const page = await open();
  await tab(page, 'Style');
  await section(page, 'Top progress');
  const pickers = await page.$$('[role="radiogroup"][aria-label^="Tier "]');
  check('one icon picker per tier', pickers.length === 2, String(pickers.length));
  await page.click('[role="radiogroup"][aria-label^="Tier 2"] [role="radio"][aria-label="crown"]');
  const iconsNow = await page.$$eval('.bxq-mile-dot svg', (els) => els.map((e) => e.innerHTML));
  check('picking an icon changes that milestone in the preview', iconsNow.length === 2 && iconsNow[1].includes('m3 7 4.5 4L12 5'), iconsNow[1]);
  await page.click('[role="radiogroup"][aria-label^="Tier 1"] [role="radio"][aria-label="percent"]');
  await page.click('[role="radiogroup"][aria-label^="Tier 2"] [role="radio"][aria-label="percent"]');
  const bothPercent = await page.$$eval('.bxq-mile-dot svg', (els) => els.map((e) => e.innerHTML));
  check('% can be picked on every tier', bothPercent.length === 2 && bothPercent.every((h) => h.includes('M19 5 5 19')), JSON.stringify(bothPercent));
  check('no emoji in the sidebar or preview', !/[\u{1F300}-\u{1FAFF}]/u.test((await sidebar(page)) + (await page.textContent('.bxq'))));
  await section(page, 'Title & Description');
  await page.getByLabel('Show title & description').uncheck();
  check('Content switch hides the Quick Shop title', (await page.$('.bxq-head')) === null);
  await tab(page, 'Layout');
  check('Layout tab has the Banner section', (await sidebar(page)).includes('Banner Settings'));
  await section(page, 'Banner Settings');
  if (!(await page.getByLabel('Show Banner').isChecked())) await page.getByLabel('Show Banner').check();
  await page.getByLabel('Desktop Banner Image URL').fill('https://cdn.example.com/b.jpg');
  check('banner shows in the preview', (await page.$('.bxq-banner img[src="https://cdn.example.com/b.jpg"]')) !== null);
  await page.close();
}

// ── Shiprocket shop: Checkout with ──
{
  const page = await open({ shiprocket: true });
  await tab(page, 'Style');
  await section(page, 'Bottom bar');
  check('Shiprocket shop: Checkout with offered, Shopify by default', (await sidebar(page)).includes('Checkout with') && (await page.getByLabel('Checkout with').inputValue()) === 'shopify');
  await page.getByLabel('Checkout with').selectOption('shiprocket');
  check('Shiprocket + BRIX code explains the one-time code', (await sidebar(page)).includes('one-time code worth the box discount'));
  await page.getByLabel('Button goes to').selectOption('cart');
  check('Cart page destination hides Checkout with', !(await sidebar(page)).includes('Checkout with'));
  await page.close();
}

// ── Picture collection bar and bottom bar button sizes ──
{
  const page = await open();
  await tab(page, 'Layout');
  await section(page, 'Filters');
  await page.click('label:has-text("Pictures with names")');
  await page.waitForSelector('.bxq-colbar');
  const tiles = await page.$$eval('.bxq-col .bxq-col-name', (els) => els.map((e) => e.textContent));
  check('builder: Pictures with names shows the picture bar in the preview', tiles.join(',') === 'All,Face Wash,Serums', tiles.join(','));
  const side = await sidebar(page);
  check('builder: shape, size and one picture field per collection', side.includes('Picture shape') && side.includes('Picture size') && side.includes('Face Wash picture') && side.includes('Serums picture'));
  await page.getByLabel('Face Wash picture').fill('https://cdn.example.com/face.jpg');
  check('builder: a picture link shows on its tile', (await page.$('.bxq-col[data-value^="c:"] img[src="https://cdn.example.com/face.jpg"]')) !== null);
  await page.getByLabel('Serums picture').fill('http://insecure.example.com/s.jpg');
  check('builder: a non-https link is flagged', (await sidebar(page)).includes('Use an https:// image link.'));
  await page.getByLabel('Picture shape').selectOption('square');
  check('builder: shape follows the setting', (await page.$eval('.bxq-col-img', (el) => getComputedStyle(el).borderRadius)) === '4px');
  await page.click('.bxq-col:has-text("Serums")');
  check('builder: tapping a tile filters the preview', (await page.$$('.bxq-card')).length === 2);

  await plus(page, 3);
  await tab(page, 'Style');
  await section(page, 'Bottom bar');
  const bar = await sidebar(page);
  check('builder: button size fields', bar.includes('Text size') && bar.includes('Text size on phones') && bar.includes('Padding top and bottom') && bar.includes('Padding left and right'));
  // PxField's caption isn't a <label>, so find each input by its field.
  const px = (caption) => page.locator('.compact-field').filter({ has: page.locator(`div:text-is("${caption}")`) }).locator('input');
  await px('Padding top and bottom').fill('20');
  await px('Text size').fill('19');
  await page.waitForTimeout(200);
  const go = await page.$eval('.bxq-go', (el) => ({ pt: getComputedStyle(el).paddingTop, fs: getComputedStyle(el).fontSize }));
  check('builder: the preview button follows the sizes', go.pt === '20px' && go.fs === '19px', JSON.stringify(go));

  await page.click('button:has-text("Save Template")');
  await page.waitForSelector('text=Template Title');
  await page.click('.Polaris-Modal-Dialog button:has-text("Save")');
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => window.__SAVED?.[0]);
  const config = saved ? JSON.parse(saved.customization_data) : {};
  check('saved: picture bar settings and button sizes',
    config.qs_chip_style === 'images' && config.qs_chip_image_shape === 'square' && Object.values(config.qs_chip_images || {}).includes('https://cdn.example.com/face.jpg')
    && Number(config.qs_btn_pad_y) === 20 && Number(config.qs_btn_font_size) === 19,
    JSON.stringify({ style: config.qs_chip_style, shape: config.qs_chip_image_shape, images: config.qs_chip_images, py: config.qs_btn_pad_y, fs: config.qs_btn_font_size }));
  await page.screenshot({ path: path.join(SHOTS, 'builder-collection-bar.png'), fullPage: false });
  await page.close();
}

// ── Weight Box: "Price per kg" tier (1.5 kg at ₹999/kg = ₹1,498.50) ──
{
  const WEIGHT = { measure: 'weight', unit: 'kg', max_grams: null, tiers: [{ id: 't1', min_grams: 1000, type: 'unit_price', value: 999, label: '' }], messages: { unlocked: 'You unlocked {{tier}}' } };
  const page = await open({ quickShop: WEIGHT, layout: 'layout5' });
  await tab(page, 'Advanced');
  await section(page, 'Offer');
  const typeSel = page.getByLabel('Shopper gets').first();
  const opts = await typeSel.locator('option').allTextContents();
  check('Weight Box offer types include "Price per kg"', opts.includes('Price per kg'), opts.join(', '));
  check('…and it is the saved tier\'s type', (await typeSel.inputValue()) === 'unit_price');
  check('value field says "Price per kg" with the 1.5 × example', (await sidebar(page)).includes('Price per kg') && (await sidebar(page)).includes('1.5 kg = 1.5 × this'));
  check('no max weight needed (no error)', !(await sidebar(page)).includes('needs a max weight'));
  check('preview names the tier "₹999/KG"', /999\/KG/.test(await page.textContent('.bxq')));
  await page.close();
}

// ── Box Collections: order, own names, sections; chips alignment ──
{
  const page = await open();
  const chipOrder = () => page.$$eval('.bxq-filters [data-combo-action="qs-chip"]', (els) => els.map((e) => e.textContent.trim()));
  check('collections: chips as before (Shopify names, saved order)', JSON.stringify(await chipOrder()) === JSON.stringify(['All', 'Face Wash', 'Serums']), JSON.stringify(await chipOrder()));
  await tab(page, 'Layout');
  if (!(await sidebar(page)).includes('Add Collection')) await section(page, 'Box Collections');
  await page.getByLabel('Name on the page for collection 1').fill('Cleansers');
  check('collections: own name shows on the chip', (await chipOrder()).includes('Cleansers') && !(await chipOrder()).includes('Face Wash'), JSON.stringify(await chipOrder()));
  await page.getByLabel('Move collection 2 up').click();
  check('collections: ↑ moves Serums first', JSON.stringify(await chipOrder()) === JSON.stringify(['All', 'Serums', 'Cleansers']), JSON.stringify(await chipOrder()));
  check('collections: the own name follows its collection', (await page.getByLabel('Name on the page for collection 2').inputValue()) === 'Cleansers');
  check('collections: one grid until sections are switched on', (await page.$$('.bxq-section')).length === 0);
  await page.getByLabel('Show products by collection').check();
  const sections = await page.$$eval('.bxq-section-title', (els) => els.map((e) => [e.textContent, e.style.textAlign]));
  check('sections: one per collection, in the new order, own names', JSON.stringify(sections) === JSON.stringify([['Serums', 'left'], ['Cleansers', 'left']]), JSON.stringify(sections));
  await page.getByLabel('Section title alignment').selectOption('center');
  check('sections: title alignment', (await page.$$eval('.bxq-section-title', (els) => els.map((e) => e.style.textAlign))).every((a) => a === 'center'));
  await page.getByLabel('Title size (px)').fill('26');
  check('sections: title size', await page.$eval('.bxq-section-title', (e) => getComputedStyle(e).fontSize) === '26px');
  await page.screenshot({ path: path.join(SHOTS, 'builder-collection-sections.png') });
  await tab(page, 'Layout');
  if (!(await sidebar(page)).includes('Chips alignment')) await section(page, 'Filters');
  await page.getByLabel('Chips alignment').selectOption('center');
  check('chips alignment: centre', await page.$eval('.bxq-filters', (e) => e.classList.contains('bxq-al-center')));
  // Removing the first collection keeps the second (it used to be lost).
  if (!(await sidebar(page)).includes('Add Collection')) await section(page, 'Box Collections');
  await page.getByLabel('Remove collection 1').click();
  check('remove: the other collection stays', (await page.getByLabel('Collection 1', { exact: true }).inputValue()) === 'face-wash' && (await page.$$('.bxq-card')).length === 2, await page.getByLabel('Collection 1', { exact: true }).inputValue());
  await page.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

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

async function open({ plan = 'pro', quickShop = QUANTITY, fresh = false, viewport = { width: 1500, height: 1000 } } = {}) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.addInitScript(({ plan: pl, quickShop: q, fresh: f }) => {
    window.shopify = { toast: { show: (message, opts) => { (window.__toasts = window.__toasts || []).push({ message, ...(opts || {}) }); } } };
    window.__PLAN = pl;
    if (q) window.__QUICK_SHOP = q;
    if (f) window.__NEW = true;
  }, { plan, quickShop, fresh });
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

// ── a saved Quick Shop: preview, styles, measure, filters, save ──
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

  // Clicking the bar opens its settings; clicking a card opens the card settings
  await page.click('.bxq-card .bxq-name');
  await page.waitForTimeout(150);
  check('clicking a card opens Product cards', (await sidebar(page)).includes('Columns (desktop)'));

  // Layout tab: filters
  await section(page, 'Filters');
  await page.getByLabel('Brand (vendor)').uncheck();
  check('turning Brand off removes it from the page', !(await text(page, '.bxq-filters')).includes('Brand'));

  // Advanced: measure picker
  await tab(page, 'Advanced');
  check('no count Progress Bar / AI sections for Quick Shop', !(await sidebar(page)).includes('AI Settings') && !(await sidebar(page)).includes('Progress Bar'));
  await section(page, 'Offer');
  check('measure picker with Quantity selected', await page.isChecked('input[type="radio"][value="quantity"]'));
  await page.click('label:has-text("Value")');
  const offer = await sidebar(page);
  check('Value: spend field with currency, no box price option', offer.includes('Box total at least') && !(await page.$$eval('select option', (o) => o.map((x) => x.value))).includes('fixed_price'));
  // $299 + $699 + $299 = $1297, past the sample $999 spend tier.
  check('Value: summary in money, box unlocked', (await sidebar(page)).includes('$999+: 10% off') && (await text(page, '.bxq-msg')).includes('You unlocked 10% OFF'), await text(page, '.bxq-msg'));
  check('rare settings are under More options', !offer.includes('Which products count toward the box'));
  await page.click('button:has-text("More options")');
  check('More options opens them', (await sidebar(page)).includes('Which products count toward the box'));

  await page.click('button:has-text("Save Template")');
  await page.waitForSelector('text=Template Title');
  await page.click('.Polaris-Modal-Dialog button:has-text("Save")');
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => window.__SAVED?.[0]);
  const config = saved ? JSON.parse(saved.customization_data) : {};
  check('saved: layout6, box-priced, measured by value', config.layout === 'layout6' && config.pricing_mode === 'weight' && config.weight_pricing?.measure === 'value', JSON.stringify({ layout: config.layout, measure: config.weight_pricing?.measure }));
  check('saved: the style choices', config.qs_top_style === 'none' && config.qs_bar_style === 'ring' && config.qs_btn_label === 'View box' && config.qs_filter_brand === false);
  await page.close();
}

// ── picker: Quick Shop card → preset ──
{
  const page = await open({ fresh: true, quickShop: null });
  const card = page.locator('.tpl-pick-card', { hasText: 'Quick Shop' });
  check('picker has a Pro Quick Shop card', (await card.count()) === 1 && (await card.textContent()).includes('Pro'));
  await card.locator('button:has-text("Use This Template")').click();
  await page.waitForSelector('.bxq', { timeout: 15000 });
  check('starts with sample products until collections are chosen', (await page.textContent('body')).includes('Sample products'));
  check('preset: quantity tiers 3 → 5% OFF, 5 → 10% OFF', ((t) => t.includes('5% OFF') && t.includes('10% OFF') && t.includes('3 items'))(await text(page, '.bxq-top')), await text(page, '.bxq-top'));
  await page.screenshot({ path: path.join(SHOTS, 'quickshop-builder-new.png') });
  await page.click('button:has-text("Save Template")');
  await page.waitForTimeout(300);
  check('save needs a collection', (await page.evaluate(() => (window.__toasts || []).map((t) => t.message))).some((m) => m.includes('Choose at least one collection for the page')));
  await page.close();

  const starter = await open({ fresh: true, plan: 'starter', quickShop: null });
  const locked = starter.locator('.tpl-pick-card', { hasText: 'Quick Shop' });
  check('Starter: Quick Shop offers the upgrade', (await locked.locator('button').last().textContent()).includes('Upgrade to Pro'));
  await starter.close();
}

// ── phone preview ──
{
  const page = await open({ viewport: { width: 1500, height: 1000 } });
  await page.click('button:has-text("Mobile")').catch(() => {});
  await page.waitForSelector('.bxq--m', { timeout: 5000 }).catch(() => {});
  check('phone preview uses the phone layout', (await page.$('.bxq--m')) !== null);
  await page.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

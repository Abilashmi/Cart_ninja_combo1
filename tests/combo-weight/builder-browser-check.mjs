/* eslint-env node */
// Browser check for the builder's Offer section and weight preview
// (app/components/customization/OfferSection.jsx, app.bundles.customize.jsx).
// Run with: node tests/combo-weight/builder-browser-check.mjs
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
const WEIGHT = {
  unit: 'kg', max_grams: 2200,
  tiers: [{ id: 't1', min_grams: 1000, type: 'percentage', value: 10, label: '' }, { id: 't2', min_grams: 2000, type: 'fixed_price', value: 1700, label: '' }],
};
const LIVE = { state: 'active', verified: true, message: 'The box discount is active in Shopify checkout.' };

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();

async function open({ plan = 'pro', weight = WEIGHT, status = LIVE, saveWeight = null, fresh = false, viewport = { width: 1500, height: 1000 } } = {}) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.addInitScript(({ plan: pl, weight: w, status: s, saveWeight: sw, fresh: f }) => {
    window.shopify = { toast: { show: (message, opts) => { (window.__toasts = window.__toasts || []).push({ message, ...(opts || {}) }); } } };
    window.__PLAN = pl;
    if (w) window.__WEIGHT = w;
    if (s) window.__WEIGHT_STATUS = s;
    if (sw) window.__SAVE_WEIGHT = sw;
    if (f) window.__NEW = true;
  }, { plan, weight, status, saveWeight, fresh });
  await page.route('**/api/combo-ai-suggestions', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"enabled":false}}' }));
  await page.goto(`${base}/app/bundles/customize`);
  await page.waitForSelector(fresh ? '.tpl-pick-card' : `[data-cdo-product-id="${P(1)}"]`, { timeout: 20000 });
  return page;
}

async function openOffer(page) {
  await page.click('.cst-sidebar-tab:has-text("Advanced")');
  await page.click('.cst-section-header:has-text("Offer")');
  await page.waitForSelector('text=/How this combo is priced|always priced by the weight of the box/');
}
const sidebar = (page) => page.textContent('.cst-sidebar-content');
const toasts = (page) => page.evaluate(() => (window.__toasts || []).map((t) => `${t.isError ? '!' : ''}${t.message}`));

// ── Pro: editor, live status, preview meter, audit, validation, save ──
{
  const page = await open({ saveWeight: { state: 'not_deployed', verified: false, active: true, message: 'The box discount is not installed on this store yet.' } });
  await openOffer(page);
  let text = await sidebar(page);
  check('weight mode is selected for a weight template', await page.isChecked('input[type="radio"][value="weight"]'));
  check('status card says the discount is live', text.includes('Box discount is live in checkout'));
  check('live summary of the tiers', text.includes('1 kg+: 10% off · 2 kg+: box for $1700 (max 2.2 kg)'), text.match(/1 kg\+[^)]*\)/)?.[0]);

  // Preview: 300 g + 450 g + 700 g = 1.45 kg
  for (const n of [1, 3, 5]) await page.click(`[data-cdo-product-id="${P(n)}"]`);
  const preview = await page.textContent('[data-tour="combo-preview"], body');
  check('preview shows the weight meter with the unlocked tier', preview.includes('1.45 kg') && preview.includes('1 kg box discount unlocked!'), preview.match(/Your box.{0,160}/s)?.[0]?.replace(/\s+/g, ' '));
  await page.screenshot({ path: path.join(SHOTS, 'builder-weight.png') });

  // Clicking the preview jumps the sidebar to the product card settings.
  await openOffer(page);
  // Edit tier 1 → unsaved note
  const valueField = page.getByLabel('Percentage off', { exact: true }).first();
  await valueField.fill('15');
  text = await sidebar(page);
  check('summary follows the edit', text.includes('1 kg+: 15% off'));
  check('says the change is not saved yet', text.includes('Save to send it to checkout'));

  await page.click('button:has-text("Check product weights")');
  await page.waitForSelector('text=without a weight', { timeout: 5000 }).catch(() => {});
  check('weight audit lists the product without a weight', (await sidebar(page)).includes('Rose Face Wash'));

  // Remove the max weight: a box price needs one → save blocked
  const maxField = page.getByLabel('Max box weight', { exact: true });
  await maxField.fill('');
  await maxField.blur();
  check('validation error shown', (await sidebar(page)).includes('A fixed box price needs a max weight'));
  await page.click('button:has-text("Save Template")');
  await page.waitForTimeout(300);
  check('save is blocked with the error', (await toasts(page)).some((t) => t.startsWith('!A fixed box price needs a max weight')) && (await page.$('text=Template Title')) === null);

  await maxField.fill('2.5');
  await maxField.blur();
  await page.click('button:has-text("Save Template")');
  await page.waitForSelector('text=Template Title');
  await page.click('.Polaris-Modal-Dialog button:has-text("Save")');
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => window.__SAVED?.[0]);
  const config = saved ? JSON.parse(saved.customization_data) : {};
  check('saved config carries weight mode and the edited pricing', config.pricing_mode === 'weight' && config.weight_pricing?.max_grams === 2500 && config.weight_pricing?.tiers?.[0]?.value === 15, JSON.stringify(config.weight_pricing));
  check('no coupon is saved with a weight box', !config.has_discount_offer);
  text = await sidebar(page);
  check('after save, the status card shows why it is not live', text.includes('Box discount is not live yet') && text.includes('not installed on this store yet'));
  check('and the merchant is told (and stays on the page)', (await toasts(page)).some((t) => t.startsWith('!The box discount is not installed')));
  await page.close();
}

// ── Starter: weight pricing is locked ──
{
  const page = await open({ plan: 'starter', weight: null, status: null });
  await openOffer(page);
  check('count template on Starter: weight option disabled', await page.isDisabled('input[type="radio"][value="weight"]'));
  check('Pro badge shown next to it', (await sidebar(page)).includes('Pro'));
  check('coupon controls still there for item-count combos', (await sidebar(page)).includes('Offer a coupon?'));
  await page.close();

  const locked = await open({ plan: 'starter', status: null });
  await openOffer(locked);
  const text = await sidebar(locked);
  check('weight template after a downgrade: explained and locked', text.includes('part of the Pro plan') && text.includes('Requires the Pro plan'));
  await locked.close();
}

// ── Template picker: "The Weight Box" is the 4th template, Pro only ──
{
  const page = await open({ fresh: true });
  const titles = await page.$$eval('.tpl-pick-card h3', (els) => els.map((e) => e.textContent.trim()));
  check('picker shows 5 templates, the 4th is The Weight Box', titles.length === 5 && titles[3] === 'The Weight Box', titles.join(', '));
  const card = page.locator('.tpl-pick-card', { hasText: 'The Weight Box' });
  check('Weight Box card is marked Pro', (await card.textContent()).includes('Pro'));
  await page.screenshot({ path: path.join(SHOTS, 'picker.png'), fullPage: true });
  await card.locator('button:has-text("Use This Template")').click();
  await page.waitForSelector('.bxw', { timeout: 15000 });
  check('picking it opens the Weight Box design in the preview', (await page.$('.bxw-panel')) !== null);
  const ladder = await page.$$eval('.bxw-rung', (els) => els.map((e) => e.textContent));
  check('preview starts with sample tiers (1 kg 10%, 2 kg 15%)', ladder.length === 2 && ladder[0].includes('10% off') && ladder[1].includes('15% off'), ladder.join(' | '));
  await page.click(`.bxw-card[data-cdo-product-id="${P(5)}"] .bxw-add`); // 700 g
  await page.click(`.bxw-card[data-cdo-product-id="${P(4)}"] .bxw-add`); // 500 g
  const panel = await page.textContent('.bxw-panel');
  check('adding products fills the box panel (1.2 kg, 10% off)', panel.includes('1.2 kg') && panel.includes('Box discount'), panel.replace(/\s+/g, ' ').slice(0, 220));
  check('product without a weight says "Not counted"', (await page.textContent(`.bxw-card[data-cdo-product-id="${P(2)}"]`)).includes('Not counted'));
  await page.screenshot({ path: path.join(SHOTS, 'builder-weight-box.png') });
  await openOffer(page);
  const offer = await sidebar(page);
  check('Offer: no item-count option for the Weight Box', offer.includes('always priced by the weight of the box') && !(await page.$('input[type="radio"][value="count"]')));
  await page.click('.cst-sidebar-tab:has-text("Layout")');
  check('Layout tab: "Box Collections" section', (await sidebar(page)).includes('Box Collections'));
  await page.click('button:has-text("Save Template")');
  await page.waitForTimeout(300);
  check('save needs a collection for the box', (await toasts(page)).some((t) => t.startsWith('!Choose at least one collection for the box')));
  await page.close();

  const starter = await open({ fresh: true, plan: 'starter' });
  const lockedCard = starter.locator('.tpl-pick-card', { hasText: 'The Weight Box' });
  check('Starter: Weight Box card offers the upgrade instead', (await lockedCard.locator('button').last().textContent()).includes('Upgrade to Pro'));
  check('Starter: other templates still usable', (await starter.locator('.tpl-pick-card', { hasText: 'The Guided Architect' }).locator('button:has-text("Use This Template")').count()) === 1);
  await starter.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

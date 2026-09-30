// Real-browser check of the admin PackPreview (the Builder's live preview) for
// the three layouts, so it matches the storefront widget.
//
//   node tests/packs/preview-browser-check.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { defaultCustomization } from '../../app/utils/packs.shared.js';

const root = path.join(process.cwd(), 'tests', 'packs', 'preview-harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
const shotDir = path.join(process.cwd(), 'tests', 'packs', 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const swatch = (color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`)}`;
const tiers = [
  { quantity: 1, name: 'Buy 1', badge: '', discountType: 'none', discountValue: 0, subtotal: 80, savings: 0, price: 80 },
  { quantity: 2, name: 'Buy 2', badge: '', discountType: 'percentage', discountValue: 5, subtotal: 160, savings: 8, price: 152 },
  { quantity: 3, name: 'Buy 3', badge: 'Best value', discountType: 'percentage', discountValue: 10, subtotal: 240, savings: 24, price: 216 },
];
const variants = [
  { id: '200', title: 'Black / M', price: 80, availableForSale: true, image: swatch('#111111') },
  { id: '201', title: 'White / L', price: 100, availableForSale: true, image: swatch('#eeeeee') },
];
const props = (preset, over = {}) => ({ template: 'same_variant', packType: 'same_variant', variants, tiers, productImage: swatch('#cccccc'), productTitle: 'Tee', customization: { ...defaultCustomization(), design: { preset } }, ...over });

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (error) { results.push(false); console.log('  ✗', name, '\n     ', String(error.message).split('\n')[0]); }
};
const browser = await chromium.launch();
async function open(p) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((value) => { window.__PROPS__ = value; }, p);
  await page.route('http://preview.test/**', (route) => {
    const url = new URL(route.request().url());
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://preview.test/');
  await page.locator('#preview section').waitFor();
  return { page, errors };
}

console.log('\nPackPreview (admin) — layout checks');

await check('Pack tabs: tabs across, one plain dropdown per item under the chosen pack', async () => {
  const { page, errors } = await open(props('tabs'));
  await page.getByRole('radio', { name: /Buy 3/ }).click();
  assert.equal(await page.locator('#preview select').count(), 3);
  await page.locator('#preview select').nth(1).selectOption('201');
  assert.match(await page.locator('#preview').innerText(), /₹234\.00/); // (80 + 100 + 80) x 0.9
  await page.locator('#preview').screenshot({ path: path.join(shotDir, 'preview-tabs.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

await check('Stacked packs: rows; the chosen row shows the photo per item (product name for a single variant)', async () => {
  const { page, errors } = await open(props('stacked', { variants: [{ id: '200', title: 'Default Title', price: 80, availableForSale: true, image: swatch('#3366cc') }] }));
  await page.getByRole('radio', { name: /Buy 3/ }).click();
  assert.equal(await page.locator('#preview img[src*="3366cc"]').count(), 3);
  assert.doesNotMatch(await page.locator('#preview').innerText(), /Default Title/);
  assert.equal(await page.locator('#preview select').count(), 0);
  await page.locator('#preview').screenshot({ path: path.join(shotDir, 'preview-stacked.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

await check('Visual picker: rows; photo dropdown per item with photos in every option', async () => {
  const { page, errors } = await open(props('visual'));
  await page.getByRole('radio', { name: /Buy 2/ }).click();
  const triggers = page.locator('#preview button[aria-haspopup="listbox"]');
  assert.equal(await triggers.count(), 2);
  await triggers.nth(1).click();
  assert.equal(await page.locator('#preview [role="option"] img').count(), 2);
  await page.locator('#preview').screenshot({ path: path.join(shotDir, 'preview-visual.png') });
  await page.locator('#preview [role="option"]', { hasText: 'White / L' }).click();
  assert.match(await triggers.nth(1).innerText(), /White \/ L/);
  assert.deepEqual(errors, []);
  await page.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

// Real-browser check of the admin PackPreview (the Builder's live preview and
// template thumbnails). PackPreview mounts the real storefront widget, so this
// verifies the admin shows the same three templates and interactions.
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
  { id: '200', title: 'M / Black', options: ['M', 'Black'], price: 80, availableForSale: true, image: swatch('#111111') },
  { id: '201', title: 'L / White', options: ['L', 'White'], price: 100, availableForSale: true, image: swatch('#eeeeee') },
  { id: '202', title: 'L / Black', options: ['L', 'Black'], price: 80, availableForSale: true, image: swatch('#222222') },
];
const props = (preset, over = {}) => ({ template: 'choose_each_item', packType: 'mix_match', variants, productOptions: ['Size', 'Color'], tiers, productImage: swatch('#cccccc'), productTitle: 'Tee', customization: { ...defaultCustomization(), design: { preset } }, ...over });

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
  await page.locator('#preview .brix-packs-widget').waitFor();
  return { page, errors };
}
const text = (page) => page.locator('#preview').innerText();

console.log('\nPackPreview (admin) — template checks');

await check('Horizontal Select: horizontal packs, a slot per item with Shopify option dropdowns; Add to cart is simulated', async () => {
  const { page, errors } = await open(props('slots'));
  await page.getByRole('radio', { name: /Buy 2/ }).click();
  assert.equal(await page.locator('#preview .brix-packs-slot').count(), 2);
  await page.getByLabel('Item 1 Size').selectOption('M');
  await page.getByLabel('Item 1 Color').selectOption('Black');
  await page.getByLabel('Item 2 Size').selectOption('L');
  await page.getByLabel('Item 2 Color').selectOption('White');
  assert.match(await text(page), /₹171\.00/); // (80 + 100) x 0.95
  await page.locator('#preview .brix-packs-add').click();
  assert.match(await text(page), /Preview only — on your store this adds to the cart: M \/ Black × 1, L \/ White × 1/);
  await page.locator('#preview').screenshot({ path: path.join(shotDir, 'preview-slots.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

await check('Quick Add Picker: variant cards with +, selected count, blocked when full', async () => {
  const { page, errors } = await open(props('quick_add'));
  await page.getByRole('radio', { name: /Buy 2/ }).click();
  assert.match(await text(page), /Selected: 0 \/ 2/);
  await page.getByRole('button', { name: 'Add M / Black to your pack' }).click();
  await page.getByRole('button', { name: 'Add another M / Black' }).click();
  assert.match(await text(page), /Selected: 2 \/ 2/);
  assert.equal(await page.getByRole('button', { name: /Add L \/ White to your pack/ }).getAttribute('aria-disabled'), 'true');
  await page.locator('#preview').screenshot({ path: path.join(shotDir, 'preview-quick-add.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

await check('Image Variant Select: packs as rows; a photo dropdown of whole variants per item', async () => {
  const { page, errors } = await open(props('image_slots'));
  await page.getByRole('radio', { name: /Buy 2/ }).click();
  assert.equal(await page.locator('#preview .brix-packs-tier').count(), 3, 'packs as rows');
  assert.equal(await page.locator('#preview .brix-packs-dd').count(), 2);
  assert.equal(await page.locator('#preview select').count(), 0, 'no per-option selects');
  await page.getByRole('button', { name: /^Item 2:/ }).click();
  await page.locator('#preview').screenshot({ path: path.join(shotDir, 'preview-image-slots-open.png') });
  await page.getByRole('option', { name: /^L \/ White/ }).click();
  assert.match(await page.getByRole('button', { name: /^Item 2:/ }).locator('img').getAttribute('src'), /eeeeee/);
  assert.match(await text(page), /₹171\.00/); // (80 + 100) x 0.95
  await page.locator('#preview').screenshot({ path: path.join(shotDir, 'preview-image-slots.png') });
  assert.deepEqual(errors, []);
  await page.close();
});

await check('thumbnail (demo): second pack chosen with one item already picked', async () => {
  const { page, errors } = await open(props('quick_add', { demo: true }));
  assert.equal(await page.getByRole('radio', { name: /Buy 2/ }).getAttribute('aria-checked'), 'true');
  assert.match(await text(page), /Selected: 1 \/ 2/);
  assert.deepEqual(errors, []);
  await page.close();
});

await check('Same Variant Pack, single-variant product: one selection, no dropdowns, product name instead of Default Title', async () => {
  const { page, errors } = await open(props('slots', { packType: 'same_variant', template: 'same_variant', productOptions: ['Title'], variants: [{ id: '300', title: 'Default Title', options: ['Default Title'], price: 80, availableForSale: true, image: swatch('#3366cc') }] }));
  await page.getByRole('radio', { name: /Buy 3/ }).click();
  assert.equal(await page.locator('#preview select').count(), 0);
  assert.match(await text(page), /all 3 items/i);
  assert.doesNotMatch(await text(page), /Default Title/);
  assert.deepEqual(errors, []);
  await page.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

// Real-browser check of the BRIX Packs builder for Fixed Combo packs (pack type 'combo').
//
//   node --import ./tests/packs/register.mjs tests/packs/combo-admin-check.mjs
//
// Same Vite harness as extra-products-admin-check.mjs (real page components, mocked /api/packs, stubbed
// App Bridge picker). Proves the per-pack product editor, its prices and the payload it sends; the server
// re-verifies every item with Shopify (verifyComboTiers).
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defaultCustomization } from '../../app/utils/packs.shared.js';

const root = path.join(process.cwd(), 'tests', 'packs', 'harness');
if (!process.env.SKIP_HARNESS_BUILD) execFileSync(process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(root, 'vite.config.mjs')], { stdio: 'ignore' });
const dist = path.join(root, 'dist');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };

const SHOP = 'demo.myshopify.com';
const currency = { code: 'INR', locale: 'en-IN', symbol: '₹' };
const variant = (id, title, price, extra = {}) => ({ id, title, price, availableForSale: true, maxQuantity: null, inventoryQuantity: 9, inventoryPolicy: 'CONTINUE', image: '', options: [title], ...extra });
const PRODUCTS = {
  100: { id: '100', title: 'Kurta', handle: 'kurta', status: 'ACTIVE', published: true, image: '', options: ['Size'], variants: [variant('200', 'M', 80), variant('201', 'L', 100)] },
  101: { id: '101', title: 'Dupatta', handle: 'dupatta', status: 'ACTIVE', published: true, image: '', options: ['Colour'], variants: [variant('1011', 'Red', 50), variant('1012', 'Blue', 60), variant('1013', 'Green', 20)] },
  102: { id: '102', title: 'Candle', handle: 'candle', status: 'ACTIVE', published: true, image: '', options: ['Title'], variants: [variant('1021', 'Default Title', 300)] },
};
const RED = { productId: '101', variantId: '1011', quantity: 1, handle: 'dupatta', title: 'Dupatta', variantTitle: 'Red', image: '' };
const GREEN = { productId: '101', variantId: '1013', quantity: 2, handle: 'dupatta', title: 'Dupatta', variantTitle: 'Green', image: '' };
const comboPack = (over = {}) => ({
  id: 61, shop: SHOP, productId: '100', variantId: '200', productTitle: 'Kurta', variantTitle: 'M', productImage: '', basePrice: 80, status: 'draft', displayStatus: 'draft', enabled: false,
  template: 'fixed_combo', packType: 'combo', variantScope: 'all', allowedVariantIds: [], version: 1, customization: defaultCustomization(),
  tiers: [
    { name: 'Kurta + Dupatta', quantity: 2, discountType: 'percentage', discountValue: 10, badge: '', items: [RED] },
    { name: '', quantity: 4, discountType: 'fixed', discountValue: 30, badge: 'Best value', items: [RED, GREEN] },
  ],
  extraProducts: [], showOn: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', priceVerified: true, issue: null, available: true, maxQuantity: null, currency, ...over,
});

const results = [];
const check = async (name, fn) => {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (error) { results.push(false); console.log('  ✗', name, '\n     ', String(error.message).split('\n').slice(0, 3).join(' | ')); }
};
const browser = await chromium.launch();

async function open({ pack, picker = [], step = 'configure', onSave }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  const calls = [];
  await page.route('http://harness.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/packs') {
      const request = route.request();
      const body = request.method() === 'POST' ? JSON.parse(request.postData() || '{}') : null;
      calls.push({ method: request.method(), query: Object.fromEntries(url.searchParams), body });
      if (request.method() === 'GET') {
        const product = PRODUCTS[url.searchParams.get('product')];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(product ? { success: true, product, currency } : { success: false, error: 'nf' }), status: product ? 200 : 404 });
      }
      if (body.action === 'preview') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, valid: true, errors: [], currency, variant: { id: '200', title: 'M', price: 80, availableForSale: true, maxQuantity: null }, tiers: [] }) });
      if (body.action === 'save') {
        onSave?.(body);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, pack: comboPack({ ...body, id: 61 }), checkoutDiscount: null, warning: null }) });
      }
    }
    const file = path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(dist) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'nf' });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  await page.addInitScript(({ start, data, picker }) => { window.__START__ = start; window.__DATA__ = data; window.__pickerResult = picker; },
    { start: `/app/packs/${pack.id}/edit?step=${step}`, data: { edit: { pack, shop: SHOP, planState: 'enabled', currency } }, picker });
  await page.goto('http://harness.test/');
  return { page, context, calls };
}
const text = (page) => page.locator('body').innerText();

console.log('\nBRIX Packs builder — Fixed Combo');

await check('each pack lists this product + its products, priced from their live prices', async () => {
  const { page, context } = await open({ pack: comboPack() });
  await page.getByText('Products in this pack').first().waitFor();
  await page.getByText('₹140.00').first().waitFor();
  const body = await text(page);
  assert.match(body, /Pack 1 · 2 items/);
  assert.match(body, /Pack 2 · 4 items/);
  assert.match(body, /Shoppers pick its variant/);
  assert.match(body, /₹117\.00/, '(80 + 50) - 10%');
  assert.match(body, /₹140\.00/, '80 + 50 + 2 x 20 - 30');
  assert.match(body, /Kurta \+ Dupatta \(Red\) \+ 2 × Dupatta \(Green\)/, 'the pricing summary names the contents');
  assert.equal(await page.getByRole('textbox', { name: 'Quantity' }).count(), 0, 'no quantity field: a pack is its products');
  if (process.env.PACKS_SHOTS) await page.locator('.pc-tier').nth(1).screenshot({ path: path.join(process.env.PACKS_SHOTS, 'combo-builder-pack.png') });
  await context.close();
});

await check('the quantity of a product and its variant can be changed; the count and price follow', async () => {
  const { page, context } = await open({ pack: comboPack() });
  await page.getByText('₹117.00').first().waitFor();
  const firstPack = page.locator('.pc-tier').first();
  await firstPack.getByRole('spinbutton', { name: 'Quantity' }).fill('3');
  await page.getByText('Pack 1 · 4 items').waitFor();
  await page.getByText('₹207.00').first().waitFor(); // (80 + 3 x 50) - 10%
  await firstPack.getByRole('combobox', { name: 'Variant' }).selectOption('1012');
  await page.getByText('₹234.00').first().waitFor(); // (80 + 3 x 60) - 10%
  await context.close();
});

await check('adding products: this product is skipped with a note, a single-variant product is added once', async () => {
  const picker = [
    { id: 'gid://shopify/Product/100', title: 'Kurta', images: [], totalVariants: 2, variants: [{ id: 'gid://shopify/ProductVariant/200', title: 'M' }, { id: 'gid://shopify/ProductVariant/201', title: 'L' }] },
    { id: 'gid://shopify/Product/102', title: 'Candle', handle: 'candle', images: [], totalVariants: 1, variants: [{ id: 'gid://shopify/ProductVariant/1021', title: 'Default Title' }] },
  ];
  const { page, context } = await open({ pack: comboPack(), picker });
  await page.getByText('₹117.00').first().waitFor();
  await page.locator('.pc-tier').first().getByRole('button', { name: 'Add products' }).click();
  await page.getByText(/already in every pack/).waitFor();
  await page.locator('.pc-tier').first().getByText('Candle').waitFor();
  await page.getByText('Pack 1 · 3 items').waitFor();
  await page.getByText('₹387.00').first().waitFor(); // (80 + 50 + 300) - 10%
  await page.locator('.pc-tier').first().getByRole('button', { name: 'Remove Candle from pack 1' }).click();
  await page.getByText('Pack 1 · 2 items').waitFor();
  await context.close();
});

await check('a whole product ticked adds one variant; picked variants are added as chosen', async () => {
  const picker = [{ id: 'gid://shopify/Product/101', title: 'Dupatta', handle: 'dupatta', images: [], totalVariants: 3, variants: [{ id: 'gid://shopify/ProductVariant/1011', title: 'Red' }, { id: 'gid://shopify/ProductVariant/1012', title: 'Blue' }, { id: 'gid://shopify/ProductVariant/1013', title: 'Green' }] }];
  const { page, context } = await open({ pack: comboPack({ tiers: [{ name: '', quantity: 1, discountType: 'none', discountValue: 0, badge: '', items: [] }] }), picker });
  await page.getByText('Products in this pack').first().waitFor();
  await page.getByRole('button', { name: 'Add products' }).click();
  await page.getByText('Pack 1 · 2 items').waitFor();
  assert.equal(await page.locator('.pc-combo-row').count(), 2, 'Kurta + one Dupatta, not all three colours');
  await context.close();
});

await check('Add pack opens the picker and adds a pack holding the chosen products (no empty pack, no error)', async () => {
  const picker = [{ id: 'gid://shopify/Product/102', title: 'Candle', handle: 'candle', images: [], totalVariants: 1, variants: [{ id: 'gid://shopify/ProductVariant/1021', title: 'Default Title' }] }];
  const { page, context } = await open({ pack: comboPack(), picker });
  await page.getByText('₹117.00').first().waitFor();
  await page.getByRole('button', { name: 'Add pack' }).click();
  await page.getByText('Pack 3 · 2 items').waitFor();
  assert.match(await page.locator('.pc-tier').nth(2).innerText(), /Candle/);
  assert.doesNotMatch(await text(page), /already this product on its own|same products as pack/);
  await context.close();
});

await check('Add pack with nothing picked (or only this product) adds no pack', async () => {
  const { page, context } = await open({ pack: comboPack(), picker: [{ id: 'gid://shopify/Product/100', title: 'Kurta', images: [], totalVariants: 2, variants: [{ id: 'gid://shopify/ProductVariant/200', title: 'M' }] }] });
  await page.getByText('₹117.00').first().waitFor();
  await page.getByRole('button', { name: 'Add pack' }).click();
  await page.getByText(/already in every pack/).waitFor();
  assert.equal(await page.locator('.pc-tier').count(), 2);
  await context.close();
});

await check('two packs with the same products, or no products anywhere, block Continue', async () => {
  const { page, context } = await open({ pack: comboPack({ tiers: [{ name: '', quantity: 2, discountType: 'none', discountValue: 0, badge: '', items: [RED] }, { name: '', quantity: 2, discountType: 'percentage', discountValue: 5, badge: '', items: [RED] }] }) });
  await page.getByText(/same products as pack 1/).first().waitFor();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText(/Fix the Pack tiers first/).waitFor();
  await context.close();
});

await check('a fixed discount larger than the pack (with the cheapest size) is refused', async () => {
  const tiers = comboPack().tiers.map((tier, index) => (index === 1 ? { ...tier, discountValue: 175 } : tier));
  const { page, context } = await open({ pack: comboPack({ tiers }) });
  await page.getByText(/Fixed discount cannot be larger than the Pack subtotal/).first().waitFor(); // 80 + 50 + 40 = 170
  await context.close();
});

await check('switching a Pack to Fixed Combo starts with two empty packs; back again restores the ladder', async () => {
  const { page, context } = await open({ pack: comboPack({ template: 'same_variant', packType: 'same_variant', variantScope: 'selected', allowedVariantIds: ['200'], tiers: [{ name: '', quantity: 1, discountType: 'none', discountValue: 0, badge: '' }, { name: '', quantity: 2, discountType: 'percentage', discountValue: 5, badge: '' }] }), step: 'type' });
  await page.getByRole('radio', { name: /Fixed Combo/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByText('Products in this pack').first().waitFor();
  assert.equal(await page.locator('.pc-combo').count(), 2);
  assert.match(await text(page), /Add the other products to at least one pack/);
  await page.getByRole('button', { name: 'Back' }).first().click();
  await page.getByRole('radio', { name: /Same Variant/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('spinbutton', { name: 'Quantity' }).first().waitFor();
  assert.equal(await page.locator('.pc-combo').count(), 0);
  await context.close();
});

await check('save sends the type and each pack\'s products (no live prices)', async () => {
  let saved = null;
  const { page, context } = await open({ pack: comboPack(), step: 'review', onSave: (body) => { saved = body; } });
  await page.getByRole('button', { name: 'Save changes' }).waitFor();
  await page.waitForFunction(() => { const button = [...document.querySelectorAll('button')].find((node) => node.innerText.trim() === 'Save changes'); return button && !button.disabled; });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(500);
  assert.ok(saved, 'a save request was sent');
  assert.equal(saved.packType, 'combo');
  assert.equal(saved.template, 'fixed_combo');
  assert.deepEqual(saved.tiers.map((tier) => tier.items), [[RED], [RED, GREEN]]);
  assert.ok(saved.tiers.every((tier) => tier.items.every((item) => !('price' in item))));
  await context.close();
});

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

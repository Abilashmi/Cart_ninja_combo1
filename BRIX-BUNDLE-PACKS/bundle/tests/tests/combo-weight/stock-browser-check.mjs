/* eslint-env node */
// Browser check: sold-out products never go into a combo box
// (app/routes/combo-page[.]js.jsx onAdd / getActiveVariantId / product card,
// and the Quick Shop kit's activeVariant). Classic layouts (layout1 count
// combo, popup variants) and Quick Shop (layout6).
// Run with: node tests/combo-weight/stock-browser-check.mjs
// Loads the real storefront script with every network call mocked.
import { chromium } from '@playwright/test';
import { loadComboPageScript } from './storefront-script.mjs';
import { normalizeWeightPricing } from '../../app/utils/combo-weight.shared.js';

const SCRIPT = loadComboPageScript();
const API = 'https://app.test';
const P = (n) => `gid://shopify/Product/${n}`;
const V = (n) => `gid://shopify/ProductVariant/${n}`;
const variant = (n, title, available, grams = 500) => ({ id: V(n), title, price: '299.00', compareAtPrice: null, grams, available, image: null });
const product = (n, title, variants) => ({ id: P(n), title, handle: `p${n}`, price: '299.00', currency: 'INR', image: null, images: [], vendor: 'Brix', productType: 'Snacks', tags: [], summary: '', variants, variantId: variants[0].id });

// 1: one variant, sold out. 2: first size sold out, second in stock. 3: in stock.
const productsByHandle = {
  snacks: [
    product(1, 'Sold Out Chips', [variant(10, 'Default Title', false)]),
    product(2, 'Trail Mix', [variant(20, 'Small', false), variant(21, 'Large', true)]),
    product(3, 'Peanut Bar', [variant(30, 'Default Title', true)]),
  ],
};

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch();

async function openCombo(config, weightPricing = null) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const log = { navigations: [], add: [] };
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.pathname === '/pages/kit') return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html><body><main><div data-brix-combo-root data-shop="store.test" data-template-id="3"></div></main><script src="${API}/combo-page.js"></script></body></html>` });
    if (url.pathname === '/combo-page.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: SCRIPT });
    if (url.pathname === '/api/combo-page-data') return json({ success: true, data: { templateId: 3, templateName: 'Snack Box', config, productsByHandle, collectionNameMap: { snacks: 'Snacks' }, activeDiscounts: [], weightPricing } });
    if (url.pathname === '/cart.js') return json({ items: [] });
    if (url.pathname === '/cart/add.js') { log.add.push(JSON.parse(req.postData())); return json({ items: [] }); }
    if (url.pathname === '/cart/update.js') return json({ items: [] });
    if (url.pathname === '/api/bundle-analytics') return json({ success: true });
    if (url.origin === 'https://store.test') { log.navigations.push(url.pathname); return route.fulfill({ status: 200, contentType: 'text/html', body: 'next' }); }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('https://store.test/pages/kit');
  return { page, log };
}

const cardSel = (n, cls = '.brix-combo-card') => `${cls}[data-product-id="${P(n)}"]`;
const btnOf = (page, n) => page.locator(`${cardSel(n)} [data-combo-action="card-add"]`);

// ── Classic layout (count combo), variant dropdown ──
{
  const config = { layout: 'layout4', max_products: 2, col_1: 'snacks', tab_count: 1, show_preview_bar: true, product_card_variants_display: 'static' };
  const { page, log } = await openCombo(config);
  await page.waitForSelector('.brix-combo-card');

  const sold = btnOf(page, 1);
  check('fully sold-out product: Add button says "Sold out" and is disabled', (await sold.textContent()).trim() === 'Sold out' && await sold.isDisabled());
  const plus1 = page.locator(`${cardSel(1)} [data-combo-action="qty-inc"]`);
  check('fully sold-out product: + is disabled too', (await plus1.count()) === 0 || await plus1.isDisabled());
  // Even a forced click (e.g. a theme re-enabling buttons) adds nothing.
  await page.evaluate((sel) => { const b = document.querySelector(sel); b.disabled = false; b.click(); }, `${cardSel(1)} [data-combo-action="card-add"]`);
  await page.waitForTimeout(150);
  const toast = await page.evaluate(() => document.body.innerText.includes('Sold out: Sold Out Chips'));
  check('forced click on a sold-out product shows "Sold out: <name>" and adds nothing', toast);

  const select = page.locator(`${cardSel(2)} select[data-combo-action="variant-select"]`);
  check('first size sold out → card opens on the in-stock size', await select.inputValue() === V(21));
  const options = await select.locator('option').allTextContents();
  check('sold-out size is labelled in the dropdown', options.includes('Small (Sold out)') && options.includes('Large'), options.join(' | '));
  check('in-stock size: Add is enabled', !(await btnOf(page, 2).isDisabled()));

  await btnOf(page, 2).click();
  await btnOf(page, 3).click();
  await select.selectOption(V(20));
  await page.waitForTimeout(100);
  check('switching to the sold-out size shows Sold out, disabled', (await btnOf(page, 2).textContent()).trim() === 'Sold out' && await btnOf(page, 2).isDisabled());

  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(300);
  const cartPath = log.navigations.find((p) => p.startsWith('/cart/')) || '';
  check('checkout carries only in-stock variants', cartPath.includes('21:1') && cartPath.includes('30:1') && !cartPath.includes('10:') && !cartPath.includes('20:'), cartPath);
  await page.close();
}

// ── Classic layout, popup variants: picking a sold-out size adds nothing ──
{
  const config = { layout: 'layout4', max_products: 4, col_1: 'snacks', tab_count: 1, show_preview_bar: true, product_card_variants_display: 'popup' };
  const { page } = await openCombo(config);
  await page.waitForSelector('.brix-combo-card');
  await btnOf(page, 2).click();
  const soldOpt = page.locator(`${cardSel(2)} [data-combo-action="popup-pick"][data-variant-id="${V(20)}"]`);
  check('popup lists the sold-out size as "(Sold out)"', (await soldOpt.textContent()).includes('(Sold out)'));
  await soldOpt.click();
  await page.waitForTimeout(150);
  check('picking it shows the sold-out message', await page.evaluate(() => document.body.innerText.includes('Sold out: Trail Mix')));
  check('…and the card is not selected', (await btnOf(page, 2).textContent()).trim() === 'Sold out');
  await page.close();
}

// ── Quick Shop (layout6) ──
{
  const { value } = normalizeWeightPricing({ unit: 'kg', max_grams: 5000, tiers: [{ min_grams: 1000, type: 'fixed_price', value: 999, label: '' }] });
  const pricing = { enabled: true, reason: null, hash: value.hash, measure: 'weight', unit: value.unit, maxGrams: value.max_grams, tiers: value.tiers, messages: value.messages, qualifyingProductIds: [1, 2, 3].map(P) };
  const { page, log } = await openCombo({ layout: 'layout6', pricing_mode: 'weight', tab_count: 1, col_1: 'snacks' }, pricing);
  await page.waitForSelector('.bxq-card');
  check('Quick Shop: fully sold-out card shows Out of stock with no + button',
    await page.locator(`${cardSel(1, '.bxq-card')} .bxq-soldout`).count() === 1 && await page.locator(`${cardSel(1, '.bxq-card')} [data-combo-action="qty-inc"]`).count() === 0);
  const qsSelect = page.locator(`${cardSel(2, '.bxq-card')} select`);
  check('Quick Shop: first size sold out → card opens on the in-stock size with a + button',
    await qsSelect.inputValue() === V(21) && await page.locator(`${cardSel(2, '.bxq-card')} [data-combo-action="qty-inc"]`).count() === 1);
  await page.click(`${cardSel(2, '.bxq-card')} [data-combo-action="qty-inc"]`);
  await page.click(`${cardSel(2, '.bxq-card')} [data-combo-action="qty-inc"]`);
  await page.click(`${cardSel(3, '.bxq-card')} [data-combo-action="qty-inc"]`);
  await page.click('[data-combo-action="checkout"]');
  await page.waitForTimeout(400);
  const items = (log.add[0]?.items || []).map((i) => `${i.id}:${i.quantity}`).sort();
  check('Quick Shop: the cart gets only in-stock variants', JSON.stringify(items) === JSON.stringify(['21:2', '30:1']), JSON.stringify(items));
  await page.close();
}

// ── Stock limits: never more in the box than Shopify will sell ──
{
  const limited = {
    snacks: [
      product(4, 'Two Left Cookies', [{ ...variant(40, 'Default Title', true), stock: 2 }]),
      product(5, 'Zero Stock Chips', [{ ...variant(50, 'Default Title', true), stock: 0 }]),
      product(6, 'Unlimited Bar', [{ ...variant(60, 'Default Title', true), stock: null }]),
    ],
  };
  const saved = productsByHandle.snacks;
  productsByHandle.snacks = limited.snacks;

  const { value } = normalizeWeightPricing({ unit: 'kg', max_grams: 9000, tiers: [{ min_grams: 1000, type: 'percentage', value: 10, label: '' }] });
  const pricing = { enabled: true, reason: null, hash: value.hash, measure: 'weight', unit: value.unit, maxGrams: value.max_grams, tiers: value.tiers, messages: value.messages, qualifyingProductIds: [4, 5, 6].map(P) };
  const qs = await openCombo({ layout: 'layout6', pricing_mode: 'weight', tab_count: 1, col_1: 'snacks' }, pricing);
  await qs.page.waitForSelector('.bxq-card');
  const plus4 = `${cardSel(4, '.bxq-card')} [data-combo-action="qty-inc"]`;
  await qs.page.click(plus4);
  await qs.page.click(plus4);
  check('Quick Shop: + stops at the 2 in stock (disabled)', await qs.page.locator(plus4).last().isDisabled());
  const qty = await qs.page.locator(`${cardSel(4, '.bxq-card')} .bxq-stepper span`).textContent();
  check('…box holds 2', qty.trim() === '2', qty);
  await qs.page.evaluate((sel) => { const b = [...document.querySelectorAll(sel)].pop(); b.disabled = false; b.click(); }, plus4);
  await qs.page.waitForTimeout(150);
  check('…forcing a 3rd shows "Only 2 left: Two Left Cookies" and keeps 2', await qs.page.evaluate(() => document.body.innerText.includes('Only 2 left: Two Left Cookies')) && (await qs.page.locator(`${cardSel(4, '.bxq-card')} .bxq-stepper span`).textContent()).trim() === '2');
  check('Quick Shop: a tracked variant with 0 left is out of stock', await qs.page.locator(`${cardSel(5, '.bxq-card')} .bxq-soldout`).count() === 1);
  const plus6 = `${cardSel(6, '.bxq-card')} [data-combo-action="qty-inc"]`;
  for (let i = 0; i < 4; i++) await qs.page.click(plus6);
  check('Quick Shop: no limit when Shopify sells past 0 or doesn\'t track', (await qs.page.locator(`${cardSel(6, '.bxq-card')} .bxq-stepper span`).textContent()).trim() === '4');
  await qs.page.close();

  const classic = await openCombo({ layout: 'layout4', max_products: 6, col_1: 'snacks', tab_count: 1, show_preview_bar: true });
  await classic.page.waitForSelector('.brix-combo-card');
  await btnOf(classic.page, 4).click();
  const inc = `${cardSel(4)} [data-combo-action="qty-inc"]`;
  await classic.page.click(inc);
  check('classic layout: + disabled at the 2 in stock', await classic.page.locator(inc).isDisabled());
  check('classic layout: 0 left = "Sold out" button', (await btnOf(classic.page, 5).textContent()).trim() === 'Sold out');
  await classic.page.close();
  productsByHandle.snacks = saved;
}

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);

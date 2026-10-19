/* eslint-env node */
// Real-browser check of the FBT widget (snippets/fbt-widget-render.liquid):
//  - the "buy all together" offer text, only on rules the server marked live
//    and only while every product of the set is shown
//  - Add all also adds the product being viewed when an offer applies
//  - image and spacing settings (sizes, corners, fit, gaps, padding, margins)
//  - the image popup (every picture of the product) and the spacing inside cards
// Liquid attributes are filled with fixed values and every request is mocked.
//   node tests/fbt-offer/widget-browser-check.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };
const shotDir = path.join(os.tmpdir(), 'brix-fbt-widget');
fs.mkdirSync(shotDir, { recursive: true });

const fbt = fs.readFileSync(path.join(process.cwd(), 'extensions', 'cart-drawer', 'snippets', 'fbt-widget-render.liquid'), 'utf8')
  // The widget script is an asset (the Liquid size limit): inline it here.
  .replace(`<script src="{{ 'fbt_widget_render.js' | asset_url }}" defer></script>`, () => `<script>${fs.readFileSync(path.join(process.cwd(), 'extensions', 'cart-drawer', 'assets', 'fbt_widget_render.js'), 'utf8')}</script>`)
  .replace('{{ product.id }}', '100')
  .replace('{{ shop.permanent_domain }}', 'demo.myshopify.com')
  .replace('{{ shop.currency }}', 'INR')
  // The viewed product's price in cents (₹800), part of the offer's set.
  .replace('{{ product.selected_or_first_available_variant.price }}', '80000')
  .replace('{{ product.handle }}', 'joggers')
  .replace("{{ block.settings.placement | default: 'below_atc' }}", 'below_cart')
  .replace('{{ request.design_mode }}', 'false');

const SOCKS = { id: 'gid://shopify/Product/201', title: 'Socks', handle: 'socks', price: '199' };
const CAP = { id: 'gid://shopify/Product/202', title: 'Cap', handle: 'cap', price: '500' };
const catalog = (capAvailable = true, socksVariants = null) => ({ products: [
  { id: 201, variants: socksVariants || [{ id: 9201, available: true, price: '199.00', compare_at_price: null }] },
  { id: 202, variants: [{ id: 9202, available: capAvailable, price: '500.00', compare_at_price: null }] },
] });

const browser = await chromium.launch();

// products: a whole /products.json catalog instead of catalog(); pageProduct:
// the viewed product's /products/joggers.js (its options and variants).
async function open({ condition, temp1 = {}, cart = [], capAvailable = true, width = 1100, whole = false, socksVariants = null, products = null, pageProduct = null, catalogDelay = 0, themeCss = '', productJs = {} }) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  // Account → Price display → "Hide decimals in prices" (printed by the block).
  if (whole) await page.addInitScript(() => { window.__brixWholePrices = true; });
  const log = { added: [], hits: { config: 0, catalog: 0 } };
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  const config = { status: 'success', data: { selectedTemp: 'fbt1', isEnabled: true, temp1: { layout: 'carousel', interactionType: 'classic', showPrices: true, showAddAllButton: true, widgetPlacement: 'below_cart', ...temp1 }, condition } };
  await page.route('https://int.thebrix.io/**', (r) => (log.hits.config += 1) && r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(config) }));
  await page.route('http://shop.test/**', async (r) => {
    const url = new URL(r.request().url());
    if (url.pathname === '/products.json') { log.hits.catalog += 1; if (catalogDelay) await new Promise((res) => setTimeout(res, catalogDelay)); }
    if (url.pathname === '/products.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(products ? { products } : catalog(capAvailable, socksVariants)) });
    if (productJs[url.pathname]) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(productJs[url.pathname]) });
    if (url.pathname === '/products/joggers.js') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(pageProduct || { options: [], variants: [] }) });
    if (url.pathname === '/cart.js') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: cart }) });
    if (url.pathname === '/cart/add.js') { log.added.push(r.request().postDataJSON()); return r.fulfill({ contentType: 'application/json', body: '{"items":[]}' }); }
    if (url.hostname === 'img.test' || url.pathname.endsWith('.svg')) return r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#16a34a"/></svg>' });
    // The product page form: variant 1005 of the viewed product (id 100) is selected.
    return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${themeCss}</style></head><body style="margin:0;font-family:Arial"><form action="/cart/add"><input type="hidden" name="id" value="1005"><button name="add" type="submit">Add to cart</button></form>${fbt}</body></html>` });
  });
  await page.goto('http://shop.test/products/joggers');
  if (catalogDelay) return { page, log };
  await page.waitForSelector('ps-fbt-widget .ps-product-card, ps-fbt-widget .ps-product-row', { timeout: 10000 });
  return { page, log };
}

const OFFER = { type: 'percentage', value: 10, text: 'Buy all {count} together and save {discount}' };

/* L. Loading: placeholders while products load; a widget the theme re-creates
   (Dawn re-renders the product section on every size click) draws again at
   once from what this visit already downloaded, never hidden in between. */
{
  // Dawn hides every empty div: the placeholders must still show.
  const { page, log } = await open({ condition: [{ id: 'rl', displayScope: 'per_product', triggerProducts: [{ id: 'gid://shopify/Product/100' }], fbtProducts: [SOCKS, CAP] }], catalogDelay: 2500, themeCss: 'div:empty{display:none}' });
  await page.waitForSelector('ps-fbt-widget .ps-fbt-skel', { timeout: 5000 });
  const blocks = await page.$$eval('ps-fbt-widget .ps-fbt-skel', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(e).backgroundColor]; }));
  check('loading: grey blocks visible on a theme that hides empty divs', blocks.length >= 10 && blocks.every(([w, h, bg]) => w > 0 && h > 0 && bg === 'rgb(230, 232, 236)'), JSON.stringify(blocks.slice(0, 3)));
  check('loading: the real heading shows at once', (await page.textContent('ps-fbt-widget .ps-fbt-title')) === 'Frequently Bought Together');
  await page.screenshot({ path: path.join(shotDir, 'skeleton.png') });
  const skel = await page.evaluate(() => { const w = document.querySelector('ps-fbt-widget'); return { shown: getComputedStyle(w).display, cards: w.querySelectorAll('.ps-product-card').length, busy: !!w.querySelector('[aria-busy="true"]') }; });
  check('loading: placeholders shown in place (no empty gap, no pop-in)', skel.shown === 'block' && skel.cards === 0 && skel.busy, JSON.stringify(skel));
  await page.waitForSelector('ps-fbt-widget .ps-product-card', { timeout: 6000 });
  check('loading: real cards replace them', (await page.$$('ps-fbt-widget .ps-fbt-skel')).length === 0);
  const hitsBefore = { ...log.hits };
  // What a Dawn-style theme does on a size click: the section's HTML (with a new widget) replaces the old.
  const samples = await page.evaluate(async () => {
    const old = document.querySelector('ps-fbt-widget');
    const fresh = document.createElement('ps-fbt-widget');
    for (const a of old.attributes) fresh.setAttribute(a.name, a.value);
    fresh.style.display = 'none';
    const out = [];
    old.replaceWith(fresh);
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const w = document.querySelector('ps-fbt-widget');
      out.push(`${getComputedStyle(w).display}:${w.querySelectorAll('.ps-product-card').length}`);
    }
    return out;
  });
  check('re-created widget: cards on the next frames, never hidden', samples.slice(1).every((x) => x === 'block:2'), samples.join(' | '));
  check('re-created widget: nothing downloaded again', log.hits.config === hitsBefore.config && log.hits.catalog === hitsBefore.catalog, JSON.stringify({ before: hitsBefore, after: log.hits }));
  await page.close();
}

/* S. Match the shopper's size (AI-Powered mode) */
{
  const v = (id, size, available = true, price = '500.00') => ({ id, title: size, option1: size, available, price, compare_at_price: null });
  const products = [
    { id: 203, options: [{ name: 'Size', position: 1 }], variants: [v(9301, '10 Y'), v(9302, '12 Y', true, '550.00'), v(9303, '13-14 Y')] },
    { id: 204, options: [{ name: 'Size', position: 1 }], variants: [v(9401, '8 Y'), v(9402, '10 Y')] },
    { id: 201, options: [{ name: 'Title', position: 1 }], variants: [v(9201, 'Default Title', true, '199.00')] },
  ];
  // The viewed joggers: 12 Years picked (the page form's variant 1005), 10 Years is 1006.
  const pageProduct = { options: [{ name: 'Size', position: 1 }], variants: [{ id: 1006, option1: '10 Years', available: true, price: 79900 }, { id: 1005, option1: '12 Years', available: true, price: 80000 }] };
  const TOP = { id: 'gid://shopify/Product/203', title: 'Top', handle: 'top', price: '500' };
  const JEANS = { id: 'gid://shopify/Product/204', title: 'Jeans', handle: 'jeans', price: '500' };
  const SOCK = { id: 'gid://shopify/Product/201', title: 'Socks', handle: 'socks', price: '199' };
  const sizeRule = (extra = {}) => ({ id: 'rs', displayScope: 'per_product', triggerProducts: [{ id: 'gid://shopify/Product/100' }], fbtProducts: [TOP, JEANS, SOCK], ...extra });
  const titles = (page) => page.$$eval('ps-fbt-widget .ps-product-title', (els) => els.map((e) => e.textContent));

  let { page, log } = await open({ condition: [sizeRule()], temp1: { sizeMatchLive: true, showVariantPicker: true }, products, pageProduct });
  check('size 12: jeans (no 12 in stock) hidden, sizeless socks kept', (await titles(page)).join('|') === 'Top|Socks', (await titles(page)).join('|'));
  check('size 12: the top shows its 12 Y, priced', (await page.$eval('ps-fbt-widget .ps-fbt-variant', (e) => e.value)) === '9302' && (await page.textContent('ps-fbt-widget .ps-product-card .ps-product-price')) === '₹550');
  await page.locator('ps-fbt-widget .ps-fbt-addall').click();
  await page.waitForFunction(() => /Added/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
  check('Add all adds the 12 Y top', (log.added[0]?.items || []).map((i) => String(i.id)).join(',') === '9302,9201', JSON.stringify(log.added[0]));
  // The shopper picks 10 Years on the page (themes set the form value without events).
  await page.evaluate(() => { document.querySelector('form[action*="/cart/add"] [name="id"]').value = '1006'; });
  await page.waitForFunction(() => document.querySelectorAll('ps-fbt-widget .ps-product-title').length === 3, null, { timeout: 4000 }).catch(() => {});
  check('size changed to 10: jeans back in 10 Y, top switches to 10 Y', (await titles(page)).join('|') === 'Top|Jeans|Socks'
    && (await page.$$eval('ps-fbt-widget .ps-fbt-variant', (els) => els.map((e) => e.value))).join(',') === '9301,9402', (await titles(page)).join('|'));
  await page.close();

  ({ page, log } = await open({ condition: [sizeRule({ offer: OFFER })], temp1: { sizeMatchLive: true, sizeMatchMissing: 'note' }, products, pageProduct }));
  check('note mode: jeans shown greyed "Not in 12 Years"', (await page.textContent('ps-fbt-widget')).includes('Not in 12 Years'));
  check('note mode: no bundle offer (the set isn\'t complete in this size)', (await page.$('ps-fbt-widget .ps-fbt-offer')) === null);
  await page.screenshot({ path: path.join(shotDir, 'size-note.png') });
  await page.locator('ps-fbt-widget .ps-fbt-addall').click();
  await page.waitForFunction(() => /Added/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
  check('note mode: Add all skips the greyed jeans', (log.added[0]?.items || []).map((i) => String(i.id)).join(',') === '9302,9201', JSON.stringify(log.added[0]));
  await page.close();

  // Replace (the default): a spare AI pick in that size takes the jeans' place.
  const SHORTS = { id: 'gid://shopify/Product/205', title: 'Shorts', handle: 'shorts', price: '400' };
  const DRESS = { id: 'gid://shopify/Product/206', title: 'Dress', handle: 'dress', price: '900' };
  const withSpares = [...products,
    { id: 205, options: [{ name: 'Size', position: 1 }], variants: [v(9501, '11-12 Y', true, '420.00')] },
    { id: 206, options: [{ name: 'Size', position: 1 }], variants: [v(9601, '6 Y')] }];
  ({ page, log } = await open({ condition: [sizeRule({ backupProducts: [DRESS, SHORTS] })], temp1: { sizeMatchLive: true, showVariantPicker: true }, products: withSpares, pageProduct }));
  check('replace: shorts (in 11-12 Y) take the jeans\' place, dress (no 12) skipped', (await titles(page)).join('|') === 'Top|Shorts|Socks', (await titles(page)).join('|'));
  await page.locator('ps-fbt-widget .ps-fbt-addall').click();
  await page.waitForFunction(() => /Added/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
  check('replace: Add all adds the shorts in 11-12 Y', (log.added[0]?.items || []).map((i) => String(i.id)).join(',') === '9302,9501,9201', JSON.stringify(log.added[0]));
  await page.evaluate(() => { document.querySelector('form[action*="/cart/add"] [name="id"]').value = '1006'; });
  await page.waitForFunction(() => [...document.querySelectorAll('ps-fbt-widget .ps-product-title')].map((e) => e.textContent).join('|') === 'Top|Jeans|Socks', null, { timeout: 4000 }).catch(() => {});
  check('replace: at 10 Years the jeans come back (no spare needed)', (await titles(page)).join('|') === 'Top|Jeans|Socks', (await titles(page)).join('|'));
  await page.close();

  ({ page } = await open({ condition: [sizeRule()], temp1: { sizeMatch: true, sizeMatchLive: false }, products, pageProduct }));
  check('manual mode (not live): no size matching, every product shown', (await titles(page)).join('|') === 'Top|Jeans|Socks');
  await page.close();
}
const rule = (extra = {}) => ({ id: 'r1', displayScope: 'per_product', triggerProducts: [{ id: 'gid://shopify/Product/100' }], fbtProducts: [SOCKS, CAP], ...extra });

/* 0. Variant picker + "show the discount" (savings line, struck bundle total, per-product prices) */
{
  const socksVariants = [
    { id: 9201, title: 'Small', available: true, price: '199.00', compare_at_price: null },
    { id: 9203, title: 'Large', available: true, price: '249.00', compare_at_price: null },
    { id: 9204, title: 'XL', available: false, price: '249.00', compare_at_price: null },
  ];
  const temp1 = { showVariantPicker: true, offerShowSavings: true, offerStrikeTotal: true, offerProductPrices: true };
  const { page, log } = await open({ condition: [rule({ offer: OFFER })], temp1, socksVariants });
  const opts = await page.$$eval('ps-fbt-widget .ps-fbt-variant option', (els) => els.map((o) => `${o.textContent}${o.disabled ? '!' : ''}`));
  check('variant picker: only on the product with options; sold-out listed but not pickable', opts.join('|') === 'Small|Large|XL - Sold out!', opts.join('|'));
  const savings = () => page.textContent('ps-fbt-widget .ps-fbt-savings');
  const total = () => page.textContent('ps-fbt-widget .ps-total-price');
  check('savings line: 10% of ₹800 + ₹199 + ₹500', (await savings()) === 'You save ₹149.9', await savings());
  check('bundle total struck through with the new one', (await total()) === '₹1,499₹1,349.1', await total());
  check('total label names the whole set', (await page.textContent('ps-fbt-widget .ps-total-label')) === 'Bundle total (3 items)');
  check('each product: old price struck, price after its share', (await page.textContent('ps-fbt-widget .ps-product-card .ps-product-price')) === '₹199₹179.1');
  await page.selectOption('ps-fbt-widget .ps-fbt-variant', '9203');
  check('picking Large updates the savings and prices', (await savings()) === 'You save ₹154.9' && (await page.textContent('ps-fbt-widget .ps-product-card .ps-product-price')) === '₹249₹224.1', await savings());
  await page.screenshot({ path: path.join(shotDir, 'variants-savings.png') });
  await page.click('ps-fbt-widget .ps-product-card:nth-of-type(1) .ps-classic-btn');
  check('not the whole set: no savings shown, plain total', !(await page.isVisible('ps-fbt-widget .ps-fbt-savings')) && (await total()) === '₹500');
  await page.click('ps-fbt-widget .ps-product-card:nth-of-type(1) .ps-classic-btn');
  await page.locator('ps-fbt-widget .ps-fbt-addall').click();
  await page.waitForFunction(() => /Added/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
  const ids = (log.added[0]?.items || []).map((i) => String(i.id));
  check('Add all adds the picked variant (Large)', ids.join(',') === '1005,9203,9202', ids.join(','));
  await page.close();
}
{
  const { page } = await open({ condition: [rule({ offer: OFFER })], socksVariants: [{ id: 9201, title: 'Small', available: true, price: '199.00' }, { id: 9203, title: 'Large', available: true, price: '249.00' }] });
  check('switches off by default: no picker, no savings line, plain total', (await page.$('ps-fbt-widget .ps-fbt-variant')) === null && (await page.$('ps-fbt-widget .ps-fbt-savings')) === null && (await page.textContent('ps-fbt-widget .ps-total-price')) === '₹699');
  await page.close();
}

/* 1. Live offer: text, Add all adds the viewed product too */
{
  const { page, log } = await open({ condition: [rule({ offer: OFFER })] });
  const text = await page.locator('ps-fbt-widget .ps-fbt-offer').textContent().catch(() => null);
  check('offer: "Buy all 3 together and save 10%" (2 recommended + the viewed product)', text === 'Buy all 3 together and save 10%', text);
  check('offer: the button says it adds the whole set', (await page.locator('ps-fbt-widget .ps-fbt-addall').textContent()) === 'Add all 3 to Cart');
  await page.screenshot({ path: path.join(shotDir, 'offer.png') });
  await page.locator('ps-fbt-widget .ps-fbt-addall').click();
  await page.waitForFunction(() => /Added/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
  const ids = (log.added[0]?.items || []).map((i) => String(i.id));
  check('offer: Add all also adds the viewed product (the variant chosen on the page)', ids.join(',') === '1005,9201,9202', ids.join(','));
  await page.close();
}

/* 2. Viewed product already in the cart: not added twice */
{
  const { page, log } = await open({ condition: [rule({ offer: OFFER })], cart: [{ product_id: 100, variant_id: 1005, quantity: 1 }] });
  await page.locator('ps-fbt-widget .ps-fbt-addall').click();
  await page.waitForFunction(() => /Added/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
  const ids = (log.added[0]?.items || []).map((i) => String(i.id));
  check('offer: viewed product already in the cart is not added again', ids.join(',') === '9201,9202', ids.join(','));
  await page.close();
}

/* 3. No live offer: nothing shown, Add all unchanged */
{
  const { page, log } = await open({ condition: [rule()] });
  check('no offer on the rule: no offer text', await page.locator('ps-fbt-widget .ps-fbt-offer').count() === 0);
  await page.locator('ps-fbt-widget .ps-fbt-addall').click();
  await page.waitForFunction(() => /Added/.test(document.querySelector('ps-fbt-widget .ps-fbt-addall').textContent));
  check('no offer: Add all adds only the recommended products', (log.added[0]?.items || []).map((i) => String(i.id)).join(',') === '9201,9202');
  await page.close();
}

/* 4. A product of the set sold out: the offer can't be completed, so it isn't shown */
{
  const { page } = await open({ condition: [rule({ offer: OFFER })], capAvailable: false });
  check('set product sold out: no offer text', await page.locator('ps-fbt-widget .ps-fbt-offer').count() === 0);
  await page.close();
}

/* 4b. Show only, "offer from N items" (the store's own "any N" discount) */
{
  const temp1 = { offerShowSavings: true, offerStrikeTotal: true };
  const { page } = await open({ condition: [rule({ offer: { type: 'percentage', value: 10, text: 'Buy any {count} together and save {discount}', min: 2 } })], temp1 });
  const savings = () => page.textContent('ps-fbt-widget .ps-fbt-savings');
  check('any N: "Buy any 2 together and save 10%"', (await page.locator('ps-fbt-widget .ps-fbt-offer').textContent()).startsWith('Buy any 2 together and save 10%'));
  check('any N: everything picked = 10% of ₹800 + ₹199 + ₹500', (await savings()) === 'You save ₹149.9', await savings());
  await page.click('ps-fbt-widget .ps-product-card:nth-of-type(2) .ps-classic-btn');
  check('any N: 2 items (viewed + socks) still get it: ₹99.9', (await savings()) === 'You save ₹99.9' && (await page.textContent('ps-fbt-widget .ps-total-label')) === 'Bundle total (2 items)', await savings());
  await page.click('ps-fbt-widget .ps-product-card:nth-of-type(1) .ps-classic-btn');
  check('any N: below 2 items, no saving shown', !(await page.isVisible('ps-fbt-widget .ps-fbt-savings')));
  await page.close();
}

/* 5. Amount offer text */
{
  const { page } = await open({ condition: [rule({ offer: { type: 'fixed_amount', value: 150, text: 'Save {discount} when you take all {count}' } })] });
  check('amount offer: "Save ₹150 when you take all 3"', (await page.locator('ps-fbt-widget .ps-fbt-offer').textContent()) === 'Save ₹150 when you take all 3');
  await page.close();
}

/* 6. Offer text style: colours, font, size, weight, italic, alignment */
{
  const css = (page) => page.$eval('ps-fbt-widget .ps-fbt-offer', (e) => { const c = getComputedStyle(e); return { color: c.color, bg: c.backgroundColor, size: c.fontSize, weight: c.fontWeight, style: c.fontStyle, align: c.textAlign, family: c.fontFamily }; });
  const styled = await open({ condition: [rule({ offer: OFFER })], temp1: { priceColor: '#059669', offerTextColor: '#b91c1c', offerBgColor: '#fef3c7', offerFontSize: 17, offerFontWeight: 500, offerItalic: true, offerAlign: 'left', offerFontFamily: 'Poppins' } });
  const c = await css(styled.page);
  check('offer style: the merchant\'s colours, size, weight, italic, left, Poppins', c.color === 'rgb(185, 28, 28)' && c.bg === 'rgb(254, 243, 199)' && c.size === '17px' && c.weight === '500' && c.style === 'italic' && c.align === 'left' && /Poppins/.test(c.family), JSON.stringify(c));
  check('offer style: the Google font is loaded once', await styled.page.$$eval('link[href*="fonts.googleapis.com"][href*="Poppins"]', (l) => l.length) === 1);
  await styled.page.close();
  const plain = await open({ condition: [rule({ offer: OFFER })], temp1: { priceColor: '#059669' } });
  const d = await css(plain.page);
  check('offer style: unset = as before (price colour, 13px bold, centred)', d.color === 'rgb(5, 150, 105)' && d.size === '13px' && d.weight === '700' && d.style === 'normal' && d.align === 'center', JSON.stringify(d));
  await plain.page.close();
  const bad = await open({ condition: [rule({ offer: OFFER })], temp1: { offerFontSize: 99, offerFontWeight: 950, offerAlign: 'middle', offerFontFamily: 'x;}body{', offerTextColor: 'red;}' } });
  const e = await css(bad.page);
  check('offer style: bad values clamped / ignored', e.size === '24px' && e.weight === '700' && e.align === 'center' && !/body/.test(e.family), JSON.stringify(e));
  await bad.page.close();
}

/* 7. "Hide decimals in prices": the offer's amount is whole */
{
  const AMOUNT = { type: 'fixed_amount', value: 150.5, text: 'Save {discount} on all {count}' };
  const exact = await open({ condition: [rule({ offer: AMOUNT })] });
  check('amount offer with paise: "Save ₹150.50 on all 3"', (await exact.page.locator('ps-fbt-widget .ps-fbt-offer').textContent()) === 'Save ₹150.50 on all 3');
  await exact.page.close();
  const whole = await open({ condition: [rule({ offer: AMOUNT })], whole: true });
  check('hide decimals: "Save ₹151 on all 3"', (await whole.page.locator('ps-fbt-widget .ps-fbt-offer').textContent()) === 'Save ₹151 on all 3');
  await whole.page.close();
}

/* 8. knitnknot.in's saved template: vertical + Quick Add (image 107px) draws the list */
{
  for (const width of [1100, 390]) {
    const { page } = await open({ condition: [rule()], temp1: { layout: 'vertical', interactionType: 'quickAdd', imageSize: 107 }, width });
    const g = await page.evaluate(() => {
      const w = document.querySelector('ps-fbt-widget [data-layout]');
      const rows = [...document.querySelectorAll('ps-fbt-widget .ps-product-row')].map((r) => { const b = r.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width)]; });
      return { layout: w && w.dataset.layout, cls: w && w.className, rows, cards: document.querySelectorAll('ps-fbt-widget .ps-product-card').length };
    });
    const stacked = g.rows.length >= 2 && g.rows.every((r, i) => i === 0 || r[1] > g.rows[i - 1][1]);
    check(`vertical + Quick Add at ${width}px: rows one under the other`, g.layout === 'vertical' && g.cards === 0 && stacked, JSON.stringify(g));
    await page.screenshot({ path: path.join(shotDir, `vertical-quickadd-${width}.png`) });
    await page.close();
  }
}

/* Start selected (a bundle) or let shoppers add each one */
{
  const btns = (page) => page.$$eval('ps-fbt-widget .ps-product-card button, ps-fbt-widget .ps-product-row button', (els) => els.map((b) => b.textContent.trim()));
  const addAll = (page) => page.$eval('ps-fbt-widget .ps-fbt-addall', (b) => (getComputedStyle(b).display === 'none' ? 'hidden' : b.textContent.trim()));

  const classicOff = await open({ condition: [rule()], temp1: { interactionType: 'classic', startSelected: false } });
  check('Classic, start selected off: products show "Add", cart button hidden', (await btns(classicOff.page)).every((t) => t === 'Add') && (await addAll(classicOff.page)) === 'hidden', JSON.stringify(await btns(classicOff.page)));
  await classicOff.page.locator('ps-fbt-widget .ps-product-card button', { hasText: 'Add' }).first().click();
  check('…one tap adds just that product', (await addAll(classicOff.page)) === 'Add 1 to Cart');
  await classicOff.page.close();

  const classicDefault = await open({ condition: [rule()], temp1: { interactionType: 'classic' } });
  check('Classic, not set: starts all "Added" as before', (await btns(classicDefault.page)).every((t) => t === 'Added') && (await addAll(classicDefault.page)) === 'Add 2 to Cart');
  await classicDefault.page.close();

  const quickOn = await open({ condition: [rule()], temp1: { interactionType: 'quickAdd', startSelected: true } });
  check('Quick Add, start selected on: steppers at 1, "Add 2 to Cart"', (await addAll(quickOn.page)) === 'Add 2 to Cart');
  await quickOn.page.close();

  const quickDefault = await open({ condition: [rule()], temp1: { interactionType: 'quickAdd' } });
  check('Quick Add, not set: starts with "Add" buttons as before', (await addAll(quickDefault.page)) === 'hidden');
  await quickDefault.page.close();

  const bundleOff = await open({ condition: [rule()], temp1: { interactionType: 'bundle', startSelected: false } });
  check('Bundle always starts with everything ticked', (await addAll(bundleOff.page)) === 'Add 2 to Cart');
  await bundleOff.page.close();
}

/* 6. Image and spacing settings */
const measure = (page) => page.evaluate(() => {
  const w = document.querySelector('ps-fbt-widget');
  const wrap = w.querySelector('.ps-fbt-wrapper');
  const cards = [...w.querySelectorAll('.ps-product-card')];
  const img = w.querySelector('.ps-product-image');
  const imgEl = img && img.querySelector('img');
  const products = w.querySelector('.ps-fbt-products');
  return {
    pad: getComputedStyle(wrap).paddingTop,
    gap: getComputedStyle(products).columnGap,
    cardW: cards[0] ? Math.round(cards[0].getBoundingClientRect().width) : 0,
    cardPad: cards[0] ? getComputedStyle(cards[0]).paddingTop : '',
    imgH: img ? Math.round(img.getBoundingClientRect().height) : 0,
    imgR: img ? getComputedStyle(img).borderTopLeftRadius : '',
    imgBg: img ? getComputedStyle(img).backgroundColor : '',
    fit: imgEl ? getComputedStyle(imgEl).objectFit : '',
    margin: [getComputedStyle(w).marginTop, getComputedStyle(w).marginBottom],
  };
});
{
  const withImg = [rule({ fbtProducts: [{ ...SOCKS, image: 'http://shop.test/socks.svg' }, { ...CAP, image: 'http://shop.test/cap.svg' }] })];
  const def = await open({ condition: withImg });
  const d = await measure(def.page);
  check('defaults unchanged: 20px padding, 10px gap, 140px cards, 64px images, 8px corners, whole image, 16px margins',
    d.pad === '20px' && d.gap === '10px' && d.cardW === 140 && d.imgH === 64 && d.imgR === '8px' && d.fit === 'contain' && d.margin.join() === '16px,16px', JSON.stringify(d));
  await def.page.close();

  const custom = await open({ condition: withImg, temp1: { imageSize: 120, imageRadius: 60, imageFit: 'cover', imageBg: '#ffeeaa', cardWidth: 200, gap: 24, cardPadding: 16, widgetPadding: 32, marginTop: 40, marginBottom: 8 } });
  const c = await measure(custom.page);
  check('custom: widget padding, gap, card width and padding', c.pad === '32px' && c.gap === '24px' && c.cardW === 200 && c.cardPad === '16px', JSON.stringify(c));
  check('custom: image height, corners, fill and background', c.imgH === 120 && c.imgR === '60px' && c.fit === 'cover' && c.imgBg === 'rgb(255, 238, 170)', JSON.stringify(c));
  check('custom: space above and below the widget', c.margin.join() === '40px,8px', c.margin.join());
  await custom.page.screenshot({ path: path.join(shotDir, 'custom-layout.png') });
  await custom.page.close();

  const phone = await open({ condition: withImg, temp1: { widgetPadding: 30 }, width: 390 });
  check('phone: widget padding is 70% (21px)', (await measure(phone.page)).pad === '21px');
  await phone.page.close();

  const list = await open({ condition: withImg, temp1: { layout: 'vertical', imageSize: 80, cardPadding: 14 } });
  const row = await list.page.evaluate(() => {
    const r = document.querySelector('ps-fbt-widget .ps-product-row');
    const img = document.querySelector('ps-fbt-widget .ps-product-row-image');
    return { img: Math.round(img.getBoundingClientRect().width), pad: getComputedStyle(r).paddingTop };
  });
  check('list rows: image 75% of the size (60px), padding +2 (16px)', row.img === 60 && row.pad === '16px', JSON.stringify(row));
  await list.page.close();

  const bad = await open({ condition: withImg, temp1: { imageSize: 9999, gap: -5, imageFit: 'stretch', imageBg: 'red;}' } });
  const b = await measure(bad.page);
  check('bad values are clamped / ignored', b.imgH === 200 && b.gap === '0px' && b.fit === 'contain', JSON.stringify(b));
  await bad.page.close();
}

/* 9. Spacing inside each product (image to text, title to price, list rows) */
const inner = (page) => page.evaluate(() => {
  const w = document.querySelector('ps-fbt-widget');
  const card = w.querySelector('.ps-product-card, .ps-product-row');
  const price = w.querySelector('.ps-product-price, .ps-product-row-price');
  const wrap = w.querySelector('.ps-fbt-products');
  return { gap: getComputedStyle(card).columnGap, priceTop: getComputedStyle(price).marginTop, listGap: getComputedStyle(wrap).rowGap };
});
{
  const withImg = [rule({ fbtProducts: [{ ...SOCKS, image: 'http://shop.test/socks.svg' }, { ...CAP, image: 'http://shop.test/cap.svg' }] })];
  const d = await open({ condition: withImg });
  const dc = await inner(d.page);
  check('spacing defaults unchanged: cards 8px image to text, 4px title to price', dc.gap === '8px' && dc.priceTop === '4px', JSON.stringify(dc));
  await d.page.close();
  const dl = await open({ condition: withImg, temp1: { layout: 'vertical' } });
  const dlc = await inner(dl.page);
  check('spacing defaults unchanged: rows 12px / 2px, no space between rows', dlc.gap === '12px' && dlc.priceTop === '2px' && (dlc.listGap === '0px' || dlc.listGap === 'normal'), JSON.stringify(dlc));
  await dl.page.close();
  const c = await open({ condition: withImg, temp1: { imageTextGap: 20, textGap: 10, rowGap: 14 } });
  const cc = await inner(c.page);
  check('spacing custom (cards): image to text 20px, title to price 10px', cc.gap === '20px' && cc.priceTop === '10px', JSON.stringify(cc));
  await c.page.close();
  const cl = await open({ condition: withImg, temp1: { layout: 'vertical', imageTextGap: 20, textGap: 10, rowGap: 14 } });
  const clc = await inner(cl.page);
  check('spacing custom (list): 20px / 10px, 14px between rows', clc.gap === '20px' && clc.priceTop === '10px' && clc.listGap === '14px', JSON.stringify(clc));
  await cl.page.screenshot({ path: path.join(shotDir, 'list-spacing.png') });
  await cl.page.close();
}

/* 10. Image popup: a tap on a product's image shows all its pictures */
{
  const withImg = [rule({ fbtProducts: [{ ...SOCKS, image: 'http://shop.test/socks.svg' }, { ...CAP, image: 'http://shop.test/cap.svg' }] })];
  const productJs = { '/products/socks.js': { title: 'Socks', images: ['http://shop.test/socks-front.svg', 'http://shop.test/socks.svg?v=2', 'http://shop.test/socks-back.svg'] } };
  const { page } = await open({ condition: withImg, productJs, themeCss: 'div:empty{display:none}' });
  check('popup: images are tappable', (await page.$$('ps-fbt-widget [data-fbt-zoom]')).length === 2);
  await page.click('ps-fbt-widget .ps-product-image >> nth=0');
  await page.waitForSelector('#ps-fbt-pop .ps-fbt-pop-thumb', { timeout: 5000 });
  const st = () => page.evaluate(() => {
    const p = document.getElementById('ps-fbt-pop');
    if (!p) return null;
    return { title: p.querySelector('.ps-fbt-pop-title').textContent, count: (p.querySelector('.ps-fbt-pop-count') || {}).textContent || '', thumbs: p.querySelectorAll('.ps-fbt-pop-thumb').length, src: p.querySelector('.ps-fbt-pop-main img').getAttribute('src'), price: (p.querySelector('.ps-fbt-pop-price') || {}).textContent || '', link: (p.querySelector('.ps-fbt-pop-link') || {}).getAttribute?.('href') || '', label: p.getAttribute('aria-label'), overflow: document.documentElement.style.overflow, visible: getComputedStyle(p).display !== 'none' };
  });
  const a = await st();
  check('popup: opens on the card picture, in the product\'s order, no duplicate', a && a.visible && a.thumbs === 3 && a.count === '2 / 3' && a.src.includes('socks.svg'), JSON.stringify(a));
  check('popup: title, price, product link, dialog label', a.title === 'Socks' && a.price.includes('199') && a.link === '/products/socks' && a.label === 'Socks', JSON.stringify(a));
  check('popup: page scroll locked while open', a.overflow === 'hidden');
  await page.click('#ps-fbt-pop .ps-fbt-pop-next');
  check('popup: next arrow', (await st()).count === '3 / 3');
  await page.keyboard.press('ArrowRight');
  check('popup: → wraps to the first', (await st()).count === '1 / 3');
  await page.click('#ps-fbt-pop .ps-fbt-pop-thumb >> nth=2');
  const t = await st();
  check('popup: thumbnail picks the picture', t.count === '3 / 3' && t.src.includes('socks-back'), JSON.stringify(t));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shotDir, 'image-popup.png') });
  await page.keyboard.press('Escape');
  check('popup: Esc closes and gives scroll back', (await st()) === null && (await page.evaluate(() => document.documentElement.style.overflow)) === '');
  await page.click('ps-fbt-widget .ps-product-image >> nth=1');
  await page.waitForSelector('#ps-fbt-pop', { timeout: 5000 });
  const one = await st();
  check('popup: a product without more pictures shows its one image, no arrows', one.thumbs === 0 && one.count === '' && one.src.includes('cap.svg'), JSON.stringify(one));
  await page.mouse.click(5, 5);
  check('popup: tap outside closes', (await st()) === null);
  await page.close();

  const phone = await open({ condition: withImg, productJs, width: 390 });
  await phone.page.click('ps-fbt-widget .ps-product-image >> nth=0');
  await phone.page.waitForSelector('#ps-fbt-pop .ps-fbt-pop-thumb', { timeout: 5000 });
  const sheet = await phone.page.evaluate(() => { const r = document.querySelector('#ps-fbt-pop .ps-fbt-pop-panel').getBoundingClientRect(); return { bottom: Math.round(r.bottom), width: Math.round(r.width), vh: innerHeight }; });
  check('popup (phone): a bottom sheet the full width', sheet.bottom === sheet.vh && sheet.width === 390, JSON.stringify(sheet));
  await phone.page.waitForTimeout(300);
  await phone.page.screenshot({ path: path.join(shotDir, 'image-popup-phone.png') });
  await phone.page.close();

  const off = await open({ condition: withImg, productJs, temp1: { imagePopup: false } });
  await off.page.click('ps-fbt-widget .ps-product-image >> nth=0');
  await off.page.waitForTimeout(300);
  check('popup off: images are not tappable', (await off.page.$$('ps-fbt-widget [data-fbt-zoom]')).length === 0 && !(await off.page.$('#ps-fbt-pop')));
  await off.page.close();
}

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed · screenshots in ${shotDir}`);
process.exit(passed === results.length ? 0 : 1);

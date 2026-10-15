/* eslint-env node */
// Real-browser check of the FBT widget (snippets/fbt-widget-render.liquid):
//  - the "buy all together" offer text, only on rules the server marked live
//    and only while every product of the set is shown
//  - Add all also adds the product being viewed when an offer applies
//  - image and spacing settings (sizes, corners, fit, gaps, padding, margins)
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
  .replace('{{ product.id }}', '100')
  .replace('{{ shop.permanent_domain }}', 'demo.myshopify.com')
  .replace('{{ shop.currency }}', 'INR')
  .replace("{{ block.settings.placement | default: 'below_atc' }}", 'below_cart')
  .replace('{{ request.design_mode }}', 'false');

const SOCKS = { id: 'gid://shopify/Product/201', title: 'Socks', handle: 'socks', price: '199' };
const CAP = { id: 'gid://shopify/Product/202', title: 'Cap', handle: 'cap', price: '500' };
const catalog = (capAvailable = true) => ({ products: [
  { id: 201, variants: [{ id: 9201, available: true, price: '199.00', compare_at_price: null }] },
  { id: 202, variants: [{ id: 9202, available: capAvailable, price: '500.00', compare_at_price: null }] },
] });

const browser = await chromium.launch();

async function open({ condition, temp1 = {}, cart = [], capAvailable = true, width = 1100, whole = false }) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  // Account → Price display → "Hide decimals in prices" (printed by the block).
  if (whole) await page.addInitScript(() => { window.__brixWholePrices = true; });
  const log = { added: [] };
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  const config = { status: 'success', data: { selectedTemp: 'fbt1', isEnabled: true, temp1: { layout: 'carousel', interactionType: 'classic', showPrices: true, showAddAllButton: true, widgetPlacement: 'below_cart', ...temp1 }, condition } };
  await page.route('https://int.thebrix.io/**', (r) => r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(config) }));
  await page.route('http://shop.test/**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname === '/products.json') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(catalog(capAvailable)) });
    if (url.pathname === '/cart.js') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: cart }) });
    if (url.pathname === '/cart/add.js') { log.added.push(r.request().postDataJSON()); return r.fulfill({ contentType: 'application/json', body: '{"items":[]}' }); }
    if (url.hostname === 'img.test' || url.pathname.endsWith('.svg')) return r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#16a34a"/></svg>' });
    // The product page form: variant 1005 of the viewed product (id 100) is selected.
    return r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font-family:Arial"><form action="/cart/add"><input type="hidden" name="id" value="1005"><button name="add" type="submit">Add to cart</button></form>${fbt}</body></html>` });
  });
  await page.goto('http://shop.test/products/joggers');
  await page.waitForSelector('ps-fbt-widget .ps-product-card, ps-fbt-widget .ps-product-row', { timeout: 10000 });
  return { page, log };
}

const OFFER = { type: 'percentage', value: 10, text: 'Buy all {count} together and save {discount}' };
const rule = (extra = {}) => ({ id: 'r1', displayScope: 'per_product', triggerProducts: [{ id: 'gid://shopify/Product/100' }], fbtProducts: [SOCKS, CAP], ...extra });

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

await browser.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed · screenshots in ${shotDir}`);
process.exit(passed === results.length ? 0 : 1);

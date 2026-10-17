// Real-browser check: Coupon Banner offer ladders on the storefront
// (snippets/coupon-slider-render.liquid): text bars above the coupon cards,
// an optional Copy / Apply button, and optional auto-apply that puts the
// reached offer's code on the cart through /cart/update.js without touching
// the shopper's own codes.
//
//   node tests/coupon-banner/offer-ladder-browser-check.mjs
//
// The PHP config and Shopify's cart are mocked (codes BUY2 / BUY3 / WELCOME /
// SAVE10 exist; anything else comes back "not applicable"), so no store is involved.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const snippet = fs.readFileSync(path.join(process.cwd(), 'extensions', 'cart-drawer', 'snippets', 'coupon-slider-render.liquid'), 'utf8');
const [, ...rest] = snippet.split('\n');
const element = '<ps-coupon-slider id="ps-coupon-slider-b1" data-shop="demo.myshopify.com" data-product-handle="tee" data-collection-handles="" data-product-tags="" data-placement="custom" data-design-mode="false" style="display:none"><div>Loading coupons...</div></ps-coupon-slider>';

const LADDER = {
  ladder: true,
  tiers: [{ text: 'Buy any 2 Get 10% Off', qty: 2, code: 'BUY2' }, { text: 'Buy any 3 Get 15% Off', qty: 3, code: 'BUY3' }, { text: 'Buy any 4 Get 20% Off', qty: 4 }],
  subtextText: 'Discount applied <b>at checkout</b>',
  bgColor: '#111827', textColor: '#ffffff', accentColor: '#facc15',
};
const config = (ladder = LADDER, extraIds = ['gid://shopify/DiscountCodeNode/1']) => ({
  status: 'success',
  data: {
    is_enabled: 1, widgetPlacement: 'custom', selectedTemplate: 'template1', layout: 'carousel',
    selectedCouponsGlobal: ['ladder:abc', ...extraIds],
    temp1DefaultStyle: { headingText: 'GET 10% OFF!', bgColor: '#ffffff', borderRadius: 10 },
    // Only selected ids get a style (the snippet also draws any coupon that has one).
    temp1CouponStyle: { 'ladder:abc': ladder, ...(extraIds.length ? { 'gid://shopify/DiscountCodeNode/1': { couponCode: 'SAVE10' } } : {}) },
    temp1CouponCondition: [],
  },
});

const KNOWN = ['BUY2', 'BUY3', 'WELCOME', 'SAVE10'];
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(true); console.log('  ✓', name); } catch (error) { results.push(false); console.log('  ✗', name, '\n     ', String(error.message).split('\n')[0]); }
};
const browser = await chromium.launch();

const ATC = '<form action="/cart/add"><button name="add">Add</button></form>';
async function open({ cfg = config(), items = 0, codes = [], viewport = { width: 1000, height: 900 }, reducedMotion = 'no-preference', atc = ATC } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cart = { qty: items, codes: [...codes], updates: [] };
  const cartJson = () => ({ items: cart.qty ? [{ handle: 'tee', quantity: cart.qty }, { handle: 'gift', quantity: 1, properties: { _brixReward: 'true' } }] : [], discount_codes: cart.codes.map((c) => ({ code: c, applicable: KNOWN.includes(c.toUpperCase()) })) });
  await page.route('https://int.thebrix.io/**', (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(cfg) }));
  await page.route('http://shop.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/cart.js') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartJson()) });
    if (url.pathname === '/cart/add.js') { cart.qty += 1; return route.fulfill({ contentType: 'application/json', body: '{}' }); }
    if (url.pathname === '/cart/change.js') { cart.qty = JSON.parse(route.request().postData()).quantity; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartJson()) }); }
    if (url.pathname === '/cart/update.js') {
      const body = JSON.parse(route.request().postData());
      cart.updates.push(body.discount);
      cart.codes = String(body.discount).split(',').filter(Boolean);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(cartJson()) });
    }
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="margin:0;padding:16px">${atc}${element}\n${rest.join('\n')}</body></html>` });
  });
  await page.goto('http://shop.test/products/tee');
  await page.waitForSelector('ps-coupon-slider .psl', { timeout: 10000 });
  return { page, context, cart, errors };
}
const addItem = (page) => page.evaluate(() => fetch('/cart/add.js', { method: 'POST', body: '{}' }));
const waitCodes = (cart, want) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => (JSON.stringify(cart.codes) === JSON.stringify(want) ? resolve() : Date.now() - t0 > 5000 ? reject(new Error(`codes ${JSON.stringify(cart.codes)} != ${JSON.stringify(want)}`)) : setTimeout(tick, 50));
  tick();
});

console.log('\nCoupon Banner — offer ladder storefront checks');

await check('default: just the offers text above the coupon card; no progress, no button, cart untouched', async () => {
  const { page, context, cart, errors } = await open({ cfg: config({ ...LADDER, autoApply: false }), items: 3 });
  const box = await page.evaluate(() => {
    const l = document.querySelector('.ps-ladder').getBoundingClientRect(), c = document.querySelector('.ps-card').getBoundingClientRect(), w = document.querySelector('ps-coupon-slider').getBoundingClientRect();
    return { above: l.bottom <= c.top, full: Math.abs(l.width - w.width) < 2, arrows: document.querySelectorAll('.ps-nav').length, text: document.querySelector('.psl').textContent };
  });
  assert.deepEqual([box.above, box.full, box.arrows], [true, true, 0]);
  assert.equal(box.text, 'Buy any 2 Get 10% Off|Buy any 3 Get 15% Off|Buy any 4 Get 20% OffDiscount applied <b>at checkout</b>', 'offers + escaped subtext, nothing else');
  assert.equal(await page.locator('.psl-btn, .psl-bar, .psl-status, .ps-ladder b').count(), 0);
  await addItem(page);
  await page.waitForTimeout(800);
  assert.deepEqual(cart.updates, [], 'auto-apply off: the cart is never touched');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('button "Copy code": copies the code, shows the done text, then goes back', async () => {
  const { page, context, cart } = await open({ cfg: config({ ...LADDER, buttonShow: true, buttonCode: 'SAVE10', buttonText: 'Copy SAVE10' }) });
  // shop.test is not https, so the snippet copies through execCommand: catch what it copies.
  await page.evaluate(() => document.addEventListener('copy', () => { window.__copied = document.activeElement && document.activeElement.value; }));
  const btn = page.locator('.psl-btn');
  assert.equal(await btn.textContent(), 'Copy SAVE10');
  await btn.click();
  await page.waitForFunction(() => document.querySelector('.psl-btn')?.textContent === 'Copied!');
  assert.equal(await page.evaluate(() => window.__copied), 'SAVE10');
  await page.waitForFunction(() => document.querySelector('.psl-btn')?.textContent === 'Copy SAVE10', null, { timeout: 4000 });
  assert.deepEqual(cart.updates, [], 'copy never touches the cart');
  await page.screenshot({ path: path.join(process.cwd(), 'tests', 'coupon-banner', 'screenshots', 'offer-ladder-button.png'), clip: { x: 0, y: 30, width: 1000, height: 200 } });
  await context.close();
});

await check('button "Apply coupon": puts the code on the cart next to the shopper\'s own, then says Applied!', async () => {
  const { page, context, cart } = await open({ cfg: config({ ...LADDER, buttonShow: true, buttonCode: 'SAVE10', buttonAction: 'apply' }), codes: ['WELCOME'] });
  assert.equal(await page.locator('.psl-btn').textContent(), 'Apply coupon');
  await page.locator('.psl-btn').click();
  await page.waitForFunction(() => document.querySelector('.psl-btn')?.textContent === 'Applied!');
  assert.deepEqual(cart.codes, ['WELCOME', 'SAVE10']);
  await page.locator('.psl-btn').click();
  await page.waitForTimeout(400);
  assert.deepEqual(cart.updates, ['WELCOME,SAVE10'], 'already on the cart: not sent again');
  await context.close();
});

await check('button needs a code: switched on without one = no button', async () => {
  const { page, context } = await open({ cfg: config({ ...LADDER, buttonShow: true }) });
  assert.equal(await page.locator('.psl-btn').count(), 0);
  await context.close();
});

await check('auto-apply: code at 2, swapped at 3, off at 4 (automatic discount), back at 2; shopper\'s code kept; gifts don\'t count', async () => {
  const { page, context, cart, errors } = await open({ cfg: config({ ...LADDER, autoApply: true }), items: 1, codes: ['WELCOME'] });
  await page.waitForTimeout(500);
  assert.deepEqual(cart.updates, [], '1 item (+ a free gift): nothing reached');
  await addItem(page);
  await waitCodes(cart, ['WELCOME', 'BUY2']);
  await addItem(page);
  await waitCodes(cart, ['WELCOME', 'BUY3']);
  await addItem(page);
  await waitCodes(cart, ['WELCOME']);
  await page.evaluate(() => fetch('/cart/change.js', { method: 'POST', body: JSON.stringify({ line: 1, quantity: 2 }) }));
  await waitCodes(cart, ['WELCOME', 'BUY2']);
  assert.deepEqual(cart.updates, ['WELCOME,BUY2', 'WELCOME,BUY3', 'WELCOME', 'WELCOME,BUY2']);
  assert.equal(await page.locator('.psl-status, .psl-bar').count(), 0, 'still just text on the page');
  assert.deepEqual(errors, []);
  await context.close();
});

await check('auto-apply: a code Shopify won\'t take is tried once, no loop', async () => {
  const { page, context, cart } = await open({ cfg: config({ ...LADDER, autoApply: true, tiers: [{ text: 'Buy 2', qty: 2, code: 'NOPE' }] }), items: 2 });
  await page.waitForTimeout(1500);
  assert.deepEqual(cart.updates, ['NOPE'], 'one attempt only');
  await context.close();
});

await check('looks: ticker scrolls (a still line under reduced motion), rotate changes offer', async () => {
  let o = await open({ cfg: config({ ...LADDER, look: 'ticker' }, []) });
  const tk = await o.page.evaluate(() => ({ anim: getComputedStyle(document.querySelector('.psl-move')).animationName, runs: document.querySelectorAll('.psl-run').length, cards: document.querySelectorAll('.ps-card').length, row: !!document.querySelector('.ps-slider-row') }));
  assert.deepEqual(tk, { anim: 'psl-scroll', runs: 2, cards: 0, row: false }, 'ticker + ladder only: no card row at all');
  await o.context.close();
  o = await open({ cfg: config({ ...LADDER, look: 'ticker' }, []), reducedMotion: 'reduce' });
  const still = await o.page.evaluate(() => ({ anim: getComputedStyle(document.querySelector('.psl-move')).animationName, copy: getComputedStyle(document.querySelector('.psl-run[aria-hidden]')).display }));
  assert.deepEqual(still, { anim: 'none', copy: 'none' }, 'reduced motion: a still line');
  await o.context.close();
  o = await open({ cfg: config({ ...LADDER, look: 'rotate', interval: 2 }, []) });
  const first = await o.page.locator('.psl-slide.is-show').textContent();
  await o.page.waitForFunction((f) => document.querySelector('.psl-slide.is-show')?.textContent !== f, first, { timeout: 5000 }).catch(() => {});
  assert.notEqual(await o.page.locator('.psl-slide.is-show').textContent(), first, 'rotated to the next offer');
  assert.equal(await o.page.locator('.psl-slide.is-show').count(), 1);
  await o.context.close();
});

await check('phone width: no sideways scroll, offers and button wrap', async () => {
  const long = { ...LADDER, buttonShow: true, buttonCode: 'SAVE10', tiers: [{ text: 'Buy any 2 products from the summer collection and get 10% off' }, { text: 'Buy any 3 Get 15% Off on everything' }] };
  const { page, context } = await open({ cfg: config(long), viewport: { width: 360, height: 800 } });
  const over = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth, ladder: document.querySelector('.psl').scrollWidth - document.querySelector('.psl').clientWidth }));
  assert.ok(over.doc <= over.win, `page ${over.doc} > ${over.win}`);
  assert.ok(over.ladder <= 1, 'ladder content fits');
  await page.screenshot({ path: path.join(process.cwd(), 'tests', 'coupon-banner', 'screenshots', 'offer-ladder-phone.png') });
  await context.close();
});

await check('button position: right edge / centred next to the text / below, centred', async () => {
  const geo = async (place) => {
    const { page, context } = await open({ cfg: config({ ...LADDER, buttonShow: true, buttonCode: 'SAVE10', buttonPlace: place }, []) });
    const g = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const box = r('.psl'), btn = r('.psl-btn'), row = r('.psl-row');
      const mid = (x) => x.left + x.width / 2;
      return { rightGap: Math.round(box.right - btn.right), btnMid: Math.round(mid(btn) - mid(box)), below: btn.top >= row.bottom - 1, sideBySide: Math.abs((btn.top + btn.height / 2) - (row.top + row.height / 2)) < 12, textToBtn: Math.round(btn.left - row.right) };
    });
    await context.close();
    return g;
  };
  const right = await geo('right');
  assert.ok(right.rightGap <= 16 && right.sideBySide && !right.below, 'right: at the right edge, same line ' + JSON.stringify(right));
  const center = await geo('center');
  assert.ok(center.sideBySide && center.rightGap > 100 && center.textToBtn >= 0 && center.textToBtn <= 30, 'center: next to the text, group in the middle ' + JSON.stringify(center));
  const below = await geo('below');
  assert.ok(below.below && Math.abs(below.btnMid) <= 2, 'below: under the text, centred ' + JSON.stringify(below));
});

await check('offers vertical: one under another, no dividers', async () => {
  const { page, context } = await open({ cfg: config({ ...LADDER, direction: 'column' }, []) });
  const g = await page.evaluate(() => ({ tops: [...document.querySelectorAll('.psl-tier')].map((t) => Math.round(t.getBoundingClientRect().top)), seps: [...document.querySelectorAll('.psl-row > .psl-sep')].filter((e) => getComputedStyle(e).display !== 'none').length }));
  assert.ok(g.tops[0] < g.tops[1] && g.tops[1] < g.tops[2], 'stacked ' + g.tops);
  assert.equal(g.seps, 0);
  await context.close();
});

await check('box size: same as Add to cart (width, left edge, at least its height), custom width, spacing', async () => {
  const atc = '<form action="/cart/add" style="padding-left:40px"><button name="add" class="product-form__submit" style="width:300px;height:50px">Add to cart</button></form>';
  let o = await open({ cfg: config({ ...LADDER, boxSize: 'atc', tiers: [{ text: 'Buy 2 Get 10%' }] }, []), atc });
  await o.page.waitForTimeout(500);
  let g = await o.page.evaluate(() => { const a = document.querySelector('[name=add]').getBoundingClientRect(), l = document.querySelector('.psl').getBoundingClientRect(); return [Math.round(l.width), Math.round(l.left - a.left), Math.round(l.height)]; });
  assert.equal(g[0], 300, 'same width as Add to cart');
  assert.equal(g[1], 0, 'same left edge');
  assert.ok(g[2] >= 50, 'at least as tall: ' + g[2]);
  // The theme changes the button (e.g. a wider layout): the ladder follows.
  await o.page.evaluate(() => { document.querySelector('[name=add]').style.width = '360px'; });
  await o.page.waitForFunction(() => Math.round(document.querySelector('.psl').getBoundingClientRect().width) === 360, null, { timeout: 3000 });
  await o.page.screenshot({ path: path.join(process.cwd(), 'tests', 'coupon-banner', 'screenshots', 'offer-ladder-atc.png'), clip: { x: 0, y: 0, width: 600, height: 220 } });
  await o.context.close();
  // Theme without a recognisable Add to cart button: full width.
  o = await open({ cfg: config({ ...LADDER, boxSize: 'atc' }, []), atc: '<div>no form</div>' });
  g = await o.page.evaluate(() => Math.round(document.querySelector('.psl').getBoundingClientRect().width - document.querySelector('ps-coupon-slider').getBoundingClientRect().width));
  assert.equal(g, 0, 'no button found: full width');
  await o.context.close();
  o = await open({ cfg: config({ ...LADDER, boxSize: 'custom', boxWidth: 320, padY: 20, padX: 30, minHeight: 200 }, []) });
  g = await o.page.evaluate(() => { const e = document.querySelector('.psl'), cs = getComputedStyle(e); return [Math.round(e.getBoundingClientRect().width), cs.paddingTop, cs.paddingLeft, Math.round(e.getBoundingClientRect().height)]; });
  assert.deepEqual(g, [320, '20px', '30px', 200], 'custom box (taller text would grow it): ' + JSON.stringify(g));
  await o.context.close();
  o = await open({ cfg: config({ ...LADDER, boxSize: 'custom', boxWidth: 600 }, []), viewport: { width: 360, height: 700 } });
  g = await o.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  assert.ok(g[0] <= g[1], 'custom width never wider than a phone');
  await o.context.close();
});

await check('no offers saved: nothing drawn for the ladder; the coupon still shows', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cfg = config({ ladder: true, tiers: [] });
  await page.route('https://int.thebrix.io/**', (route) => route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(cfg) }));
  await page.route('http://shop.test/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/cart.js') return route.fulfill({ contentType: 'application/json', body: '{"items":[]}' });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body>${element}\n${rest.join('\n')}</body></html>` });
  });
  await page.goto('http://shop.test/products/tee');
  await page.waitForSelector('ps-coupon-slider .ps-card', { timeout: 10000 });
  assert.equal(await page.locator('.ps-ladder, .psl').count(), 0);
  await context.close();
});

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

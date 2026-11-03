/* eslint-env node */
// Browser check: the BRIX cart drawer and COD popup in the shopper's language.
// Run from the repo root: node tests/i18n/storefront-browser-check.mjs
//
// Loads brix_i18n_<lang>.js (what snippets/brix-i18n.liquid adds for a
// Hindi, Tamil or Spanish page) before the real brix_cod.js and
// cart_drawer_inline.js, like the app embed. Every network call is mocked.
// Arabic is beta (not loaded by the Liquid yet); it is checked here for
// right-to-left. English loads no language file.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ASSETS = path.resolve('extensions/cart-drawer/assets');
const read = (f) => fs.readFileSync(path.join(ASSETS, f), 'utf8');
const COD_JS = read('brix_cod.js');
const DRAWER_JS = read('cart_drawer_inline.js');
const PHP = 'https://php.test';
const BRIX_PHP = 'https://int.thebrix.io';
const shotDir = path.join(os.tmpdir(), 'brix-i18n-storefront');
fs.mkdirSync(shotDir, { recursive: true });

const catalog = (lang) => (lang === 'en' ? JSON.parse(fs.readFileSync('app/i18n/en.json', 'utf8')) : JSON.parse(fs.readFileSync(`app/i18n/locales/${lang}.json`, 'utf8')));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const CFG = {
  success: true, enabled: true, surfaces: { drawer: true, product: true, combo: true }, otpRequired: false,
  minOrder: 0, maxOrder: 0, codFee: 40, codFeeLabel: 'Cash on Delivery Fee', showCodFee: true, shippingFee: 0, freeShippingAbove: 0,
  blockedPincodes: [], excludedProductTags: [], excludedBehavior: 'unavailable', allowCoupons: true, prepaidNudgeText: '',
  drawerPlacement: 'above', drawerSelector: '',
  buttons: { drawerText: 'Cash on Delivery', productText: 'Buy with Cash on Delivery', bg: '#0d6b4c', color: '#ffffff', style: 'filled', radius: 12 },
  productButton: { replaceBuyNow: true }, sheet: {}, tracking: { ga4Id: '', metaPixelId: '', metaContentId: 'shopify', dataLayer: false },
};
const CART = [
  { key: 'a:1', variant_id: 101, product_id: 11, quantity: 2, handle: 'tee', product_title: 'Cotton tee', final_price: 49900, original_price: 49900, final_line_price: 99800, original_line_price: 99800, properties: {} },
  { key: 'b:1', variant_id: 102, product_id: 12, quantity: 1, handle: 'tote', product_title: 'Canvas tote', final_price: 30000, original_price: 30000, final_line_price: 30000, original_line_price: 30000, properties: {} },
];

function page(lang) {
  return `<!doctype html><html lang="${lang}"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:sans-serif">
    <div id="cc-root" data-shop="demo.myshopify.com" data-currency="INR"></div>
    <script>window.Shopify={shop:'demo.myshopify.com',routes:{root:'/'}};</script>
    ${lang === 'en' ? '' : `<script src="https://cdn.test/brix_i18n_${lang}.js"></script>`}
    <script src="https://cdn.test/brix_cod.js" data-php="${PHP}" data-shop="demo.myshopify.com" data-currency="INR"></script>
    <script src="https://cdn.test/cart_drawer_inline.js"></script>
  </body></html>`;
}

const browser = await chromium.launch();
const allErrors = [];

async function open(lang, { drawerData = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
  const p = await context.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  await p.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'Access-Control-Allow-Origin': '*' } });
    const js = (body) => route.fulfill({ contentType: 'application/javascript; charset=utf-8', body });
    if (url.origin === 'https://cdn.test') {
      if (url.pathname === '/brix_cod.js') return js(COD_JS);
      if (url.pathname === '/cart_drawer_inline.js') return js(DRAWER_JS);
      const m = /^\/(brix_i18n_[a-z]+\.js)$/.exec(url.pathname);
      if (m) return js(read(m[1]));
    }
    if (url.origin === 'https://shop.test') {
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: page(lang) });
      if (url.pathname === '/cart.js') {
        const total = CART.reduce((n, l) => n + l.final_line_price, 0);
        return json({ token: 't1', items: CART, item_count: 3, items_subtotal_price: total, total_price: total, cart_level_discount_applications: [], currency: 'INR' });
      }
      if (/^\/products\/[^/]+\.js$/.test(url.pathname)) return json({ tags: [] });
      return route.fulfill({ status: 404, body: '' });
    }
    if (url.origin === PHP && url.pathname === '/cod_storefront.php') return json(CFG);
    if (url.origin === PHP && url.pathname === '/cod_checkout.php') {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } });
      const body = JSON.parse(req.postData() || '{}');
      if (body.endpoint === 'quote') {
        return json({ success: true, quote: { currency: 'INR', lines: [{ title: 'Cotton tee', quantity: 2, total: 998, originalTotal: 998 }, { title: 'Canvas tote', quantity: 1, total: 300, originalTotal: 300 }], itemsTotal: 1298, subtotal: 1298, discounts: 0, shipping: 0, codFee: 40, tax: 0, taxesIncluded: true, total: 1338, coupon: null } });
      }
      if (body.endpoint === 'order') return json({ success: false, code: 'otp_wrong', error: 'That code doesn\'t match. 2 tries left.', details: { vars: { attemptsLeft: 2 } } }, 400);
      return json({ success: false, error: 'unmocked' }, 404);
    }
    if (url.origin === BRIX_PHP) {
      if (url.pathname === '/save_cart_drawer.php') return json({ status: 'success', data: { cartStatus: '1', checkoutName: 'Checkout', header_title: 'Your Cart', ...drawerData } });
      return json({ status: 'success', data: [] });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await p.goto('https://shop.test/');
  await p.waitForFunction(() => window.__brixCartDrawerActive === true, null, { timeout: 6000 }).catch(() => null);
  return p;
}

async function drawerText(p) {
  await p.evaluate(() => window.testCart());
  await p.waitForSelector('#cc-cod-slot [data-brix-cod-btn]', { timeout: 8000 }).catch(() => null);
  await p.waitForTimeout(400);
  return p.evaluate(() => ({
    text: (document.getElementById('cc-drawer') || {}).innerText || '',
    dir: (document.getElementById('cc-drawer') || { getAttribute: () => null }).getAttribute('dir'),
  }));
}

async function sheetText(p) {
  await p.click('#cc-cod-slot [data-brix-cod-btn]');
  await p.waitForFunction(() => {
    const host = document.querySelector('[data-brix-cod-sheet]');
    return host && host.shadowRoot && /cod-name|cod-phone2/.test(host.shadowRoot.innerHTML);
  }, null, { timeout: 8000 }).catch(() => null);
  await p.waitForTimeout(300);
  return p.evaluate(() => {
    const sh = document.querySelector('[data-brix-cod-sheet]').shadowRoot.querySelector('.sh');
    return { text: sh.innerText, dir: sh.getAttribute('dir') };
  });
}

for (const lang of ['hi', 'ta', 'es', 'ar', 'en']) {
  const t = catalog(lang);
  const p = await open(lang);
  const d = await drawerText(p);
  const want = ['storefront.drawer.your_cart', 'storefront.drawer.subtotal', 'storefront.drawer.items_included', 'storefront.cod.button', 'storefront.drawer.footer_note'].map((k) => t[k]);
  const missing = want.filter((w) => !d.text.toLowerCase().includes(w.toLowerCase()));
  check(`${lang}: drawer header, summary, COD button and footer note in ${lang}`, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)}` : '');
  check(`${lang}: drawer direction`, d.dir === (lang === 'ar' ? 'rtl' : 'ltr'), String(d.dir));
  // The checkout button text: "Checkout" (the Cart Editor's default) follows the shopper's language.
  check(`${lang}: default checkout text translated`, d.text.includes(t['storefront.drawer.checkout']), '');
  await p.screenshot({ path: path.join(shotDir, `${lang}-drawer.png`) });
  const s = await sheetText(p);
  const sheetWant = ['storefront.cod.delivery_address', 'storefront.cod.full_name', 'storefront.cod.pincode', 'storefront.cod.deliver_to'].map((k) => t[k]);
  // Some headings are drawn in capitals (text-transform), so compare without case.
  const sheetMissing = sheetWant.filter((w) => !s.text.toLowerCase().includes(w.toLowerCase()));
  check(`${lang}: COD popup address step in ${lang}`, sheetMissing.length === 0, sheetMissing.length ? `missing ${JSON.stringify(sheetMissing)}` : '');
  check(`${lang}: COD popup direction`, s.dir === (lang === 'ar' ? 'rtl' : 'ltr'), String(s.dir));
  await p.screenshot({ path: path.join(shotDir, `${lang}-cod.png`) });
  allErrors.push(...p.errors);
  await p.context().close();
}

// The merchant's own words stay as typed on a Hindi page.
{
  const p = await open('hi', { drawerData: { header_title: 'Mera Jhola', checkoutName: 'Pay karo', empty_cart_message: 'Kuch nahi' } });
  const d = await drawerText(p);
  check('hi: merchant\'s own header and checkout text stay as typed', d.text.includes('Mera Jhola') && d.text.includes('Pay karo'), '');
  allErrors.push(...p.errors);
  await p.context().close();
}

check('no page errors', allErrors.length === 0, allErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${shotDir}`);
process.exit(failed.length ? 1 : 0);

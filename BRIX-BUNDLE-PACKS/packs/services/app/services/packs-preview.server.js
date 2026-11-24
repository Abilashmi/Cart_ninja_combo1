/**
 * DEV-ONLY customer-facing preview of the BRIX Packs storefront widget.
 *
 * The widget itself is the real one (extensions/cart-drawer/assets/packs_widget.js, served at
 * /packs.js). This module only supplies what Shopify would: a product page shell
 * and the /api/packs-storefront payload, built with the same shared Pack logic
 * (tier maths + design presets in app/utils/packs.shared.js). No Shopify, proxy,
 * tunnel or database is involved.
 */
import { PACK_DESIGNS, applyDesign, calculateTier, defaultCustomization, mergeCustomization } from '../utils/packs.shared.js';

export const PREVIEW_SHOP = 'preview-store.myshopify.com';
export const PREVIEW_PRODUCT_ID = '9000000001';
const CURRENCY = { code: 'INR', locale: 'en-IN' };
const BASE_PRICE = 80;

const COLORS = ['Black', 'White'];
const SIZES = ['Small', 'Medium', 'Large'];
const VARIANTS = COLORS.flatMap((color, c) => SIZES.map((size, s) => ({ id: String(9100000001 + c * 3 + s), color, size, title: `${color} / ${size}`, price: BASE_PRICE, availableForSale: true })));

const OFFERS = [
  { quantity: 1, name: 'Pack 1', discountType: 'none', discountValue: 0, badge: '' },
  { quantity: 2, name: 'Pack 2', discountType: 'percentage', discountValue: 10, badge: '' },
  { quantity: 3, name: 'Pack 3', discountType: 'percentage', discountValue: 15, badge: 'Popular' },
  { quantity: 4, name: 'Pack 4', discountType: 'percentage', discountValue: 20, badge: 'Best value' },
];

// Illustration only: stands in for the Shopify product photo.
const IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f1f1ef"/><path d="M150 210h300l30 60-60 30v150c0 22-18 40-40 40H220c-22 0-40-18-40-40V300l-60-30z" fill="#1c1c1c"/><path d="M240 210q60 50 120 0" fill="none" stroke="#3a3a3a" stroke-width="10"/></svg>')}`;

export function buildPreviewPayload({ design = 'slots', type = 'standard' } = {}) {
  const designId = PACK_DESIGNS.some((item) => item.id === design) ? design : 'slots';
  const packType = type === 'mix' ? 'mix_match' : 'same_variant';
  const template = packType === 'mix_match' ? 'choose_each_item' : 'same_variant';
  const customization = applyDesign(mergeCustomization({ ...defaultCustomization(), content: { ...defaultCustomization().content, heading: 'Choose your pack', subheading: 'Buy more and save more.' } }), designId);
  const tiers = OFFERS.map((offer) => ({ ...offer, ...calculateTier(BASE_PRICE, offer, { currencyCode: CURRENCY.code }) }));
  const publicTiers = tiers.map((tier) => ({
    quantity: tier.quantity, name: tier.name, badge: tier.badge, discountType: tier.discountType, discountValue: tier.discountValue,
    subtotal: tier.subtotal, discountAmount: tier.discountAmount, price: tier.price, savings: tier.savings, effectiveUnitPrice: tier.effectiveUnitPrice,
  }));
  const publicVariants = VARIANTS.map(({ id, title, price, availableForSale, color, size }) => ({ id, title, price, availableForSale, options: [color, size] }));
  // One Pack covering the whole product (variantScope='all') — matches the real
  // architecture: a Pack belongs to a product, then declares which variants it
  // applies to. `variants` is always attached here so the mock also
  // demonstrates same_variant re-pricing when the shopper switches variant.
  const packs = [{
    id: 1, version: 1, variantId: VARIANTS[0].id, template, packType, variantScope: 'all', allowedVariantIds: [],
    productTitle: 'Padded Underwear', variantTitle: VARIANTS[0].title, productImage: IMAGE,
    basePrice: BASE_PRICE, available: true, maxQuantity: 10, tiers: publicTiers, customization, variants: publicVariants, productOptions: ['Color', 'Size'],
  }];
  return { success: true, packs, reason: null, currency: CURRENCY, checkoutDiscount: { verified: true, state: 'active', message: '' }, preview: false };
}

const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const esc = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** The fake Shopify product page. Loads the REAL /packs.js and stubs only Shopify's network endpoints. */
export function renderStorefrontFrame({ design, type }) {
  const payload = buildPreviewPayload({ design, type });
  return `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Padded Underwear – Preview Store</title>
<style>
  *{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#121212;background:#fff}
  .announce{background:#121212;color:#fff;text-align:center;font-size:12px;padding:8px}
  header{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid #e6e6e6}
  header b{font-size:20px;letter-spacing:.5px}header nav{display:flex;gap:20px;font-size:14px}
  .cart-link{position:relative;font-size:14px}.cart-count{display:inline-block;min-width:18px;padding:0 5px;margin-left:4px;border-radius:9px;background:#121212;color:#fff;font-size:11px;text-align:center}
  main{max-width:1100px;margin:0 auto;padding:32px 24px;display:grid;grid-template-columns:1fr 1fr;gap:48px}
  .gallery img{width:100%;border-radius:4px;display:block}
  .vendor{font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.6;margin:0 0 8px}
  h1{font-size:32px;margin:0 0 8px;font-weight:600}.price{font-size:20px;margin:0 0 24px}
  fieldset{border:0;padding:0;margin:0 0 20px}legend{font-size:13px;margin-bottom:8px;opacity:.75}
  .opts{display:flex;gap:8px;flex-wrap:wrap}
  .opt{padding:10px 18px;border:1px solid #cfcfcf;border-radius:999px;background:#fff;font:inherit;font-size:14px;cursor:pointer}
  .opt[aria-pressed="true"]{background:#121212;color:#fff;border-color:#121212}
  .qty{display:inline-flex;border:1px solid #cfcfcf;margin-bottom:16px}.qty button{width:40px;height:44px;border:0;background:none;font-size:18px;cursor:pointer}.qty input{width:48px;text-align:center;border:0;font:inherit}
  .buy{display:block;width:100%;padding:15px;border:1px solid #121212;background:#fff;color:#121212;font:inherit;font-size:15px;cursor:pointer;margin-bottom:10px}
  .desc{font-size:14px;line-height:1.6;opacity:.75;margin-top:24px}
  #brix-mock-note{font-size:11px;color:#8a6d00;background:#fff8e0;border:1px solid #ecd58a;border-radius:4px;padding:6px 10px;margin-top:20px}
  #toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#121212;color:#fff;padding:12px 18px;border-radius:6px;font-size:13px;max-width:92vw;display:none;z-index:10}
  @media (max-width:820px){main{grid-template-columns:1fr;gap:24px;padding:16px}h1{font-size:26px}header nav{display:none}header{padding:12px 16px}}
</style></head>
<body>
<div class="announce">Free shipping over ₹499 · Preview store</div>
<header><b>PREVIEW STORE</b><nav><span>Shop</span><span>Collections</span><span>About</span></nav><span class="cart-link">Cart<span class="cart-count" id="cart-count">0</span></span></header>
<main>
  <div class="gallery"><img src="${esc(payload.packs[0].productImage)}" alt="Padded Underwear"></div>
  <div>
    <p class="vendor">Preview Vendor</p>
    <h1>Padded Underwear</h1>
    <p class="price" id="price">₹80.00</p>
    <fieldset><legend>Color: <span id="color-label">Black</span></legend><div class="opts" id="colors"></div></fieldset>
    <fieldset><legend>Size: <span id="size-label">Medium</span></legend><div class="opts" id="sizes"></div></fieldset>
    <form action="/cart/add" method="post" id="product-form">
      <input type="hidden" name="id" value="">
      <div class="qty"><button type="button" id="dec">−</button><input name="quantity" value="1" readonly aria-label="Quantity"><button type="button" id="inc">+</button></div>
      <button class="buy" type="submit">Add to cart</button>
    </form>
    <p class="desc">Soft, breathable padded underwear with a comfortable waistband. This page is a local mock of a Shopify product page — the Pack widget above the buttons is the real storefront widget.</p>
    <div id="brix-mock-note">Local preview: cart and product data are mocked. Nothing is sent to Shopify.</div>
  </div>
</main>
<div id="toast" role="status"></div>
<div data-brix-packs-root data-shop="${PREVIEW_SHOP}" data-product-id="${PREVIEW_PRODUCT_ID}" data-api="${''}"></div>
<script>
(function () {
  var VARIANTS = ${json(VARIANTS)}, PAYLOAD = ${json(payload)}, cart = [];
  var color = 'Black', size = 'Medium';
  var money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
  function toast(text) { var t = document.getElementById('toast'); t.textContent = text; t.style.display = 'block'; clearTimeout(toast.h); toast.h = setTimeout(function () { t.style.display = 'none'; }, 3500); }
  function renderCount() { document.getElementById('cart-count').textContent = cart.reduce(function (n, l) { return n + l.quantity; }, 0); }

  // Stub ONLY Shopify's endpoints; everything else (including /packs.js) is real.
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : input.url;
    if (url.indexOf('/api/packs-storefront') > -1) return Promise.resolve(new Response(JSON.stringify(PAYLOAD), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (url.indexOf('/cart/add.js') > -1) {
      var body = JSON.parse(init.body), lines = [];
      for (var i = 0; i < body.items.length; i += 1) {
        var item = body.items[i], v = VARIANTS.filter(function (x) { return Number(x.id) === item.id; })[0];
        if (!v) return Promise.resolve(new Response(JSON.stringify({ description: 'Variant not found in preview.' }), { status: 422 }));
        lines.push({ id: item.id, title: v.title, quantity: item.quantity, properties: item.properties || {} });
      }
      lines.forEach(function (l) { cart.push(l); });
      renderCount();
      var summary = lines.map(function (l) { return l.title + ' × ' + l.quantity; }).join(', ');
      toast('Added to cart: ' + summary + (lines[0].properties._brix_pack_id ? '  (BRIX Pack — mock cart)' : ''));
      window.__mockCart = cart;
      return Promise.resolve(new Response(JSON.stringify({ items: lines }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, init);
  };

  var form = document.getElementById('product-form'), idInput = form.querySelector('[name=id]'), qty = form.querySelector('[name=quantity]');
  function variant() { return VARIANTS.filter(function (v) { return v.color === color && v.size === size; })[0]; }
  function sync() {
    idInput.value = variant().id;
    document.getElementById('color-label').textContent = color; document.getElementById('size-label').textContent = size;
    document.getElementById('price').textContent = money.format(variant().price);
    [['colors', color], ['sizes', size]].forEach(function (pair) {
      Array.prototype.forEach.call(document.getElementById(pair[0]).children, function (b) { b.setAttribute('aria-pressed', b.textContent === pair[1] ? 'true' : 'false'); });
    });
  }
  function build(id, values, set) {
    values.forEach(function (value) { var b = document.createElement('button'); b.type = 'button'; b.className = 'opt'; b.textContent = value; b.onclick = function () { set(value); sync(); }; document.getElementById(id).appendChild(b); });
  }
  build('colors', ['Black', 'White'], function (v) { color = v; });
  build('sizes', ['Small', 'Medium', 'Large'], function (v) { size = v; });
  document.getElementById('inc').onclick = function () { qty.value = Number(qty.value) + 1; };
  document.getElementById('dec').onclick = function () { qty.value = Math.max(1, Number(qty.value) - 1); };
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    cart.push({ id: Number(idInput.value), title: variant().title, quantity: Number(qty.value), properties: {} });
    renderCount(); toast('Added to cart: ' + variant().title + ' × ' + qty.value);
  });
  sync();
})();
</script>
<script src="/packs.js"></script>
</body></html>`;
}

/** The dev toolbar page: pick design / pack type / device; the storefront renders in an iframe of that width. */
export function renderPreviewShell({ design, type, device }) {
  const designs = PACK_DESIGNS.map((item) => `<option value="${item.id}"${item.id === design ? ' selected' : ''}>${esc(item.name)}</option>`).join('');
  const types = [['standard', 'Standard Pack'], ['mix', 'Mix & Match']].map(([value, label]) => `<option value="${value}"${value === type ? ' selected' : ''}>${label}</option>`).join('');
  const devices = [['desktop', 'Desktop', '1280'], ['tablet', 'Tablet', '820'], ['mobile', 'Mobile', '390']].map(([value, label, width]) => `<button type="button" data-device="${value}" data-width="${width}" aria-pressed="${value === device}">${label}</button>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Packs storefront preview (dev)</title>
<style>
  body{margin:0;font-family:system-ui,sans-serif;background:#e9eaec;color:#1f2328}
  .bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:12px 20px;background:#fff;border-bottom:1px solid #d6d8dc}
  .bar label{font-size:12px;color:#5c6169;display:flex;flex-direction:column;gap:4px}
  select{padding:7px 10px;font:inherit;border:1px solid #c4c7cc;border-radius:8px;background:#fff}
  .devices{display:flex;border:1px solid #c4c7cc;border-radius:8px;overflow:hidden}
  .devices button{padding:8px 14px;border:0;background:#fff;font:inherit;cursor:pointer}.devices button[aria-pressed="true"]{background:#1f2328;color:#fff}
  .tag{margin-left:auto;font-size:12px;color:#8a6d00;background:#fff8e0;border:1px solid #ecd58a;border-radius:999px;padding:4px 12px}
  .stage{display:flex;justify-content:center;padding:24px}
  iframe{border:1px solid #cfd2d6;border-radius:10px;background:#fff;height:calc(100vh - 120px);min-height:640px;max-width:100%;box-shadow:0 8px 30px rgba(0,0,0,.08)}
</style></head><body>
<div class="bar">
  <label>Design<select id="design">${designs}</select></label>
  <label>Pack type<select id="type">${types}</select></label>
  <div class="devices" role="group" aria-label="Device">${devices}</div>
  <span class="tag">Dev only · customer view · mock data</span>
</div>
<div class="stage"><iframe id="frame" title="Storefront preview"></iframe></div>
<script>
  var frame = document.getElementById('frame'), d = document.getElementById('design'), t = document.getElementById('type');
  var device = ${json(device)};
  function apply() {
    var btn = document.querySelector('[data-device="' + device + '"]');
    frame.style.width = btn.dataset.width + 'px';
    Array.prototype.forEach.call(document.querySelectorAll('[data-device]'), function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
    frame.src = '/packs/storefront-frame?design=' + d.value + '&type=' + t.value;
    history.replaceState(null, '', '?design=' + d.value + '&type=' + t.value + '&device=' + device);
  }
  d.onchange = t.onchange = apply;
  Array.prototype.forEach.call(document.querySelectorAll('[data-device]'), function (b) { b.onclick = function () { device = b.dataset.device; apply(); }; });
  apply();
</script></body></html>`;
}

/** Dev only: off in production builds unless BRIX_PACKS_PREVIEW=1. */
export function previewEnabled() {
  return process.env.NODE_ENV !== 'production' || process.env.BRIX_PACKS_PREVIEW === '1';
}

/*
 * BRIX Packs storefront widget.
 *
 * Stores load it from the theme extension (blocks/Packs.liquid -> asset_url);
 * the admin preview and tests load it from the Node app's /packs.js
 * (app/routes/packs[.]js.jsx). Plain browser JavaScript — no imports, no JSX.
 *
 * Data source: `data-endpoint` on the root. On stores that is
 * php_backend/packs_storefront.php via the app proxy, which returns stored
 * Packs WITHOUT prices (pricing:'client'); they are priced here from the
 * product page's live Liquid variant data (see priceOnPage). Without
 * `data-endpoint` it uses the Node /api/packs-storefront, which returns
 * Packs already priced from the Shopify Admin API.
 *
 * Flow: fetch Pack data -> pick the Pack for the variant currently
 * selected on the product page -> render the Pack's template -> add the REAL
 * variant to the cart with the chosen quantity. Line-item properties only
 * *mark* the line; the discount itself is applied by the BRIX Packs Shopify
 * Function at checkout (extensions/brix-packs-discount). The widget never
 * claims a discount the server hasn't verified (see `checkoutDiscount`).
 *
 * All CSS is prefixed `.brix-packs-` so it can't touch theme or cart drawer UI.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-brix-packs-root]');
  if (!root || root.getAttribute('data-brix-packs-ready')) return;
  root.setAttribute('data-brix-packs-ready', '1');

  var scriptEl = document.currentScript;
  var api = (root.getAttribute('data-api') || '').replace(/\/$/, '');
  if (!api && scriptEl && scriptEl.src) {
    try { api = new URL(scriptEl.src).origin; } catch (e) { api = ''; }
  }
  var endpoint = root.getAttribute('data-endpoint') || (api ? api + '/api/packs-storefront' : '');
  var shop = root.getAttribute('data-shop');
  var productId = root.getAttribute('data-product-id');
  var preview = /[?&]brix_packs_preview=1\b/.test(location.search);

  var CART_EVENTS = ['cart:item-added', 'cart:updated', 'cart:add', 'cart:refresh', 'on:cart:add', 'shopify:cart:added', 'theme:cart:open', 'cart:open'];
  var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  // busy: false | 'add' | 'buy'. pickVariant: the variant chosen in the Pack's
  // own picker (same_variant Packs); null follows the theme's variant picker.
  // openPicker: key of the Visual picker dropdown that is open, or null.
  var state = { data: null, pack: null, tierIndex: 0, chosen: [], busy: false, message: null, pickVariant: null, redirecting: false, openPicker: null };
  var lastVariant = null;
  var money = null;

  // ── helpers ────────────────────────────────────────────────────────────────

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      var value = props[key];
      if (value === undefined || value === null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function numericId(value) {
    var match = /(\d+)$/.exec(String(value == null ? '' : value));
    return match ? match[1] : null;
  }

  // Same rounding rules as calculateTierFromPrices in app/utils/packs.shared.js
  // (integer minor units). Used only to preview choose-each-item totals; the
  // checkout discount is computed independently by the Shopify Function.
  function calc(prices, tier, decimals) {
    var factor = Math.pow(10, decimals);
    var subtotal = 0;
    prices.forEach(function (price) { subtotal += Math.round(Number(price) * factor); });
    var discount = 0;
    if (tier.discountType === 'percentage') discount = Math.round(subtotal * Number(tier.discountValue) / 100);
    else if (tier.discountType === 'fixed') discount = Math.round(Number(tier.discountValue) * factor);
    discount = Math.min(Math.max(discount, 0), subtotal);
    return { subtotal: subtotal / factor, savings: discount / factor, price: (subtotal - discount) / factor };
  }

  // Live product data rendered by Packs.liquid. Prices are in the shopper's
  // presentment currency, in Liquid's x100 minor units.
  function readPageProduct() {
    var node = document.querySelector('script[data-brix-packs-product]');
    if (!node) return null;
    try { return JSON.parse(node.textContent); } catch (e) { return null; }
  }

  // Price stored Packs (pricing:'client') from the page's live variants,
  // mirroring hydratePacks in app/services/packs-shopify.server.js. A Pack whose
  // anchor variant isn't on this page is dropped — never priced from a cache.
  function priceOnPage(data, product) {
    var shopCode = product.shopCurrency;
    var code = product.currency || shopCode;
    var rate = 1;
    if (code !== shopCode) {
      // Fixed tier discounts are stored in the shop currency.
      var parsed = parseFloat(window.Shopify && window.Shopify.currency && window.Shopify.currency.rate);
      if (isFinite(parsed) && parsed > 0) rate = parsed; else code = shopCode; // makeMoney then hides amounts
    }
    var decimals = 2;
    try { decimals = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits; } catch (e) { /* keep default */ }

    var byId = {};
    (product.variants || []).forEach(function (variant) {
      var price = Number(variant.price) / 100;
      var stock = Number(variant.inventoryQuantity);
      byId[String(variant.id)] = {
        id: String(variant.id),
        title: variant.title,
        price: isFinite(price) && price >= 0 ? price : null,
        availableForSale: Boolean(variant.available),
        maxQuantity: variant.inventoryManagement === 'shopify' && variant.inventoryPolicy === 'deny' && stock > 0 ? stock : null,
        inventoryQuantity: isFinite(stock) ? stock : null,
        image: variant.image || '',
      };
    });

    var packs = [];
    (data.packs || []).forEach(function (pack) {
      var anchor = byId[numericId(pack.variantId)];
      if (!anchor || anchor.price === null) return;
      var tiers = (pack.tiers || []).map(function (tier) {
        var t = {};
        Object.keys(tier).forEach(function (key) { t[key] = tier[key]; });
        if (t.discountType === 'fixed') t.discountValue = Number(t.discountValue) * rate;
        var prices = [];
        for (var i = 0; i < t.quantity; i += 1) prices.push(anchor.price);
        var priced = calc(prices, t, decimals);
        t.subtotal = priced.subtotal;
        t.savings = priced.savings;
        t.discountAmount = priced.savings;
        t.price = priced.price;
        t.effectiveUnitPrice = t.quantity > 0 ? Math.round((priced.price / t.quantity) * Math.pow(10, decimals)) / Math.pow(10, decimals) : 0;
        return t;
      });
      var variants;
      var allowed = pack.allowedVariantIds || [];
      if (pack.packType === 'mix_match' || pack.variantScope === 'all' || allowed.length > 1) {
        variants = Object.keys(byId).map(function (id) { return byId[id]; }).filter(function (variant) {
          return variant.price !== null && (pack.variantScope === 'all' || allowed.indexOf(variant.id) >= 0);
        });
      }
      var copy = {};
      Object.keys(pack).forEach(function (key) { copy[key] = pack[key]; });
      copy.basePrice = anchor.price;
      copy.tiers = tiers;
      copy.variants = variants;
      copy.available = anchor.availableForSale || Boolean(variants && variants.some(function (variant) { return variant.availableForSale; }));
      copy.maxQuantity = anchor.maxQuantity;
      copy.productTitle = product.title || pack.productTitle;
      copy.variantTitle = anchor.title;
      copy.productImage = product.image || pack.productImage;
      packs.push(copy);
    });

    var priced = {};
    Object.keys(data).forEach(function (key) { priced[key] = data[key]; });
    priced.packs = packs;
    priced.currency = { code: code, locale: document.documentElement.lang || undefined };
    return priced;
  }

  function makeMoney(currency) {
    var shopCode = currency.code;
    var active = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || shopCode;
    var rate = 1;
    var hidden = false;
    if (active !== shopCode) {
      var parsed = parseFloat(window.Shopify && window.Shopify.currency && window.Shopify.currency.rate);
      if (isFinite(parsed) && parsed > 0) rate = parsed; else hidden = true;
    }
    var locale = document.documentElement.lang || currency.locale || undefined;
    var fmt = null;
    var shopDecimals = 2;
    try { shopDecimals = new Intl.NumberFormat('en', { style: 'currency', currency: shopCode }).resolvedOptions().maximumFractionDigits; } catch (e) { /* keep default */ }
    try { fmt = new Intl.NumberFormat(locale, { style: 'currency', currency: active }); } catch (e) { fmt = null; }
    return {
      hidden: hidden,
      decimals: shopDecimals,
      format: function (value) {
        var amount = Number(value) * rate;
        return fmt ? fmt.format(amount) : active + ' ' + amount.toFixed(2);
      },
    };
  }

  function percentLabel(subtotal, savings) {
    var pct = subtotal > 0 ? Math.round((savings / subtotal) * 1000) / 10 : 0;
    return pct + '%';
  }

  function currentVariantId() {
    var form = productForm();
    var input = form && form.querySelector('[name="id"]');
    if (input && input.value) return numericId(input.value);
    var fromUrl = new URLSearchParams(location.search).get('variant');
    return fromUrl ? numericId(fromUrl) : null;
  }

  // A same_variant Pack applies to whichever of its covered variants the
  // shopper currently has selected (scope='all' -> any variant of the
  // product; scope='selected' -> one of allowedVariantIds). A mix_match Pack
  // isn't tied to the page's variant selector at all — it composes its own
  // items — so it's offered independently of the currently selected variant.
  function matchesVariant(pack, variantId) {
    if (!variantId) return false;
    if (pack.variantScope === 'all') return true;
    var allowed = pack.allowedVariantIds || [];
    for (var i = 0; i < allowed.length; i += 1) if (numericId(allowed[i]) === variantId) return true;
    return false;
  }

  function packForVariant(packs, variantId) {
    if (!packs.length) return null;
    for (var i = 0; i < packs.length; i += 1) {
      if (packs[i].packType !== 'mix_match' && matchesVariant(packs[i], variantId)) return packs[i];
    }
    for (var j = 0; j < packs.length; j += 1) if (packs[j].packType === 'mix_match') return packs[j];
    // No packType (older cached response) and nothing else matched: fall back
    // to the previous single-pack behaviour rather than showing nothing.
    if (!variantId && packs.length === 1) return packs[0];
    return null;
  }

  function cartAddUrl() {
    var base = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
    return base + 'cart/add.js';
  }

  function token() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ── styles ─────────────────────────────────────────────────────────────────

  var CSS = [
    '.brix-packs-widget{box-sizing:border-box;margin:var(--brix-packs-section) 0;padding:var(--brix-packs-pad);background:var(--brix-packs-bg);color:var(--brix-packs-text);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius);font-family:inherit;line-height:1.35}',
    '.brix-packs-widget.is-shadow{box-shadow:0 2px 10px rgba(0,0,0,.14)}',
    '.brix-packs-widget *{box-sizing:border-box}',
    '.brix-packs-head{text-align:var(--brix-packs-align)}',
    '.brix-packs-heading{margin:0 0 4px;font-size:var(--brix-packs-h);font-weight:var(--brix-packs-weight);color:var(--brix-packs-text)}',
    '.brix-packs-sub{margin:0 0 14px;font-size:var(--brix-packs-desc);opacity:.75}',
    '.brix-packs-preview{margin:0 0 12px;padding:8px 10px;background:#fff4d6;color:#5c4400;border:1px solid #e1b955;border-radius:6px;font-size:12px}',
    '.brix-packs-tier{position:relative;display:grid;grid-template-columns:auto 1fr auto;column-gap:16px;align-items:center;width:100%;margin:0;padding:var(--brix-packs-card-pad);background:var(--brix-packs-card);color:var(--brix-packs-text);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius);font:inherit;text-align:left;cursor:pointer}',
    '.brix-packs-tier:hover:not([disabled]){border-color:var(--brix-packs-primary)}',
    '.brix-packs-tier:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:2px}',
    '.brix-packs-tier[aria-checked="true"]{background:var(--brix-packs-selected);border-color:var(--brix-packs-primary);box-shadow:0 0 0 1px var(--brix-packs-primary)}',
    '.brix-packs-tier[disabled]{opacity:.5;cursor:not-allowed}',
    '.brix-packs-radio{width:18px;height:18px;border:2px solid var(--brix-packs-border);border-radius:50%;display:inline-block;position:relative}',
    '.brix-packs-tier[aria-checked="true"] .brix-packs-radio{border-color:var(--brix-packs-primary)}',
    '.brix-packs-tier[aria-checked="true"] .brix-packs-radio::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--brix-packs-primary)}',
    '.brix-packs-content{min-width:0}',
    '.brix-packs-title{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:var(--brix-packs-title);font-weight:var(--brix-packs-weight)}',
    '.brix-packs-meta{display:block;font-size:var(--brix-packs-desc);opacity:.75}',
    '.brix-packs-badge{display:inline-block;padding:2px 8px;background:var(--brix-packs-badge);color:var(--brix-packs-text);border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.2px;text-transform:uppercase}',
    '.brix-packs-price{text-align:right;color:var(--brix-packs-price)}',
    '.brix-packs-price strong{display:block;font-size:var(--brix-packs-priceSize);font-weight:var(--brix-packs-weight)}',
    '.brix-packs-was{font-size:var(--brix-packs-desc);text-decoration:line-through;opacity:.6}',
    '.brix-packs-save{display:block;font-size:var(--brix-packs-desc);font-weight:600;color:var(--brix-packs-discount)}',
    '.brix-packs-img{display:block;object-fit:cover;border-radius:calc(var(--brix-packs-radius) / 2);max-width:100%}',
    '.brix-packs-img[data-size="small"]{width:48px;height:48px}.brix-packs-img[data-size="medium"]{width:72px;height:72px}.brix-packs-img[data-size="large"]{width:104px;height:104px}',
    '.brix-packs-promo{margin:12px 0 0;font-size:var(--brix-packs-desc);opacity:.8;text-align:var(--brix-packs-align)}',
    '.brix-packs-msg{margin:12px 0 0;padding:8px 10px;border-radius:6px;font-size:13px}',
    '.brix-packs-msg[data-type="error"]{background:#fde7e7;color:#8a1f1f;border:1px solid #f0b3b3}',
    '.brix-packs-msg[data-type="success"]{background:#e3f5ea;color:#14532d;border:1px solid #a7d7b8}',
    '.brix-packs-add{display:block;width:100%;margin-top:var(--brix-packs-btn-gap);padding:13px 16px;background:var(--brix-packs-button);color:var(--brix-packs-button-text);border:0;border-radius:var(--brix-packs-radius);font:inherit;font-weight:700;cursor:pointer}',
    '.brix-packs-add[disabled]{opacity:.55;cursor:not-allowed}',
    '.brix-packs-actions{display:flex;gap:10px;margin-top:var(--brix-packs-btn-gap)}',
    '.brix-packs-actions .brix-packs-add{margin-top:0;flex:1 1 0}',
    '.brix-packs-buy{flex:1 1 0;padding:13px 16px;background:var(--brix-packs-card);color:var(--brix-packs-button);border:2px solid var(--brix-packs-button);border-radius:var(--brix-packs-radius);font:inherit;font-weight:700;cursor:pointer}',
    '.brix-packs-buy[disabled]{opacity:.55;cursor:not-allowed}',
    /* ── Layouts: tabs (Pack tabs) + visual (Visual picker) — a row of pack tabs over one panel. */
    '.brix-packs-tabs{display:flex;gap:var(--brix-packs-gap);padding-top:8px}',
    '.brix-packs-tab{position:relative;flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:2px;margin:0;padding:12px 8px 10px;background:var(--brix-packs-card);color:var(--brix-packs-text);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius);font:inherit;text-align:center;cursor:pointer}',
    '.brix-packs-tab:hover:not([disabled]){border-color:var(--brix-packs-primary)}',
    '.brix-packs-tab:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:2px}',
    '.brix-packs-tab[aria-checked="true"]{background:var(--brix-packs-selected);border-color:var(--brix-packs-primary);box-shadow:0 0 0 1px var(--brix-packs-primary)}',
    '.brix-packs-tab[disabled]{opacity:.5;cursor:not-allowed}',
    '.brix-packs-tab .brix-packs-badge{position:absolute;top:-9px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:9px;padding:1px 7px}',
    '.brix-packs-tab-label{font-size:var(--brix-packs-title);font-weight:var(--brix-packs-weight);line-height:1.2}',
    '.brix-packs-tab-price{font-size:var(--brix-packs-desc);opacity:.8}',
    '.brix-packs-panel{display:flex;flex-direction:column;gap:12px;margin-top:var(--brix-packs-gap);padding:var(--brix-packs-card-pad);background:var(--brix-packs-card);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius)}',
    '.brix-packs-panel-head{display:flex;align-items:center;gap:12px}',
    '.brix-packs-panel-head .brix-packs-content{flex:1}',
    /* ── Layout: stacked (Stacked packs) — one card, rows divided; the chosen row opens its pickers. */
    '.brix-packs-stack{background:var(--brix-packs-card);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius)}',
    '.brix-packs-stack-item:first-child{border-radius:var(--brix-packs-radius) var(--brix-packs-radius) 0 0}.brix-packs-stack-item:last-child{border-radius:0 0 var(--brix-packs-radius) var(--brix-packs-radius)}.brix-packs-stack-item:only-child{border-radius:var(--brix-packs-radius)}',
    '.brix-packs-stack-item + .brix-packs-stack-item{border-top:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border)}',
    '.brix-packs-stack-item[data-selected="1"]{background:var(--brix-packs-selected);box-shadow:inset 3px 0 0 var(--brix-packs-primary)}',
    '.brix-packs-stack .brix-packs-tier,.brix-packs-stack .brix-packs-tier[aria-checked="true"]{border:0;border-radius:0;background:transparent;box-shadow:none}',
    '.brix-packs-widget[data-layout="visual"][data-image="1"] .brix-packs-tier{grid-template-columns:auto auto 1fr auto}',
    '.brix-packs-expand{padding:0 var(--brix-packs-card-pad) var(--brix-packs-card-pad)}',
    /* ── Item choices: plain dropdowns (tabs), photo tiles (stacked), photo dropdowns (visual). */
    '.brix-packs-selects{display:flex;flex-direction:column;gap:8px}',
    '.brix-packs-select-row{display:flex;flex-direction:column;gap:4px;font-size:var(--brix-packs-desc)}',
    '.brix-packs-widget select{width:100%;padding:8px;font:inherit;border:1px solid var(--brix-packs-border);border-radius:calc(var(--brix-packs-radius) / 2);background:var(--brix-packs-card);color:var(--brix-packs-text)}',
    '.brix-packs-tiles-wrap{display:flex;flex-direction:column;gap:10px}',
    '.brix-packs-tiles{display:flex;flex-wrap:wrap;gap:var(--brix-packs-gap)}',
    '.brix-packs-tile{flex:1 1 0;min-width:84px;max-width:150px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px;background:var(--brix-packs-card);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius);font-size:var(--brix-packs-desc);text-align:center}',
    '.brix-packs-tile img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:calc(var(--brix-packs-radius) / 2);background:#f1f2f4}',
    '.brix-packs-tile-name{font-weight:600;overflow-wrap:anywhere}',
    '.brix-packs-dds{display:flex;flex-direction:column;gap:8px}',
    '.brix-packs-dd{position:relative}',
    '.brix-packs-dd-trigger{width:100%;display:flex;align-items:center;gap:10px;margin:0;padding:8px 10px;background:var(--brix-packs-card);color:var(--brix-packs-text);border:1px solid var(--brix-packs-border);border-radius:calc(var(--brix-packs-radius) / 2);font:inherit;text-align:left;cursor:pointer}',
    '.brix-packs-dd-trigger:hover,.brix-packs-dd-trigger[aria-expanded="true"]{border-color:var(--brix-packs-primary)}',
    '.brix-packs-dd-trigger:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:2px}',
    '.brix-packs-dd img,.brix-packs-dd-noimg{display:block;width:44px;height:44px;flex-shrink:0;object-fit:cover;border-radius:calc(var(--brix-packs-radius) / 2);background:#f1f2f4}',
    '.brix-packs-dd-text{flex:1;min-width:0;display:flex;flex-direction:column}',
    '.brix-packs-dd-label{font-size:11px;opacity:.7}',
    '.brix-packs-dd-value{font-weight:600;overflow-wrap:anywhere}',
    '.brix-packs-dd-price{font-size:var(--brix-packs-desc);opacity:.8;white-space:nowrap}',
    '.brix-packs-dd-caret{opacity:.6}',
    '.brix-packs-dd-list{position:absolute;z-index:30;left:0;right:0;top:calc(100% + 4px);max-height:280px;overflow:auto;margin:0;padding:4px;list-style:none;background:var(--brix-packs-card);color:var(--brix-packs-text);border:1px solid var(--brix-packs-border);border-radius:calc(var(--brix-packs-radius) / 2);box-shadow:0 8px 24px rgba(0,0,0,.14)}',
    '.brix-packs-dd-option{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer}',
    '.brix-packs-dd-option .brix-packs-dd-value{flex:1}',
    '.brix-packs-dd-option:hover,.brix-packs-dd-option:focus{background:var(--brix-packs-selected);outline:none}',
    '.brix-packs-dd-option[aria-selected="true"]{box-shadow:inset 3px 0 0 var(--brix-packs-primary)}',
    '@media (max-width:480px){.brix-packs-tier{column-gap:10px}.brix-packs-tab{padding:10px 4px 8px}}',
  ].join('\n');

  function injectStyle() {
    if (document.getElementById('brix-packs-style')) return;
    var style = el('style', { id: 'brix-packs-style' });
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function applyCustomization(section, custom) {
    var colors = custom.colors || {};
    function color(key, fallback) { return HEX.test(colors[key] || '') ? colors[key] : fallback; }
    function px(value, fallback) { var n = Number(value); return (isFinite(n) ? n : fallback) + 'px'; }
    var borders = custom.borders || {};
    var type = custom.typography || {};
    var space = custom.spacing || {};
    var vars = {
      '--brix-packs-primary': color('primary', '#008060'), '--brix-packs-bg': color('background', '#ffffff'), '--brix-packs-card': color('cardBackground', '#ffffff'),
      '--brix-packs-selected': color('selectedCard', '#e6f4f1'), '--brix-packs-border': color('border', '#dfe3e8'), '--brix-packs-text': color('text', '#202223'),
      '--brix-packs-price': color('price', '#202223'), '--brix-packs-discount': color('discount', '#008060'), '--brix-packs-badge': color('badge', '#fff4d6'),
      '--brix-packs-button': color('button', '#008060'), '--brix-packs-button-text': color('buttonText', '#ffffff'),
      '--brix-packs-radius': px(borders.radius, 8), '--brix-packs-bw': px(borders.width, 1),
      '--brix-packs-bs': ['solid', 'dashed', 'dotted'].indexOf(borders.style) >= 0 ? borders.style : 'solid',
      '--brix-packs-h': px(type.headingSize, 20), '--brix-packs-title': px(type.packTitleSize, 15), '--brix-packs-priceSize': px(type.priceSize, 18), '--brix-packs-desc': px(type.descriptionSize, 13),
      '--brix-packs-weight': [400, 500, 600, 700].indexOf(Number(type.fontWeight)) >= 0 ? String(Number(type.fontWeight)) : '600',
      '--brix-packs-align': ['left', 'center', 'right'].indexOf(type.alignment) >= 0 ? type.alignment : 'left',
      '--brix-packs-pad': px(space.cardPadding, 16), '--brix-packs-card-pad': px(space.cardPadding, 16), '--brix-packs-gap': px(space.cardGap, 10),
      '--brix-packs-section': px(space.sectionSpacing, 20), '--brix-packs-btn-gap': px(space.buttonSpacing, 16),
    };
    Object.keys(vars).forEach(function (name) { section.style.setProperty(name, vars[name]); });
    if (borders.shadow) section.classList.add('is-shadow');
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  // Each design preset is a structurally different layout (mirrors layoutOf
  // in app/components/packs/PackPreview.jsx):
  //   tabs    -> packs side by side; under the chosen pack, one dropdown per item
  //   stacked -> packs as rows; the chosen row shows the variant photo per item
  //   visual  -> packs as rows; the chosen row opens one photo dropdown per item
  // Removed layouts map to their closest current one (LEGACY_DESIGN_MAP in
  // app/utils/packs.shared.js); this reads raw saved settings from PHP, so it
  // maps them itself. The old "image cards" template becomes tabs.
  var LEGACY_LAYOUTS = { classic: 'stacked', highlight: 'tabs', premium: 'tabs' };
  function layoutOf(design, template) {
    if (design === 'tabs' || design === 'stacked' || design === 'visual') return design;
    if (LEGACY_LAYOUTS[design]) return LEGACY_LAYOUTS[design];
    return template === 'visual_offer' ? 'tabs' : 'stacked';
  }

  function tierDisabled(pack, tier) {
    return !pack.available || (pack.maxQuantity !== null && pack.maxQuantity !== undefined && tier.quantity > pack.maxQuantity);
  }

  // Default every chooser slot to the shopper's currently selected variant
  // when it's one of the Pack's own variants, otherwise the first available one.
  function defaultChoice(pack) {
    var sellable = sellableOf(pack);
    for (var i = 0; i < sellable.length; i += 1) if (sellable[i].id === lastVariant) return lastVariant;
    if (sellable[0]) return sellable[0].id;
    if (pack.variants && pack.variants[0]) return pack.variants[0].id;
    return numericId(pack.variantId);
  }

  function sellableOf(pack) {
    return (pack.variants || []).filter(function (variant) { return variant.availableForSale; });
  }

  function layoutFor(pack) {
    var custom = pack.customization || {};
    return layoutOf((custom.design && custom.design.preset) || 'stacked', pack.template);
  }

  // One variant choice per item: always for Mix & Match; for other Packs in
  // the layouts built for choosing per item (Pack tabs, Visual picker) when
  // there's more than one variant to choose from. The checkout discount
  // accepts any allowed variant in a Pack, so mixing variants is safe.
  function perItem(pack) {
    if (!pack.variants || !pack.variants.length) return false;
    if (pack.packType === 'mix_match') return true;
    var layout = layoutFor(pack);
    return (layout === 'tabs' || layout === 'visual') && sellableOf(pack).length > 1;
  }

  function ensureChosen(pack, quantity) {
    var fallback = defaultChoice(pack);
    var next = [];
    for (var i = 0; i < quantity; i += 1) next.push(state.chosen[i] || fallback);
    state.chosen = next;
  }

  function priceOfVariant(pack, variantId) {
    if (pack.variants) {
      for (var i = 0; i < pack.variants.length; i += 1) if (pack.variants[i].id === variantId) return pack.variants[i].price;
    }
    return pack.basePrice;
  }

  function variantOf(pack, variantId) {
    var list = pack.variants || [];
    for (var i = 0; i < list.length; i += 1) if (list[i].id === variantId) return list[i];
    return null;
  }

  // The variant a same_variant Pack adds: the one picked in the Pack's own
  // picker, else the theme's selected variant, else the Pack's anchor variant.
  function packVariantId(pack) {
    if (state.pickVariant && variantOf(pack, state.pickVariant)) return state.pickVariant;
    return lastVariant || numericId(pack.variantId);
  }

  // Effective price/savings for a tier as displayed:
  //  - mix_match recomputes from the variants the shopper picked per item.
  //  - same_variant covering more than one variant recomputes from whichever
  //    variant is currently selected on the product page (prices differ per
  //    variant — see priceOfVariant).
  //  - everything else uses the server-computed values as-is.
  function displayedTier(pack, tier, index) {
    if (perItem(pack) && index === state.tierIndex) {
      ensureChosen(pack, tier.quantity); // one entry per item BEFORE pricing, or the total covers too few items
      var prices = state.chosen.map(function (id) { return priceOfVariant(pack, id); });
      return calc(prices, tier, money.decimals);
    }
    if (pack.packType !== 'mix_match' && pack.variants && pack.variants.length > 1) {
      var unitPrice = priceOfVariant(pack, packVariantId(pack));
      var sameVariantPrices = [];
      for (var i = 0; i < tier.quantity; i += 1) sameVariantPrices.push(unitPrice);
      return calc(sameVariantPrices, tier, money.decimals);
    }
    return { subtotal: tier.subtotal, savings: tier.savings, price: tier.price };
  }

  function render() {
    root.textContent = '';
    var pack = state.pack;
    if (!pack || !state.data) return;
    var custom = pack.customization || {};
    var content = custom.content || {};
    var savingsCfg = custom.savings || {};
    var saveWord = (savingsCfg.label && String(savingsCfg.label).trim()) || 'Save';
    var images = custom.images || {};
    var design = (custom.design && custom.design.preset) || 'stacked';
    var layout = layoutOf(design, pack.template);

    var hasImage = images.enabled !== false && Boolean(pack.productImage);

    var section = el('section', { class: 'brix-packs-widget', 'data-template': pack.template, 'data-design': design, 'data-layout': layout, 'data-image': hasImage ? '1' : null, 'data-image-position': images.position === 'left' ? 'left' : 'top', 'aria-label': content.heading || 'Packs' });
    applyCustomization(section, custom);

    var head = el('div', { class: 'brix-packs-head' }, [
      content.heading ? el('h2', { class: 'brix-packs-heading', text: content.heading }) : null,
      content.subheading ? el('p', { class: 'brix-packs-sub', text: content.subheading }) : null,
    ]);
    section.appendChild(head);

    var discount = state.data.checkoutDiscount;
    if (state.data.preview && discount && !discount.verified) {
      section.appendChild(el('div', { class: 'brix-packs-preview', role: 'status', text: 'Preview only — ' + (discount.message || 'the checkout discount is not active') + ' Shoppers do not see this widget until it is, and this discount will not be applied at checkout.' }));
    }

    function saveTextFor(shown) {
      if (savingsCfg.visible === false || !(shown.savings > 0)) return null;
      if (savingsCfg.mode === 'save_percent' || money.hidden) return saveWord + ' ' + percentLabel(shown.subtotal, shown.savings);
      return saveWord + ' ' + money.format(shown.savings);
    }
    function metaFor(tier, shown) {
      var meta = tier.quantity + ' item' + (tier.quantity === 1 ? '' : 's');
      if (!money.hidden && shown.savings > 0 && tier.quantity > 0) meta += ' · ' + money.format(shown.price / tier.quantity) + ' each';
      return meta;
    }
    function imageEl() {
      return hasImage ? el('img', { class: 'brix-packs-img', src: pack.productImage, alt: '', loading: 'lazy', 'data-size': images.size || 'medium' }) : null;
    }
    function priceEl(shown, saveText) {
      if (money.hidden) return el('span', { class: 'brix-packs-price' }, [saveText ? el('span', { class: 'brix-packs-save', text: saveText }) : null]);
      return el('span', { class: 'brix-packs-price' }, [
        shown.savings > 0 ? el('span', { class: 'brix-packs-was', text: money.format(shown.subtotal) }) : null,
        el('strong', { text: money.format(shown.price) }),
        saveText ? el('span', { class: 'brix-packs-save', text: saveText }) : null,
      ]);
    }
    function tierButtonProps(index, disabled, selected, className) {
      return {
        type: 'button', class: className, role: 'radio', 'aria-checked': selected ? 'true' : 'false', 'data-index': index,
        disabled: disabled, title: disabled ? (pack.available ? 'Only ' + pack.maxQuantity + ' in stock' : 'Sold out') : null,
        tabindex: selected ? '0' : '-1',
        onclick: function () { selectTier(index); },
        onkeydown: function (event) { onTierKey(event, index); },
      };
    }

    function titleContent(tier, shown) {
      return el('span', { class: 'brix-packs-content' }, [
        el('span', { class: 'brix-packs-title' }, [tier.name || 'Buy ' + tier.quantity, tier.badge ? el('span', { class: 'brix-packs-badge', text: tier.badge }) : null]),
        el('span', { class: 'brix-packs-meta', text: metaFor(tier, shown) }),
      ]);
    }

    if (layout === 'tabs') {
      // Design 1: packs side by side; one dropdown per item underneath.
      var tabs = el('div', { class: 'brix-packs-tabs', role: 'radiogroup', 'aria-label': content.heading || 'Choose a pack' });
      pack.tiers.forEach(function (tier, index) {
        var tabShown = displayedTier(pack, tier, index);
        tabs.appendChild(el('button', tierButtonProps(index, tierDisabled(pack, tier), index === state.tierIndex, 'brix-packs-tab'), [
          tier.badge ? el('span', { class: 'brix-packs-badge', text: tier.badge }) : null,
          el('span', { class: 'brix-packs-tab-label', text: tier.name || 'Buy ' + tier.quantity }),
          money.hidden ? null : el('span', { class: 'brix-packs-tab-price', text: money.format(tabShown.price) }),
        ]));
      });
      section.appendChild(tabs);
      var current = pack.tiers[state.tierIndex];
      if (current) {
        var currentShown = displayedTier(pack, current, state.tierIndex);
        section.appendChild(el('div', { class: 'brix-packs-panel', 'aria-live': 'polite' }, [
          renderItemSelects(pack, current),
          el('div', { class: 'brix-packs-panel-head' }, [imageEl(), titleContent(current, currentShown), priceEl(currentShown, saveTextFor(currentShown))]),
        ]));
      }
    } else {
      // Designs 2 and 3: packs as rows. The chosen row opens underneath —
      // Stacked shows the variant photo per item, Visual one photo dropdown per item.
      var stack = el('div', { class: 'brix-packs-stack', role: 'radiogroup', 'aria-label': content.heading || 'Choose a pack' });
      pack.tiers.forEach(function (tier, index) {
        var rowShown = displayedTier(pack, tier, index);
        var isSelected = index === state.tierIndex;
        var item = el('div', { class: 'brix-packs-stack-item', 'data-selected': isSelected ? '1' : null }, [
          el('button', tierButtonProps(index, tierDisabled(pack, tier), isSelected, 'brix-packs-tier'), [
            el('span', { class: 'brix-packs-radio', 'aria-hidden': 'true' }),
            layout === 'stacked' ? null : imageEl(),
            titleContent(tier, rowShown),
            priceEl(rowShown, saveTextFor(rowShown)),
          ]),
        ]);
        if (isSelected) {
          var opened = layout === 'visual' ? renderImageDropdowns(pack, tier) : renderTiles(pack, tier);
          if (opened) item.appendChild(el('div', { class: 'brix-packs-expand' }, [opened]));
        }
        stack.appendChild(item);
      });
      section.appendChild(stack);
    }

    if (content.promoText) section.appendChild(el('p', { class: 'brix-packs-promo', text: content.promoText }));
    if (state.message) section.appendChild(el('div', { class: 'brix-packs-msg', role: 'alert', 'data-type': state.message.type, text: state.message.text }));

    var selectedTier = pack.tiers[state.tierIndex];
    var addDisabled = Boolean(state.busy) || !selectedTier || tierDisabled(pack, selectedTier);
    var addButton = el('button', { type: 'button', class: 'brix-packs-add', disabled: addDisabled, onclick: function () { addToCart(false); }, text: state.busy === 'add' ? 'Adding\u2026' : (pack.available ? (content.cta || 'Add Pack to Cart') : 'Sold out') });
    if (buyNowOn(pack) && pack.available) {
      section.appendChild(el('div', { class: 'brix-packs-actions' }, [
        addButton,
        el('button', { type: 'button', class: 'brix-packs-buy', disabled: addDisabled, onclick: function () { addToCart(true); }, text: state.busy === 'buy' ? 'Going to checkout\u2026' : (content.buyNow || 'Buy Now') }),
      ]));
    } else {
      section.appendChild(addButton);
    }
    root.appendChild(section);
    // Keep keyboard focus on the open Visual picker list after re-rendering.
    if (state.openPicker !== null) {
      var option = root.querySelector('.brix-packs-dd[data-key="' + state.openPicker + '"] [aria-selected="true"]') || root.querySelector('.brix-packs-dd[data-key="' + state.openPicker + '"] [role="option"]');
      if (option) option.focus();
    }
  }

  function variantImage(pack, variant) {
    return (variant && variant.image) || pack.productImage || '';
  }

  function optionText(variant) {
    return variant.title + (money.hidden ? '' : ' \u2014 ' + money.format(variant.price));
  }

  function nativeSelect(label, value, options, onchange) {
    return el('select', { 'aria-label': label, onchange: onchange }, options.map(function (variant) {
      return el('option', { value: variant.id, selected: variant.id === value, text: optionText(variant) });
    }));
  }

  function chooseItem(slot) {
    return function (event) { state.chosen[slot] = event.target.value; state.message = null; render(); };
  }

  function pickSameVariant(event) {
    state.pickVariant = event.target.value;
    state.message = null;
    render();
  }

  // Design 1 (Pack tabs): one plain dropdown per item, stacked vertically.
  function renderItemSelects(pack, tier) {
    var sellable = sellableOf(pack);
    if (!sellable.length) return null;
    if (!perItem(pack)) return null;
    ensureChosen(pack, tier.quantity);
    var list = el('div', { class: 'brix-packs-selects' });
    for (var i = 0; i < tier.quantity; i += 1) {
      list.appendChild(el('label', { class: 'brix-packs-select-row' }, [el('span', { text: 'Item ' + (i + 1) }), nativeSelect('Item ' + (i + 1) + ' variant', state.chosen[i], sellable, chooseItem(i))]));
    }
    return list;
  }

  // A single-variant product's only variant is called "Default Title" by Shopify.
  function tileName(pack, variant) {
    var title = variant ? variant.title : pack.variantTitle;
    return !title || title === 'Default Title' ? (pack.productTitle || '') : title;
  }

  // Design 2 (Stacked packs): the variant's photo once per item. A product
  // with several variants gets one dropdown above that switches them all;
  // Mix & Match gets a small dropdown under each photo instead.
  function renderTiles(pack, tier) {
    var sellable = sellableOf(pack);
    var each = perItem(pack);
    if (each) ensureChosen(pack, tier.quantity);
    var wrap = el('div', { class: 'brix-packs-tiles-wrap' });
    if (!each && sellable.length > 1) {
      var current = packVariantId(pack);
      if (!sellable.some(function (variant) { return variant.id === current; })) current = sellable[0].id;
      wrap.appendChild(el('label', { class: 'brix-packs-select-row' }, [el('span', { text: tier.quantity > 1 ? 'Variant (all ' + tier.quantity + ' items)' : 'Variant' }), nativeSelect('Variant', current, sellable, pickSameVariant)]));
    }
    var tiles = el('div', { class: 'brix-packs-tiles' });
    for (var i = 0; i < tier.quantity; i += 1) {
      var id = each ? state.chosen[i] : packVariantId(pack);
      var variant = variantOf(pack, id);
      var image = variantImage(pack, variant);
      tiles.appendChild(el('div', { class: 'brix-packs-tile' }, [
        image ? el('img', { src: image, alt: variant ? variant.title : (pack.variantTitle || ''), loading: 'lazy' }) : null,
        el('span', { class: 'brix-packs-tile-name', text: tileName(pack, variant) }),
        each ? nativeSelect('Item ' + (i + 1) + ' variant', id, sellable, chooseItem(i)) : null,
      ]));
    }
    wrap.appendChild(tiles);
    return wrap;
  }

  // Design 3 (Visual picker): one dropdown per item whose closed box AND every
  // option show the variant photo. A single-variant product has nothing to
  // choose, so it shows the photos like Stacked packs.
  function renderImageDropdowns(pack, tier) {
    var sellable = sellableOf(pack);
    if (!sellable.length || (!perItem(pack) && sellable.length < 2)) return renderTiles(pack, tier);
    var list = el('div', { class: 'brix-packs-dds' });
    if (perItem(pack)) {
      ensureChosen(pack, tier.quantity);
      for (var i = 0; i < tier.quantity; i += 1) {
        (function (slot) {
          list.appendChild(imageDropdown(pack, 'item-' + slot, 'Item ' + (slot + 1), state.chosen[slot], sellable, function (id) { state.chosen[slot] = id; }));
        })(i);
      }
    } else {
      list.appendChild(imageDropdown(pack, 'all', tier.quantity > 1 ? 'Variant (all ' + tier.quantity + ' items)' : 'Variant', packVariantId(pack), sellable, function (id) { state.pickVariant = id; }));
    }
    return list;
  }

  function imageDropdown(pack, key, label, value, options, onpick) {
    var chosen = variantOf(pack, value);
    if (!chosen || !options.some(function (variant) { return variant.id === chosen.id; })) chosen = options[0];
    var open = state.openPicker === key;
    function pick(id) { onpick(id); state.openPicker = null; state.message = null; render(); focusTrigger(key); }
    function close() { state.openPicker = null; render(); focusTrigger(key); }
    function photo(variant) {
      var image = variantImage(pack, variant);
      return image ? el('img', { src: image, alt: '', loading: 'lazy' }) : el('span', { class: 'brix-packs-dd-noimg', 'aria-hidden': 'true' });
    }
    var trigger = el('button', {
      type: 'button', class: 'brix-packs-dd-trigger', 'aria-haspopup': 'listbox', 'aria-expanded': open ? 'true' : 'false', 'aria-label': label + ': ' + chosen.title,
      onclick: function (event) { event.stopPropagation(); state.openPicker = open ? null : key; render(); },
      onkeydown: function (event) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); state.openPicker = key; render(); } },
    }, [
      photo(chosen),
      el('span', { class: 'brix-packs-dd-text' }, [el('span', { class: 'brix-packs-dd-label', text: label }), el('span', { class: 'brix-packs-dd-value', text: chosen.title })]),
      money.hidden ? null : el('span', { class: 'brix-packs-dd-price', text: money.format(chosen.price) }),
      el('span', { class: 'brix-packs-dd-caret', 'aria-hidden': 'true', text: '\u25BE' }),
    ]);
    var children = [trigger];
    if (open) {
      children.push(el('ul', { class: 'brix-packs-dd-list', role: 'listbox', 'aria-label': label }, options.map(function (variant, index) {
        return el('li', {
          role: 'option', class: 'brix-packs-dd-option', tabindex: '-1', 'data-index': index, 'aria-selected': variant.id === chosen.id ? 'true' : 'false',
          onclick: function (event) { event.stopPropagation(); pick(variant.id); },
          onkeydown: function (event) {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(variant.id); return; }
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (event.key === 'Tab') { state.openPicker = null; render(); return; }
            var step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            var next = event.currentTarget.parentNode.children[(index + step + options.length) % options.length];
            if (next) next.focus();
          },
        }, [photo(variant), el('span', { class: 'brix-packs-dd-value', text: variant.title }), money.hidden ? null : el('span', { class: 'brix-packs-dd-price', text: money.format(variant.price) })]);
      })));
    }
    return el('div', { class: 'brix-packs-dd', 'data-key': key }, children);
  }

  function focusTrigger(key) {
    var trigger = root.querySelector('.brix-packs-dd[data-key="' + key + '"] .brix-packs-dd-trigger');
    if (trigger) trigger.focus();
  }

  function selectTier(index) {
    var tier = state.pack.tiers[index];
    if (!tier || tierDisabled(state.pack, tier)) return;
    state.tierIndex = index;
    state.message = null;
    render();
    focusTier(index);
  }

  function focusTier(index) {
    var node = root.querySelector('[data-index="' + index + '"]');
    if (node) node.focus();
  }

  function onTierKey(event, index) {
    var keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    if (!keys[event.key]) return;
    event.preventDefault();
    var count = state.pack.tiers.length;
    for (var step = 1; step <= count; step += 1) {
      var next = (index + keys[event.key] * step + count * step) % count;
      if (!tierDisabled(state.pack, state.pack.tiers[next])) { selectTier(next); return; }
    }
  }

  // ── cart ───────────────────────────────────────────────────────────────────

  function notifyCartUpdated(detail) {
    CART_EVENTS.forEach(function (name) {
      try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* a theme listener threw \u2014 never block the cart flow */ }
    });
  }

  function buildItems(pack, tier) {
    var group = token();
    var properties = { _brix_pack_id: String(pack.id), _brix_pack_quantity: String(tier.quantity), _brix_pack_version: String(pack.version), _brix_pack_group: group };
    if (!perItem(pack)) {
      // Every item is the same variant: the one picked in the Pack, else the
      // one selected on the product page — any of the Pack's allowed
      // variants, not necessarily the anchor pack.variantId.
      var variantId = packVariantId(pack);
      return [{ id: Number(variantId), quantity: tier.quantity, properties: properties }];
    }
    ensureChosen(pack, tier.quantity);
    var counts = {};
    var order = [];
    state.chosen.forEach(function (id) { if (!counts[id]) { counts[id] = 0; order.push(id); } counts[id] += 1; });
    return order.map(function (id) { return { id: Number(id), quantity: counts[id], properties: properties }; });
  }

  function cartErrorMessage(response, body) {
    if (body && (body.description || body.message)) return String(body.description || body.message);
    if (response.status === 422) return 'Some items are not available in that quantity. Try a smaller pack.';
    return 'Could not add the pack to your cart. Please try again.';
  }

  function checkoutUrl() {
    return ((window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/') + 'checkout';
  }

  // buyNow: add the Pack, then go straight to checkout (like the theme's Buy it now).
  function addToCart(buyNow) {
    var pack = state.pack;
    var tier = pack && pack.tiers[state.tierIndex];
    if (!tier || state.busy) return;
    state.busy = buyNow ? 'buy' : 'add';
    state.message = null;
    render();
    var items = buildItems(pack, tier);
    fetch(cartAddUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: items }) })
      .then(function (response) {
        return response.json().catch(function () { return null; }).then(function (body) {
          if (!response.ok) throw new Error(cartErrorMessage(response, body));
          return body;
        });
      })
      .then(function (body) {
        var detail = { packId: pack.id, quantity: tier.quantity, items: body && body.items, buyNow: Boolean(buyNow) };
        document.dispatchEvent(new CustomEvent('brix:packs:added', { detail: detail }));
        if (buyNow) { state.redirecting = true; window.location.assign(checkoutUrl()); return; }
        state.message = { type: 'success', text: 'Added to your cart.' };
        notifyCartUpdated(detail);
      })
      .catch(function (error) {
        state.message = { type: 'error', text: error && error.message && error.message.indexOf('Failed to fetch') < 0 ? error.message : 'Could not reach the cart. Check your connection and try again.' };
      })
      .then(function () { if (state.redirecting) return; state.busy = false; render(); });
  }

  // ── boot ───────────────────────────────────────────────────────────────────

  // The theme's real product form. Themes like Dawn also render a hidden
  // "installment" form posting to /cart/add right under the price, so the first
  // match isn't safe: prefer a form with its own submit button.
  function productForm() {
    var forms = Array.prototype.slice.call(document.querySelectorAll('form[action*="/cart/add"]'));
    var real = forms.filter(function (form) {
      return !/installment/i.test((form.getAttribute('id') || '') + ' ' + (form.getAttribute('class') || '')) && form.querySelector('[name="add"], [type="submit"]');
    });
    return real[0] || forms[0] || null;
  }

  // 'below_price' (default) or 'custom'. Packs saved with the removed
  // "next to the buy buttons" choices show below the price.
  function placementOf(pack) {
    var position = pack && pack.customization && pack.customization.placement && pack.customization.placement.position;
    return position === 'custom' ? 'custom' : 'below_price';
  }

  // Common theme price blocks, most specific first (Dawn wraps its price in
  // #price-<section id>).
  var PRICE_SELECTORS = ['[id^="price-template"]', '[id^="ProductPrice"]', '.product__price', '.product-single__price', '.product-price', '.product__info-price', '.price__container', '[data-product-price]', '.price'];

  // The product's price block: searched from the product form outwards, so a
  // price in a recommendations section elsewhere on the page is never picked.
  // Returns the block's top-level element within the nearest container that
  // holds both the price and the product form, or null.
  function priceAnchor() {
    var form = productForm();
    if (!form) return null;
    var container = form.parentElement;
    for (var depth = 0; container && depth < 8; depth += 1) {
      for (var i = 0; i < PRICE_SELECTORS.length; i += 1) {
        var matches = container.querySelectorAll(PRICE_SELECTORS[i]);
        for (var m = 0; m < matches.length; m += 1) {
          var price = matches[m];
          if (form.contains(price) || root.contains(price) || price.contains(form)) continue;
          var block = price;
          while (block.parentElement && block.parentElement !== container) block = block.parentElement;
          return block;
        }
      }
      container = container.parentElement;
    }
    return null;
  }

  // below_price: right after the product price. custom: inside the "BRIX Packs
  // position" app block. When neither is found, above the buy buttons.
  function place(pack) {
    if (root.getAttribute('style')) root.removeAttribute('style'); // the embed's pre-placement spacing
    var slot = placementOf(pack) === 'custom' && document.querySelector('[data-brix-packs-slot]');
    if (slot) { if (root.parentNode !== slot) slot.appendChild(root); return; }
    var price = priceAnchor();
    if (price && price.parentNode) {
      if (price.nextElementSibling !== root) price.parentNode.insertBefore(root, price.nextSibling);
      return;
    }
    var form = productForm();
    var anchor = form && (form.closest('product-form') || form);
    if (anchor && anchor.parentNode && root.nextElementSibling !== anchor) anchor.parentNode.insertBefore(root, anchor);
  }

  function setHidden(node, hidden) {
    if (hidden) { node.setAttribute('data-brix-packs-hidden', '1'); node.style.display = 'none'; }
    else if (node.getAttribute('data-brix-packs-hidden')) { node.removeAttribute('data-brix-packs-hidden'); node.style.display = ''; }
  }

  // While a Pack is shown for the selected variant, the Pack's own button adds
  // it to the cart with the Pack's quantity, so the theme's quantity selector
  // and Add to cart button are hidden (and restored when no Pack applies).
  // Buy it now (dynamic checkout) is left alone.
  function buyNowOn(pack) {
    var content = (pack && pack.customization && pack.customization.content) || {};
    return Boolean(pack) && content.showBuyNow !== false;
  }

  function setThemeControlsHidden(hidden, hidePayment) {
    var form = productForm();
    if (!form) return;
    // getAttribute, not form.id: the form contains <input name="id">, which
    // shadows the form's `id` property.
    var formId = form.getAttribute('id');
    var inputs = Array.prototype.slice.call(form.querySelectorAll('input[name="quantity"]'));
    if (formId) inputs = inputs.concat(Array.prototype.slice.call(document.querySelectorAll('input[name="quantity"][form="' + formId + '"]')));
    inputs.forEach(function (input) {
      var box = input.closest('quantity-input, .quantity, .product-form__quantity, .product-form__input--quantity') || input.parentElement;
      if (!box) return;
      setHidden(box.closest('.product-form__input') || box, hidden);
    });
    var buttons = Array.prototype.slice.call(form.querySelectorAll('[name="add"], button[type="submit"], input[type="submit"]'));
    if (formId) buttons = buttons.concat(Array.prototype.slice.call(document.querySelectorAll('[type="submit"][form="' + formId + '"]')));
    buttons.forEach(function (button) {
      if (button.closest('.shopify-payment-button, [data-shopify="payment-button"]') || root.contains(button)) return;
      setHidden(button, hidden);
    });
    // The theme's Buy it now (dynamic checkout) goes too when the Pack has its
    // own Buy Now, so there's one clear way to buy the Pack.
    Array.prototype.forEach.call(form.querySelectorAll('.shopify-payment-button, [data-shopify="payment-button"]'), function (node) {
      if (!root.contains(node)) setHidden(node, hidden && Boolean(hidePayment));
    });
  }

  function showFor(variantId) {
    var next = packForVariant(state.data.packs, variantId);
    setThemeControlsHidden(Boolean(next), buyNowOn(next));
    if (next) place(next);
    // A new theme variant takes over from the Pack's own picker.
    state.pickVariant = null;
    if (next === state.pack) { render(); return; }
    state.pack = next;
    state.tierIndex = 0;
    state.chosen = [];
    state.message = null;
    if (next) {
      var first = 0;
      while (first < next.tiers.length && tierDisabled(next, next.tiers[first])) first += 1;
      state.tierIndex = first < next.tiers.length ? first : 0;
    }
    render();
  }

  function fail(message) {
    if (preview) {
      injectStyle();
      root.textContent = '';
      root.appendChild(el('div', { class: 'brix-packs-preview', role: 'alert', text: 'BRIX Packs preview: ' + message }));
    }
    if (window.console && console.warn) console.warn('[BRIX Packs] ' + message);
  }

  document.addEventListener('click', function () {
    if (state.openPicker !== null) { state.openPicker = null; render(); }
  });

  if (!shop || !productId || !endpoint) { fail('missing shop, product or API address.'); return; }

  var url = endpoint + (endpoint.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(shop) + '&productId=' + encodeURIComponent(productId) + (preview ? '&preview=1' : '');
  fetch(url, { headers: { Accept: 'application/json' } })
    .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
    .then(function (result) {
      if (!result.ok || !result.body || !result.body.success) { fail((result.body && result.body.error) || 'the Packs service returned an error.'); return; }
      var data = result.body;
      if (data.pricing === 'client' && data.packs && data.packs.length) {
        var product = readPageProduct();
        if (!product) { fail('the product data from Packs.liquid is missing.'); return; }
        data = priceOnPage(data, product);
        if (!data.packs.length) data.reason = 'price_unverified';
      }
      if (!data.packs || !data.packs.length) {
        if (preview) fail('no widget to show (' + (data.reason || 'no active Pack') + ').');
        return;
      }
      injectStyle();
      money = makeMoney(data.currency);
      state.data = data;
      lastVariant = currentVariantId();
      showFor(lastVariant);
      setInterval(function () {
        var variant = currentVariantId();
        if (variant !== lastVariant) { lastVariant = variant; showFor(variant); }
        else {
          setThemeControlsHidden(Boolean(state.pack), buyNowOn(state.pack)); // a theme re-render can bring them back
          if (state.pack && !root.isConnected) { place(state.pack); } // a theme re-render replaced the block the Pack sat in
        }
      }, 700);
    })
    .catch(function () { fail('could not reach the Packs service.'); });
})();

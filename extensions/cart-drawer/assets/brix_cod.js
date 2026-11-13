/* BRIX COD Checkout - storefront sheet (see CLAUDE.md, "BRIX COD Checkout").
 *
 * One Cash-on-Delivery flow shared by three entry points:
 *   - cart drawer   (BRIX Cart Drawer: cart_drawer_inline.js -> BrixCod.mountDrawerButton;
 *                    or, when that drawer is off, the theme's own cart drawer:
 *                    initThemeDrawer adds the button next to its Checkout)
 *   - product page  (auto-injected under Add to Cart, or into the
 *                    "COD button" app block's [data-brix-cod-slot])
 *   - combo pages   (combo-page.js / preview iframe -> BrixCod.open)
 *
 * Flow: phone (+ OTP when the store has SMS set up) -> address -> review
 * (priced by Shopify on our server) -> order placed in Shopify as
 * "Payment pending", tagged COD. Prepaid is never handled here: "Pay online"
 * always hands back to the caller's normal checkout path.
 *
 * Where data comes from:
 *   - COD settings and PIN code lookups: the BRIX PHP backend
 *     (php_backend/cod_storefront.php on data-php), like the cart drawer's
 *     own settings.
 *   - OTP, pricing and placing the order: php_backend/cod_checkout.php,
 *     which relays them server-to-server to the BRIX app server (the only
 *     place holding the store's Shopify access).
 * The browser only ever talks to the PHP backend.
 *
 * Every server call re-checks the merchant's rules; anything shown here
 * before that (min/max hints) is only a hint.
 */
(function () {
  'use strict';
  if (window.BrixCod) return;

  var script = document.currentScript;
  var PHP_API = ((script && script.getAttribute('data-php')) || 'https://int.thebrix.io').replace(/\/$/, '');
  var SHOP = (script && script.getAttribute('data-shop')) || (window.Shopify && window.Shopify.shop) || '';
  var CURRENCY = (script && script.getAttribute('data-currency')) || 'INR';
  // Product pages: the collections this product is in (the app embed writes
  // them), for the prepaid offer's excluded collections.
  var PRODUCT_COLLECTIONS = String((script && script.getAttribute('data-product-collections')) || '').split(',').filter(function (id) { return /^\d+$/.test(id); });
  var BRIX_LOGO = (script && script.getAttribute('data-brix-logo')) || '';
  var ROOT = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  var CONFIG_KEY = 'brix_cod_config_v8'; // bump when the config shape changes (v7: product picks, unlisted products; v8: products' own COD fee, products left out of prepaid)
  var ADDRESS_KEY = 'brix_cod_address_v1';
  var TOKEN_KEY = 'brix_cod_token_v1';

  var STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh',
    'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
    'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
    'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

  /* ---------- small utils ---------- */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }

  /* i18n-shim:begin (copy of app/i18n/storefront.shared.js I18N_SHIM) */
  // Shopper-language text: window.BrixI18n comes from brix_i18n_<lang>.js,
  // which the app embed loads first on a page in a language BRIX has. Without
  // it the English written at the call site shows (it equals app/i18n/en.json).
  function bxFill(en, vars) {
    var v = vars || {};
    return String(en).replace(/\{(\w+), plural,((?:[^{}]|\{[^{}]*\})*)\}/g, function (m, name, body) {
      var n = Number(v[name]);
      var pick = body.match(new RegExp('=' + n + '\\s*\\{([^{}]*)\\}')) || (n === 1 && body.match(/\bone\s*\{([^{}]*)\}/)) || body.match(/\bother\s*\{([^{}]*)\}/);
      return pick ? pick[1].replace(/#/g, String(n)) : '';
    }).replace(/\{(\w+)\}/g, function (m, name) {
      return v[name] === undefined || v[name] === null ? '' : String(v[name]);
    });
  }
  function bxT(key, en, vars) {
    var i18n = window.BrixI18n;
    return i18n ? i18n.t(key, en, vars) : bxFill(en, vars);
  }
  // Text the merchant can edit: their own words stay; blank or still the
  // English default shows in the shopper's language.
  function bxText(saved, key, en, vars) {
    var i18n = window.BrixI18n;
    if (i18n) return i18n.text(saved, key, en, vars);
    var s = saved === undefined || saved === null ? '' : String(saved);
    return s.replace(/^\s+|\s+$/g, '') ? s : bxFill(en, vars);
  }
  function bxDir() {
    return window.BrixI18n && window.BrixI18n.dir === 'rtl' ? 'rtl' : 'ltr';
  }
  /* i18n-shim:end */

  // Server refusals the shopper can see, by code, in their language (the
  // server's English when BRIX has no text for the code; values the message
  // needs come in res.details).
  var COD_ERRORS = {
    invalid_phone: ['error.cod.invalid_phone', 'Enter a valid 10-digit mobile number.'],
    invalid_pincode: ['error.cod.invalid_pincode', 'Enter a valid 6-digit PIN code.'],
    otp_invalid: ['error.cod.otp_invalid', 'Enter the 4-digit code from the SMS.'],
    partial_unavailable: ['error.cod.partial_unavailable', 'Part payment is not available for this order. Please choose Cash on Delivery or pay online.'],
    partial_required: ['error.cod.partial_required', 'This order needs a part payment online. Please choose Part payment.'],
    otp_locked: ['error.cod.otp_locked', 'Too many wrong tries. Ask for a new code.'],
    otp_expired: ['error.cod.otp_expired', 'This code has expired. Ask for a new one.'],
    otp_wrong: ['error.cod.otp_wrong', 'That code doesn\'t match. {attemptsLeft, plural, one {# try left.} other {# tries left.}}'],
    otp_required: ['error.cod.otp_required', 'Please verify your phone number again.'],
    otp_send_failed: ['error.cod.otp_send_failed', 'We couldn\'t send the code to this number. Check it and try again, or pay online.'],
    item_unavailable: ['error.cod.item_unavailable', 'One of the items in your cart is no longer available. Refresh the page and try again.'],
    item_sold_out: ['error.cod.item_sold_out', '{title} is sold out.'],
    checkout_only: ['error.cod.checkout_only', 'This cart has a free gift that is only available with online payment.'],
    in_progress: ['error.cod.in_progress', 'Your order is already being placed. Please wait a moment.'],
    database_error: ['error.cod.unavailable', 'Cash on Delivery is temporarily unavailable. Please try again, or pay online.'],
    storage_missing: ['error.cod.unavailable', 'Cash on Delivery is temporarily unavailable. Please try again, or pay online.'],
    cod_disabled: ['error.cod.disabled', 'Cash on Delivery is not available right now. Please pay online.'],
    rate_limited: ['error.cod.rate_limited', 'Too many attempts. Please wait a few minutes and try again.'],
    shopify_error: ['error.cod.shopify_error', 'We couldn\'t reach the store right now. Please try again, or pay online.'],
    calculate_failed: ['error.cod.calculate_failed', 'We couldn\'t price this order. Please try again, or pay online.'],
    draft_not_ready: ['error.cod.draft_not_ready', 'The store took too long to confirm your order. Please try again.'],
    combo_price_mismatch: ['error.cod.combo_price_mismatch', 'Cash on Delivery can\'t be used for this box right now. Please pay online.'],
    no_delivery_option: ['error.cod.no_delivery_option', 'No delivery option is available for this address and cart right now. Please try another address, or pay online.'],
    daily_limit: ['error.cod.daily_limit', 'This number has reached today\'s limit of {limit, plural, one {# Cash on Delivery order} other {# Cash on Delivery orders}}. Please pay online to order again.'],
    invalid_request: ['error.cod.invalid_request', 'Refresh the page and try again.'],
    network: ['error.network', 'We couldn\'t connect. Check your internet and try again.'],
    internal_error: ['error.generic', 'Something went wrong. Please try again.']
  };
  // A translated sentence holding one piece of HTML (a link, a bold price):
  // the message has {name} where it goes, so each language can place it.
  function bxHtml(key, en, name, html, vars) {
    var v = Object.assign({}, vars);
    v[name] = '\u0001';
    return esc(bxT(key, en, v)).replace('\u0001', html);
  }
  // Partial COD: { advance, balance } for an order total, or null when it isn't on
  // offer (mirrors partialCodSplit in app/utils/partial-cod.shared.js; the app
  // server works out the real amounts again). `q` = the quote: its shipping +
  // COD fee are the advance in `charges` mode.
  function partialSplit(cfg, q) {
    var p = cfg && cfg.partialCod;
    var t = Number(q && q.total);
    if (!p || !isFinite(t) || t <= 0) return null;
    if (Number(p.minOrder) > 0 && t < Number(p.minOrder)) return null;
    if (Number(p.maxOrder) > 0 && t > Number(p.maxOrder)) return null;
    var raw = p.mode === 'percent' ? (t * Number(p.percent)) / 100
      : p.mode === 'charges' ? (Number(q.shipping) || 0) + (Number(q.codFee) || 0)
        : Number(p.amount);
    if (!isFinite(raw) || raw <= 0) return null;
    var advance = Math.max(1, Math.ceil(raw - 1e-9));
    if (advance >= t) return null;
    return { advance: advance, balance: Math.round((t - advance) * 100) / 100 };
  }

  function errorText(res) {
    var known = res && res.code && Object.prototype.hasOwnProperty.call(COD_ERRORS, res.code) ? COD_ERRORS[res.code] : null;
    var vars = res && res.details && res.details.vars;
    // A message with values only when the server sent them.
    if (known && (!/\{/.test(known[1]) || vars)) return bxT(known[0], known[1], vars);
    return (res && res.error) || bxT('error.generic', 'Something went wrong. Please try again.');
  }
  function readStore(kind, key) {
    try { var s = store(kind); var raw = s && s.getItem(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeStore(kind, key, value) {
    try { var s = store(kind); if (s) { if (value == null) s.removeItem(key); else s.setItem(key, JSON.stringify(value)); } } catch (e) { /* storage blocked */ }
  }
  function normalizePhone(value) {
    var d = String(value || '').replace(/\D/g, '');
    if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2);
    else if (d.length === 11 && d.charAt(0) === '0') d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? d : null;
  }
  function idemKey() {
    var a = '';
    for (var i = 0; i < 4; i++) a += Math.random().toString(36).slice(2, 10);
    return ('cod' + Date.now().toString(36) + a).slice(0, 48);
  }
  function moneyFormatter(code) {
    var nf = null;
    try { nf = new Intl.NumberFormat(document.documentElement.lang || 'en-IN', { style: 'currency', currency: code || 'INR' }); } catch (e) { nf = null; }
    return function (n) { n = Number(n) || 0; return nf ? nf.format(n) : (code || '') + ' ' + n.toFixed(2); };
  }

  // Like moneyFormatter, but whole amounts without ".00" (990, not 990.00).
  // With Account → Price display → "Hide decimals in prices" on
  // (window.__brixWholePrices), every amount is whole (display only; the COD
  // popup's bill uses moneyFormatter and stays exact).
  function shortMoney(code) {
    var full = moneyFormatter(code);
    var whole = null;
    try { whole = new Intl.NumberFormat(document.documentElement.lang || 'en-IN', { style: 'currency', currency: code || 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }); } catch (e) { whole = null; }
    return function (n) {
      n = Number(n) || 0;
      if (whole && window.__brixWholePrices === true) return whole.format(Math.round(n));
      return whole && Math.round(n * 100) % 100 === 0 ? whole.format(n) : full(n);
    };
  }

  // Amounts on buttons and their fee lines: like shortMoney when prices are
  // shown whole, else the exact amount.
  function buttonMoney(code) {
    return window.__brixWholePrices === true ? shortMoney(code) : moneyFormatter(code);
  }

  // The shopper's currency, as the theme shows prices.
  function shopperMoney() {
    return shortMoney((window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || CURRENCY);
  }

  // Price tags in the merchant's button text ("Buy it for {cod_price} COD"),
  // {{tag}} too. Mirrors app/utils/price-tags.shared.js fillPriceTags.
  var PRICE_TAG = /\{\{?\s*(price|cod_fee|cod_price|prepaid_price|saving)\s*\}?\}/g;
  function hasPriceTags(text) { return new RegExp(PRICE_TAG.source).test(String(text || '')); }
  function showsCodFee(text) { return /\{\{?\s*(cod_fee|cod_price)\s*\}?\}/.test(String(text || '')); }
  function priceTags(text, values, fmt) {
    return String(text || '').replace(PRICE_TAG, function (all, key) {
      var n = values ? values[key] : null;
      return n == null || !isFinite(Number(n)) ? '' : fmt(Number(n));
    }).replace(/\s+/g, ' ').trim();
  }
  // The COD fee for an order of `price` (cod.shared.js codFeeOf, same
  // rounding): codFeePercent % of it from codFeePercentFrom on, else the
  // fixed codFee (also when the price isn't known yet).
  // `ids`: the order's product ids (numeric), when known: products with
  // their own fee (cfg.codFeeProducts) only = that fee, mixed with others =
  // the higher one. Mirrors cod.shared.js codFeeOf / codProductFee.
  function codFeeFor(cfg, price, ids) {
    var fixed = cfg && cfg.codFee > 0 ? Number(cfg.codFee) : 0;
    var pct = cfg && cfg.codFeePercent > 0 ? Number(cfg.codFeePercent) : 0;
    var value = Number(price);
    var normal = !pct || price == null || !isFinite(value) || value < (Number(cfg.codFeePercentFrom) || 0) ? fixed : Math.round(value * pct) / 100;
    var own = cfg && cfg.codFeeProducts;
    var picked = own && Array.isArray(own.products) ? own.products.map(String) : [];
    var list = (ids || []).map(String).filter(Boolean);
    var hit = function (id) { return picked.indexOf(id) !== -1; };
    if (!picked.length || !list.some(hit)) return normal;
    var fee = Number(own.fee) > 0 ? Math.round(Number(own.fee) * 100) / 100 : 0;
    return list.every(hit) ? fee : Math.max(normal, fee);
  }
  // The cart's product ids (numeric), for codFeeFor.
  function cartProductIds(cart) {
    return ((cart && cart.items) || []).map(function (it) { return String(it.product_id || ''); }).filter(Boolean);
  }
  // The merchant's COD button texts; left at the English default = the shopper's language.
  function drawerText(cfg) { return bxText(cfg.buttons && cfg.buttons.drawerText, 'storefront.cod.button', 'Cash on Delivery'); }
  function productText(cfg) { return bxText(cfg.buttons && cfg.buttons.productText, 'storefront.cod.product_button', 'Buy with Cash on Delivery'); }
  function hasCodFee(cfg) { return Boolean(cfg && (cfg.codFee > 0 || cfg.codFeePercent > 0 || (cfg.codFeeProducts && cfg.codFeeProducts.fee > 0))); }

  // A COD button's text for this price (null = not known yet).
  function codLabel(cfg, text, price, ids) {
    if (!hasPriceTags(text)) return text;
    var fee = codFeeFor(cfg, price, ids);
    var values = price == null || !isFinite(Number(price)) ? { cod_fee: fee }
      : { price: Number(price), cod_fee: fee, cod_price: Math.round((Number(price) + fee) * 100) / 100 };
    return priceTags(text, values, shopperMoney());
  }

  // OTP, pricing and placing the order: POSTed to php_backend/cod_checkout.php,
  // which relays them to the BRIX app server (the browser never calls it).
  function api(endpoint, body) {
    var init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ endpoint: endpoint, shop: SHOP }, body)) };
    return window.fetch(PHP_API + '/cod_checkout.php', init).then(function (res) {
      return res.json().catch(function () { return { success: false, code: 'internal_error', error: bxT('error.generic', 'Something went wrong. Please try again.') }; });
    }, function () {
      return { success: false, code: 'network', error: bxT('error.network', 'We couldn\'t connect. Check your internet and try again.') };
    });
  }

  // Public reads from php_backend/cod_storefront.php.
  function phpGet(action, params) {
    var url = PHP_API + '/cod_storefront.php?action=' + action + '&shop=' + encodeURIComponent(SHOP) + (params || '');
    return window.fetch(url, { method: 'GET' }).then(function (res) {
      return res.json().catch(function () { return { success: false }; });
    }, function () { return { success: false, code: 'network' }; });
  }

  /* ---------- tracking: GA4 + Meta Pixel ---------- */

  // COD orders skip Shopify checkout, so the store's own Google / Meta setup
  // never sees them. The popup fires the funnel itself, to the IDs the
  // merchant set in the BRIX admin (cfg.tracking). The server sends its own
  // copy of the Purchase (cod-tracking.server.js) with the same ids
  // (transaction_id = order name, eventID = brixcod_<order id>), so each
  // order is counted once. Nothing fires without the shopper's consent from
  // Shopify's Customer Privacy API; tags load only when the popup is used.
  var FBC_KEY = 'brix_cod_fbc_v1';
  try {
    var fbclid = new URLSearchParams(window.location.search).get('fbclid');
    if (fbclid && /^[\w.-]{1,200}$/.test(fbclid)) writeStore('sessionStorage', FBC_KEY, 'fb.1.' + Date.now() + '.' + fbclid);
  } catch (e) { /* old browsers */ }

  var Track = (function () {
    var gaReady = {}, fbReady = {};

    function consent() {
      var p = window.Shopify && window.Shopify.customerPrivacy;
      function ask(fn) {
        try { return p && typeof p[fn] === 'function' ? p[fn]() !== false : true; } catch (e) { return true; }
      }
      // No privacy API on the page = no consent banner configured: Shopify's own default is allowed.
      return { analytics: ask('analyticsProcessingAllowed'), marketing: ask('marketingAllowed') };
    }

    function cookie(name) {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : '';
    }

    function loadScript(src) {
      var s = document.createElement('script');
      s.async = true;
      s.src = src;
      (document.head || document.documentElement).appendChild(s);
    }

    function ensureGtag(id) {
      if (gaReady[id]) return;
      if (typeof window.gtag !== 'function') {
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(arguments); };
        window.gtag('js', new Date());
        loadScript('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id));
      }
      window.gtag('config', id, { send_page_view: false });
      gaReady[id] = true;
    }

    function ensureFbq(id) {
      if (fbReady[id]) return;
      if (typeof window.fbq !== 'function') {
        var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!window._fbq) window._fbq = n;
        n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
        loadScript('https://connect.facebook.net/en_US/fbevents.js');
      }
      var state = null;
      try { state = typeof window.fbq.getState === 'function' ? window.fbq.getState() : null; } catch (e) { state = null; }
      var known = state && state.pixels && state.pixels.some(function (p) { return String(p.id) === id; });
      if (!known) {
        window.fbq('set', 'autoConfig', false, id); // no automatic button-click events from our init
        window.fbq('init', id);
      }
      fbReady[id] = true;
    }

    // Mirrors catalogItemId in app/services/cod-tracking.server.js.
    function itemId(line, format) {
      if (format === 'sku' && line.sku) return line.sku;
      if (format === 'shopify' && line.productId && line.variantId) return 'shopify_IN_' + line.productId + '_' + line.variantId;
      return String(line.variantId || line.sku || line.title || '');
    }

    function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

    // GA4 names / Meta names for each funnel step (custom ones use trackSingleCustom).
    var EVENTS = {
      begin_checkout: { ga: 'begin_checkout', meta: 'InitiateCheckout' },
      otp_verified: { ga: 'cod_otp_verified', meta: 'CodOtpVerified', custom: true },
      add_shipping_info: { ga: 'add_shipping_info', meta: 'CodAddressAdded', custom: true },
      add_payment_info: { ga: 'add_payment_info', meta: 'AddPaymentInfo' },
      purchase: { ga: 'purchase', meta: 'Purchase' },
    };

    /** name: a key of EVENTS. quote: the latest quote. order: the placed order (purchase only). */
    function send(cfg, name, quote, order) {
      var ev = EVENTS[name];
      if (!ev || !quote) return;
      var t = (cfg && cfg.tracking) || {};
      var c = consent();
      var lines = quote.lines || [];
      var coupon = quote.coupon && quote.coupon.applied ? quote.coupon.code : '';
      var currency = (order && order.currency) || quote.currency;
      var value = round2(order ? order.total : quote.total);
      var ga = {
        currency: currency,
        value: value,
        items: lines.map(function (l) {
          var item = { item_id: itemId(l, t.metaContentId), item_name: l.title, price: round2(l.unitPrice != null ? l.unitPrice : l.total / (l.quantity || 1)), quantity: l.quantity };
          if (l.variantTitle) item.item_variant = l.variantTitle;
          return item;
        }),
      };
      if (coupon) ga.coupon = coupon;
      if (name === 'add_payment_info') ga.payment_type = 'Cash on Delivery';
      // Dynamic shipping: the delivery option picked (GA4's shipping_tier).
      var dlv = quote.delivery;
      var tier = dlv && dlv.options ? dlv.options.filter(function (o) { return o.id === dlv.selected; })[0] : null;
      if (tier && order) ga.shipping_tier = tier.name;
      if (order) {
        ga.transaction_id = order.orderName;
        ga.tax = round2(quote.tax);
        ga.shipping = round2((quote.shipping || 0) + (quote.codFee || 0));
        ga.payment_type = 'Cash on Delivery';
      }
      var meta = {
        currency: currency,
        value: value,
        content_type: 'product',
        content_ids: lines.map(function (l) { return itemId(l, t.metaContentId); }),
        contents: lines.map(function (l) { return { id: itemId(l, t.metaContentId), quantity: l.quantity }; }),
        num_items: lines.reduce(function (n, l) { return n + (Number(l.quantity) || 0); }, 0),
      };
      if (coupon) meta.coupon = coupon;
      if (order) meta.order_id = order.orderName;

      try {
        if (t.ga4Id && c.analytics) {
          ensureGtag(t.ga4Id);
          window.gtag('event', ev.ga, Object.assign({ send_to: t.ga4Id }, ga));
        }
      } catch (e) { /* never break the popup */ }
      try {
        if (t.metaPixelId && c.marketing) {
          ensureFbq(t.metaPixelId);
          var opts = order ? { eventID: 'brixcod_' + String(order.orderId || '').split('/').pop() } : undefined;
          window.fbq(ev.custom ? 'trackSingleCustom' : 'trackSingle', t.metaPixelId, ev.meta, meta, opts);
        }
      } catch (e) { /* never break the popup */ }
      try {
        // GTM: the store's own container decides what to do with these (and checks consent itself).
        if (t.dataLayer !== false && Array.isArray(window.dataLayer)) {
          window.dataLayer.push({ ecommerce: null });
          window.dataLayer.push({ event: 'brix_cod_' + name, ecommerce: ga });
        }
      } catch (e) { /* ignore */ }
      try {
        document.dispatchEvent(new CustomEvent('brix:cod:track', { detail: { name: name, ga4: ga, meta: meta, consent: c } }));
      } catch (e) { /* old browsers */ }
    }

    /** What the server needs for its own copy of the Purchase (checked again there). */
    function context() {
      var ga = cookie('_ga').split('.');
      var gaClientId = ga.length >= 4 ? ga[ga.length - 2] + '.' + ga[ga.length - 1] : '';
      var t = (configValue && configValue.tracking) || {};
      var gaSessionId = '';
      if (t.ga4Id) {
        var s = cookie('_ga_' + t.ga4Id.replace(/^G-/, ''));
        var m = /^GS1\.\d+\.(\d+)\./.exec(s) || /(?:^|[.$])s(\d+)/.exec(s);
        if (m) gaSessionId = m[1];
      }
      return {
        gaClientId: gaClientId,
        gaSessionId: gaSessionId,
        fbp: cookie('_fbp'),
        fbc: cookie('_fbc') || readStore('sessionStorage', FBC_KEY) || '',
        consent: consent(),
        pageUrl: String(window.location.href).slice(0, 500),
      };
    }

    // Product page payment options (Pay Online / COD): light UI events, no
    // ecommerce payload. Never loads a tag for these: GTM's dataLayer and an
    // existing gtag only, with the shopper's analytics consent for gtag.
    function ui(cfg, name, params) {
      var t = (cfg && cfg.tracking) || {};
      var detail = Object.assign({ event: name }, params || {});
      try {
        if (t.dataLayer !== false && cfg && Array.isArray(window.dataLayer)) window.dataLayer.push(detail);
      } catch (e) { /* ignore */ }
      try {
        if (t.ga4Id && typeof window.gtag === 'function' && consent().analytics) window.gtag('event', name, Object.assign({ send_to: t.ga4Id }, params || {}));
      } catch (e) { /* never break the page */ }
      try { document.dispatchEvent(new CustomEvent('brix:payment:track', { detail: detail })); } catch (e) { /* old browsers */ }
    }

    return { send: send, context: context, ui: ui };
  })();

  /* ---------- config ---------- */

  var configPromise = null;
  var configValue;
  // Product page payment options (null = off). Sent even while COD itself is
  // off (then without the COD card), so Pay Online + the prepaid offer still work.
  var paymentValue = null;

  function loadConfig() {
    if (configPromise) return configPromise;
    var cached = readStore('sessionStorage', CONFIG_KEY);
    if (cached && cached.shop === SHOP && cached.expiresAt > Date.now()) {
      configValue = cached.config;
      paymentValue = cached.payment || null;
      configPromise = Promise.resolve(configValue);
      return configPromise;
    }
    if (!SHOP) { configValue = null; configPromise = Promise.resolve(null); return configPromise; }
    configPromise = phpGet('config').then(function (json) {
      var ok = Boolean(json && json.success);
      configValue = ok && json.enabled ? Object.assign({ currency: CURRENCY }, json) : null;
      paymentValue = ok && json.productPayment && typeof json.productPayment === 'object' ? json.productPayment : null;
      writeStore('sessionStorage', CONFIG_KEY, { shop: SHOP, config: configValue, payment: paymentValue, expiresAt: Date.now() + 60000 });
      return configValue;
    });
    return configPromise;
  }

  function isAvailable(surface) {
    return loadConfig().then(function (cfg) { return Boolean(cfg && cfg.enabled && (!surface || cfg.surfaces[surface] !== false)); });
  }

  // Free reward gifts only: Packs can be paid on delivery (the server gives
  // them the Pack price, cod.server.js packAdjustments).
  function cartHasCheckoutOnlyLines(cart) {
    return (cart.items || []).some(function (item) {
      var p = item.properties || {};
      return p._brixReward === 'true' || p._brixReward === true;
    });
  }

  function fetchCart() {
    return window.fetch(ROOT + 'cart.js', { headers: { Accept: 'application/json' }, credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }

  function cartItems(cart) {
    return (cart.items || []).map(function (item) {
      return { variantId: item.variant_id, quantity: item.quantity, properties: item.properties || {} };
    });
  }

  // The discount codes already on the cart (put there by the theme, an app,
  // a /discount/CODE link or the BRIX drawer) plus `extra` (the BRIX drawer's
  // own applied code). The server applies them only when the merchant has
  // "Apply the cart's discounts" on (cod.server.js), and Shopify checks each.
  function cartDiscountCodes(cart, extra) {
    var out = [];
    function add(code) {
      var c = String(code || '').trim();
      if (!c || out.length >= 5) return;
      for (var i = 0; i < out.length; i++) if (out[i].toLowerCase() === c.toLowerCase()) return;
      out.push(c);
    }
    (cart && cart.discount_codes || []).forEach(function (d) { if (d && d.applicable !== false) add(d.code); });
    if (extra) add(extra);
    return out;
  }

  /* ---------- sheet UI ---------- */

  // --cod-bg / --cod-fg are the merchant's button colours; --tint is a light
  // wash of --cod-bg for accents (plain grey where color-mix is missing).
  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:inherit}',
    '.ov{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483647;display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .22s;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}',
    '.ov.on{opacity:1}',
    '.sh{--tint:#f3f4f6;--tint:color-mix(in srgb,var(--cod-bg,#111827) 9%,#fff);--ring:color-mix(in srgb,var(--cod-bg,#111827) 35%,transparent);background:#fff;color:#111827;width:100%;max-width:460px;max-height:92vh;border-radius:22px 22px 0 0;display:flex;flex-direction:column;transform:translateY(40px);transition:transform .28s cubic-bezier(.2,.9,.3,1.15);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:15px;line-height:1.45;box-shadow:0 -12px 48px rgba(0,0,0,.22);overflow:hidden;position:relative}',
    '.ov.on .sh{transform:none}',
    '.sh.drag{transition:none}',
    '@media (min-width:640px){.ov{align-items:center}.sh{border-radius:20px}.grab{display:none}}',
    '.grab{width:40px;height:5px;border-radius:5px;background:#d1d5db;margin:8px auto 0;flex:none}',
    '.hd{display:flex;align-items:center;gap:8px;padding:10px 14px 10px 16px;touch-action:none}',
    '.hd .t{flex:1;font-weight:750;font-size:17px;letter-spacing:-.01em}',
    '.ib{background:none;border:0;cursor:pointer;color:#374151;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;transition:background .15s}',
    '.ib:hover{background:#f3f4f6}',
    '.ib:focus-visible,.b:focus-visible,input:focus-visible,select:focus-visible,.lk:focus-visible,.sum-h:focus-visible{outline:2px solid var(--cod-bg,#2563eb);outline-offset:2px}',
    '.tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:750;letter-spacing:.04em;background:#ecfdf3;color:#067647;padding:4px 9px;border-radius:99px}',
    /* stepper */
    '.stp{display:flex;align-items:flex-start;padding:2px 18px 12px;gap:0}',
    '.stp .s{display:flex;flex-direction:column;align-items:center;gap:5px;flex:none;width:64px;font-size:11.5px;font-weight:600;color:#9ca3af}',
    '.stp .s b{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:12px;background:#f3f4f6;color:#6b7280;transition:background .25s,color .25s,box-shadow .25s}',
    '.stp .s.cur{color:#111827}.stp .s.cur b{background:var(--cod-bg,#111827);color:var(--cod-fg,#fff);box-shadow:0 0 0 4px var(--tint)}',
    '.stp .s.dn{color:#374151}.stp .s.dn b{background:var(--tint);color:var(--cod-bg,#111827)}',
    '.stp .ln{flex:1;height:3px;border-radius:3px;background:#eef0f3;margin-top:12px;position:relative;overflow:hidden}',
    '.stp .ln:after{content:"";position:absolute;inset:0;background:var(--cod-bg,#111827);transform:scaleX(0);transform-origin:left;transition:transform .4s ease}',
    '.stp .ln.on:after{transform:scaleX(1)}',
    /* layout */
    '.bd{padding:4px 18px 16px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;overscroll-behavior:contain}',
    '.bd.fw{animation:inR .28s ease both}.bd.bw{animation:inL .28s ease both}',
    '@keyframes inR{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}',
    '@keyframes inL{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}',
    '.ft{padding:12px 18px 18px;border-top:1px solid #eef0f3;display:flex;flex-direction:column;gap:8px;background:#fff}',
    '.ftot{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:#4b5563}',
    '.ftot b{font-size:20px;color:#111827;font-weight:800}',
    /* fields */
    '.f{display:flex;flex-direction:column;gap:5px}',
    '.f label{font-size:12.5px;font-weight:650;color:#4b5563}',
    'input,select{font:inherit;font-size:16px;color:#111827;background:#fff;border:1.5px solid #e5e7eb;border-radius:12px;padding:12px 13px;width:100%;transition:border-color .15s,box-shadow .15s;-webkit-appearance:none;appearance:none}',
    'select{background-image:linear-gradient(45deg,transparent 50%,#6b7280 50%),linear-gradient(135deg,#6b7280 50%,transparent 50%);background-position:calc(100% - 18px) 52%,calc(100% - 13px) 52%;background-size:5px 5px;background-repeat:no-repeat;padding-right:34px}',
    'input:focus,select:focus{outline:none;border-color:var(--cod-bg,#2563eb);box-shadow:0 0 0 4px var(--ring,rgba(37,99,235,.2))}',
    '[aria-invalid="true"],.pre.bad{border-color:#f04438 !important;box-shadow:0 0 0 4px rgba(240,68,56,.14) !important}',
    '.pre{display:flex;align-items:center;border:1.5px solid #e5e7eb;border-radius:12px;overflow:hidden;transition:border-color .15s,box-shadow .15s}',
    '.pre:focus-within{border-color:var(--cod-bg,#2563eb);box-shadow:0 0 0 4px var(--ring,rgba(37,99,235,.2))}',
    '.pre>span{padding:12px 4px 12px 13px;font-size:16px;font-weight:600;display:flex;align-items:center;gap:6px;color:#374151}',
    '.pre input{border:0;border-radius:0;box-shadow:none !important;padding-left:8px}',
    '.pre .okc{margin-right:12px;color:#12b76a;opacity:0;transform:scale(.5);transition:opacity .2s,transform .25s cubic-bezier(.2,.9,.3,1.5)}',
    '.pre.valid .okc{opacity:1;transform:none}',
    '.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '[data-alt]{display:flex;flex-direction:column}[data-alt][hidden]{display:none}',
    'a.b{text-decoration:none}',
    /* trust badges */
    '.trust{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
    '.trust div{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;font-size:11.5px;font-weight:600;color:#4b5563;padding:10px 4px;border:1px solid #f0f1f3;border-radius:12px}',
    '.trust svg{color:var(--cod-bg,#111827)}',
    /* order summary strip */
    '.sum{border:1px solid #eef0f3;border-radius:14px;background:#fafafa;overflow:hidden}',
    '.sum-h{all:unset;box-sizing:border-box;width:100%;display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer}',
    '.thumbs{display:flex;flex:none}',
    '.thumbs img,.thumbs .ph{width:34px;height:34px;border-radius:9px;object-fit:cover;background:#eef0f3;border:2px solid #fafafa;margin-left:-10px}',
    '.thumbs>:first-child{margin-left:0}',
    '.sum-t{flex:1;display:flex;flex-direction:column;font-size:13.5px;line-height:1.3}',
    '.sum-p{font-weight:750}',
    '.chev{transition:transform .25s;color:#6b7280}',
    '.sum.open .chev{transform:rotate(180deg)}',
    '.sum-b{display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s ease}',
    '.sum.open .sum-b{grid-template-rows:1fr}',
    '.sum-b>div{overflow:hidden}',
    '.sum-b .in{padding:2px 12px 12px;display:flex;flex-direction:column;gap:10px}',
    /* buttons */
    '.b{font:inherit;font-weight:750;font-size:15.5px;border-radius:14px;padding:15px 16px;border:1.5px solid transparent;cursor:pointer;width:100%;display:flex;justify-content:center;align-items:center;gap:8px;transition:transform .12s,filter .15s,opacity .15s;-webkit-tap-highlight-color:transparent}',
    '.b:active:not(:disabled){transform:scale(.98)}',
    '.b.p{background:var(--cod-bg,#111827);color:var(--cod-fg,#fff);box-shadow:0 6px 18px -6px var(--ring,rgba(0,0,0,.3))}',
    '.b.p:hover:not(:disabled){filter:brightness(1.06)}',
    '.b.s{background:#fff;color:#111827;border-color:#e5e7eb}',
    '.b.s:hover{background:#f9fafb}',
    '.b:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}',
    /* Terms and conditions consent (review step) */
    '.agr{display:flex;align-items:center;gap:8px;font-size:12.5px;line-height:1.4;color:#4b5563;cursor:pointer}',
    // The popup's text-field styles hide the native box, so it's drawn here.
    '.agr input[type=checkbox]{width:18px;height:18px;padding:0;margin:0;flex:none;border:1.5px solid #d0d5dd;border-radius:5px;background:#fff no-repeat center/12px;cursor:pointer}',
    '.agr input[type=checkbox]:checked{background-color:var(--cod-bg,#111827);border-color:var(--cod-bg,#111827);background-image:url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%23fff%27 stroke-width=%273.5%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27%3E%3Cpath d=%27M5 12.5l4.5 4.5L19 7.5%27/%3E%3C/svg%3E")}',
    '.agr.bad input[type=checkbox]{border-color:#d92d20}',
    '.agr a{color:var(--cod-bg,#2563eb);font-weight:650;text-decoration:underline;text-underline-offset:2px}',
    '.agr.bad{color:#d92d20}',
    '.lk{background:none;border:0;padding:0;font:inherit;color:var(--cod-bg,#2563eb);font-weight:650;cursor:pointer;text-decoration:underline;text-underline-offset:2px}',
    /* notes */
    '.n{font-size:13px;padding:10px 12px;border-radius:12px;line-height:1.4;display:flex;gap:8px;align-items:flex-start}',
    '.n>svg{flex:none;margin-top:1px}',
    '.n.ok{background:#ecfdf3;color:#067647}',
    '.n.er{background:#fef3f2;color:#b42318;animation:pop .25s ease}',
    '.n.in{background:#eff6ff;color:#1e40af}',
    '.n.wa{background:#fffaeb;color:#93370d}',
    '@keyframes pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
    '.mu{color:#6b7280;font-size:13px}',
    '.pst{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#6b7280;min-height:18px}',
    '.pst.ok{color:#067647}',
    /* OTP boxes: one real input (autofill/paste friendly) over four painted boxes */
    '.otpw{position:relative;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;width:100%;max-width:280px;margin:4px auto 0;align-self:center}',
    '.otpw i{font-style:normal;height:58px;border:1.5px solid #e5e7eb;border-radius:14px;display:grid;place-items:center;font-size:26px;font-weight:750;font-variant-numeric:tabular-nums;background:#fff;transition:border-color .15s,box-shadow .15s,transform .15s}',
    '.otpw i.fi{border-color:#9ca3af;animation:popin .18s ease}',
    '.otpw.foc i.ac{border-color:var(--cod-bg,#2563eb);box-shadow:0 0 0 4px var(--ring,rgba(37,99,235,.2))}',
    '.otpw.foc i.ac:after{content:"";width:2px;height:26px;background:var(--cod-bg,#111827);animation:blink 1s step-end infinite}',
    '.otpw.bad i{border-color:#f04438;color:#b42318}',
    '.otpw.good i{border-color:#12b76a;background:#ecfdf3;color:#067647}',
    '.otpw.shake{animation:shake .4s ease}',
    '.otpw .otp{position:absolute;inset:0;width:100%;height:100%;opacity:.01;color:transparent;caret-color:transparent;background:transparent;border:0;box-shadow:none;font-size:16px;letter-spacing:2em;padding:0 0 0 1em}',
    '@keyframes shake{20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}',
    '@keyframes popin{from{transform:scale(.88)}to{transform:none}}',
    '@keyframes blink{50%{opacity:0}}',
    '.rs{display:flex;align-items:center;justify-content:center;gap:8px;font-size:13px;color:#6b7280}',
    '.ring{width:18px;height:18px;transform:rotate(-90deg)}',
    '.ring circle{fill:none;stroke-width:3}',
    /* address card */
    '.card{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1.5px solid var(--cod-bg,#111827);border-radius:16px;background:var(--tint);font-size:14px}',
    '.card .ic{flex:none;color:var(--cod-bg,#111827);margin-top:1px}',
    '.card .cb{flex:1;min-width:0}',
    '.card .cb b{display:block;font-size:14.5px;margin-bottom:2px}',
    '.card.plain{border:1px solid #eef0f3;background:#fff}',
    '.ttl{font-size:12px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin:2px 0 -6px}',
    '.fm{display:flex;flex-direction:column;gap:12px}',
    '.fm[hidden]{display:none}',
    /* review */
    '.li{display:grid;grid-template-columns:52px 1fr auto;gap:12px;align-items:center}',
    '.li .im{position:relative;width:52px;height:52px}',
    '.li img,.li .ph{width:52px;height:52px;border-radius:12px;object-fit:cover;background:#f3f4f6;display:block}',
    '.li .q{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#374151;color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;border:2px solid #fff}',
    '.li .nm{font-weight:650;font-size:14px;line-height:1.3}',
    '.rows{display:flex;flex-direction:column;gap:7px;font-size:14px;padding:12px 14px;border-radius:14px;background:#fafafa}',
    '.rows div{display:flex;justify-content:space-between;gap:12px}',
    '.rows .tot{font-weight:800;font-size:16px;border-top:1px dashed #d1d5db;padding-top:9px;margin-top:2px}',
    '.save{display:flex;align-items:center;gap:8px;justify-content:center;font-size:13.5px;font-weight:700;color:#067647;background:#ecfdf3;border-radius:12px;padding:9px 12px}',
    '.pay{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;border:1px solid #eef0f3}',
    '.pay .ic{flex:none;width:38px;height:38px;border-radius:10px;display:grid;place-items:center;background:var(--tint);color:var(--cod-bg,#111827)}',
    '.pay .cb{flex:1;font-size:13px;color:#6b7280}.pay .cb b{display:block;font-size:14.5px;color:#111827}',
    // Partial COD: Cash on Delivery and Part payment as two choices.
    'button.pay{width:100%;background:#fff;font:inherit;text-align:start;cursor:pointer;margin:0 0 8px}',
    'button.pay[aria-pressed="true"]{border-color:var(--cod-bg,#111827);box-shadow:0 0 0 1px var(--cod-bg,#111827)}',
    'button.pay .rd{flex:none;width:20px;height:20px;border-radius:50%;border:2px solid #d0d5dd}',
    'button.pay[aria-pressed="true"] .rd{border:6px solid var(--cod-bg,#111827)}',
    '.nud{display:flex;gap:10px;align-items:center;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,#eff6ff,#f5f3ff);color:#1e3a8a;font-size:13px}',
    '.nud .cb{flex:1}',
    '.nud .b{width:auto;padding:8px 12px;font-size:13px;border-radius:10px;background:#fff;color:#1e3a8a;border-color:#c7d2fe;flex:none}',
    /* delivery options (dynamic shipping) */
    '.dlv{display:flex;flex-direction:column;gap:8px}',
    '.dlo{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:12px 14px;border:1.5px solid #e5e7eb;border-radius:14px;background:#fff;font-size:14px;transition:border-color .15s,background .15s}',
    'button.dlo{cursor:pointer}button.dlo:hover{border-color:#d1d5db}',
    '.dlo.on{border-color:var(--cod-bg,#111827);background:var(--tint)}',
    '.dlo:focus-visible,.dt:focus-visible{outline:2px solid var(--cod-bg,#2563eb);outline-offset:2px}',
    '.dlo .rd{flex:none;width:18px;height:18px;border-radius:50%;border:1.5px solid #d0d5dd;background:#fff;display:grid;place-items:center}',
    '.dlo.on .rd{border-color:var(--cod-bg,#111827)}',
    '.dlo.on .rd:after{content:"";width:9px;height:9px;border-radius:50%;background:var(--cod-bg,#111827)}',
    '.dlo>svg{flex:none;color:var(--cod-bg,#111827)}',
    '.dlo .cb{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.35}',
    '.dlo .cb b{font-size:14.5px}.dlo .cb span{font-size:12.5px;color:#6b7280}',
    '.dlo .pr{font-weight:750;white-space:nowrap;font-variant-numeric:tabular-nums}.dlo .pr.fr{color:#067647}',
    // flex:none: a scrolling row would otherwise shrink to nothing in the .bd column.
    '.dts{flex:none;display:flex;gap:8px;overflow-x:auto;padding:2px;margin:-2px;scrollbar-width:none}.dts::-webkit-scrollbar{display:none}',
    '.dt{all:unset;box-sizing:border-box;cursor:pointer;flex:none;display:inline-flex;align-items:center;padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:12px;font-size:13px;font-weight:650;white-space:nowrap;background:#fff}',
    '.dt.on{border-color:var(--cod-bg,#111827);background:var(--tint);color:var(--cod-bg,#111827)}',
    '.fsh{display:flex;align-items:center;gap:8px;font-size:13px;color:#93370d;background:#fffaeb;border-radius:12px;padding:9px 12px}',
    '.fsh svg{flex:none}',
    '.r-soft .dlo,.r-soft .dt,.r-soft .fsh{border-radius:8px}.r-sharp .dlo,.r-sharp .dt,.r-sharp .fsh{border-radius:3px}',
    '.num{font-variant-numeric:tabular-nums;white-space:nowrap}',
    '.st{text-decoration:line-through;color:#9ca3af;font-weight:400;margin-right:6px}',
    /* done */
    '.done{align-items:center;text-align:center;padding:26px 18px 18px;position:relative}',
    '.tick{width:76px;height:76px;border-radius:50%;background:#12b76a;color:#fff;display:grid;place-items:center;box-shadow:0 0 0 10px #ecfdf3;animation:popin .45s cubic-bezier(.2,.9,.3,1.5) both}',
    '.tick path{stroke-dasharray:30;stroke-dashoffset:30;animation:draw .45s .25s ease forwards}',
    '@keyframes draw{to{stroke-dashoffset:0}}',
    '.oid{display:inline-flex;align-items:center;gap:6px;font-weight:700;background:#f3f4f6;border-radius:99px;padding:5px 6px 5px 12px;font-size:14px}',
    '.oid button{all:unset;cursor:pointer;font-size:12px;font-weight:700;padding:3px 9px;border-radius:99px;background:#fff;color:#374151;display:inline-flex;gap:4px;align-items:center}',
    '.amt{width:100%;border-radius:16px;background:var(--tint);padding:14px}',
    '.big{font-size:30px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:-.02em}',
    '.tl{width:100%;text-align:left;display:flex;flex-direction:column;gap:0;margin-top:4px}',
    '.tl div{display:flex;gap:12px;align-items:flex-start;position:relative;padding-bottom:14px;font-size:13.5px}',
    '.tl div:last-child{padding-bottom:0}',
    '.tl div:not(:last-child):before{content:"";position:absolute;left:11px;top:24px;bottom:2px;width:2px;background:#eef0f3}',
    '.tl i{flex:none;width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#f3f4f6;color:#9ca3af}',
    '.tl .on i{background:#12b76a;color:#fff}',
    '.tl b{display:block;font-size:14px}.tl .mu{display:block}',
    '.cf{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
    '.cf i{position:absolute;top:-12px;width:8px;height:12px;border-radius:2px;opacity:0;animation:fall 1.6s ease-in forwards}',
    '@keyframes fall{0%{opacity:1;transform:translateY(0) rotate(0)}100%{opacity:0;transform:translateY(340px) rotate(540deg)}}',
    /* loading */
    '.sp{width:22px;height:22px;border-radius:50%;border:3px solid #e5e7eb;border-top-color:var(--cod-bg,#111827);animation:r .7s linear infinite;flex:none}',
    '.ld{padding:44px 18px;display:flex;flex-direction:column;align-items:center;gap:12px;color:#6b7280}',
    '.sk{display:flex;flex-direction:column;gap:12px;padding:6px 18px 22px}',
    '.sk i{display:block;height:14px;border-radius:7px;background:linear-gradient(90deg,#f3f4f6 25%,#e9eaee 50%,#f3f4f6 75%);background-size:200% 100%;animation:shim 1.2s linear infinite}',
    '.sk .bx{height:52px;border-radius:12px}',
    '@keyframes shim{to{background-position:-200% 0}}',
    '.fail{display:flex;flex-direction:column;align-items:center;text-align:center;gap:10px;padding:10px 0 4px}',
    '.fail .ic{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:#fef3f2;color:#d92d20}',
    '@keyframes r{to{transform:rotate(360deg)}}',
    /* store logo + body title */
    '.hd .t{min-width:0;display:flex;align-items:center}',
    '.lg{display:block;max-width:160px;object-fit:contain;object-position:left center}',
    '.lg.sm{height:22px}.lg.md{height:30px}.lg.lg{height:38px}',
    '.bt{margin:0;font-size:18px;font-weight:750;letter-spacing:-.01em}',
    /* Powered by BRIX */
    '.pw{display:flex;align-items:center;justify-content:center;gap:5px;padding:0 18px 12px;font-size:11px;color:#9ca3af;background:#fff;flex:none}',
    '.ft+.pw,.ft~.pw{margin-top:-8px}',
    '.pw img{height:14px;width:auto;display:block;opacity:.85}',
    '.pw .bx,.bl .bx{font-weight:800;letter-spacing:.06em;color:#4b5563}',
    /* BRIX loader */
    '.bl{padding:46px 18px 40px;display:flex;flex-direction:column;align-items:center;gap:16px;color:#6b7280;font-size:14px}',
    '.bl-m{position:relative;display:grid;place-items:center;padding:14px 18px;border-radius:18px;animation:blp 1.6s ease-in-out infinite}',
    '.bl-m:before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(closest-side,rgba(99,102,241,.18),transparent);animation:blg 1.6s ease-in-out infinite}',
    '.bl-m img{height:40px;width:auto;display:block;position:relative}',
    '.bl-m .bx{font-size:28px;position:relative}',
    '.bl-bar{width:140px;height:4px;border-radius:4px;background:#eef0f3;overflow:hidden}',
    '.bl-bar i{display:block;width:40%;height:100%;border-radius:4px;background:var(--cod-bg,#4f46e5);animation:blb 1.1s ease-in-out infinite}',
    '@keyframes blp{50%{transform:scale(1.05)}}',
    '@keyframes blg{50%{transform:scale(1.25);opacity:.4}}',
    '@keyframes blb{from{transform:translateX(-100%)}to{transform:translateX(250%)}}',
    /* coupon */
    '.cpn-add{all:unset;box-sizing:border-box;cursor:pointer;display:flex;align-items:center;gap:8px;width:100%;padding:12px 14px;border:1.5px dashed #d1d5db;border-radius:14px;font-size:14px;color:#374151;transition:border-color .15s,background .15s}',
    '.cpn-add:hover{border-color:var(--cod-bg,#111827);background:var(--tint)}',
    '.cpn-add:focus-visible{outline:2px solid var(--cod-bg,#2563eb);outline-offset:2px}',
    '.cpn-add svg{color:var(--cod-bg,#111827)}',
    '.cpn-add span{flex:1}.cpn-add b{color:var(--cod-bg,#111827);font-size:13px}',
    '.cpn-form{display:block}',
    '.cpn-in{display:flex;align-items:center;gap:8px;border:1.5px solid #e5e7eb;border-radius:12px;padding:0 4px 0 12px;background:#fff;transition:border-color .15s,box-shadow .15s}',
    '.cpn-in:focus-within{border-color:var(--cod-bg,#2563eb);box-shadow:0 0 0 4px var(--ring,rgba(37,99,235,.2))}',
    '.cpn-in svg{color:#9ca3af;flex:none}',
    '.cpn-in input{border:0;box-shadow:none !important;padding:13px 0;font-weight:600;letter-spacing:.04em;text-transform:uppercase;min-width:0;flex:1;background:transparent}',
    '.cpn-in input::placeholder{font-weight:400;letter-spacing:0;text-transform:none;color:#9ca3af}',
    '.cpn-paste{all:unset;cursor:pointer;font-size:12px;font-weight:700;color:var(--cod-bg,#111827);padding:5px 9px;border-radius:7px;background:var(--tint)}',
    '.cpn-in:has(input:not(:placeholder-shown)) .cpn-paste{display:none}',
    '.cpn-go{all:unset;cursor:pointer;flex:none;font-size:13px;font-weight:800;letter-spacing:.06em;color:var(--cod-bg,#111827);padding:9px 10px;border-radius:8px;display:inline-flex;align-items:center}',
    '.cpn-go:hover{background:var(--tint)}',
    '.cpn-in:has(input:placeholder-shown) .cpn-go{color:#9ca3af;pointer-events:none}',
    '.cpn-paste:focus-visible,.cpn-go:focus-visible{outline:2px solid var(--cod-bg,#2563eb)}',
    '.cpn-form.bad .cpn-in{border-color:#f04438;animation:shake .4s ease}',
    '.cpn-err{display:flex;gap:6px;align-items:flex-start;font-size:12.5px;color:#b42318;margin-top:-6px}',
    '.cpn-err svg{flex:none;margin-top:2px}',
    '.cpn{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px;font-size:14px}',
    '.cpn.ok{background:#ecfdf3;color:#067647;border:1.5px dashed #6ce9a6}',
    '.cpn svg{flex:none}',
    '.cpn .cb{flex:1;display:flex;flex-direction:column;line-height:1.35}.cpn .cb span{font-size:12.5px}',
    '.cpn .lk{color:#067647}',
    '.cpn.pop{animation:popin .45s cubic-bezier(.2,.9,.3,1.5)}',
    '.rows .tot.flash .num{display:inline-block;animation:flash 1.1s ease}',
    '@keyframes flash{0%{color:#067647;transform:scale(1.14)}100%{transform:none}}',
    '.ofrs{display:flex;flex-direction:column;gap:10px;margin-top:-2px}',
    '.ofrs-t{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6b7280}',
    '.ofrs-t span{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--tint);color:var(--cod-bg,#111827);display:grid;place-items:center;font-size:11px;letter-spacing:0}',
    '.ofr{display:flex;border-radius:12px;background:#fff;box-shadow:0 0 0 1px #eef0f3,0 2px 6px -3px rgba(15,23,42,.12);overflow:hidden;position:relative;animation:pop .25s ease both}',
    '.ofr-l{flex:none;width:36px;background:var(--cod-bg,#111827);color:var(--cod-fg,#fff);display:flex;align-items:center;justify-content:center;position:relative}',
    '.ofr-l span{writing-mode:vertical-rl;transform:rotate(180deg);font-size:10.5px;font-weight:800;letter-spacing:.08em;white-space:nowrap;padding:10px 0}',
    '.ofr-l:before,.ofr-l:after{content:"";position:absolute;right:-6px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:inset 0 0 0 1px #eef0f3}',
    '.ofr-l:before{top:-6px}.ofr-l:after{bottom:-6px}',
    '.ofr-r{flex:1;min-width:0;padding:10px 6px 10px 14px}',
    '.ofr-h{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.ofr-c{font-size:14px;font-weight:800;letter-spacing:.05em;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ofr-b{all:unset;cursor:pointer;flex:none;font-size:13px;font-weight:800;letter-spacing:.06em;color:var(--cod-bg,#111827);padding:6px 8px;border-radius:8px;display:inline-flex;align-items:center}',
    '.ofr-b:hover{background:var(--tint)}',
    '.ofr-b:focus-visible{outline:2px solid var(--cod-bg,#2563eb)}',
    '.ofr-t{margin-top:6px;padding-top:6px;border-top:1px dashed #e5e7eb;font-size:12.5px;color:#4b5563;line-height:1.4}',
    '.r-soft .cpn,.r-soft .cpn-add,.r-soft .cpn-in,.r-soft .ofr{border-radius:8px}.r-sharp .cpn,.r-sharp .cpn-add,.r-sharp .cpn-in,.r-sharp .ofr{border-radius:3px}',
    /* corner styles */
    '.sh.r-soft{border-radius:14px 14px 0 0}.sh.r-sharp{border-radius:6px 6px 0 0}',
    '@media (min-width:640px){.sh.r-soft{border-radius:14px}.sh.r-sharp{border-radius:6px}}',
    '.r-soft input,.r-soft select,.r-soft .pre,.r-soft .b,.r-soft .otpw i,.r-soft .card,.r-soft .rows,.r-soft .pay,.r-soft .nud,.r-soft .sum,.r-soft .trust div,.r-soft .n,.r-soft .amt,.r-soft .save{border-radius:8px}',
    '.r-sharp input,.r-sharp select,.r-sharp .pre,.r-sharp .b,.r-sharp .otpw i,.r-sharp .card,.r-sharp .rows,.r-sharp .pay,.r-sharp .nud,.r-sharp .sum,.r-sharp .trust div,.r-sharp .n,.r-sharp .amt,.r-sharp .save,.r-sharp .hero .ic,.r-sharp .pay .ic{border-radius:3px}',
    '@media (prefers-reduced-motion:reduce){.ov,.sh,.stp .ln:after,.sum-b{transition:none}.bd.fw,.bd.bw,.otpw.shake,.tick,.n.er{animation:none}.tick path{animation:none;stroke-dashoffset:0}.cf{display:none}.sp{animation-duration:2s}.bl-m,.bl-m:before,.cpn.pop,.cpn-form.bad .cpn-in,.rows .tot.flash .num{animation:none}.bl-bar i{animation-duration:2.5s}.sk i{animation:none}}'
  ].join('');

  // Inline icons (stroke = currentColor), so the sheet needs no extra requests.
  var ICONS = {
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    truck: '<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  };
  function icon(name, size, extra) {
    var s = size || 18;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"' + (extra || '') + '>' + ICONS[name] + '</svg>';
  }
  function prettyPhone(p) { return p && p.length === 10 ? p.slice(0, 5) + ' ' + p.slice(5) : (p || ''); }
  // Popup look set by the merchant in BRIX (settings.sheet); defaults match the original sheet.
  var LOOK_DEFAULTS = {
    logo: '', logoSize: 'md', accent: '', radius: 'rounded', showSummary: true, showTrust: true, thankYouText: '',
    showCoupon: true, couponLabel: 'Have a coupon code?', couponOpen: false, offers: [],
  };
  var HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
  var SAFE_LOGO = /^(https:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/;
  // Black or white text, whichever reads better on the given colour.
  function readableOn(hex) {
    var h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : hex;
    var c = [1, 3, 5].map(function (i) { var v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.4 ? '#111827' : '#ffffff';
  }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* unsupported */ } }

  var sheet = null; // the one open sheet

  // The merchant's Terms and conditions link, else the store's own terms page.
  function termsUrl(cfg) {
    var u = cfg && cfg.sheet && typeof cfg.sheet.termsUrl === 'string' ? cfg.sheet.termsUrl : '';
    return /^(https:\/\/|\/)/.test(u) ? u : ROOT + 'policies/terms-of-service';
  }

  function Sheet(opts, cfg) {
    this.opts = opts;
    this.cfg = cfg;
    this.fmt = moneyFormatter(cfg.currency);
    this.items = opts.items || [];
    // A code from the cart (useCart) travels as one of the cart's codes, not
    // as a popup coupon, so the merchant's cart-discount setting decides it.
    this.coupon = cfg.allowCoupons && opts.coupon && !opts.useCart ? String(opts.coupon) : null;
    this.cartCodes = [];
    this.cartAttributes = null;
    this.addr = readStore('localStorage', ADDRESS_KEY) || {};
    this.phone = this.addr.phone || '';
    var saved = readStore('sessionStorage', TOKEN_KEY);
    this.token = saved && saved.shop === SHOP && saved.expiresAt > Date.now() ? saved : null;
    this.idem = idemKey();
    this.busy = false;
    this.pin = null; // last PIN lookup result
    this.tracked = {}; // funnel events already sent from this popup
    this.build();
  }

  Sheet.prototype.build = function () {
    var host = document.createElement('div');
    host.setAttribute('data-brix-cod-sheet', '');
    // Same top layer as the BRIX cart drawer (#cc-overlay, z-index 2147483647);
    // appended after it, so the sheet always opens in front of the drawer.
    // display is forced because the host has no light-DOM children, so theme
    // rules like Dawn's `div:empty{display:none}` would otherwise hide it.
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:block !important;';
    var shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    shadow.innerHTML = '<style>' + CSS + '</style><div class="ov" part="overlay"><div class="sh" role="dialog" aria-modal="true" aria-label="' + esc(bxT('storefront.cod.sheet_label', 'Cash on Delivery checkout')) + '"></div></div>';
    this.host = host;
    this.shadow = shadow;
    this.ov = shadow.querySelector('.ov');
    this.sh = shadow.querySelector('.sh');
    this.sh.setAttribute('dir', bxDir());
    this.sh.style.setProperty('--cod-bg', this.cfg.buttons.bg);
    this.sh.style.setProperty('--cod-fg', this.cfg.buttons.color);
    var look = Object.assign({}, LOOK_DEFAULTS, this.cfg.sheet || {});
    if (!SAFE_LOGO.test(look.logo || '')) look.logo = '';
    if (HEX.test(look.accent || '')) {
      this.sh.style.setProperty('--cod-bg', look.accent);
      this.sh.style.setProperty('--cod-fg', readableOn(look.accent));
    }
    this.sh.classList.add('r-' + (['rounded', 'soft', 'sharp'].indexOf(look.radius) !== -1 ? look.radius : 'rounded'));
    if (!Array.isArray(look.offers)) look.offers = [];
    this.look = look;
    this.couponOpen = Boolean(look.couponOpen);
    this.policyOk = true; // Terms and conditions consent, ticked by default
    // :host{all:initial} drops the theme font; borrow the storefront's own.
    try { var font = window.getComputedStyle(document.body).fontFamily; if (font) this.sh.style.fontFamily = font; } catch (e) { /* keep the system stack */ }
    document.body.appendChild(host);
    this.prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    var self = this;
    this.ov.addEventListener('click', function (e) { if (e.target === self.ov && !self.busy) self.close(); });
    this.onKey = function (e) { if (e.key === 'Escape' && !self.busy) self.close(); };
    document.addEventListener('keydown', this.onKey);
    this.sh.addEventListener('click', function (e) { self.onClick(e); });
    this.sh.addEventListener('submit', function (e) { e.preventDefault(); self.onSubmit(e); });
    this.sh.addEventListener('input', function (e) { self.onInput(e); });
    this.sh.addEventListener('change', function (e) {
      if (e.target.name !== 'policy') return;
      self.policyOk = e.target.checked;
      if (self.policyOk) { e.target.parentNode.classList.remove('bad'); self.setError(''); }
    });
    this.sh.addEventListener('focusin', function (e) { if (e.target.name === 'code') self.paintOtp(true); });
    this.sh.addEventListener('focusout', function (e) { if (e.target.name === 'code') self.paintOtp(false); });
    this.bindSwipe();
    requestAnimationFrame(function () { requestAnimationFrame(function () { self.ov.classList.add('on'); }); });
  };

  // Mobile: drag the header down to dismiss, like a native bottom sheet.
  Sheet.prototype.bindSwipe = function () {
    var self = this, startY = null, dy = 0;
    this.sh.addEventListener('touchstart', function (e) {
      if (self.busy || !e.target.closest || !e.target.closest('.hd,.grab') || e.target.closest('button')) return;
      startY = e.touches[0].clientY; dy = 0;
      self.sh.classList.add('drag');
    }, { passive: true });
    this.sh.addEventListener('touchmove', function (e) {
      if (startY === null) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      self.sh.style.transform = 'translateY(' + dy + 'px)';
    }, { passive: true });
    function end() {
      if (startY === null) return;
      startY = null;
      self.sh.classList.remove('drag');
      if (dy > 110) { self.sh.style.transform = 'translateY(100%)'; self.close(); } else self.sh.style.transform = '';
    }
    this.sh.addEventListener('touchend', end);
    this.sh.addEventListener('touchcancel', end);
  };

  Sheet.prototype.close = function () {
    var self = this;
    this.ov.classList.remove('on');
    document.removeEventListener('keydown', this.onKey);
    document.documentElement.style.overflow = this.prevOverflow || '';
    setTimeout(function () { if (self.host.parentNode) self.host.parentNode.removeChild(self.host); }, 220);
    if (sheet === this) sheet = null;
    if (this.placed && typeof this.opts.onClosedAfterOrder === 'function') {
      try { this.opts.onClosedAfterOrder(this.placed); } catch (e) { /* caller UI only */ }
    }
  };

  // Each funnel event once per popup (Track above; consent is checked there).
  Sheet.prototype.track = function (name, order) {
    if (this.tracked[name]) return;
    this.tracked[name] = true;
    Track.send(this.cfg, name, this.quote, order);
  };

  Sheet.prototype.otpFlow = function () { return Boolean(this.cfg.otpRequired); };

  function stageLabel(stage) {
    if (stage === 'phone') return bxT('storefront.cod.step_phone', 'Phone');
    if (stage === 'address') return bxT('storefront.cod.step_address', 'Address');
    return bxT('storefront.cod.step_review', 'Review');
  }
  var VIEW_ORDER = { phone: 0, otp: 1, address: 2, review: 3 };

  Sheet.prototype.stages = function () { return this.otpFlow() ? ['phone', 'address', 'review'] : ['address', 'review']; };

  // With a store logo the header shows the logo and the step title moves into the body.
  Sheet.prototype.head = function (title, back) {
    var logo = this.look.logo;
    return '<div class="grab" aria-hidden="true"></div><div class="hd">' +
      (back ? '<button type="button" class="ib" data-go="' + back + '" aria-label="' + esc(bxT('storefront.common.back', 'Back')) + '">' + icon('back', 20) + '</button>' : '') +
      '<div class="t">' + (logo ? '<img class="lg ' + esc(this.look.logoSize) + '" src="' + esc(logo) + '" alt="' + esc(bxT('storefront.cod.store_logo', 'Store logo')) + '">' : esc(title)) + '</div>' +
      '<span class="tag">' + icon('cash', 13) + esc(bxT('storefront.cod.tag', 'COD')) + '</span>' +
      '<button type="button" class="ib" data-act="close" aria-label="' + esc(bxT('storefront.common.close', 'Close')) + '">' + icon('close', 20) + '</button></div>';
  };

  // stage: 'phone' | 'address' | 'review' (labelled stepper), or null for none.
  Sheet.prototype.frame = function (title, back, stage, body, foot) {
    var stages = this.stages(), idx = stages.indexOf(stage), bar = '';
    if (idx !== -1) {
      bar = '<div class="stp" role="img" aria-label="' + esc(bxT('storefront.cod.step_of', 'Step {step} of {total}: {name}', { step: idx + 1, total: stages.length, name: stageLabel(stage) })) + '">';
      for (var i = 0; i < stages.length; i++) {
        if (i) bar += '<span class="ln' + (i <= idx ? ' on' : '') + '"></span>';
        bar += '<span class="s' + (i < idx ? ' dn' : i === idx ? ' cur' : '') + '"><b>' + (i < idx ? icon('check', 14) : i + 1) + '</b>' + esc(stageLabel(stages[i])) + '</span>';
      }
      bar += '</div>';
    }
    // Slide forwards or backwards between steps.
    var order = VIEW_ORDER[this.view], dir = '';
    if (order != null && this.lastOrder != null && order !== this.lastOrder) dir = order > this.lastOrder ? ' fw' : ' bw';
    if (order != null) this.lastOrder = order;
    this.sh.innerHTML = this.head(title, back) + bar +
      '<form novalidate style="display:contents"><div class="bd' + dir + '">' + (this.look.logo ? '<h2 class="bt">' + esc(title) + '</h2>' : '') + body + '</div>' +
      (foot ? '<div class="ft">' + foot + '</div>' : '') + '</form>' + this.powered();
    var first = this.sh.querySelector('[data-autofocus]');
    if (first && window.innerWidth >= 640) { try { first.focus(); } catch (e) { /* ignore */ } }
  };

  function brixMark() {
    return BRIX_LOGO ? '<img src="' + esc(BRIX_LOGO) + '" alt="BRIX">' : '<b class="bx">BRIX</b>';
  }

  Sheet.prototype.powered = function () {
    return '<div class="pw">' + icon('shield', 12) + '<span>' + esc(bxT('storefront.cod.powered', 'Secured & powered by')) + '</span>' + brixMark() + '</div>';
  };

  // BRIX-branded loader, shown first while COD is checked for this cart.
  Sheet.prototype.loading = function (text) {
    if (!this.loadingSince) this.loadingSince = Date.now();
    this.sh.innerHTML = this.head(bxT('storefront.cod.title', 'Cash on Delivery')) +
      '<div class="bl" role="status" aria-live="polite"><div class="bl-m">' + brixMark() + '</div>' +
      '<div class="bl-bar" aria-hidden="true"><i></i></div><div class="bl-t">' + esc(text || bxT('storefront.common.loading', 'Loading\u2026')) + '</div></div>';
  };

  // Keeps the BRIX loader up long enough to be seen, never longer than needed.
  Sheet.prototype.afterLoader = function (fn) {
    var wait = Math.max(0, 700 - (Date.now() - (this.loadingSince || 0)));
    if (wait) setTimeout(fn, wait); else fn();
  };

  Sheet.prototype.payOnlineButton = function (label) {
    return typeof this.opts.onPayOnline === 'function'
      ? '<button type="button" class="b s" data-act="online">' + icon('card', 18) + esc(label || bxT('storefront.cod.pay_online_instead', 'Pay online instead')) + '</button>'
      : '';
  };

  Sheet.prototype.fail = function (message) {
    this.frame(bxT('storefront.cod.title', 'Cash on Delivery'), null, null,
      '<div class="fail"><div class="ic">' + icon('alert', 28) + '</div>' +
      '<div class="n er" role="alert">' + esc(message || bxT('error.generic', 'Something went wrong. Please try again.')) + '</div></div>',
      this.payOnlineButton(bxT('storefront.cod.pay_online', 'Pay online')) + '<button type="button" class="b s" data-act="close">' + esc(bxT('storefront.common.close', 'Close')) + '</button>');
  };

  Sheet.prototype.setError = function (message) {
    var slot = this.sh.querySelector('[data-err]');
    if (slot) slot.innerHTML = message ? '<div class="n er" role="alert">' + icon('alert', 16) + '<span>' + esc(message) + '</span></div>' : '';
  };

  Sheet.prototype.setBusy = function (busy, label) {
    this.busy = busy;
    var btn = this.sh.querySelector('button[type="submit"]');
    if (btn) {
      if (busy) { btn.setAttribute('data-label', btn.innerHTML); btn.innerHTML = '<span class="sp" style="width:18px;height:18px;border-width:2px;border-color:rgba(255,255,255,.35);border-top-color:currentColor"></span> ' + esc(label || bxT('storefront.common.please_wait', 'Please wait\u2026')); }
      else if (btn.getAttribute('data-label')) btn.innerHTML = btn.getAttribute('data-label');
      btn.disabled = busy;
    }
  };

  /* --- shared pieces --- */

  Sheet.prototype.lineList = function (q) {
    var fmt = this.fmt;
    return q.lines.map(function (li) {
      var price = li.total < li.originalTotal ? '<span class="st">' + fmt(li.originalTotal) + '</span>' + fmt(li.total) : fmt(li.total);
      return '<div class="li"><div class="im">' + (li.image ? '<img src="' + esc(li.image) + '" alt="">' : '<div class="ph"></div>') +
        '<span class="q" aria-label="' + esc(bxT('storefront.common.quantity_n', 'Quantity {count}', { count: li.quantity })) + '">' + li.quantity + '</span></div>' +
        '<div><div class="nm">' + esc(li.title) + '</div><div class="mu">' + (li.variantTitle ? esc(li.variantTitle) + ' \u00b7 ' : '') + esc(bxT('storefront.cod.qty_n', 'Qty {count}', { count: li.quantity })) + '</div></div>' +
        '<div class="num" style="font-weight:650">' + price + '</div></div>';
    }).join('');
  };

  // Collapsible "what you're buying" strip for the steps before review.
  Sheet.prototype.summary = function () {
    var q = this.quote;
    if (!this.look.showSummary || !q || !q.lines || !q.lines.length) return '';
    var count = q.lines.reduce(function (n, li) { return n + (Number(li.quantity) || 0); }, 0);
    var thumbs = q.lines.slice(0, 3).map(function (li) { return li.image ? '<img src="' + esc(li.image) + '" alt="">' : '<span class="ph"></span>'; }).join('');
    var open = Boolean(this.summaryOpen);
    var extra = !hasCodFee(this.cfg) ? bxT('storefront.cod.shipping_at_review', 'Shipping is added at review.')
      : this.cfg.showCodFee === false ? bxT('storefront.cod.delivery_at_review', 'Delivery charges are added at review.')
        : bxT('storefront.cod.fee_at_review', 'Shipping and the {fee} are added at review.', { fee: feeLabel(this.cfg) });
    return '<div class="sum' + (open ? ' open' : '') + '"><button type="button" class="sum-h" data-act="summary" aria-expanded="' + open + '">' +
      '<span class="thumbs">' + thumbs + '</span><span class="sum-t"><b>' + esc(bxT('storefront.drawer.items', '{count, plural, one {# item} other {# items}}', { count: count })) + '</b><span class="mu">' + esc(bxT('storefront.cod.order_summary', 'Order summary')) + '</span></span>' +
      '<span class="num sum-p">' + this.fmt(q.subtotal) + '</span>' + icon('chevron', 18, ' class="chev"') + '</button>' +
      '<div class="sum-b"><div><div class="in">' + this.lineList(q) + '<div class="mu">' + esc(extra) + '</div></div></div></div></div>';
  };

  Sheet.prototype.phoneInput = function (id, autofocus) {
    return '<div class="pre' + (normalizePhone(this.phone) ? ' valid' : '') + '"><span>' + icon('phone', 16) + '+91</span>' +
      '<input id="' + id + '" name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="' + esc(bxT('storefront.cod.phone_placeholder', '10-digit mobile number')) + '" value="' + esc(this.phone) + '"' + (autofocus ? ' data-autofocus' : '') + '>' +
      icon('checkCircle', 20, ' class="okc"') + '</div>';
  };

  Sheet.prototype.trust = function () {
    if (!this.look.showTrust) return '';
    return '<div class="trust">' +
      '<div>' + icon('cash', 20) + esc(bxT('storefront.cod.trust_no_advance', 'No advance payment')) + '</div>' +
      '<div>' + icon('truck', 20) + esc(bxT('storefront.cod.trust_doorstep', 'Pay at your doorstep')) + '</div>' +
      '<div>' + icon('shield', 20) + esc(this.otpFlow() ? bxT('storefront.cod.trust_otp', 'Verified by OTP') : bxT('storefront.cod.trust_secure', 'Secure checkout')) + '</div></div>';
  };

  // A quote request. With the address it also carries city and state (dynamic
  // shipping prices by zone, state, city or PIN code) and the delivery option
  // the shopper picked, which the server checks again.
  Sheet.prototype.quoteBody = function (coupon, withAddress) {
    var body = { surface: this.opts.surface, items: this.items, coupon: coupon, cartCodes: this.cartCodes, cartAttributes: this.cartAttributes };
    if (withAddress) {
      body.pincode = this.addr.pincode;
      body.city = this.addr.city;
      body.state = this.addr.state;
      if (this.delivery) body.delivery = this.delivery;
    }
    return body;
  };

  /* --- start: a first quote without address fails fast on min/max, sold out, excluded products --- */
  Sheet.prototype.start = function () {
    var self = this;
    this.loading(bxT('storefront.cod.checking', 'Checking Cash on Delivery\u2026'));
    api('quote', this.quoteBody(this.coupon, false)).then(function (json) {
      self.afterLoader(function () {
        if (!json.success) { self.fail(errorText(json)); return; }
        self.quote = json.quote;
        self.track('begin_checkout');
        self.go(self.otpFlow() && !self.validToken() ? 'phone' : 'address');
      });
    });
  };

  Sheet.prototype.validToken = function () {
    return this.token && this.token.expiresAt > Date.now() && this.token.phone === this.phone;
  };

  Sheet.prototype.go = function (view) {
    this.view = view;
    if (view === 'phone') return this.viewPhone();
    if (view === 'otp') return this.viewOtp();
    if (view === 'address') return this.viewAddress();
    if (view === 'review') return this.viewReview();
  };

  Sheet.prototype.viewPhone = function () {
    this.frame(bxT('storefront.cod.confirm_phone', 'Confirm your phone'), null, 'phone',
      this.summary() +
      '<div class="f"><label for="cod-phone">' + esc(bxT('storefront.cod.mobile_number', 'Mobile number')) + '</label>' + this.phoneInput('cod-phone', true) + '</div>' +
      '<p class="mu" style="margin:-6px 0 0">' + esc(bxT('storefront.cod.otp_intro', 'We\'ll text you a 4-digit code to confirm this Cash on Delivery order.')) + '</p>' +
      '<div data-err></div>' + this.trust(),
      '<button type="submit" class="b p">' + esc(bxT('storefront.cod.send_code', 'Send code')) + '</button>' + this.payOnlineButton());
    this.submitAction = 'send';
  };

  Sheet.prototype.viewOtp = function () {
    this.frame(bxT('storefront.cod.enter_code', 'Enter the code'), 'phone', 'phone',
      '<p style="margin:4px 0 0;text-align:center">' + esc(bxT('storefront.cod.code_sent_to', 'Enter the 4-digit code sent to')) + '<br><b dir="ltr">+91 ' + esc(prettyPhone(this.phone)) + '</b> <button type="button" class="lk" data-go="phone">' + esc(bxT('storefront.common.change', 'Change')) + '</button></p>' +
      '<div class="otpw" data-otp><input id="cod-otp" name="code" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="4" aria-label="' + esc(bxT('storefront.cod.code_label', '4-digit code')) + '" data-autofocus>' +
      '<i></i><i></i><i></i><i></i></div>' +
      '<div data-err></div><div class="rs" data-resend aria-live="polite"></div>',
      '<button type="submit" class="b p">' + esc(bxT('storefront.cod.verify', 'Verify')) + '</button>');
    this.submitAction = 'verify';
    this.paintOtp(false);
    this.startResendTimer();
  };

  // Paints the four boxes from the one real input.
  Sheet.prototype.paintOtp = function (focused) {
    var w = this.sh.querySelector('[data-otp]');
    if (!w) return;
    var v = w.querySelector('input').value;
    if (focused != null) w.classList.toggle('foc', focused);
    var boxes = w.querySelectorAll('i');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].textContent = v.charAt(i);
      boxes[i].className = (v.charAt(i) ? 'fi' : '') + (i === v.length ? ' ac' : '');
    }
  };

  Sheet.prototype.startResendTimer = function () {
    var self = this;
    var total = this.resendAfter || 30;
    var left = total;
    clearInterval(this.resendTimer);
    function paint() {
      var el = self.sh.querySelector('[data-resend]');
      if (!el) { clearInterval(self.resendTimer); return; }
      var dash = 44, off = dash * (1 - left / total);
      el.innerHTML = left > 0
        ? '<svg class="ring" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" stroke="#e5e7eb"/><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-dasharray="' + dash + '" stroke-dashoffset="' + off.toFixed(1) + '" style="transition:stroke-dashoffset 1s linear"/></svg>' +
          '<span>' + esc(bxT('storefront.cod.resend_in', 'Resend code in {time}', { time: '0:' + (left < 10 ? '0' : '') + left })) + '</span>'
        : '<span>' + esc(bxT('storefront.cod.didnt_get', 'Didn\'t get it?')) + '</span> <button type="button" class="lk" data-act="resend">' + esc(bxT('storefront.cod.send_new_code', 'Send a new code')) + '</button>';
    }
    paint();
    this.resendTimer = setInterval(function () { left -= 1; paint(); if (left <= 0) clearInterval(self.resendTimer); }, 1000);
  };

  Sheet.prototype.addrComplete = function (a) {
    return Boolean(a.name && a.address1 && /^[1-9]\d{5}$/.test(a.pincode || '') && a.city && a.state && (this.otpFlow() || normalizePhone(this.phone)));
  };

  Sheet.prototype.viewAddress = function () {
    var a = this.addr;
    // Returning shoppers see their saved address as a card; the form stays
    // in the DOM (hidden) so it's what we read and submit either way.
    if (this.editAddr == null) this.editAddr = !this.addrComplete(a);
    var editing = this.editAddr;
    var stateOptions = '<option value="">' + esc(bxT('storefront.cod.select_state', 'Select state')) + '</option>' + STATES.map(function (s) {
      return '<option' + (a.state === s ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
    var phoneBlock = this.otpFlow()
      ? '<div class="n ok">' + icon('checkCircle', 16) + '<span style="flex:1">' + esc(bxT('storefront.cod.phone_verified', 'Phone verified')) + ' \u00b7 <span dir="ltr">+91 ' + esc(prettyPhone(this.phone)) + '</span></span><button type="button" class="lk" data-go="phone">' + esc(bxT('storefront.common.change', 'Change')) + '</button></div>'
      : '<div class="f"><label for="cod-phone2">' + esc(bxT('storefront.cod.mobile_number', 'Mobile number')) + '</label>' + this.phoneInput('cod-phone2', false) + '</div>';
    var card = editing ? '' :
      '<div class="card" data-card>' + icon('home', 20, ' class="ic"') + '<div class="cb"><b>' + esc(a.name) + '</b>' +
      esc(a.address1) + (a.address2 ? ', ' + esc(a.address2) : '') + '<br>' + esc(a.city) + ', ' + esc(a.state) + ' ' + esc(a.pincode) +
      (this.otpFlow() ? '' : '<br>+91 ' + esc(prettyPhone(this.phone))) + '</div>' +
      '<button type="button" class="lk" data-act="edit-addr">' + esc(bxT('storefront.common.change', 'Change')) + '</button></div>';
    var pinSlot = '<div data-pin></div>';
    this.frame(bxT('storefront.cod.delivery_address', 'Delivery address'), this.otpFlow() ? 'phone' : null, 'address',
      this.summary() + (this.otpFlow() ? phoneBlock : '') +
      '<div class="ttl">' + esc(bxT('storefront.cod.deliver_to', 'Deliver to')) + '</div>' + card + (editing ? '' : pinSlot) +
      '<div class="fm"' + (editing ? '' : ' hidden') + '>' + (this.otpFlow() ? '' : phoneBlock) +
      '<div class="f"><label for="cod-name">' + esc(bxT('storefront.cod.full_name', 'Full name')) + '</label><input id="cod-name" name="name" autocomplete="name" value="' + esc(a.name || '') + '"' + (editing ? ' data-autofocus' : '') + '></div>' +
      '<div class="f"><label for="cod-a1">' + esc(bxT('storefront.cod.address1', 'House no., building, street, area')) + '</label><input id="cod-a1" name="address1" autocomplete="address-line1" value="' + esc(a.address1 || '') + '"></div>' +
      '<div class="f"><label for="cod-a2">' + esc(bxT('storefront.cod.address2', 'Landmark (optional)')) + '</label><input id="cod-a2" name="address2" autocomplete="address-line2" placeholder="' + esc(bxT('storefront.cod.address2_placeholder', 'e.g. Near City Mall')) + '" value="' + esc(a.address2 || '') + '"></div>' +
      '<div class="two" data-pinrow><div class="f"><label for="cod-pin">' + esc(bxT('storefront.cod.pincode', 'PIN code')) + '</label><input id="cod-pin" name="pincode" inputmode="numeric" autocomplete="postal-code" maxlength="6" placeholder="' + esc(bxT('storefront.cod.pincode_placeholder', '6 digits')) + '" value="' + esc(a.pincode || '') + '"></div>' +
      '<div class="f"><label for="cod-city">' + esc(bxT('storefront.cod.city', 'City')) + '</label><input id="cod-city" name="city" autocomplete="address-level2" value="' + esc(a.city || '') + '"></div></div>' +
      (editing ? pinSlot : '') +
      '<div class="f"><label for="cod-state">' + esc(bxT('storefront.cod.state', 'State')) + '</label><select id="cod-state" name="state" autocomplete="address-level1">' + stateOptions + '</select></div>' +
      '<div class="f"><label for="cod-email">' + esc(bxT('storefront.cod.email', 'Email (optional, for order updates)')) + '</label><input id="cod-email" name="email" type="email" autocomplete="email" value="' + esc(a.email || '') + '"></div>' +
      '</div><div data-err></div>',
      '<button type="submit" class="b p">' + esc(editing ? bxT('storefront.common.continue', 'Continue') : bxT('storefront.cod.deliver_here', 'Deliver here')) + '</button>' + '<span data-alt hidden>' + this.payOnlineButton() + '</span>');
    this.submitAction = 'address';
    if (a.pincode && /^[1-9]\d{5}$/.test(a.pincode)) this.lookupPin(a.pincode, true);
  };

  // Switches the saved-address card to the editable form.
  Sheet.prototype.editAddress = function () {
    var card = this.sh.querySelector('[data-card]');
    var fm = this.sh.querySelector('.fm');
    var slot = this.sh.querySelector('[data-pin]');
    var row = this.sh.querySelector('[data-pinrow]');
    this.editAddr = true;
    if (card) card.parentNode.removeChild(card);
    if (slot && row) row.parentNode.insertBefore(slot, row.nextSibling);
    if (fm) fm.hidden = false;
    var btn = this.sh.querySelector('button[type="submit"]');
    if (btn && !this.busy) btn.textContent = bxT('storefront.common.continue', 'Continue');
    var name = this.sh.querySelector('#cod-name');
    if (name) { try { name.focus(); } catch (e) { /* ignore */ } }
  };

  Sheet.prototype.lookupPin = function (pin, keepFilled) {
    var self = this;
    var note = this.sh.querySelector('[data-pin]');
    if ((this.cfg.blockedPincodes || []).indexOf(pin) !== -1) { this.showPinBlocked(pin); return; }
    if (note) note.innerHTML = '<div class="pst"><span class="sp" style="width:14px;height:14px;border-width:2px"></span>' + esc(bxT('storefront.cod.checking_pin', 'Checking PIN code\u2026')) + '</div>';
    phpGet('pincode', '&pin=' + encodeURIComponent(pin)).then(function (json) {
      if (self.view !== 'address') return;
      var pinInput = self.sh.querySelector('#cod-pin');
      if (!pinInput || pinInput.value !== pin) return;
      self.pin = json.success ? json : null;
      if (json.success && json.blocked) { self.showPinBlocked(pin); return; }
      self.togglePinBlocked(false);
      var slot = self.sh.querySelector('[data-pin]');
      if (json.success && json.found) {
        var city = self.sh.querySelector('#cod-city');
        var state = self.sh.querySelector('#cod-state');
        if (city && (!keepFilled || !city.value)) { city.value = json.city; city.removeAttribute('aria-invalid'); }
        if (state && (!keepFilled || !state.value)) {
          var match = STATES.filter(function (s) { return s.toLowerCase() === String(json.state).toLowerCase(); })[0];
          if (match) { state.value = match; state.removeAttribute('aria-invalid'); }
        }
        // In card mode the card already shows the place; only confirm it while editing.
        if (slot) slot.innerHTML = self.editAddr ? '<div class="pst ok">' + icon('checkCircle', 16) + esc(bxT('storefront.cod.delivering_to', 'Delivering to {city}, {state}', { city: json.city, state: json.state })) + '</div>' : '';
      } else if (slot) slot.innerHTML = '';
    });
  };

  Sheet.prototype.showPinBlocked = function (pin) {
    var note = this.sh.querySelector('[data-pin]');
    if (note) note.innerHTML = '<div class="n er" role="alert">' + icon('alert', 16) + '<span>' + esc(bxT('storefront.cod.pin_blocked', 'Cash on Delivery isn\'t available for PIN code {pin}. You can still pay online.', { pin: pin })) + '</span></div>';
    this.togglePinBlocked(true);
  };

  Sheet.prototype.togglePinBlocked = function (blocked) {
    var btn = this.sh.querySelector('button[type="submit"]');
    var alt = this.sh.querySelector('[data-alt]');
    if (btn) btn.disabled = blocked;
    if (alt) alt.hidden = !blocked;
  };

  Sheet.prototype.readAddress = function () {
    var f = this.sh.querySelector('form');
    var get = function (n) { var el = f.querySelector('[name="' + n + '"]'); return el ? String(el.value || '').trim() : ''; };
    return { name: get('name'), address1: get('address1'), address2: get('address2'), pincode: get('pincode'), city: get('city'), state: get('state'), email: get('email'), phone: get('phone') };
  };

  // Points at the field that needs fixing (opening the form if it's folded into the card).
  Sheet.prototype.markInvalid = function (name) {
    var el = this.sh.querySelector('[name="' + name + '"]');
    if (!el) return;
    if (el.closest('.fm[hidden]')) this.editAddress();
    if (name === 'phone' && el.parentNode.classList.contains('pre')) el.parentNode.classList.add('bad');
    else el.setAttribute('aria-invalid', 'true');
    try { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { /* ignore */ }
  };

  Sheet.prototype.viewReview = function () {
    var self = this;
    this.frame(bxT('storefront.cod.review_title', 'Review your order'), 'address', 'review',
      '<div class="sk" role="status" aria-label="' + esc(bxT('storefront.cod.getting_total', 'Getting your total')) + '" style="padding:6px 0"><i class="bx"></i><i style="width:70%"></i><i style="width:45%"></i><i class="bx" style="height:96px"></i><i class="bx" style="height:72px"></i></div>', '');
    var asked = this.delivery && this.delivery.option;
    api('quote', this.quoteBody(this.coupon, true)).then(function (json) {
      if (self.view !== 'review') return;
      if (!json.success) {
        self.frame(bxT('storefront.cod.review_title', 'Review your order'), 'address', 'review', '<div class="n er" role="alert">' + icon('alert', 16) + '<span>' + esc(errorText(json)) + '</span></div>', self.payOnlineButton(bxT('storefront.cod.pay_online', 'Pay online')) + '<button type="button" class="b s" data-go="address">' + esc(bxT('storefront.cod.change_address', 'Change address')) + '</button>');
        return;
      }
      self.quote = json.quote;
      self.syncDelivery();
      // The option picked earlier isn't offered for this address or cart any more.
      if (asked && self.delivery && self.delivery.option !== asked && !self.reviewNotice) {
        self.reviewNotice = bxT('storefront.cod.delivery_repicked', 'Your earlier delivery choice isn\'t available for this address, so we picked {option}.', { option: self.deliveryName() });
      }
      self.track('add_payment_info');
      if (json.quote.coupon && !json.quote.coupon.applied) {
        self.couponDraft = json.quote.coupon.code;
        self.couponError = json.quote.coupon.message || bxT('storefront.cod.coupon_left_off', '{code} can\'t be used on this order, so it was left off.', { code: json.quote.coupon.code });
        self.coupon = null;
      }
      self.renderReview();
    });
  };

  /* --- coupon code (review step). Shopify checks the code when it prices the order. --- */

  Sheet.prototype.couponBlock = function () {
    if (!this.cfg.allowCoupons) return '';
    var q = this.quote;
    var applied = q.coupon && q.coupon.applied;
    if (!applied && !this.look.showCoupon && !this.couponError) return '';
    if (applied) {
      return '<div class="cpn ok' + (this.couponJustApplied ? ' pop' : '') + '" role="status">' + icon('tag', 18) +
        '<div class="cb"><b>' + esc(bxT('storefront.cod.coupon_applied', '{code} applied', { code: q.coupon.code })) + '</b><span>' + esc(bxT('storefront.cod.you_save_order', 'You save {amount} on this order', { amount: this.fmt(q.discounts) })) + '</span></div>' +
        '<button type="button" class="lk" data-act="coupon-remove">' + esc(bxT('storefront.common.remove', 'Remove')) + '</button></div>';
    }
    var offers = this.look.showCoupon ? this.offersList() : '';
    if (!this.couponOpen && !this.couponError) {
      return '<button type="button" class="cpn-add" data-act="coupon-open">' + icon('tag', 16) + '<span>' + esc(bxText(this.look.couponLabel, 'storefront.cod.coupon_prompt', 'Have a coupon code?')) + '</span><b>' + esc(bxT('storefront.drawer.add', 'Add')) + '</b></button>' + offers;
    }
    var canPaste = Boolean(navigator.clipboard && navigator.clipboard.readText);
    return '<div class="cpn-form' + (this.couponError ? ' bad' : '') + '"><div class="cpn-in">' + icon('tag', 16) +
      '<input name="coupon" aria-label="' + esc(bxT('storefront.cod.coupon_code', 'Coupon code')) + '" placeholder="' + esc(bxT('storefront.cod.coupon_placeholder', 'Enter coupon code')) + '" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="60" value="' + esc(this.couponDraft || '') + '">' +
      (canPaste ? '<button type="button" class="cpn-paste" data-act="coupon-paste">' + esc(bxT('storefront.cod.paste', 'Paste')) + '</button>' : '') +
      '<button type="button" class="cpn-go" data-act="coupon-apply">' + esc(bxT('storefront.cod.apply_caps', 'APPLY')) + '</button></div></div>' +
      (this.couponError ? '<div class="cpn-err" role="alert">' + icon('alert', 14) + '<span>' + esc(this.couponError) + '</span></div>' : '') + offers;
  };

  // The merchant's suggested codes, tap to apply. Shopify still checks each one.
  Sheet.prototype.offersList = function () {
    var offers = this.look.offers || [];
    if (!offers.length) return '';
    return '<div class="ofrs"><div class="ofrs-t">' + esc(bxT('storefront.cod.available_offers', 'Available offers')) + '<span>' + offers.length + '</span></div>' + offers.map(function (o) {
      return '<div class="ofr"><div class="ofr-l" aria-hidden="true"><span>' + esc(offerBadge(o.text)) + '</span></div>' +
        '<div class="ofr-r"><div class="ofr-h"><b class="ofr-c">' + esc(o.code) + '</b>' +
        '<button type="button" class="ofr-b" data-act="coupon-offer" data-code="' + esc(o.code) + '" aria-label="' + esc(bxT('storefront.cod.apply_code', 'Apply {code}', { code: o.code })) + '">' + esc(bxT('storefront.cod.apply_caps', 'APPLY')) + '</button></div>' +
        (o.text ? '<div class="ofr-t">' + esc(o.text) + '</div>' : '') + '</div></div>';
    }).join('') + '</div>';
  };

  // Short deal label for the ticket strip, read from the merchant's offer text.
  function offerBadge(text) {
    var t = String(text || '');
    var m = /(\d{1,3}(?:\.\d+)?)\s?%/.exec(t);
    if (m) return bxT('storefront.cod.badge_off', '{amount} OFF', { amount: m[1] + '%' });
    m = /(\u20b9|rs\.?|inr|\$|\u20ac|\u00a3)\s?([\d,]+(?:\.\d+)?)/i.exec(t);
    if (m) return bxT('storefront.cod.badge_off', '{amount} OFF', { amount: (/^(rs|inr)/i.test(m[1]) ? '\u20b9' : m[1]) + m[2].replace(/\.0+$/, '') });
    if (/free\s*ship/i.test(t)) return bxT('storefront.cod.badge_free_ship', 'FREE SHIP');
    return bxT('storefront.cod.badge_offer', 'OFFER');
  }

  // Re-prices the order with a coupon (code) or without one (null).
  Sheet.prototype.requote = function (code, done) {
    var self = this;
    this.busy = true;
    api('quote', this.quoteBody(code, true)).then(function (json) {
      self.busy = false;
      if (self.view !== 'review') return;
      done(json);
    });
  };

  Sheet.prototype.applyCoupon = function (raw) {
    var self = this;
    var input = this.sh.querySelector('[name="coupon"]');
    var code = String(raw != null ? raw : (input ? input.value : '')).trim();
    this.couponDraft = code;
    var bad = !code ? bxT('storefront.cod.coupon_empty', 'Enter a coupon code.') : !/^[\w-]{1,60}$/.test(code) ? bxT('storefront.cod.coupon_chars', 'Coupon codes only use letters, numbers, - and _.') : '';
    if (bad) { this.couponError = bad; this.renderReview(true); return; }
    var btn = this.sh.querySelector('[data-act="coupon-apply"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="sp" style="width:16px;height:16px;border-width:2px;border-color:rgba(255,255,255,.35);border-top-color:currentColor"></span>'; }
    this.requote(code, function (json) {
      if (!json.success) {
        self.couponError = json.error ? errorText(json) : bxT('storefront.cod.coupon_check_failed', 'We couldn\'t check that code. Please try again.');
      } else if (json.quote.coupon && json.quote.coupon.applied) {
        self.quote = json.quote;
        self.syncDelivery();
        self.coupon = code;
        self.couponError = '';
        self.couponDraft = '';
        self.couponOpen = false;
        self.couponJustApplied = true;
      } else {
        // Keep the current prices (and any code already applied).
        self.couponError = (json.quote.coupon && json.quote.coupon.message) || bxT('storefront.cod.coupon_invalid', '{code} isn\'t valid for this order. Check the code, or the order may not meet its conditions.', { code: code });
      }
      self.renderReview(Boolean(self.couponError));
      self.couponJustApplied = false;
    });
  };

  Sheet.prototype.removeCoupon = function () {
    var self = this;
    var btn = this.sh.querySelector('[data-act="coupon-remove"]');
    if (btn) btn.textContent = bxT('storefront.cod.removing', 'Removing\u2026');
    this.requote(null, function (json) {
      if (json.success) { self.quote = json.quote; self.syncDelivery(); self.coupon = null; self.couponOpen = false; }
      self.renderReview();
    });
  };

  /* --- delivery options (dynamic shipping): prices and dates come from the server's quote --- */

  // The pick the next quote and the order carry: what the last quote selected.
  Sheet.prototype.syncDelivery = function () {
    var d = this.quote && this.quote.delivery;
    this.delivery = d && d.selected ? { option: d.selected, date: d.date || null, slot: d.slot || null } : null;
  };

  Sheet.prototype.selectedOption = function () {
    var d = this.quote && this.quote.delivery;
    if (!d || !d.options) return null;
    for (var i = 0; i < d.options.length; i++) if (d.options[i].id === d.selected) return d.options[i];
    return null;
  };

  Sheet.prototype.deliveryName = function () {
    var o = this.selectedOption();
    return o ? o.name : bxT('storefront.cod.another_option', 'another option');
  };

  function arrivesText(eta) {
    if (!eta) return '';
    if (eta.label === 'Today') return bxT('storefront.cod.arrives_today', 'Arrives today');
    if (eta.label === 'Tomorrow') return bxT('storefront.cod.arrives_tomorrow', 'Arrives tomorrow');
    return bxT('storefront.cod.arrives', 'Arrives {date}', { date: eta.label });
  }

  // "Standard delivery · Arrives 28–30 Oct" / "Scheduled delivery · Tue, 28 Oct, 10 AM – 1 PM" (done screen).
  Sheet.prototype.deliveryText = function () {
    var d = this.quote && this.quote.delivery, o = this.selectedOption();
    if (!o) return '';
    if (d.date && o.dates) {
      var day = o.dates.filter(function (x) { return x.date === d.date; })[0];
      var slot = d.slot && o.slots ? o.slots.filter(function (s) { return s.id === d.slot; })[0] : null;
      return o.name + ' \u00b7 ' + (day ? day.label : d.date) + (slot ? ', ' + slot.label : '');
    }
    return o.name + (o.eta ? ' \u00b7 ' + arrivesText(o.eta) : '');
  };

  Sheet.prototype.deliveryBlock = function () {
    var d = this.quote && this.quote.delivery;
    if (!d || !d.options || !d.options.length) return '';
    var fmt = this.fmt, sel = this.selectedOption(), many = d.options.length > 1;
    var html = '<div class="ttl">' + esc(bxT('storefront.cod.delivery', 'Delivery')) + '</div><div class="dlv"' + (many ? ' role="radiogroup" aria-label="' + esc(bxT('storefront.cod.delivery_options', 'Delivery options')) + '"' : '') + '>';
    d.options.forEach(function (o) {
      var on = many && o.id === d.selected;
      // Scheduled delivery: its days are the chips below.
      var sub = [o.description, o.dates ? (o.description ? '' : bxT('storefront.cod.pick_day', 'Pick a delivery day')) : arrivesText(o.eta)].filter(Boolean).join(' \u00b7 ');
      var inner = (many ? '<span class="rd" aria-hidden="true"></span>' : icon('truck', 20)) +
        '<span class="cb"><b>' + esc(o.name) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</span>' +
        '<span class="pr' + (o.price > 0 ? '' : ' fr') + '">' + (o.price > 0 ? fmt(o.price) : esc(bxT('storefront.common.free', 'Free'))) + '</span>';
      html += many
        ? '<button type="button" class="dlo' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-act="dlv" data-id="' + esc(o.id) + '">' + inner + '</button>'
        : '<div class="dlo">' + inner + '</div>';
    });
    html += '</div>';
    if (sel && sel.dates && sel.dates.length) {
      html += '<div class="dts" role="radiogroup" aria-label="' + esc(bxT('storefront.cod.delivery_day', 'Delivery day')) + '">' + sel.dates.map(function (x) {
        var on = x.date === d.date;
        return '<button type="button" class="dt' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-act="dlv-date" data-date="' + esc(x.date) + '">' + esc(x.label) + '</button>';
      }).join('') + '</div>';
      if (sel.slots && sel.slots.length) {
        html += '<div class="dts" role="radiogroup" aria-label="' + esc(bxT('storefront.cod.delivery_time', 'Delivery time')) + '">' + sel.slots.map(function (s) {
          var on = s.id === d.slot;
          return '<button type="button" class="dt' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-act="dlv-slot" data-slot="' + esc(s.id) + '">' + esc(s.label) + '</button>';
        }).join('') + '</div>';
      }
    }
    if (sel && sel.freeIn > 0) html += '<div class="fsh">' + icon('truck', 16) + '<span>' + esc(bxT('storefront.cod.free_shipping_in', 'Add {amount} more for free shipping', { amount: fmt(sel.freeIn) })) + '</span></div>';
    return html;
  };

  // A tap on an option, day or time: re-priced by the server, then redrawn.
  Sheet.prototype.pickDelivery = function (act, el) {
    var d = this.quote && this.quote.delivery;
    if (!d) return;
    var prev = this.delivery;
    var next = { option: d.selected, date: d.date || null, slot: d.slot || null };
    if (act === 'dlv') {
      if (el.getAttribute('data-id') === d.selected) return;
      next = { option: el.getAttribute('data-id'), date: null, slot: null };
    } else if (act === 'dlv-date') {
      if (el.getAttribute('data-date') === d.date) return;
      next.date = el.getAttribute('data-date');
    } else {
      if (el.getAttribute('data-slot') === d.slot) return;
      next.slot = el.getAttribute('data-slot');
    }
    var self = this;
    this.delivery = next;
    // Show the tap at once; the new price arrives with the quote.
    var group = el.parentNode ? el.parentNode.querySelectorAll('[role="radio"]') : [];
    for (var i = 0; i < group.length; i++) {
      group[i].classList.toggle('on', group[i] === el);
      group[i].setAttribute('aria-checked', String(group[i] === el));
    }
    var price = act === 'dlv' ? el.querySelector('.pr') : null;
    if (price) price.innerHTML = '<span class="sp" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle"></span>';
    this.requote(this.coupon, function (json) {
      if (!json.success) {
        self.delivery = prev;
        self.renderReview();
        self.setError(errorText(json));
        return;
      }
      self.quote = json.quote;
      self.syncDelivery();
      self.renderReview();
    });
  };

  function feeLabel(cfg) { return bxText(cfg.codFeeLabel, 'storefront.cod.fee_label', 'Cash on Delivery Fee'); }

  // Shipping and the COD fee on the review step. With "Show fee to customers"
  // off the fee is still charged, shown inside one "Delivery charges" line.
  function chargeRows(cfg, q, fmt) {
    var free = '<b style="color:#067647">' + esc(bxT('storefront.common.free', 'Free')) + '</b>';
    if (cfg.showCodFee === false && q.codFee > 0) {
      return '<div><span>' + esc(bxT('storefront.cod.delivery_charges', 'Delivery charges')) + '</span><span class="num">' + fmt((q.shipping || 0) + q.codFee) + '</span></div>';
    }
    return '<div><span>' + esc(bxT('storefront.cod.shipping', 'Shipping')) + '</span><span class="num">' + (q.shipping > 0 ? fmt(q.shipping) : free) + '</span></div>' +
      (q.codFee > 0 ? '<div><span>' + esc(feeLabel(cfg)) + '</span><span class="num">' + fmt(q.codFee) + '</span></div>' : '');
  }

  // One row per discount Shopify gave (q.discountList, by name), else one
  // "Discounts" row; then a note for any cart code that didn't apply.
  function discountRows(q, fmt) {
    var html = '';
    var list = q.discountList;
    if (list && list.length) {
      var listed = 0;
      list.forEach(function (d) {
        listed += d.amount;
        html += '<div style="color:#067647"><span>' + esc(d.code || d.title) + '</span><span class="num">\u2212' + fmt(d.amount) + '</span></div>';
      });
      // Anything Shopify took off that isn't itemised (rounding, older APIs).
      var rest = Math.round((q.discounts - listed) * 100) / 100;
      if (rest > 0.009) html += '<div style="color:#067647"><span>' + esc(bxT('storefront.cod.other_discounts', 'Other discounts')) + '</span><span class="num">\u2212' + fmt(rest) + '</span></div>';
    } else if (q.discounts > 0) {
      html += '<div style="color:#067647"><span>' + esc(bxT('storefront.drawer.discounts', 'Discounts')) + (q.coupon && q.coupon.applied ? ' (' + esc(q.coupon.code) + (q.coupon.capped ? ', ' + esc(bxT('storefront.cod.max_amount', 'max {amount}', { amount: fmt(q.coupon.amount) })) : '') + ')' : '') + '</span><span class="num">\u2212' + fmt(q.discounts) + '</span></div>';
    }
    (q.cartCodes || []).forEach(function (c) {
      if (!c.applied) html += '<div class="mu"><span>' + esc(bxT('storefront.cod.code_not_applied', '{code} doesn\'t apply to this order', { code: c.code })) + '</span></div>';
    });
    return html;
  }

  Sheet.prototype.renderReview = function (couponFailed) {
    var q = this.quote, fmt = this.fmt, a = this.addr;
    // Partial COD: offered for this total? Picked? (this.payMode)
    var split = partialSplit(this.cfg, q);
    // "Only part payment": no full Cash on Delivery where Partial COD is offered.
    var partialOnly = Boolean(split) && Boolean(this.cfg.partialCod && this.cfg.partialCod.only);
    if (!split) this.payMode = 'cod';
    else if (partialOnly) this.payMode = 'partial';
    var partial = Boolean(split) && this.payMode === 'partial';
    var prevBody = this.sh.querySelector('.bd');
    var scrollTop = prevBody ? prevBody.scrollTop : 0;
    var rows = '<div class="rows">' +
      '<div><span>' + esc(bxT('storefront.cod.items', 'Items')) + '</span><span class="num">' + fmt(q.itemsTotal) + '</span></div>' +
      // Weight combo box price: the same discount Shopify checkout gives (cod.server.js).
      (q.comboDiscount > 0 ? '<div style="color:#067647"><span>' + esc(bxT('storefront.cod.combo_discount', 'Combo box discount')) + '</span><span class="num">−' + fmt(q.comboDiscount) + '</span></div>' : '') +
      // Pack price (Buy 2 / Buy 3 ...): the same discount Shopify checkout gives.
      (q.packDiscount > 0 ? '<div style="color:#067647"><span>' + esc(bxT('storefront.cod.pack_discount', 'Pack discount')) + '</span><span class="num">−' + fmt(q.packDiscount) + '</span></div>' : '') +
      discountRows(q, fmt) +
      chargeRows(this.cfg, q, fmt) +
      (q.tax > 0 && !q.taxesIncluded ? '<div><span>' + esc(bxT('storefront.cod.taxes', 'Taxes')) + '</span><span class="num">' + fmt(q.tax) + '</span></div>' : '') +
      // Part payment: the full amount is the order total, split into Pay now / Pay on delivery below.
      '<div class="tot' + (this.couponJustApplied ? ' flash' : '') + '"><span>' + esc(partial ? bxT('storefront.drawer.total', 'Total') : bxT('storefront.cod.pay_on_delivery', 'Pay on delivery')) + '</span><span class="num">' + fmt(q.total) + '</span></div>' +
      (q.tax > 0 && q.taxesIncluded ? '<div class="mu"><span>' + esc(bxT('storefront.cod.includes_tax', 'Includes {amount} in taxes', { amount: fmt(q.tax) })) + '</span></div>' : '') +
      (partial ? '<div><span>' + esc(bxT('storefront.cod.partial_pay_now', 'Pay now')) + '</span><span class="num">' + fmt(split.advance) + '</span></div>' +
        '<div><span>' + esc(bxT('storefront.cod.pay_on_delivery', 'Pay on delivery')) + '</span><span class="num">' + fmt(split.balance) + '</span></div>' : '') +
      '</div>';
    // The coupon card already shows its saving; this banner is for automatic discounts.
    var autoSaving = (q.comboDiscount || 0) + (q.packDiscount || 0) + (q.coupon && q.coupon.applied ? 0 : q.discounts);
    var save = autoSaving > 0 ? '<div class="save">' + icon('tag', 16) + esc(bxT('storefront.cod.saving_order', 'You\'re saving {amount} on this order', { amount: fmt(autoSaving) })) + '</div>' : '';
    var nudge = this.cfg.prepaidNudgeText && typeof this.opts.onPayOnline === 'function'
      ? '<div class="nud">' + icon('card', 22) + '<div class="cb">' + esc(this.cfg.prepaidNudgeText) + '</div><button type="button" class="b" data-act="online">' + esc(bxT('storefront.cod.pay_online', 'Pay online')) + '</button></div>' : '';
    var ship = '<div class="card plain">' + icon('pin', 20, ' class="ic"') + '<div class="cb"><b>' + esc(a.name) + '</b>' +
      esc(a.address1) + (a.address2 ? ', ' + esc(a.address2) : '') + '<br>' + esc(a.city) + ', ' + esc(a.state) + ' ' + esc(a.pincode) +
      '<br><span dir="ltr">+91 ' + esc(prettyPhone(this.phone)) + '</span></div><button type="button" class="lk" data-go="address">' + esc(bxT('storefront.common.edit', 'Edit')) + '</button></div>';
    var pay = '<div class="pay"><div class="ic">' + icon('cash', 20) + '</div><div class="cb"><b>' + esc(bxT('storefront.cod.title', 'Cash on Delivery')) + '</b>' + esc(bxT('storefront.cod.pay_when_arrives', 'Pay {amount} when your order arrives', { amount: fmt(q.total) })) + '</div>' +
      icon('checkCircle', 22, ' style="color:#12b76a;flex:none"') + '</div>';
    var partialNote = partial ? '<p class="mu" style="margin:0 0 4px;font-size:12.5px">' + esc(bxT('storefront.cod.partial_note', 'You\'ll pay {advance} in the store\'s secure checkout. Keep {balance} ready at delivery.', { advance: split ? fmt(split.advance) : '', balance: split ? fmt(split.balance) : '' })) + '</p>' : '';
    if (partialOnly) {
      // The only way to pay: the advance now online + the rest on delivery.
      pay = '<div class="pay"><div class="ic">' + icon('card', 20) + '</div><div class="cb"><b>' + esc(bxT('storefront.cod.partial_title', 'Part payment')) + '</b>' + esc(bxT('storefront.cod.partial_desc', 'Pay {advance} now online, {balance} on delivery', { advance: fmt(split.advance), balance: fmt(split.balance) })) + '</div>' +
        icon('checkCircle', 22, ' style="color:#12b76a;flex:none"') + '</div>' + partialNote;
    } else if (split) {
      // Two choices: the whole amount on delivery, or the advance now online + the rest on delivery.
      pay = '<button type="button" class="pay" data-act="pay-mode" data-mode="cod" aria-pressed="' + String(!partial) + '"><span class="rd"></span><div class="ic">' + icon('cash', 20) + '</div><div class="cb"><b>' + esc(bxT('storefront.cod.title', 'Cash on Delivery')) + '</b>' + esc(bxT('storefront.cod.pay_when_arrives', 'Pay {amount} when your order arrives', { amount: fmt(q.total) })) + '</div></button>' +
        '<button type="button" class="pay" data-act="pay-mode" data-mode="partial" aria-pressed="' + String(partial) + '"><span class="rd"></span><div class="ic">' + icon('card', 20) + '</div><div class="cb"><b>' + esc(bxT('storefront.cod.partial_title', 'Part payment')) + '</b>' + esc(bxT('storefront.cod.partial_desc', 'Pay {advance} now online, {balance} on delivery', { advance: fmt(split.advance), balance: fmt(split.balance) })) + '</div></button>' +
        partialNote;
    }
    this.frame(bxT('storefront.cod.review_title', 'Review your order'), 'address', 'review',
      this.lineList(q) + this.couponBlock() + save + rows +
      '<div class="ttl">' + esc(bxT('storefront.cod.deliver_to', 'Deliver to')) + '</div>' + ship + this.deliveryBlock() +
      '<div class="ttl">' + esc(bxT('storefront.cod.payment', 'Payment')) + '</div>' + pay + nudge + '<div data-err></div>',
      '<label class="agr"><input type="checkbox" name="policy"' + (this.policyOk ? ' checked' : '') + '>' +
      '<span>' + bxHtml('storefront.cod.agree', 'I agree to the {terms}', 'terms', '<a href="' + esc(termsUrl(this.cfg)) + '" target="_blank" rel="noopener">' + esc(bxT('storefront.cod.terms', 'Terms and conditions')) + '</a>') + '</span></label>' +
      '<button type="submit" class="b p">' + (partial
        ? esc(bxT('storefront.cod.partial_button', 'Pay {amount} now', { amount: fmt(split.advance) }))
        : esc(bxT('storefront.cod.place_order', 'Place COD order')) + ' \u00b7 ' + fmt(q.total)) + '</button>');
    this.submitAction = 'place';
    var body = this.sh.querySelector('.bd');
    if (body) body.scrollTop = scrollTop;
    // e.g. the delivery option changed since the shopper last saw it.
    if (this.reviewNotice) { this.setError(this.reviewNotice); this.reviewNotice = null; }
    if (couponFailed) {
      vibrate(50);
      var field = this.sh.querySelector('[name="coupon"]');
      if (field) { try { field.focus(); field.select(); } catch (e) { /* ignore */ } }
    }
  };

  Sheet.prototype.viewDone = function (order) {
    var fmt = this.fmt;
    var colors = [this.cfg.buttons.bg || '#111827', '#12b76a', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6'];
    var confetti = '';
    for (var i = 0; i < 24; i++) {
      confetti += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + esc(colors[i % colors.length]) +
        ';animation-delay:' + (Math.random() * 0.5).toFixed(2) + 's;width:' + (6 + Math.round(Math.random() * 5)) + 'px"></i>';
    }
    this.sh.innerHTML = this.head(bxT('storefront.cod.order_placed', 'Order placed')) +
      '<div class="bd done"><div class="cf" aria-hidden="true">' + confetti + '</div>' +
      '<div class="tick" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
      '<div style="font-weight:800;font-size:21px;margin-top:8px">' + esc(bxT('storefront.cod.order_confirmed', 'Order confirmed!')) + '</div>' +
      (this.look.thankYouText ? '<p class="mu" style="margin:-6px 0 0;font-size:14px">' + esc(this.look.thankYouText) + '</p>' : '') +
      '<div class="oid">' + esc(bxT('storefront.cod.order_name', 'Order {name}', { name: order.orderName })) + ' <button type="button" data-act="copy" data-copy="' + esc(order.orderName) + '">' + icon('copy', 12) + '<span>' + esc(bxT('storefront.common.copy', 'Copy')) + '</span></button></div>' +
      '<div class="amt"><div class="mu">' + esc(bxT('storefront.cod.keep_amount', 'Keep this amount ready at delivery')) + '</div><div class="big">' + fmt(order.total) + '</div></div>' +
      '<div class="tl">' +
      '<div class="on"><i>' + icon('check', 14) + '</i><span><b>' + esc(bxT('storefront.cod.order_placed', 'Order placed')) + '</b><span class="mu">' + esc(bxT('storefront.cod.store_has_order', 'The store has your order.')) + '</span></span></div>' +
      '<div><i>' + icon('box', 14) + '</i><span><b>' + esc(bxT('storefront.cod.packed_shipped', 'Packed and shipped')) + '</b><span class="mu">' + esc(this.deliveryText() || bxT('storefront.cod.store_sends', 'The store prepares and sends it to you.')) + '</span></span></div>' +
      '<div><i>' + icon('cash', 14) + '</i><span><b>' + esc(bxT('storefront.cod.pay_on_delivery', 'Pay on delivery')) + '</b><span class="mu">' + esc(bxT('storefront.cod.pay_when_it_arrives', 'Pay {amount} when it arrives.', { amount: fmt(order.total) })) + '</span></span></div>' +
      '</div></div><div class="ft">' +
      (order.statusPageUrl ? '<a href="' + esc(order.statusPageUrl) + '" class="b s">' + esc(bxT('storefront.cod.order_status', 'View order status')) + '</a>' : '') +
      '<button type="button" class="b p" data-act="close">' + esc(bxT('storefront.drawer.continue_shopping', 'Continue shopping')) + '</button></div>' + this.powered();
  };

  /* --- events --- */

  Sheet.prototype.onClick = function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t || this.busy) return;
    var go = t.getAttribute('data-go');
    var act = t.getAttribute('data-act');
    if (go) {
      e.preventDefault();
      if (this.view === 'address') this.addr = Object.assign(this.addr, this.readAddress());
      if (this.view === 'review' && go === 'address') this.editAddr = true; // "Edit" means show the form
      this.go(go);
      return;
    }
    if (act === 'close') { this.close(); return; }
    if (act === 'online') {
      var cb = this.opts.onPayOnline;
      this.close();
      if (typeof cb === 'function') { try { cb(); } catch (err) { /* caller */ } }
      return;
    }
    if (act === 'pay-mode') { this.payMode = t.getAttribute('data-mode') === 'partial' ? 'partial' : 'cod'; this.setError(''); this.renderReview(); return; }
    if (act === 'resend') { this.sendCode(true); return; }
    if (act === 'summary') {
      var box = t.closest('.sum');
      this.summaryOpen = !box.classList.contains('open');
      box.classList.toggle('open', this.summaryOpen);
      t.setAttribute('aria-expanded', String(this.summaryOpen));
      return;
    }
    if (act === 'edit-addr') { this.editAddress(); return; }
    if (act === 'coupon-open') {
      this.couponOpen = true;
      this.renderReview();
      var field = this.sh.querySelector('[name="coupon"]');
      if (field) { try { field.focus(); } catch (err) { /* ignore */ } }
      return;
    }
    if (act === 'coupon-apply') { this.applyCoupon(); return; }
    if (act === 'coupon-offer') {
      t.innerHTML = '<span class="sp" style="width:14px;height:14px;border-width:2px;border-top-color:currentColor"></span>';
      this.applyCoupon(t.getAttribute('data-code'));
      return;
    }
    if (act === 'coupon-remove') { this.removeCoupon(); return; }
    if (act === 'dlv' || act === 'dlv-date' || act === 'dlv-slot') { e.preventDefault(); this.pickDelivery(act, t); return; }
    if (act === 'coupon-paste') {
      // Paste and claim in one tap.
      var self = this;
      navigator.clipboard.readText().then(function (text) {
        var code = String(text || '').trim().slice(0, 60);
        var el = self.sh.querySelector('[name="coupon"]');
        if (el) el.value = code;
        if (code) self.applyCoupon(code);
      }, function () {
        var el = self.sh.querySelector('[name="coupon"]');
        if (el) { try { el.focus(); } catch (err) { /* ignore */ } }
      });
      return;
    }
    if (act === 'copy') {
      var label = t.querySelector('span');
      var text = t.getAttribute('data-copy');
      var done = function () { if (label) label.textContent = bxT('storefront.common.copied', 'Copied'); };
      try { navigator.clipboard.writeText(text).then(done, function () { /* blocked */ }); } catch (err) { /* no clipboard */ }
    }
  };

  Sheet.prototype.onInput = function (e) {
    var el = e.target;
    if (el.getAttribute('aria-invalid')) el.removeAttribute('aria-invalid');
    if (el.name !== 'code' && el.name !== 'coupon') this.setError(''); // the code step clears it when the new code is checked
    if (el.name === 'coupon') {
      this.couponDraft = el.value;
      var form = el.closest('.cpn-form');
      if (form) form.classList.remove('bad');
    }
    if (el.name === 'phone' && el.parentNode.classList.contains('pre')) {
      el.parentNode.classList.remove('bad');
      el.parentNode.classList.toggle('valid', Boolean(normalizePhone(el.value)));
    }
    if (el.name === 'pincode') {
      el.value = el.value.replace(/\D/g, '').slice(0, 6);
      if (el.value.length === 6) this.lookupPin(el.value, false);
      else { var note = this.sh.querySelector('[data-pin]'); if (note) note.innerHTML = ''; this.togglePinBlocked(false); }
    }
    if (el.name === 'code') {
      el.value = el.value.replace(/\D/g, '').slice(0, 4);
      if (el.parentNode) el.parentNode.classList.remove('bad', 'shake');
      this.paintOtp();
      if (el.value.length === 4 && !this.busy) this.verifyCode(el.value);
    }
  };

  Sheet.prototype.onSubmit = function () {
    if (this.busy) return;
    if (this.submitAction === 'send') return this.sendCode(false);
    if (this.submitAction === 'verify') {
      var code = this.sh.querySelector('[name="code"]');
      return this.verifyCode(code ? code.value : '');
    }
    if (this.submitAction === 'address') return this.submitAddress();
    if (this.submitAction === 'place') {
      var active = (this.shadow && this.shadow.activeElement) || document.activeElement;
      if (active && active.name === 'coupon') return this.applyCoupon();
      if (this.payMode === 'partial' && this.quote && partialSplit(this.cfg, this.quote)) return this.payPartial();
      return this.placeOrder();
    }
  };

  Sheet.prototype.sendCode = function (isResend) {
    var self = this;
    if (!isResend) {
      var input = this.sh.querySelector('[name="phone"]');
      var phone = normalizePhone(input && input.value);
      if (!phone) { this.setError(bxT('error.cod.invalid_phone', 'Enter a valid 10-digit mobile number.')); this.markInvalid('phone'); return; }
      this.phone = phone;
    }
    this.setError('');
    this.setBusy(true, bxT('storefront.cod.sending', 'Sending\u2026'));
    api('otp', { step: 'send', phone: this.phone }).then(function (json) {
      self.setBusy(false);
      if (!json.success) {
        if (isResend) { self.setError(errorText(json)); self.startResendTimer(); } else self.setError(errorText(json));
        return;
      }
      self.resendAfter = json.resendAfter || 30;
      if (isResend) { self.setError(''); self.startResendTimer(); } else self.go('otp');
    });
  };

  Sheet.prototype.verifyCode = function (code) {
    var self = this;
    if (!/^\d{4}$/.test(code || '')) { this.setError(bxT('error.cod.otp_invalid', 'Enter the 4-digit code from the SMS.')); return; }
    this.setError('');
    this.setBusy(true, bxT('storefront.cod.checking_short', 'Checking\u2026'));
    api('otp', { step: 'verify', phone: this.phone, code: code }).then(function (json) {
      self.setBusy(false);
      var w = self.sh.querySelector('[data-otp]');
      if (!json.success) {
        self.setError(errorText(json));
        vibrate(60);
        if (w) { w.classList.remove('shake'); void w.offsetWidth; w.classList.add('bad', 'shake'); }
        // Leave the wrong digits on screen while the boxes shake, then clear them.
        setTimeout(function () {
          var el = self.sh.querySelector('[name="code"]');
          if (!el || el.value !== code) return;
          el.value = '';
          self.paintOtp();
          try { el.focus(); } catch (e) { /* ignore */ }
        }, 450);
        return;
      }
      self.token = { shop: SHOP, phone: self.phone, token: json.token, expiresAt: Date.now() + 25 * 60000 };
      writeStore('sessionStorage', TOKEN_KEY, self.token);
      self.track('otp_verified');
      clearInterval(self.resendTimer);
      if (w) w.classList.add('good');
      self.busy = true; // hold briefly on the green boxes
      setTimeout(function () { self.busy = false; if (self.view === 'otp') self.go('address'); }, 350);
    });
  };

  Sheet.prototype.submitAddress = function () {
    var a = this.readAddress();
    if (!this.otpFlow()) {
      var phone = normalizePhone(a.phone);
      if (!phone) { this.setError(bxT('error.cod.invalid_phone', 'Enter a valid 10-digit mobile number.')); this.markInvalid('phone'); return; }
      this.phone = phone;
    }
    var err = null, field = null;
    if (a.name.length < 2) { err = bxT('storefront.cod.need_name', 'Enter your full name.'); field = 'name'; }
    else if (a.address1.length < 5) { err = bxT('storefront.cod.need_address', 'Enter your house number, street and area.'); field = 'address1'; }
    else if (!/^[1-9]\d{5}$/.test(a.pincode)) { err = bxT('error.cod.invalid_pincode', 'Enter a valid 6-digit PIN code.'); field = 'pincode'; }
    else if (a.city.length < 2) { err = bxT('storefront.cod.need_city', 'Enter your city.'); field = 'city'; }
    else if (!a.state) { err = bxT('storefront.cod.need_state', 'Choose your state.'); field = 'state'; }
    else if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) { err = bxT('storefront.cod.need_email', 'Enter a valid email address, or leave it empty.'); field = 'email'; }
    else if ((this.cfg.blockedPincodes || []).indexOf(a.pincode) !== -1 || (this.pin && this.pin.pincode === a.pincode && this.pin.blocked)) { err = bxT('storefront.cod.pin_blocked_short', 'Cash on Delivery isn\'t available for PIN code {pin}.', { pin: a.pincode }); field = 'pincode'; }
    if (err) { this.setError(err); this.markInvalid(field); return; }
    delete a.phone;
    this.addr = a;
    writeStore('localStorage', ADDRESS_KEY, Object.assign({}, a, { phone: this.phone }));
    this.track('add_shipping_info');
    this.go('review');
  };

  Sheet.prototype.placeOrder = function () {
    var self = this;
    var policy = this.sh.querySelector('[name="policy"]');
    if (policy && !policy.checked) {
      this.setError(bxT('storefront.cod.need_terms', 'Please agree to the Terms and conditions to place your order.'));
      policy.parentNode.classList.add('bad');
      vibrate(50);
      return;
    }
    this.setError('');
    this.setBusy(true, bxT('storefront.cod.placing', 'Placing your order\u2026'));
    api('order', {
      surface: this.opts.surface,
      items: this.items,
      coupon: this.quote && this.quote.coupon && this.quote.coupon.applied ? this.quote.coupon.code : null,
      attributes: this.opts.attributes || null,
      cartCodes: this.cartCodes,
      cartAttributes: this.cartAttributes,
      idemKey: this.idem,
      phone: this.phone,
      token: this.otpFlow() && this.token ? this.token.token : null,
      address: this.addr,
      delivery: this.delivery,
      track: Track.context(),
    }).then(function (json) {
      self.setBusy(false);
      if (!json.success) {
        if (json.code === 'otp_required') { writeStore('sessionStorage', TOKEN_KEY, null); self.token = null; self.go('phone'); self.setError(errorText(json)); return; }
        // The delivery option, day or time is gone (cut-off passed): show the fresh choices.
        if (json.code === 'delivery_changed') { self.idem = idemKey(); self.reviewNotice = json.error; self.go('review'); return; }
        if (json.code !== 'in_progress') self.idem = idemKey();
        self.setError(errorText(json));
        return;
      }
      self.placed = json.order;
      // Also on a repeated tap (the first answer may have been lost): same ids, so GA4 / Meta count it once.
      self.track('purchase', json.order);
      self.viewDone(json.order);
      var after = self.opts.useCart
        ? window.fetch(ROOT + 'cart/clear.js', { method: 'POST', headers: { Accept: 'application/json' }, credentials: 'same-origin' }).catch(function () { return null; })
        : Promise.resolve();
      after.then(function () {
        try { document.dispatchEvent(new CustomEvent('brix:cod:order', { detail: json.order })); } catch (e) { /* old browsers */ }
        if (typeof self.opts.onSuccess === 'function') { try { self.opts.onSuccess(json.order); } catch (e) { /* caller UI only */ } }
      });
    });
  };

  // Partial COD: the app server prices the order like a COD order and makes a
  // one-time code that leaves only the advance to pay (app/services/
  // partial-cod.server.js). Shopify checkout then opens for these items with
  // the code, the shopper's address filled in, and the _brix_partial_cod
  // attribute (BRIX's payment customization hides Cash on Delivery there, so
  // the advance is paid online). When the order comes in, BRIX adds the rest
  // back as "Balance payable on delivery" and Shopify shows it Partially paid.
  Sheet.prototype.payPartial = function () {
    var self = this;
    var policy = this.sh.querySelector('[name="policy"]');
    if (policy && !policy.checked) {
      this.setError(bxT('storefront.cod.need_terms', 'Please agree to the Terms and conditions to place your order.'));
      policy.parentNode.classList.add('bad');
      vibrate(50);
      return;
    }
    this.setError('');
    this.setBusy(true, bxT('storefront.cod.opening_checkout', 'Opening secure checkout\u2026'));
    api('partial-cod', {
      surface: this.opts.surface,
      items: this.items,
      coupon: this.quote && this.quote.coupon && this.quote.coupon.applied ? this.quote.coupon.code : null,
      cartCodes: this.cartCodes,
      cartAttributes: this.cartAttributes,
      address: this.addr,
      delivery: this.delivery,
    }).then(function (json) {
      if (!json.success || !json.code) {
        self.setBusy(false);
        if (json.code === 'delivery_changed') { self.reviewNotice = json.error; self.go('review'); return; }
        self.setError(errorText(json));
        return;
      }
      window.location.href = partialCheckoutUrl(self.items, json, self.addr, self.phone);
    });
  };

  // The Shopify checkout of a Partial COD order: a cart permalink for exactly
  // these items, with the code, the address filled in and the attribute that
  // keeps Cash on Delivery off that checkout.
  function partialCheckoutUrl(items, res, addr, phone) {
    var merged = {};
    var order = [];
    (items || []).forEach(function (it) {
      var id = String(it.variantId || it.id || '');
      if (!/^\d+$/.test(id)) return;
      if (!merged[id]) { merged[id] = 0; order.push(id); }
      merged[id] += Number(it.quantity) || 1;
    });
    var a = addr || {};
    var name = String(a.name || '').trim().split(/\s+/);
    var first = name.shift() || '';
    var params = [
      ['discount', res.code],
      ['attributes[_brix_partial_cod]', String(res.advance)],
      ['checkout[email]', a.email || ''],
      ['checkout[shipping_address][first_name]', first],
      ['checkout[shipping_address][last_name]', name.join(' ') || first],
      ['checkout[shipping_address][address1]', a.address1 || ''],
      ['checkout[shipping_address][address2]', a.address2 || ''],
      ['checkout[shipping_address][city]', a.city || ''],
      ['checkout[shipping_address][province]', a.state || ''],
      ['checkout[shipping_address][zip]', a.pincode || ''],
      ['checkout[shipping_address][country]', 'IN'],
      ['checkout[shipping_address][phone]', phone ? '+91' + phone : ''],
    ].filter(function (pair) { return pair[1]; });
    return ROOT + 'cart/' + order.map(function (id) { return id + ':' + merged[id]; }).join(',') + '?' +
      params.map(function (pair) { return encodeURIComponent(pair[0]).replace(/%5B/g, '[').replace(/%5D/g, ']') + '=' + encodeURIComponent(pair[1]); }).join('&');
  }

  /* ---------- public: open ---------- */

  // opts: { surface: 'drawer'|'product'|'combo', items?, useCart?, coupon?, attributes?,
  //         onPayOnline?, onSuccess?, onClosedAfterOrder? }
  function open(opts) {
    opts = opts || {};
    if (sheet) return;
    loadConfig().then(function (cfg) {
      if (!cfg || cfg.surfaces[opts.surface] === false) {
        if (typeof opts.onPayOnline === 'function') opts.onPayOnline();
        return;
      }
      var itemsPromise = opts.useCart
        ? fetchCart().then(function (cart) {
          if (cartHasCheckoutOnlyLines(cart)) return { checkoutOnly: true };
          return { items: cartItems(cart), cartCodes: cartDiscountCodes(cart, opts.coupon), cartAttributes: cart.attributes || null };
        })
        : Promise.resolve({ items: opts.items || [] });
      sheet = new Sheet(opts, cfg);
      sheet.loading(bxT('storefront.cod.checking', 'Checking Cash on Delivery\u2026'));
      itemsPromise.then(function (res) {
        if (!sheet) return;
        if (res.checkoutOnly) { sheet.fail(bxT('error.cod.checkout_only', 'This cart has a free gift that is only available with online payment.')); return; }
        if (!res.items.length) { sheet.fail(bxT('storefront.cod.cart_empty', 'Your cart is empty.')); return; }
        sheet.items = res.items;
        sheet.cartCodes = res.cartCodes || [];
        sheet.cartAttributes = res.cartAttributes || null;
        sheet.start();
      }, function () { if (sheet) sheet.fail(bxT('storefront.cod.cart_read_failed', 'We couldn\'t read your cart. Refresh the page and try again.')); });
    });
  }

  /* ---------- cart drawer button ---------- */

  // Inline declarations, all !important: theme CSS for `button` (uppercase,
  // letter-spacing, min-height, shadows, hover colours) must not change the
  // button from what the merchant sees in the BRIX preview.
  function important(rules) {
    return rules.split(';').filter(Boolean).map(function (r) { return r + ' !important;'; }).join('');
  }

  var BUTTON_STYLES = ['filled', 'outline', 'minimal'];

  // The COD button look for one place ('drawer' | 'product' | 'combo'):
  // { style, bg, color, radius, fontSize, bold, uppercase, icon }, as
  // resolved by php_backend/cod_storefront.php (buttons.looks). Settings
  // served before per-place looks existed fall back to the one shared look.
  function lookOf(cfg, surface) {
    var b = cfg.buttons || {};
    var l = b.looks && b.looks[surface];
    if (l) return l;
    return { style: b.style, bg: b.bg, color: b.color, radius: b.radius, fontSize: 15, bold: true, uppercase: false, icon: true, paddingY: 14, paddingX: 16 };
  }

  // Colours for a button style. Outline and Minimal draw the text in the
  // button colour. The outline is an inset shadow, so all three styles are
  // exactly the same size.
  function buttonPaint(look) {
    var style = BUTTON_STYLES.indexOf(look.style) !== -1 ? look.style : 'filled';
    if (style === 'outline') return 'background:transparent;color:' + esc(look.bg) + ';box-shadow:inset 0 0 0 1.5px ' + esc(look.bg) + ';';
    if (style === 'minimal') return 'background:transparent;color:' + esc(look.bg) + ';box-shadow:none;';
    return 'background:' + esc(look.bg) + ';color:' + esc(look.color) + ';box-shadow:none;';
  }

  // Font size, weight and capitals of a look.
  function buttonType(look) {
    var size = Math.max(12, Math.min(22, Math.round(Number(look.fontSize)) || 15));
    return 'font-size:' + size + 'px;font-weight:' + (look.bold === false ? '500' : '700') + ';' +
      'text-transform:' + (look.uppercase ? 'uppercase' : 'none') + ';letter-spacing:' + (look.uppercase ? '.04em' : 'normal') + ';';
  }

  // size: { marginTop, marginBottom, paddingY, paddingX, radius } in px.
  // opts: { look } (the place's look, default the cart drawer's), and for the
  // payment options' Pay Online button { paint, icon, attr }.
  function buttonHtml(cfg, label, sub, disabled, size, opts) {
    var z = size;
    var o = opts || {};
    var look = o.look || lookOf(cfg, 'drawer');
    var iconName = o.icon || (look.icon === false ? '' : 'cash');
    return '<button type="button" ' + (o.attr || 'data-brix-cod-btn') + (disabled ? ' disabled' : '') + ' style="' + important(
      'box-sizing:border-box;width:100%;max-width:100%;min-width:0;height:auto;min-height:0;' +
      'margin:' + z.marginTop + 'px 0 ' + z.marginBottom + 'px 0;padding:' + z.paddingY + 'px ' + z.paddingX + 'px;' +
      (o.paint || buttonPaint(look)) + 'border:none;border-radius:' + z.radius + 'px;' +
      'text-shadow:none;outline-offset:2px;appearance:none;-webkit-appearance:none;' +
      'font-family:inherit;line-height:1.25;text-decoration:none;text-align:center;' + buttonType(look) +
      'cursor:' + (disabled ? 'not-allowed' : 'pointer') + ';opacity:' + (disabled ? '0.5' : '1') + ';' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px') + '">' +
      '<span style="' + important('display:inline-flex;align-items:center;gap:8px;color:inherit;font:inherit;text-transform:inherit;letter-spacing:inherit') + '">' +
      (iconName ? icon(iconName, 18, ' style="flex:none;width:18px;height:18px"') : '') +
      '<span data-brix-cod-label style="' + important('color:inherit;font:inherit;text-transform:inherit;letter-spacing:inherit') + '">' + esc(label) + '</span></span>' +
      (sub ? '<span data-brix-cod-sub style="' + important('font-size:11.5px;font-weight:500;opacity:.85;color:inherit;text-transform:none;letter-spacing:normal') + '">' + esc(sub) + '</span>' : '') + '</button>';
  }

  // The combo page's COD button, for combo-page.js (it draws its own button
  // in its own bar): { text, css } — css = colours, corners and type, or
  // null when COD isn't available.
  function comboButton() {
    return loadConfig().then(function (cfg) {
      if (!cfg || !cfg.enabled || cfg.surfaces.combo === false) return null;
      var look = lookOf(cfg, 'combo');
      var r = Math.max(0, Math.min(40, Math.round(Number(look.radius)) || 0));
      var text = bxText(cfg.buttons && cfg.buttons.comboText, 'storefront.cod.button', 'Cash on Delivery');
      return {
        text: text,
        // The text for the combo's price, with its price tags filled in.
        label: function (price) { return codLabel(cfg, text, price); },
        // Where it goes next to the combo's Checkout: replace | above | below.
        placement: PLACEMENTS.indexOf(cfg.comboPlacement) !== -1 ? cfg.comboPlacement : 'below',
        codFee: cfg.codFee > 0 ? Number(cfg.codFee) : 0,
        // The fee for the combo's price (a % of it on large orders, if set).
        feeFor: function (price) { return codFeeFor(cfg, price); },
        icon: look.icon !== false ? icon('cash', 16, ' style="flex:none;width:16px;height:16px"') : '',
        css: buttonPaint(look) + 'border:none;border-radius:' + r + 'px;' + buttonType(look),
      };
    });
  }

  // "+₹40 Cash on Delivery Fee" under the button, unless the merchant hides
  // the fee; `price` = the order it's for (a % fee needs it).
  function feeHint(cfg, fmt, price, ids) {
    var fee = codFeeFor(cfg, price, ids);
    return fee > 0 && cfg.showCodFee !== false ? '+' + fmt(fee) + ' ' + feeLabel(cfg) : '';
  }

  var PLACEMENTS = ['replace', 'above', 'below'];
  function placementOf(cfg) { return PLACEMENTS.indexOf(cfg.drawerPlacement) !== -1 ? cfg.drawerPlacement : 'above'; }

  // Drawer button sizes; the gap (default 10px) is on the side that faces
  // Checkout. The BRIX drawer passes its Phone layout gap on phones.
  function drawerSize(cfg, where, gap) {
    var look = lookOf(cfg, 'drawer');
    var g = isFinite(gap) && gap !== null ? Math.max(0, Math.min(24, Math.round(gap))) : 10;
    var r = Math.round(Number(look.radius));
    var py = Math.round(Number(look.paddingY));
    var px = Math.round(Number(look.paddingX));
    return {
      marginTop: where === 'below' ? g : 0,
      marginBottom: where === 'above' ? g : 0,
      paddingY: isFinite(py) ? Math.max(4, Math.min(32, py)) : 14,
      paddingX: isFinite(px) ? Math.max(4, Math.min(48, px)) : 16,
      radius: isFinite(r) ? Math.max(0, Math.min(40, r)) : 12,
    };
  }

  /* --- "Continue shopping" next to Pay now + COD (COD → Customize → Cart drawer) --- */

  // cfg.drawerContinue as cod_storefront.php cods_continue() sends it (same
  // rules as app/utils/continue-shopping.shared.js), or null when it's off.
  function continueLook(cfg) {
    var d = cfg && cfg.drawerContinue;
    if (!d || d.enabled !== true) return null;
    var hex = function (v, def) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '')) ? String(v) : def; };
    var num = function (v, def, min, max) { var n = Math.round(Number(v)); return isFinite(n) ? Math.max(min, Math.min(max, n)) : def; };
    var url = String(d.url || '');
    return {
      text: String(d.text || '') || 'Continue shopping',
      placement: d.placement === 'above' ? 'above' : 'below',
      style: ['outline', 'filled', 'link'].indexOf(d.style) !== -1 ? d.style : 'outline',
      bg: hex(d.bg, '#111827'),
      color: hex(d.color, '#ffffff'),
      fontSize: num(d.fontSize, 14, 11, 20),
      radius: num(d.radius, 8, 0, 40),
      paddingY: num(d.paddingY, 12, 4, 24),
      action: d.action === 'link' ? 'link' : 'close',
      url: /^https:\/\/[^\s<>"'\\]+$/i.test(url) || /^\/(?!\/)[^\s<>"'\\]*$/.test(url) ? url : '',
    };
  }

  function continueHtml(cs) {
    var link = cs.style === 'link';
    var paint = cs.style === 'filled'
      ? 'background:' + cs.bg + ';color:' + cs.color + ';box-shadow:none;'
      : 'background:transparent;color:' + cs.bg + ';box-shadow:' + (link ? 'none' : 'inset 0 0 0 1.5px ' + cs.bg) + ';';
    return '<button type="button" data-brix-cod-continue-btn style="' + important(
      'box-sizing:border-box;width:100%;max-width:100%;min-width:0;height:auto;min-height:0;display:block;' +
      'margin:' + (cs.placement === 'above' ? '0 0 10px 0' : '10px 0 0 0') + ';' +
      'padding:' + (link ? Math.max(2, Math.round(cs.paddingY / 2)) + 'px 8px' : cs.paddingY + 'px 16px') + ';' +
      paint + 'border:none;border-radius:' + (link ? 0 : cs.radius) + 'px;text-shadow:none;appearance:none;-webkit-appearance:none;' +
      'font-family:inherit;font-size:' + cs.fontSize + 'px;font-weight:600;line-height:1.25;letter-spacing:normal;text-transform:none;' +
      'text-align:center;text-decoration:' + (link ? 'underline' : 'none') + ';text-underline-offset:3px;cursor:pointer;opacity:1') + '">' +
      esc(bxText(cs.text, 'storefront.drawer.continue_shopping', 'Continue shopping')) + '</button>';
  }

  // Puts `el` above the first or below the last of `group` (the Checkout
  // button and the COD slot, wherever the COD placement put them).
  function placeContinue(el, where, group) {
    var list = group.filter(function (n) { return n && n.parentNode; });
    if (!list.length) return;
    var first = list[0];
    var last = list[0];
    list.forEach(function (n) {
      if (first.compareDocumentPosition(n) & 2) first = n; // n comes before
      if (last.compareDocumentPosition(n) & 4) last = n; // n comes after
    });
    if (where === 'above') { if (el.nextSibling !== first) first.parentNode.insertBefore(el, first); }
    else if (last.nextSibling !== el) last.parentNode.insertBefore(el, last.nextSibling);
  }

  // Draws (or removes, cs = null) the Continue shopping button of one drawer.
  // holder = { cont } keeps the element between paints.
  function paintContinue(holder, cs, group, onTap) {
    if (!cs) {
      if (holder.cont && holder.cont.parentNode) holder.cont.parentNode.removeChild(holder.cont);
      holder.cont = null;
      return;
    }
    if (!holder.cont) {
      holder.cont = document.createElement('div');
      holder.cont.setAttribute('data-brix-cod-continue', '');
      holder.cont.style.cssText = important('display:block;width:100%;margin:0;padding:0;flex:1 0 100%');
    }
    holder.cont.innerHTML = continueHtml(cs);
    placeContinue(holder.cont, cs.placement, group);
    var btn = holder.cont.querySelector('[data-brix-cod-continue-btn]');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (cs.action === 'link') { goTo(cs.url || '/collections/all'); return; }
      onTap(cs);
    });
  }

  // A store path (under the market's route root) or an https link.
  function goTo(href) {
    window.location.href = /^https:\/\//i.test(href) ? href : ROOT.replace(/\/$/, '') + href;
  }

  // Closes the theme's own drawer: its close button, else Escape (most
  // drawers listen for it), else the page the link would open.
  var THEME_CLOSE = '[data-drawer-close], [data-cart-close], .drawer__close, .cart-drawer__close, button[name="close"], ' +
    'button[aria-label*="close" i], a[aria-label*="close" i], button[class*="close"], a[class*="close"], [role="button"][class*="close"]';
  function closeThemeDrawer(checkout) {
    var drawer = themeDrawerOf(checkout) || (checkout.closest && checkout.closest('[role="dialog"], dialog'));
    var btns = drawer ? drawer.querySelectorAll(THEME_CLOSE) : [];
    for (var i = 0; i < btns.length; i++) {
      if (!btns[i].closest(BRIX_UI) && isShown(btns[i])) { btns[i].click(); return; }
    }
    var esc27 = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true };
    try {
      (drawer || document).dispatchEvent(new KeyboardEvent('keydown', esc27));
      document.dispatchEvent(new KeyboardEvent('keydown', esc27));
    } catch (e) { /* old browser */ }
    setTimeout(function () { if (checkout.isConnected && isShown(checkout)) goTo('/collections/all'); }, 400);
  }

  /* --- excluded product tags --- */

  var tagCache = {};
  // Tags of a product, from the storefront's own /products/<handle>.js (cached per page).
  function tagsOf(handle) {
    if (!tagCache[handle]) {
      tagCache[handle] = window.fetch(ROOT + 'products/' + encodeURIComponent(handle) + '.js', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) { return p ? (Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(',')) : []; })
        .catch(function () { return []; });
    }
    return tagCache[handle];
  }

  function excludedTags(cfg) {
    return (cfg.excludedProductTags || []).map(function (t) { return String(t).trim().toLowerCase(); }).filter(Boolean);
  }

  function hasExcludedTag(tags, excluded) {
    return (tags || []).some(function (t) { return excluded.indexOf(String(t).trim().toLowerCase()) !== -1; });
  }

  // Does any product in the cart carry one of the merchant's excluded tags?
  // Only a display hint: the server checks the real tags again for every quote.
  function cartHasExcluded(cfg, cart) {
    var excluded = excludedTags(cfg);
    var handles = [];
    ((cart && cart.items) || []).forEach(function (it) { if (it.handle && handles.indexOf(it.handle) === -1) handles.push(it.handle); });
    if (!excluded.length || !handles.length) return Promise.resolve(false);
    return Promise.all(handles.map(tagsOf)).then(function (lists) {
      return lists.some(function (tags) { return hasExcludedTag(tags, excluded); });
    });
  }

  /* --- one drawer button, shared by the BRIX drawer and theme drawers --- */

  // What the drawer's COD button shows for this cart: null = no button,
  // { reason } = shown but unavailable, else { sub } = usable.
  function drawerState(cfg, cart, excluded, fmt) {
    var items = (cart && cart.items) || [];
    if (!items.length) return null;
    if (excluded) return cfg.excludedBehavior === 'hide' ? null : { reason: bxT('storefront.cod.not_for_some_items', 'Not available for some items in your cart') };
    var subtotal = items.reduce(function (sum, it) {
      var p = it.properties || {};
      return p._brixReward === 'true' ? sum : sum + (Number(it.final_line_price) || 0);
    }, 0) / 100;
    var reason = '';
    if (cartHasCheckoutOnlyLines(cart)) reason = bxT('storefront.cod.not_with_packs', 'Not available with free gifts');
    else if (cfg.minOrder > 0 && subtotal < cfg.minOrder) reason = bxT('storefront.cod.min_order', 'Available on orders from {amount}', { amount: fmt(cfg.minOrder) });
    else if (cfg.maxOrder > 0 && subtotal > cfg.maxOrder) reason = bxT('storefront.cod.max_order', 'Available on orders up to {amount}', { amount: fmt(cfg.maxOrder) });
    // total: what the cart costs after its discounts (shown in price tags).
    // codTotal: the same without the prepaid discount, which COD never gets.
    var total = isFinite(Number(cart.total_price)) ? Number(cart.total_price) / 100 : subtotal;
    var codTotal = Math.round((total + prepaidInCart(cart)) * 100) / 100;
    // "Create the discount" off: the cart has no prepaid discount of BRIX's,
    // so the online price ("Pay now {price}") shows it taken off here.
    var shownSaving = prepaidShownSaving(cart);
    total = Math.round((total - shownSaving) * 100) / 100;
    var saving = Math.round((codTotal - total) * 100) / 100;
    var ids = cartProductIds(cart);
    return reason ? { reason: reason, subtotal: subtotal, total: total, codTotal: codTotal, saving: saving, ids: ids } : { sub: showsCodFee(cfg.buttons.drawerText) ? '' : feeHint(cfg, fmt, codTotal, ids), subtotal: subtotal, total: total, codTotal: codTotal, saving: saving, ids: ids };
  }

  // Show-only prepaid (paymentValue.prepaid.showOnly): the saving the online
  // price shows, worked out like the Function (paid lines only, never gifts
  // or combo boxes, the minimum and the cap). Collections left out of it can't
  // be told from the cart, so they aren't; products left out one by one are.
  // 0 when BRIX creates the discount.
  function prepaidShownSaving(cart) {
    var pre = paymentValue && paymentValue.prepaid;
    if (!pre || !pre.showOnly || !cart) return 0;
    var leftOut = (Array.isArray(pre.excludedProducts) ? pre.excludedProducts : []).map(String);
    var base = (cart.items || []).reduce(function (sum, it) {
      var p = it.properties || {};
      if (leftOut.indexOf(String(it.product_id)) !== -1) return sum;
      return p._brixReward === 'true' || p._brixReward === true || p._brix_combo_id ? sum : sum + (Number(it.final_line_price) || 0);
    }, 0) / 100;
    if (!(base > 0) || (pre.minSubtotal > 0 && base < pre.minSubtotal)) return 0;
    var saving = Math.round(base * Number(pre.percent)) / 100;
    if (pre.maxDiscount > 0 && saving > pre.maxDiscount) saving = pre.maxDiscount;
    return saving;
  }

  // Price tags in the BRIX Cart Drawer's own Checkout text (Cart Editor →
  // Checkout Button, e.g. "Pay {prepaid_price}"), for a cart whose total the
  // drawer shows as `total`: {price} = that total, {prepaid_price} = it after
  // the prepaid discount (already off when Shopify applies BRIX's; taken off
  // here when it's show only), {saving} = the prepaid saving, {cod_fee} /
  // {cod_price} = the COD fee and the COD total (only with COD on). ready =
  // the settings have loaded; codText = COD → Customize's checkout text is
  // set and draws the label instead (relabelBrixCheckout).
  function priceTagValues(cart, total) {
    var t = Number(total);
    if (!isFinite(t)) t = cart && isFinite(Number(cart.total_price)) ? Number(cart.total_price) / 100 : 0;
    var inCart = prepaidInCart(cart);
    var shown = prepaidShownSaving(cart);
    var saving = Math.round((inCart + shown) * 100) / 100;
    var cfg = configValue || null;
    var codBase = Math.round((t + inCart) * 100) / 100;
    var fee = cfg ? codFeeFor(cfg, codBase, cartProductIds(cart)) : null;
    return {
      price: t,
      prepaid_price: Math.round((t - shown) * 100) / 100,
      saving: saving > 0 ? saving : null,
      cod_fee: cfg ? fee : null,
      cod_price: cfg ? Math.round((codBase + fee) * 100) / 100 : null,
      ready: configValue !== undefined,
      codText: Boolean(cfg && cfg.drawerCheckoutText && cfg.surfaces && cfg.surfaces.drawer !== false),
    };
  }

  // The BRIX prepaid discount (product page payment options) is a Shopify
  // order discount, so the cart's total already has it taken off, under the
  // merchant's title (the Function's message). COD orders never get it
  // (cod.server.js), so the drawer's COD price adds it back. Without a title
  // from an older cod_storefront.php: the default title or the same percent.
  function prepaidInCart(cart) {
    var pre = paymentValue && paymentValue.prepaid;
    if (!pre || !cart) return 0;
    var title = pre.title || 'Prepaid discount';
    return (cart.cart_level_discount_applications || []).reduce(function (sum, d) {
      var mine = d.title === title || (!pre.title && d.value_type === 'percentage' && Number(d.value) === Number(pre.percent));
      return mine ? sum + (Number(d.total_allocated_amount) || 0) : sum;
    }, 0) / 100;
  }

  // "Replace Checkout" hides the drawer's Checkout with a stylesheet rule, so
  // it comes back the moment the attribute is removed.
  var REPLACED = 'data-brix-cod-replaced';
  function setReplaced(el, on) {
    if (!el) return;
    if (!on) { if (el.hasAttribute(REPLACED)) el.removeAttribute(REPLACED); return; }
    if (!document.getElementById('brix-cod-replaced-style')) {
      var style = document.createElement('style');
      style.id = 'brix-cod-replaced-style';
      style.textContent = '[' + REPLACED + ']{display:none !important}';
      document.head.appendChild(style);
    }
    el.setAttribute(REPLACED, '');
  }

  // Draws the COD button into `slot` next to a drawer's Checkout, where the
  // merchant chose. `place` = { anchor, checkout }: the slot goes before or
  // after `anchor`; `checkout` is what "Replace Checkout" hides. Checkout is
  // only hidden while a usable COD button shows: when COD can't be used for
  // this cart, shoppers always keep their normal Checkout.
  function paintDrawerSlot(slot, cfg, state, place, onOpen, gap) {
    var where = placementOf(cfg);
    var replace = where === 'replace' && Boolean(state && !state.reason && place);
    if (place && place.anchor && place.anchor.parentNode) {
      var a = place.anchor;
      if (where === 'below') { if (a.nextSibling !== slot) a.parentNode.insertBefore(slot, a.nextSibling); }
      else if (slot.nextSibling !== a) a.parentNode.insertBefore(slot, a);
    }
    if (!state) {
      slot.innerHTML = '';
      setReplaced(place && place.checkout, false);
      return;
    }
    var size = drawerSize(cfg, replace ? 'replace' : where === 'replace' ? 'above' : where, gap);
    slot.innerHTML = buttonHtml(cfg, codLabel(cfg, drawerText(cfg), codPrice(state), state.ids), state.reason || state.sub, Boolean(state.reason), size, { look: lookOf(cfg, 'drawer') });
    setReplaced(place && place.checkout, replace);
    var btn = slot.querySelector('[data-brix-cod-btn]');
    if (btn && !state.reason) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        onOpen();
      });
    }
  }

  // Renders the COD button into `slot` inside the BRIX cart drawer.
  // opts: { cart, coupon, checkout, onPayOnline, onSuccess }; `checkout` is
  // the element holding the BRIX drawer's Checkout button.
  function mountDrawerButton(slot, opts) {
    if (!slot) return;
    var checkout = opts.checkout || null;
    var held = {};
    function paint(cfg, excluded) {
      if (!slot.isConnected) return;
      if (!cfg || cfg.surfaces.drawer === false) { slot.innerHTML = ''; setReplaced(checkout, false); setReplaced(opts.continueWrap, false); paintContinue(held, null); return; }
      var state = drawerState(cfg, opts.cart, excluded, buttonMoney(cfg.currency));
      relabelBrixCheckout(checkout, cfg, state);
      paintDrawerSlot(slot, cfg, state, checkout ? { anchor: checkout, checkout: checkout } : null, function () {
        open({ surface: 'drawer', useCart: true, coupon: opts.coupon, onPayOnline: opts.onPayOnline, onSuccess: opts.onSuccess });
      }, opts.gap);
      // COD's Continue shopping takes the place of the Cart Editor's one.
      var cs = opts.cart && opts.cart.items && opts.cart.items.length ? continueLook(cfg) : null;
      setReplaced(opts.continueWrap, Boolean(cs));
      paintContinue(held, cs, [slot, checkout], function () { if (opts.onContinue) opts.onContinue(); });
    }
    function run(cfg) {
      if (!cfg || cfg.surfaces.drawer === false || !excludedTags(cfg).length) { paint(cfg, false); return; }
      cartHasExcluded(cfg, opts.cart).then(function (ex) { paint(cfg, ex); });
    }
    if (configValue !== undefined) run(configValue);
    else loadConfig().then(run);
  }

  /* ---------- the theme's own cart drawer ---------- */

  // COD works without the BRIX Cart Drawer: when that drawer is off, the
  // button is added to the theme's own drawer, next to its Checkout button.
  //
  // Cart drawers of Shopify themes, by element, id or class: Dawn and the
  // other free themes (<cart-drawer>, #CartDrawer), Horizon, Impulse,
  // Prestige, Impact, Focal, Broadcast, Symmetry, Turbo and most others.
  // Only Checkout buttons inside one of these get a COD button, so the cart
  // page and other forms are left alone. A merchant whose theme isn't found
  // can give the Checkout button's selector in BRIX (cfg.drawerSelector).
  var THEME_DRAWER = [
    'cart-drawer', 'cart-drawer-component', 'side-cart', 'mini-cart', 'sidebar-cart',
    '#CartDrawer', '#mini-cart', '#sidebar-cart', '#side-cart', '#CartSidebar',
    '[data-cart-drawer]', '.drawer--cart', '.ajax-cart',
    '[id*="cart-drawer" i]', '[id*="CartDrawer"]', '[class*="cart-drawer"]', '[class*="mini-cart"]', '[class*="minicart"]',
    '[class*="cart-sidebar"]', '[class*="side-cart"]', '[class*="sidecart"]',
  ].join(',');
  var THEME_CHECKOUT = [
    'button[name="checkout"]', 'input[type="submit"][name="checkout"]', '#CartDrawer-Checkout', '.cart__checkout-button',
    'a[href$="/checkout"]', 'a[href*="/checkout?"]',
  ].join(',');
  // Shop Pay / Google Pay buttons and BRIX's own UI are never a "Checkout".
  var NOT_CHECKOUT = '.additional-checkout-buttons, .dynamic-checkout__content, .shopify-payment-button, shopify-accelerated-checkout-cart, shopify-accelerated-checkout, [data-shopify-buttoncontainer]';
  var BRIX_UI = '#cc-root, #cc-overlay, [data-cart-ninja-drawer], [data-brix-cod-sheet], [data-brix-cod-drawer], [data-brix-cod-continue]';
  var LAYOUT = /^(HTML|BODY|MAIN)$/;

  // The outermost drawer around `el` (page-level wrappers never count, in
  // case a theme puts a class like "side-cart-enabled" on <body>).
  function themeDrawerOf(el) {
    var d = el.closest(THEME_DRAWER);
    if (!d || LAYOUT.test(d.tagName)) return null;
    var up = d.parentElement && d.parentElement.closest(THEME_DRAWER);
    while (up && !LAYOUT.test(up.tagName)) {
      d = up;
      up = d.parentElement && d.parentElement.closest(THEME_DRAWER);
    }
    return d;
  }

  // One Checkout button per drawer, in page order.
  function findThemeCheckouts(cfg) {
    var custom = cfg.drawerSelector || '';
    var nodes;
    try { nodes = document.querySelectorAll(custom || THEME_CHECKOUT); } catch (e) { nodes = []; }
    var found = [];
    var drawers = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest(BRIX_UI)) continue;
      if (!custom) {
        if (el.closest(NOT_CHECKOUT)) continue;
        var drawer = themeDrawerOf(el);
        if (!drawer || drawers.indexOf(drawer) !== -1) continue;
        drawers.push(drawer);
      }
      found.push(el);
    }
    return found;
  }

  // Where the slot goes: next to the Checkout button, or next to its row
  // when Checkout shares a side-by-side row (flex/grid) with other buttons,
  // so the COD button gets its own full-width line instead of squeezing in.
  function anchorFor(btn) {
    var drawer = themeDrawerOf(btn); // never climb out of the drawer itself
    var el = btn;
    for (var i = 0; i < 3; i++) {
      var p = el.parentElement;
      if (!p || p === drawer || LAYOUT.test(p.tagName) || p.tagName === 'FORM') break;
      var cs = window.getComputedStyle(p);
      var row = /flex/.test(cs.display) && cs.flexDirection.indexOf('row') === 0 && cs.flexWrap === 'nowrap';
      var grid = /grid/.test(cs.display) && cs.gridTemplateColumns.trim().split(/\s+/).length > 1;
      if (!row && !grid) break;
      el = p;
    }
    return el;
  }

  var themeMounts = []; // [{ checkout, anchor, slot }]
  var themeCart = null;
  var themeExcluded = false;
  var themeSeq = 0;

  function newThemeSlot() {
    var slot = document.createElement('div');
    slot.setAttribute('data-brix-cod-drawer', '');
    slot.style.cssText = important('display:block;width:100%;margin:0;padding:0;flex:1 0 100%');
    return slot;
  }

  function unmountTheme(m) {
    if (m.slot.parentNode) m.slot.parentNode.removeChild(m.slot);
    paintContinue(m, null);
    setReplaced(m.checkout, false);
  }

  /* ---------- "Pay online": Shopify, or Shiprocket where the shop has it on ---------- */

  // cart_drawer_inline.js sets window.__brixShiprocket from the shop's
  // integration switch (php_backend/integrations_admin.php) once its settings
  // load, then fires brix:drawer:ready. A tap usually comes long after; wait
  // up to 1.5 s otherwise, then go on with what's known.
  function whenCheckoutKnown(cb) {
    if (typeof window.__brixShiprocket === 'boolean' || window.__brixCartDrawerActive !== undefined) { cb(); return; }
    var done = false;
    function go() { if (!done) { done = true; cb(); } }
    document.addEventListener('brix:drawer:ready', go, { once: true });
    setTimeout(go, 1500);
  }

  // window.BrixCheckout = brix_checkout.js (same app embed): opens
  // Shiprocket and falls back to the given Shopify URL if it can't.
  function shiprocketOn() {
    return window.__brixShiprocket === true && window.BrixCheckout && typeof window.BrixCheckout.checkoutCart === 'function';
  }

  // Pay online for exactly these items (product page): Shiprocket with just
  // them, else a Shopify checkout with just them.
  // opts.prepaid: the product page's prepaid saving is on offer. Shopify
  // checkout gives it by itself (the BRIX prepaid discount Function), but
  // Shiprocket can't run Functions, so it gets a one-time Shopify code for it
  // (app/services/prepaid-code.server.js). If the code can't be made, Shopify
  // checkout, where the promised saving still applies.
  var payingOnline = false;
  function payOnlineItems(items, opts) {
    var url = ROOT + 'cart/' + items.map(function (it) { return it.variantId + ':' + it.quantity; }).join(',');
    var list = items.map(function (it) { return { variantId: Number(it.variantId), quantity: Number(it.quantity) || 1 }; });
    if (payingOnline) return;
    payingOnline = true;
    setTimeout(function () { payingOnline = false; }, 10000);
    whenCheckoutKnown(function () {
      if (!shiprocketOn()) { window.location.href = url; return; }
      var code = opts && opts.prepaid ? api('prepaid-code', { items: list }) : Promise.resolve({ success: true, code: null });
      code.then(function (json) {
        if (!json || !json.success) { window.location.href = url; return; }
        window.BrixCheckout.checkoutItems({
          items: list,
          coupon: json.code || null,
          fallbackUrl: url, // Shopify checkout gives the saving through the Function
          onOpen: function () { payingOnline = false; },
        });
      });
    });
  }

  // A Pack (packs_widget.js) tapped through Shiprocket's own product Buy Now:
  // the Pack goes in the cart with its _brix_pack_* properties, then Shiprocket
  // opens for the cart and applies the Pack's automatic discount itself. No
  // discount code is made. Shiprocket missing: Shopify checkout (the Pack
  // Function gives the Pack price). The cart add failing: opts.fallback (the
  // Pack's own Buy Now). BRIX's own Shiprocket switch isn't needed: the tap
  // came from Shiprocket's button (Silverline runs Shiprocket's app directly).
  function payOnlinePack(items, opts) {
    var fallback = function () { payingOnline = false; if (opts && typeof opts.fallback === 'function') opts.fallback(); };
    if (payingOnline) return false;
    if (!window.BrixCheckout || typeof window.BrixCheckout.checkoutCart !== 'function') return false;
    payingOnline = true;
    setTimeout(function () { payingOnline = false; }, 10000);
    var lines = items.map(function (it) { return { id: Number(it.variantId), quantity: Number(it.quantity) || 1, properties: it.properties || {} }; });
    window.fetch(ROOT + 'cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: lines }) })
      .then(function (res) {
        if (!res.ok) { fallback(); return; }
        window.BrixCheckout.checkoutCart({
          allowPacks: true,
          fallbackUrl: ROOT + 'checkout',
          onOpen: function () { payingOnline = false; if (opts && typeof opts.onOpen === 'function') opts.onOpen(); },
        });
      }, fallback);
    return true;
  }

  // The selected Pack's total (shopper's currency) while a Pack widget takes
  // over Shiprocket's Buy Now; null = the theme's variant x quantity as usual.
  // order: the Pack widget's "theme's buttons under the Pack" mode, where this
  // file's own product COD button orders the Pack: a function returning
  // { items, onPayOnline } for the selected Pack (null = not ready; the widget
  // shows why). Its label uses the Pack price then too.
  var packPrice = null;
  var packOrder = null;
  function setPackPrice(price, order) {
    var next = price != null && isFinite(price) && Number(price) > 0 ? Number(price) : null;
    var nextOrder = next != null && typeof order === 'function' ? order : null;
    if (next === packPrice && nextOrder === packOrder) return;
    packPrice = next;
    packOrder = nextOrder;
    if (productMount && typeof productMount.relabel === 'function') productMount.relabel();
  }

  // "Pay online" goes through the theme's own Checkout button, so anything
  // the theme or another app does on checkout (notes, terms box, checkout
  // apps) still happens. Clicking works while it's hidden by "Replace".
  // Shops on Shiprocket get Shiprocket for the whole cart (BRIX's own
  // hand-off, which doesn't depend on Shiprocket's script catching a
  // scripted click on a hidden button).
  function themeCheckout(btn) {
    whenCheckoutKnown(function () {
      if (shiprocketOn()) {
        prepaidCartCode().then(function (r) {
          if (r.failed) { window.location.href = ROOT + 'checkout'; return; }
          window.BrixCheckout.checkoutCart({ coupon: r.code, giftsCovered: r.giftsCovered, fallbackUrl: ROOT + 'checkout' });
        });
        return;
      }
      if (btn && btn.isConnected && !btn.disabled) { btn.click(); return; }
      window.location.href = ROOT + 'checkout';
    });
  }

  // The whole cart to Shiprocket (cart drawers): Shopify already took the
  // prepaid saving off in the cart (prepaidInCart) and made the reward gifts
  // free, but Shiprocket can't run either Function, so it gets ONE one-time
  // Shopify code (Shiprocket takes one) worth the same percent on the paid
  // lines plus the free gifts' price (api.cod.prepaid-code.jsx checks each
  // gift against the merchant's free milestones). Resolves { code,
  // giftsCovered } (code null = nothing to carry) or { failed: true }: then
  // Shopify checkout, where both still apply.
  // What the code request for this cart would be, or null (nothing to carry).
  function cartCodeRequest(cart) {
    var isGift = function (it) { var p = it.properties || {}; return p._brixReward === 'true' || p._brixReward === true; };
    // Free in the cart now (the reward Function made it ₹0).
    var gifts = (cart.items || []).filter(function (it) { return isGift(it) && Number(it.final_line_price) === 0; })
      .map(function (it) { return { variantId: it.variant_id, quantity: it.quantity }; });
    var prepaid = Boolean(paymentValue && paymentValue.prepaid) && prepaidInCart(cart) > 0;
    if (!prepaid && !gifts.length) return null;
    // Like the Function: free gifts and combo box lines (already at the box price) never get it.
    var items = (cart.items || []).filter(function (it) {
      var p = it.properties || {};
      return !isGift(it) && !p._brix_combo_id;
    }).map(function (it) { return { variantId: it.variant_id, quantity: it.quantity }; });
    if (!items.length) return null;
    var key = function (list) { return list.map(function (l) { return l.variantId + 'x' + l.quantity; }).sort().join(','); };
    return {
      body: { items: items, gifts: gifts, prepaid: prepaid },
      gifts: gifts.length,
      // The cart token too: a code is single use, and an order starts a new cart.
      signature: [cart.token || '', key(items), key(gifts), prepaid ? 1 : 0].join('|'),
    };
  }

  // Codes made ahead for a cart (prepareCartCode), reused by its checkout:
  // making one takes Shopify ~3 s, which the shopper used to wait on after
  // tapping Checkout. A failed one is dropped so the tap tries again.
  var CART_CODE_TTL_MS = 90 * 60 * 1000;
  var cartCodes = {};
  function cartCodeFor(req) {
    var hit = cartCodes[req.signature];
    if (hit && Date.now() - hit.at < CART_CODE_TTL_MS) return hit.promise;
    var promise = api('prepaid-code', req.body).then(function (json) {
      return json && json.success ? { code: json.code || null, giftsCovered: req.gifts > 0 && Number(json.gifts) >= req.gifts } : { failed: true };
    }, function () { return { failed: true }; }).then(function (r) {
      if (r.failed && cartCodes[req.signature] && cartCodes[req.signature].promise === promise) delete cartCodes[req.signature];
      return r;
    });
    cartCodes[req.signature] = { at: Date.now(), promise: promise };
    return promise;
  }

  // The whole cart to Shiprocket (cart drawers): Shopify already took the
  // prepaid saving off in the cart (prepaidInCart) and made the reward gifts
  // free, but Shiprocket can't run either Function, so it gets ONE one-time
  // Shopify code (Shiprocket takes one) worth the same percent on the paid
  // lines plus the free gifts' price (api.cod.prepaid-code.jsx checks each
  // gift against the merchant's free milestones). Resolves { code,
  // giftsCovered } (code null = nothing to carry) or { failed: true }: then
  // Shopify checkout, where both still apply.
  function prepaidCartCode() {
    return loadConfig().then(function () {
      return fetchCart().then(function (cart) {
        var req = cartCodeRequest(cart);
        return req ? cartCodeFor(req) : { code: null };
      });
    }).catch(function () { return { failed: true }; });
  }

  // Makes the code for this cart now (the drawer calls it while open), so
  // Checkout finds it ready. Never throws.
  function prepareCartCode(cart) {
    return loadConfig().then(function () {
      return cart ? cart : fetchCart();
    }).then(function (c) {
      var req = cartCodeRequest(c);
      if (req) cartCodeFor(req);
    }).catch(function () { /* the tap makes it instead */ });
  }

  // The cart's price for price tags: after its discounts when known.
  function cartPrice(state) {
    if (!state) return null;
    return state.total != null ? state.total : state.subtotal != null ? state.subtotal : null;
  }

  // The same for Cash on Delivery: without the prepaid discount.
  function codPrice(state) {
    return state && state.codTotal != null ? state.codTotal : cartPrice(state);
  }

  // The merchant's text on the theme drawer's own Checkout button (COD →
  // Customize → Cart drawer), with {price} = the cart total.
  function checkoutLabel(cfg, state) {
    var text = cfg && cfg.drawerCheckoutText;
    if (!text) return '';
    var price = state ? cartPrice(state) : null;
    var cod = state ? codPrice(state) : null;
    var fee = codFeeFor(cfg, cod, state && state.ids);
    var values = price == null ? {} : { price: price, prepaid_price: price, saving: state.saving > 0 ? state.saving : null, cod_fee: fee, cod_price: Math.round((cod + fee) * 100) / 100 };
    return hasPriceTags(text) ? priceTags(text, values, shopperMoney()) : text;
  }

  function relabelCheckout(checkout, cfg, state) {
    var el = cfg && cfg.drawerCheckoutText ? textTarget(checkout) : null;
    if (!el) return;
    setButtonText(el, checkoutLabel(cfg, state));
  }

  // The same text on the BRIX Cart Drawer's own Checkout button (standard,
  // animated and swipe): cart_drawer_inline.js marks its label
  // [data-cc-checkout-label], so the → arrow stays. Empty = the drawer's
  // own text (Cart Editor → Checkout Button).
  function relabelBrixCheckout(checkout, cfg, state) {
    if (!checkout || !cfg || !cfg.drawerCheckoutText) return;
    var next = checkoutLabel(cfg, state);
    var labels = checkout.querySelectorAll('[data-cc-checkout-label]');
    for (var i = 0; i < labels.length; i++) if (labels[i].textContent !== next) labels[i].textContent = next;
  }

  function paintTheme(cfg) {
    var fmt = buttonMoney(cfg.currency);
    themeMounts.forEach(function (m) {
      if (!m.checkout.isConnected) return;
      var state = drawerState(cfg, themeCart, themeExcluded, fmt);
      relabelCheckout(m.checkout, cfg, state);
      paintDrawerSlot(m.slot, cfg, state, m, function () {
        open({
          surface: 'drawer',
          useCart: true,
          onPayOnline: function () { themeCheckout(m.checkout); },
          // The cart was emptied; reload so the theme's drawer and cart count show it.
          onClosedAfterOrder: function () { window.location.reload(); },
        });
      });
      var cs = themeCart && themeCart.items && themeCart.items.length ? continueLook(cfg) : null;
      paintContinue(m, cs, [m.slot, m.anchor], function () { closeThemeDrawer(m.checkout); });
    });
  }

  // Finds theme drawer Checkout buttons, adds/removes COD slots to match,
  // and (re)reads the cart when asked or when it was never read.
  function refreshTheme(cfg, refetch) {
    if (window.__brixCartDrawerActive === true) {
      // The BRIX Cart Drawer is on and replaces the theme's drawer; COD lives in it.
      themeMounts.forEach(unmountTheme);
      themeMounts = [];
      return;
    }
    var buttons = findThemeCheckouts(cfg);
    themeMounts = themeMounts.filter(function (m) {
      if (m.checkout.isConnected && buttons.indexOf(m.checkout) !== -1) return true;
      unmountTheme(m);
      return false;
    });
    buttons.forEach(function (btn) {
      var m = themeMounts.filter(function (x) { return x.checkout === btn; })[0];
      if (!m) themeMounts.push({ checkout: btn, anchor: anchorFor(btn), slot: newThemeSlot() });
      else if (!m.slot.isConnected) { m.anchor = anchorFor(btn); m.slot = newThemeSlot(); }
    });
    if (!themeMounts.length) return;
    if (!refetch && themeCart) { paintTheme(cfg); return; }
    var seq = ++themeSeq;
    fetchCart().then(function (cart) {
      return cartHasExcluded(cfg, cart).then(function (ex) {
        if (seq !== themeSeq) return;
        themeCart = cart;
        themeExcluded = ex;
        paintTheme(cfg);
      });
    }).catch(function () { /* cart unreadable: leave the theme's drawer as it is */ });
  }

  function initThemeDrawer() {
    loadConfig().then(function (cfg) {
      if (!cfg || cfg.surfaces.drawer === false) return;
      refreshTheme(cfg, true);
      document.addEventListener('brix:drawer:ready', function () { refreshTheme(cfg, false); });
      if (!window.MutationObserver) return;
      // Themes redraw their drawer when the cart changes (Dawn re-renders it
      // from the server after every add, remove or quantity change), which
      // removes the COD button and may change the cart: put it back and
      // re-read the cart. Changes made by BRIX itself are ignored.
      var timer = null;
      var custom = cfg.drawerSelector || '';
      var ours = function (n) { return n.nodeType === 1 && Boolean(n.closest && n.closest(BRIX_UI)); };
      var bringsCheckout = function (n) {
        if (n.nodeType !== 1) return false;
        try { return Boolean((n.matches && n.matches(custom || THEME_CHECKOUT)) || n.querySelector(custom || THEME_CHECKOUT)); } catch (e) { return false; }
      };
      new MutationObserver(function (records) {
        var hit = false;
        for (var i = 0; i < records.length && !hit; i++) {
          var r = records[i];
          var target = r.target.nodeType === 1 ? r.target : r.target.parentElement;
          if (!target || ours(target)) continue;
          var nodes = [].slice.call(r.addedNodes).concat([].slice.call(r.removedNodes));
          if (nodes.length && nodes.every(ours)) continue;
          hit = custom
            ? nodes.some(bringsCheckout) || themeMounts.some(function (m) { return !m.checkout.isConnected; })
            : Boolean(themeDrawerOf(target)) || nodes.some(bringsCheckout);
        }
        if (!hit) return;
        clearTimeout(timer);
        timer = setTimeout(function () { refreshTheme(cfg, true); }, 250);
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  /* ---------- product page button ---------- */

  function isProductPage() {
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
    if (meta && meta.page && meta.page.pageType) return meta.page.pageType === 'product';
    return /\/products\/[^/?#]+/.test(window.location.pathname);
  }

  // Never the product's own form: drawers, quick-add popups, recommendations.
  var FOREIGN_FORM = '[data-cart-ninja-drawer], cart-drawer, .quick-add-modal, product-recommendations';
  // Product cards (other products). Dawn-style themes also put the main
  // product column in a .grid__item, so that one doesn't count as a card.
  var CARD_FORM = '.card, .product-card, .card-wrapper, .grid__item:not(.product__info-wrapper)';

  function isShown(el) {
    return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // The Add to Cart form of the product on this page. Themes often have
  // several /cart/add forms here (a hidden installment form, a sticky bar
  // that's hidden until scroll, upsell cards), so the best one is: a form with
  // an Add to Cart button, holding one of this product's variants, visible.
  // Without the product's variant list it falls back to any non-card form.
  function findProductForm(variantIds) {
    var scope = document.querySelector('main') || document;
    var forms = scope.querySelectorAll('form[action*="/cart/add"]');
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      var idEl = f.querySelector('[name="id"]');
      if (!idEl || !submitButtonFor(f) || f.closest(FOREIGN_FORM)) continue;
      var ours = variantIds.length > 0 && variantIds.indexOf(String(idEl.value)) !== -1;
      if (variantIds.length > 0 ? !ours : f.closest(CARD_FORM)) continue;
      var score = (isShown(f) ? 2 : 0) + (f.closest(CARD_FORM) ? 0 : 1);
      if (score > bestScore) { best = f; bestScore = score; }
    }
    return best;
  }

  // The product form on this page (the one the COD button is on, if mounted).
  function productForm() {
    if (productMount && productMount.form && productMount.form.isConnected) return productMount.form;
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product;
    var ids = meta && Array.isArray(meta.variants) ? meta.variants.map(function (v) { return String(v.id); }) : [];
    return findProductForm(ids);
  }

  // form.id is shadowed by an <input name="id">, which every product form has.
  function formIdOf(form) {
    return form.getAttribute('id') || '';
  }

  // The button itself, or the row it sits in when that row is a one-line flex
  // row (a block put after the button there would squeeze into the row).
  function rowOf(btn) {
    var row = btn.parentNode;
    if (!row || row.nodeType !== 1) return btn;
    var cs = window.getComputedStyle(row);
    return /flex/.test(cs.display) && !/column/.test(cs.flexDirection) && cs.flexWrap === 'nowrap' ? row : btn;
  }

  function submitButtonFor(form) {
    var id = formIdOf(form);
    return form.querySelector('[type="submit"][name="add"], button[name="add"], [type="submit"]')
      || (id ? document.querySelector('[type="submit"][form="' + id + '"]') : null);
  }

  function formSelection(form) {
    var idEl = form.querySelector('[name="id"]');
    var id = formIdOf(form);
    var qtyEl = form.querySelector('[name="quantity"]') || (id ? document.querySelector('[name="quantity"][form="' + id + '"]') : null);
    var properties = {};
    try {
      var fd = new FormData(form);
      fd.forEach(function (value, key) {
        var m = /^properties\[(.+)\]$/.exec(key);
        if (m && typeof value === 'string' && value !== '') properties[m[1]] = value;
      });
    } catch (e) { /* no FormData */ }
    return {
      variantId: idEl ? String(idEl.value || '') : '',
      quantity: Math.max(1, parseInt(qtyEl && qtyEl.value, 10) || 1),
      properties: properties,
    };
  }

  // Id (for the merchant's product picks), tags (for excluded tags) and
  // variant ids (to find the right form) of the product on this page.
  function productInfo() {
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product;
    var metaIds = meta && Array.isArray(meta.variants) ? meta.variants.map(function (v) { return String(v.id); }) : [];
    var metaId = meta && meta.id ? String(meta.id) : '';
    var m = /\/products\/([^/?#]+)/.exec(window.location.pathname);
    if (!m) return Promise.resolve({ id: metaId, tags: [], variantIds: metaIds, variants: [] });
    return window.fetch(ROOT + 'products/' + m[1] + '.js', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (p) {
        var ids = Array.isArray(p.variants) ? p.variants.map(function (v) { return String(v.id); }) : [];
        return {
          id: p.id ? String(p.id) : metaId,
          tags: Array.isArray(p.tags) ? p.tags : String(p.tags || '').split(','),
          variantIds: metaIds.length ? metaIds : ids,
          // Prices for the payment options (in the shopper's currency, in cents).
          variants: Array.isArray(p.variants) ? p.variants.map(function (v) { return { id: String(v.id), price: Number(v.price) }; }) : [],
        };
      })
      .catch(function () { return { id: metaId, tags: [], variantIds: metaIds, variants: [] }; });
  }

  // Is this page's product among the merchant's picks ({ products, collections }:
  // numeric ids)? Collections are the ones the app embed sees on the page.
  // Mirrors codPicksMatch in app/utils/cod.shared.js.
  function picksMatch(picks, info) {
    if (!picks) return false;
    var id = String((info && info.id) || '');
    if (id && (picks.products || []).map(String).indexOf(id) !== -1) return true;
    return (picks.collections || []).some(function (c) { return PRODUCT_COLLECTIONS.indexOf(String(c)) !== -1; });
  }

  // COD on this product's page at all (Product page → Which products; codShownOnProduct).
  // The server refuses a product page COD order for a product left out either way.
  function codShownHere(cfg, info) {
    var showOn = cfg && cfg.productButton && cfg.productButton.showOn;
    if (!showOn || (showOn.mode !== 'except' && showOn.mode !== 'only')) return true;
    var hit = picksMatch(showOn, info);
    return showOn.mode === 'only' ? hit : !hit;
  }

  // An unlisted product COD may not sell (Eligibility → Unlisted products):
  // in the list BRIX made from Shopify, and the page is still marked noindex,
  // as Shopify marks unlisted product pages, so a product listed again since
  // the list was made keeps its button. The server checks every order anyway.
  function unlistedBlockedHere(cfg, info) {
    var list = (cfg && cfg.unlistedBlocked) || [];
    if (!info || !info.id || list.map(String).indexOf(String(info.id)) === -1) return false;
    var robots = document.querySelector('meta[name="robots"]');
    return Boolean(robots && /noindex/i.test(robots.getAttribute('content') || ''));
  }

  // replace | above | below Shopify's Buy it now for this product
  // (codBuyNowPlacementFor): "some" = replace on the picked products only.
  function placementFor(cfg, info) {
    var pb = (cfg && cfg.productButton) || {};
    if (pb.buyNowPlacement === 'some') return picksMatch(pb.replaceOn, info) ? 'replace' : pb.restPlacement === 'below' ? 'below' : 'above';
    if (pb.buyNowPlacement === 'replace' || pb.buyNowPlacement === 'above' || pb.buyNowPlacement === 'below') return pb.buyNowPlacement;
    return pb.replaceBuyNow === false ? 'above' : 'replace';
  }

  // Shopify's "Buy it now" (dynamic checkout) button. The payment_button filter
  // renders its container inside the product form; the button itself loads later.
  var BUY_NOW = '.shopify-payment-button, [data-shopify="payment-button"], shopify-buy-it-now-button, shopify-accelerated-checkout';

  // Hidden with a stylesheet, not inline, so a Buy it now button the theme
  // draws again later (variant change) is hidden too.
  function hideBuyNow(scope) {
    if (!document.getElementById('brix-cod-hide-buy-now')) {
      var style = document.createElement('style');
      style.id = 'brix-cod-hide-buy-now';
      style.textContent = BUY_NOW.split(',').map(function (s) { return '[data-brix-cod-hide-buy-now] ' + s.trim(); }).join(',') + '{display:none !important}';
      document.head.appendChild(style);
    }
    scope.setAttribute('data-brix-cod-hide-buy-now', '');
  }

  // The chosen variant's price x quantity on the product form (shopper's
  // currency), or null while it isn't known.
  function productPrice(form, info) {
    var sel = formSelection(form);
    var id = sel.variantId;
    if (!/^\d+$/.test(id)) { var m = /[?&]variant=(\d+)/.exec(window.location.search); id = m ? m[1] : id; }
    for (var i = 0; i < (info.variants || []).length; i++) {
      var v = info.variants[i];
      if (v.id === id && isFinite(v.price) && v.price >= 0) return Math.round(v.price * sel.quantity) / 100;
    }
    return null;
  }

  // The text button inside Shopify's Buy it now (the unbranded one; Shop Pay /
  // PayPal branded buttons can't be relabelled), also inside shadow roots.
  function buyNowButton(host) {
    if (!host) return null;
    var pick = function (root) {
      var b = root.querySelector('.shopify-payment-button__button--unbranded') ||
        root.querySelector('.shopify-payment-button__button:not(.shopify-payment-button__button--branded)');
      return b && b.children.length === 0 ? b : null;
    };
    var b = pick(host);
    if (!b) {
      var inner = host.querySelectorAll('*');
      if (host.shadowRoot) b = pick(host.shadowRoot);
      for (var i = 0; !b && i < inner.length; i++) if (inner[i].shadowRoot) b = pick(inner[i].shadowRoot);
    }
    return b;
  }

  // The theme's Buy it now: the merchant's selector (COD → Customize →
  // Product page) when set, else Shopify's dynamic checkout
  // button in the product form, else anywhere in the product's section.
  // The merchant's own Buy it now (Product page → Buy it now selector). A
  // class can match more than the product page's button: Shiprocket puts
  // .shiprocket-headless on its product Buy Now (data-type="product") and on
  // the cart drawer's checkout (data-type="mini-cart"), which comes first and
  // is hidden. So: never one inside a cart drawer or marked for the cart; the
  // one in the product's own section first, else the first other match.
  var CART_PLACES = 'cart-drawer, cart-notification, #CartDrawer, #cart-drawer, .cart-drawer, .drawer--cart, #cc-root, [data-brix-cod-drawer]';
  // Every product-page match: a page can have more than one (Silverline:
  // Shiprocket drew a second product Buy Now, and only the first, not the
  // one on screen, got the merchant's text).
  function customBuyNows(cfg) {
    var sel = cfg && cfg.productButton && cfg.productButton.buyNowSelector;
    if (!sel) return [];
    var list;
    try { list = document.querySelectorAll(sel); } catch (e) { return []; }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      // The place mark can sit on a box around the match: a selector for
      // Shiprocket's button itself (.sr-headless-checkout) has its
      // data-type on the .shiprocket-headless wrapper.
      var typed = el.closest ? el.closest('[data-type]') : el;
      var kind = String((typed && typed.getAttribute('data-type')) || '').toLowerCase();
      if (kind === 'mini-cart' || kind === 'cart') continue;
      if (el.closest && el.closest(CART_PLACES)) continue;
      if (out.some(function (o) { return o.contains(el) || el.contains(o); })) continue;
      out.push(el);
    }
    return out;
  }
  function shownOnPage(el) { return el.getClientRects().length > 0; }
  // The one to place COD next to: in the product's section and on screen
  // first, then in the section, then on screen, then the first.
  function customBuyNow(cfg) {
    var list = customBuyNows(cfg);
    if (!list.length) return null;
    var form = productForm();
    var section = form && (form.closest('.shopify-section') || form.parentNode);
    var inSection = list.filter(function (el) { return section && section.contains(el); });
    var pick = function (arr) { return arr.filter(shownOnPage)[0] || null; };
    return pick(inSection) || inSection[0] || pick(list) || list[0];
  }
  function findBuyNow(form, cfg) {
    var custom = customBuyNow(cfg);
    if (custom) return custom;
    if (!form) return null;
    var section = form.closest('.shopify-section') || form.parentNode;
    return form.querySelector(BUY_NOW) || (section && section.querySelector(BUY_NOW)) || null;
  }
  // Puts `text` on a theme button. Some themes hide the button's real text
  // (font-size: 0) and draw their label with CSS, e.g.
  //   #CartDrawer-Checkout::after { content: "Proceed to Checkout" }
  // so that CSS text is replaced too. A ::before/::after with no letters
  // (borders, icons, effects) is left alone.
  var LABEL_PSEUDOS = ['before', 'after'];
  // The text element and every box up to its button: the painted label can
  // sit on any of them. Shiprocket on silverline925.in hides the text span
  // (display:none) and paints .sr-button-text-container::after { content:
  // "BUY NOW" }, the box between them, so the merchant's text never showed.
  function labelHosts(el) {
    var hosts = [el];
    var btn = el.closest && el.closest('button, a, [role="button"], input[type="submit"]');
    if (!btn || btn === el) return hosts;
    for (var up = el.parentElement; up && up !== btn; up = up.parentElement) hosts.push(up);
    hosts.push(btn);
    return hosts;
  }
  // Takes the merchant's text back off the painted labels (back to the theme's).
  function clearButtonLabel(el) {
    if (!el) return;
    labelHosts(el).forEach(function (host) {
      LABEL_PSEUDOS.forEach(function (pseudo) { host.removeAttribute('data-brix-label-' + pseudo); });
    });
  }
  function setButtonText(el, text) {
    if (!el || !text) return;
    if (el.textContent !== text) el.textContent = text;
    labelHosts(el).forEach(function (host) {
      LABEL_PSEUDOS.forEach(function (pseudo) {
        var attr = 'data-brix-label-' + pseudo;
        var content = '';
        try { content = getComputedStyle(host, '::' + pseudo).content || ''; } catch (e) { return; }
        if (!host.hasAttribute(attr) && !/^["'].*[A-Za-z0-9].*["']$/.test(content)) return;
        if (host.getAttribute(attr) !== text) host.setAttribute(attr, text);
        if (!document.getElementById('brix-cod-label-style')) {
          var style = document.createElement('style');
          style.id = 'brix-cod-label-style';
          // The attribute three times: beats a theme's / Shiprocket's own
          // !important rule such as .shiprocket-headless .sr-button-text-container::after.
          style.textContent = LABEL_PSEUDOS.map(function (p) { var a = '[data-brix-label-' + p + ']'; return a + a + a + '::' + p + '{content:attr(data-brix-label-' + p + ') !important}'; }).join('');
          document.head.appendChild(style);
        }
      });
    });
  }

  // Where a button's text lives: Shopify's unbranded Buy it now, else the
  // element itself, else its innermost element with text (keeps icons).
  function textTarget(el) {
    if (!el) return null;
    var shop = buyNowButton(el);
    if (shop) return shop;
    if (!el.children.length) return el;
    var all = el.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (!all[i].children.length && /\S/.test(all[i].textContent) && !/^(svg|path|style|script)$/i.test(all[i].tagName)) return all[i];
    }
    return null;
  }

  // The merchant's text on Shopify's Buy it now (COD → Customize →
  // Product page), with price tags for the chosen variant and quantity.
  // Only while Buy it now shows (COD doesn't replace it). The prepaid
  // discount has its own switch: with the payment options off its offer still
  // comes (paymentValue.prepaid), so {prepaid_price} / {saving} use it, worked
  // out like the payment options (minimum, cap, excluded collections,
  // currency); it used to be the plain price here.
  function relabelBuyNow(cfg, form, info) {
    var text = cfg && cfg.productButton && cfg.productButton.buyNowText;
    if (!text || !form) return;
    var hosts = customBuyNows(cfg);
    if (!hosts.length) { var one = findBuyNow(form, cfg); if (one) hosts = [one]; }
    var targets = hosts.map(textTarget).filter(Boolean);
    if (!targets.length) return;
    var price = packPrice != null ? packPrice : productPrice(form, info);
    var fee = codFeeFor(cfg, price, info && info.id ? [info.id] : null);
    var online = price;
    var pre = paymentValue && paymentValue.prepaid;
    if (pre && price != null && !Pay.prepaidExcludedHere(pre, info && info.id)) {
      var active = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || CURRENCY;
      var pr = Pay.pricing(price, 1, pre, 0, Boolean(pre.currency && pre.currency === active));
      if (pr.qualifies) online = pr.online;
    }
    var values = price == null ? {} : { price: price, prepaid_price: online, saving: price - online > 0 ? Math.round((price - online) * 100) / 100 : null, cod_fee: fee, cod_price: Math.round((price + fee) * 100) / 100 };
    var next = hasPriceTags(text) ? priceTags(text, values, shopperMoney()) : text;
    targets.forEach(function (btn) { setButtonText(btn, next); });
  }

  var PRODUCT_BUTTON_DEFAULTS = { replaceBuyNow: true, buyNowPlacement: '', marginTop: 10, marginBottom: 0, paddingY: 14, paddingX: 16, radius: 12 };

  var productMount = null; // { form, slot, addBtn } of the button on the page

  // Puts the COD button on the product form: where Buy it now was (and hides
  // it) when the merchant chose to replace it, else under Add to Cart. A
  // [data-brix-cod-slot] block placed in the theme wins over both.
  // `excluded`: the product has an excluded tag, so the button shows as
  // unavailable under Add to Cart and Buy it now is left alone.
  function mountProductButton(cfg, info, excluded) {
    var m = productMount;
    if (m && m.form.isConnected && m.slot.isConnected && (!m.addBtn || m.addBtn.isConnected)) return;
    var form = findProductForm(info.variantIds);
    if (!form) return;
    if (m && m.slot.getAttribute('data-brix-cod-slot') === 'auto' && m.slot.parentNode) m.slot.parentNode.removeChild(m.slot);
    var look = Object.assign({}, PRODUCT_BUTTON_DEFAULTS, cfg.productButton || {});
    // replace | above | below Shopify's Buy it now, for this product.
    var where = placementFor(cfg, info);
    if (excluded && where === 'replace') where = 'above'; // an unavailable COD button never hides Buy it now
    var replacing = where === 'replace';
    var addBtn = submitButtonFor(form);
    var buyNow = findBuyNow(form, cfg);
    if (buyNow && !form.contains(buyNow) && !customBuyNow(cfg)) buyNow = null;
    var slot = document.querySelector('[data-brix-cod-slot]:not([data-brix-cod-slot="auto"])');
    if (!slot) {
      slot = document.createElement('div');
      slot.setAttribute('data-brix-cod-slot', 'auto');
      // The theme's spacing rules for its buttons must not add to the merchant's.
      slot.style.cssText = important('display:block;width:100%;margin:0;padding:0');
      var anchor = addBtn && addBtn.parentNode && form.contains(addBtn) ? addBtn : null;
      // Add to cart outside its form, tied to it by form="..." (Silverline:
      // <button type="submit" form="pdp-form"> in a row with the quantity,
      // the form itself hidden): COD goes after that button, or after its
      // row when the row can't wrap; it used to go inside the hidden form.
      if (!anchor && addBtn && addBtn.parentNode && !form.contains(addBtn)) anchor = rowOf(addBtn);
      if (buyNow && where === 'below') buyNow.parentNode.insertBefore(slot, buyNow.nextSibling);
      else if (buyNow) buyNow.parentNode.insertBefore(slot, buyNow);
      else if (anchor) anchor.parentNode.insertBefore(slot, anchor.nextSibling);
      else form.appendChild(slot);
    }
    if (replacing) {
      hideBuyNow(form.closest('.shopify-section') || form);
      // A Buy it now found by the merchant's selector is hidden directly.
      customBuyNows(cfg).forEach(function (custom) { custom.style.setProperty('display', 'none', 'important'); });
    }
    productMount = { form: form, slot: slot, addBtn: addBtn };

    var fmt = buttonMoney(cfg.currency);
    var text = productText(cfg);
    var here = info && info.id ? [info.id] : null;
    var label = codLabel(cfg, text, productPrice(form, info), here);
    var sub = excluded ? bxT('storefront.cod.not_for_product', 'Not available for this product') : showsCodFee(text) ? '' : feeHint(cfg, fmt, productPrice(form, info), here);
    slot.innerHTML = buttonHtml(cfg, label, sub, Boolean(excluded), look, { look: lookOf(cfg, 'product') });
    var btn = slot.querySelector('[data-brix-cod-btn]');
    var keepsBuyNow = !replacing;
    productMount.relabel = function () {
      var el = slot.querySelector('[data-brix-cod-label]');
      var price = packOrder && packPrice != null ? packPrice : productPrice(form, info);
      var next = codLabel(cfg, text, price, here);
      if (el && el.textContent !== next) el.textContent = next;
      // A % COD fee follows the variant and quantity too.
      var subEl = slot.querySelector('[data-brix-cod-sub]');
      var nextSub = excluded || showsCodFee(text) ? null : feeHint(cfg, fmt, price, here);
      if (subEl && nextSub && subEl.textContent !== nextSub) subEl.textContent = nextSub;
      if (keepsBuyNow) relabelBuyNow(cfg, form, info);
    };
    productMount.relabel();
    if (excluded) return;
    function syncDisabled() {
      var soldOut = Boolean(addBtn && (addBtn.disabled || addBtn.getAttribute('aria-disabled') === 'true'));
      btn.disabled = soldOut;
      btn.style.setProperty('opacity', soldOut ? '0.5' : '1', 'important');
      btn.style.setProperty('cursor', soldOut ? 'not-allowed' : 'pointer', 'important');
    }
    syncDisabled();
    if (addBtn && window.MutationObserver) {
      new MutationObserver(syncDisabled).observe(addBtn, { attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
    }
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (packOrder) {
        var pack = packOrder();
        if (pack && pack.items && pack.items.length) open({ surface: 'product', items: pack.items, onPayOnline: pack.onPayOnline });
        return;
      }
      var sel = formSelection(form);
      if (!/^\d+$/.test(sel.variantId)) return;
      open({
        surface: 'product',
        items: [sel],
        onPayOnline: function () { payOnlineItems([sel]); },
      });
    });
  }

  /* ---------- product page payment options (Pay Online / Cash on Delivery) ---------- */

  // The shopper picks how to pay before buying: Pay Online (Shopify checkout,
  // where the BRIX prepaid discount Function gives the merchant's X% off;
  // Shiprocket with a one-time code for it on Shiprocket shops) or
  // Cash on Delivery (the BRIX COD popup above, never discounted). Settings:
  // productPayment in the COD settings (app/utils/product-payment.shared.js),
  // served by cod_storefront.php, which only sends a prepaid offer the server
  // verified is active in Shopify. Every amount here is a preview: Shopify
  // checkout and the COD server price the real order.
  //
  // Shopify's own Buy it now button is the Pay Online button whenever the
  // theme shows it (only its text changes, to "Buy it now · Save 10%"); when
  // COD is picked it's hidden and the BRIX COD button takes its place. Themes
  // without Buy it now get a BRIX Pay Online button that goes to checkout.
  var Pay = (function () {
    var SPACING = { small: 8, medium: 12, large: 16 };
    var PRICE = '[id^="price-"], .product__price, .product-price, .product-single__price, [data-product-price], .price';
    var VARIANTS = 'variant-selects, variant-radios, variant-picker, product-variants, .variant-picker, [data-variant-picker], .product-form__input--dropdown, .product-form__input--pill, .selector-wrapper';
    var QUANTITY = 'quantity-input, .product-form__quantity, .quantity-selector, [data-quantity-selector], .product__quantity';
    // ASCII-only source (the script may be served without a charset): U+00B7 is " · ".
    var DOT = String.fromCharCode(0xb7);
    var SAVE_SUFFIX = new RegExp('\\s*' + DOT + '\\s*Save\\s+[\\d.,]+\\s*%\\s*$', 'i');
    var st = null; // the one product page's state
    var seq = 0;

    function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

    // Mirrors productPaymentPricing in app/utils/product-payment.shared.js.
    function pricing(unitPrice, quantity, prepaid, codFee, currencyMatches) {
      var qty = Math.max(1, Math.floor(Number(quantity)) || 1);
      var subtotal = round2((Number(unitPrice) || 0) * qty);
      var percent = prepaid && Number(prepaid.percent) >= 1 && Number(prepaid.percent) <= 50 ? round2(prepaid.percent) : null;
      var min = prepaid ? Number(prepaid.minSubtotal) || 0 : 0;
      var cap = prepaid ? Number(prepaid.maxDiscount) || 0 : 0;
      var minMet = (min > 0 || cap > 0) && !currencyMatches ? false : min > 0 ? subtotal >= min : true;
      var qualifies = Boolean(percent) && subtotal > 0 && minMet;
      var full = qualifies ? round2(subtotal * percent / 100) : 0;
      var savings = cap > 0 ? Math.min(full, round2(cap)) : full;
      return {
        subtotal: subtotal, percent: percent, qualifies: qualifies, minMissing: Boolean(percent) && min > 0 && !minMet,
        savings: savings, online: round2(subtotal - savings), cod: subtotal, codFee: round2(codFee), codTotal: round2(subtotal + (Number(codFee) || 0)),
      };
    }

    // Mirrors fillPaymentText.
    function fill(template, vars) {
      var pct = vars.percent != null ? String(Number(vars.percent)) : '';
      return String(template || '')
        .replace(/\{percent\}/g, pct)
        .replace(/\{amount\}/g, vars.amount ? vars.amount : pct + '%')
        .replace(/\{min\}/g, vars.min || '')
        .replace(/\{price\}/g, vars.price || '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Mirrors onlineButtonLabel: built from the merchant's text every time, so
    // a suffix can never stack ("Save 10% · Save 10%"). Text with price tags is
    // filled in and gets no suffix.
    function onlineLabel(base, pr, prepaid) {
      var b = String(bxText(base, 'storefront.cod.buy_it_now', 'Buy it now')).trim();
      if (hasPriceTags(b)) {
        var values = pr && pr.subtotal != null
          ? { price: pr.subtotal, prepaid_price: pr.online, saving: pr.savings > 0 ? pr.savings : null, cod_fee: pr.codFee, cod_price: pr.codTotal }
          : {};
        return priceTags(b, values, st ? st.fmt : shopperMoney());
      }
      return pr && pr.qualifies && prepaid && prepaid.showBadge ? b + ' ' + DOT + ' ' + bxT('storefront.cod.save_percent', 'Save {percent}%', { percent: Number(pr.percent) }) : b;
    }

    function hex(value, fallback) { return HEX.test(value || '') ? value : fallback; }

    function ensureStyle() {
      if (document.getElementById('brix-pay-style')) return;
      var style = document.createElement('style');
      style.id = 'brix-pay-style';
      style.textContent = [
        '[data-brix-pay-cod] .shopify-payment-button,[data-brix-pay-cod] [data-shopify="payment-button"],[data-brix-pay-cod] shopify-buy-it-now-button,[data-brix-pay-cod] shopify-accelerated-checkout{display:none !important}',
        // The merchant's own Buy it now (its selector, e.g. Shiprocket's) while COD is chosen.
        '[data-brix-pay-hidden]{display:none !important}',
        '.bxpay{display:block;width:100%;max-width:100%;margin:14px 0;padding:0;font-family:inherit;line-height:1.4;text-align:left;box-sizing:border-box}',
        '.bxpay *,.bxpay *:before,.bxpay *:after{box-sizing:border-box}',
        '.bxpay-h{display:block;margin:0 0 8px;font-size:14px;font-weight:600;letter-spacing:normal;text-transform:none}',
        '.bxpay-banner{display:flex;align-items:flex-start;gap:10px;margin:0 0 10px;padding:10px 12px;border-radius:var(--bxpay-r);background:var(--bxpay-sel-bg);color:var(--bxpay-sel-fg);border:1px solid var(--bxpay-online)}',
        '.bxpay-banner svg{flex:none;color:var(--bxpay-online);margin-top:1px}',
        '.bxpay-banner b{display:block;font-size:14px;font-weight:700}',
        '.bxpay-banner span{display:block;font-size:13px;opacity:.85}',
        '.bxpay-cards{display:grid;gap:var(--bxpay-gap);grid-template-columns:minmax(0,1fr)}',
        '.bxpay-cards.is-h{grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr))}',
        '@media (max-width:480px){.bxpay-cards.is-h{grid-template-columns:minmax(0,1fr)}}',
        '.bxpay-card{position:relative;display:flex;align-items:flex-start;gap:10px;min-width:0;min-height:48px;margin:0;padding:var(--bxpay-pad);border-radius:var(--bxpay-r);background:var(--bxpay-bg);color:var(--bxpay-fg);border:1px solid var(--bxpay-border);box-shadow:none;cursor:pointer;outline:none;user-select:none;-webkit-tap-highlight-color:transparent;transition:border-color .15s,background-color .15s,box-shadow .15s}',
        '.bxpay.cs-filled .bxpay-card{background:var(--bxpay-fill);border-color:transparent}',
        '.bxpay.cs-minimal .bxpay-card{background:transparent;color:inherit;border-color:transparent}',
        '.bxpay-card:focus-visible{outline:2px solid var(--c);outline-offset:2px}',
        '.bxpay-card[aria-checked="true"]{border-color:var(--c);box-shadow:inset 0 0 0 1px var(--c)}',
        '.bxpay.ss-background .bxpay-card[aria-checked="true"]{background:var(--bxpay-sel-bg);color:var(--bxpay-sel-fg);box-shadow:none}',
        '.bxpay-card[aria-disabled="true"]{cursor:not-allowed;opacity:.6}',
        '.bxpay-radio{flex:none;display:grid;place-items:center;width:18px;height:18px;margin-top:2px;border-radius:50%;border:2px solid var(--bxpay-border);background:#fff}',
        '.bxpay-card[aria-checked="true"] .bxpay-radio{border-color:var(--c)}',
        '.bxpay-card[aria-checked="true"] .bxpay-radio:after{content:"";width:8px;height:8px;border-radius:50%;background:var(--c)}',
        '.bxpay-tick{position:absolute;top:8px;right:8px;display:none;width:18px;height:18px;border-radius:50%;background:var(--c);color:#fff;place-items:center}',
        '.bxpay.no-radio .bxpay-card[aria-checked="true"] .bxpay-tick{display:grid}',
        '.bxpay-ic{flex:none;display:inline-flex;margin-top:1px;color:var(--c)}',
        '.bxpay-main{flex:1;min-width:0;overflow-wrap:anywhere}',
        '.bxpay.no-radio .bxpay-main{padding-right:20px}',
        '.bxpay-top{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px}',
        '.bxpay-l{font-size:15px;font-weight:700;line-height:1.3}',
        '.bxpay-badge{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--bxpay-badge-bg);color:var(--bxpay-badge-fg);font-size:11.5px;font-weight:700;line-height:1.5;white-space:nowrap}',
        '.bxpay-d,.bxpay-p,.bxpay-o,.bxpay-why{display:block;margin-top:3px}',
        '.bxpay-d{font-size:13px;opacity:.75}',
        '.bxpay-p{font-size:14px}',
        '.bxpay-p s{margin-left:6px;opacity:.6}',
        '.bxpay-save{color:var(--c);font-weight:600;white-space:nowrap}',
        '.bxpay-o{font-size:13px;font-weight:600;color:var(--bxpay-online)}',
        '.bxpay-why{font-size:12.5px;font-weight:600}',
        '.bxpay-sr{position:absolute !important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);border:0;white-space:nowrap}',
        '@media (prefers-reduced-motion:reduce){.bxpay-card{transition:none}}',
      ].join('');
      document.head.appendChild(style);
    }

    // The block a placement is measured from: the product's own section.
    function scopeOf(form) {
      return form.closest('.shopify-section, product-info, .product, [id^="MainProduct"]') || document.querySelector('main') || document.body;
    }

    function firstShown(scope, selector, form) {
      var nodes;
      try { nodes = scope.querySelectorAll(selector); } catch (e) { return null; }
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.closest('[data-brix-pay], [data-brix-cod-slot]') || el.closest(FOREIGN_FORM)) continue;
        if (el.closest(CARD_FORM) && !(form && el.closest(CARD_FORM) === form.closest(CARD_FORM))) continue;
        if (isShown(el)) return el;
      }
      return null;
    }

    function lastShown(scope, selector) {
      var nodes;
      try { nodes = scope.querySelectorAll(selector); } catch (e) { return null; }
      for (var i = nodes.length - 1; i >= 0; i--) {
        if (!nodes[i].closest('[data-brix-pay]') && !nodes[i].closest(FOREIGN_FORM) && isShown(nodes[i])) return nodes[i];
      }
      return null;
    }

    // The outermost match of `selector` around `el` (e.g. the whole price block, not one amount).
    function outermost(el, selector) {
      var top = el;
      var up = el.parentElement && el.parentElement.closest(selector);
      while (up && !LAYOUT.test(up.tagName) && up.tagName !== 'FORM') { top = up; up = up.parentElement && up.parentElement.closest(selector); }
      return top;
    }

    function buyNowHost(form) {
      var custom = customBuyNow(st && st.cfg);
      if (custom) return custom;
      var scope = form.closest('.shopify-section') || form;
      return form.querySelector(BUY_NOW) || scope.querySelector('.product-form__buttons ' + BUY_NOW.split(',')[0]) || null;
    }

    // Where the buttons row starts: Dawn-like themes wrap Add to cart and Buy it now together.
    function buttonsBlock(addBtn, buyNow) {
      if (!addBtn) return null;
      var row = addBtn.closest('.product-form__buttons, .product-form__controls-group--submit, .product-form__payment-container');
      if (row) return row;
      var p = addBtn.parentNode;
      if (buyNow && p && p.tagName !== 'FORM' && p.contains(buyNow)) return p;
      return addBtn;
    }

    function insertBefore(node, ref) { if (ref && ref.parentNode && node.nextSibling !== ref) ref.parentNode.insertBefore(node, ref); }
    function insertAfter(node, ref) { if (ref && ref.parentNode && ref.nextSibling !== node) ref.parentNode.insertBefore(node, ref.nextSibling); }

    function newSlot(attr) {
      var el = document.createElement('div');
      el.setAttribute(attr, '');
      el.style.cssText = important('display:block;width:100%;max-width:100%;margin:0;padding:0');
      return el;
    }

    /* --- where everything goes --- */

    function place() {
      var form = st.form;
      var scope = scopeOf(form);
      var addBtn = submitButtonFor(form);
      var buyNow = buyNowHost(form);
      var buttons = buttonsBlock(addBtn, buyNow);
      var placement = st.pp.layout.placement;

      // The purchase button: the COD button block if the merchant placed one,
      // else where Buy it now is, else under Add to cart.
      var codBlock = document.querySelector('[data-brix-cod-slot]:not([data-brix-cod-slot="auto"])');
      if (codBlock) { if (st.cta.parentNode !== codBlock) codBlock.appendChild(st.cta); }
      else if (buyNow) insertBefore(st.cta, buyNow);
      else if (addBtn && form.contains(addBtn)) insertAfter(st.cta, addBtn);
      else form.appendChild(st.cta);

      var block = document.querySelector('[data-brix-pay-slot]');
      var anchor = null;
      var after = true;
      if (block) {
        if (st.box.parentNode !== block) block.appendChild(st.box);
      } else {
        if (placement === 'below_price') { var price = firstShown(scope, PRICE, form); if (price) anchor = outermost(price, PRICE); }
        else if (placement === 'below_variants') { var v = lastShown(scope, VARIANTS); if (v) anchor = outermost(v, VARIANTS); }
        else if (placement === 'below_quantity') {
          var q = lastShown(scope, QUANTITY) || (form.querySelector('[name="quantity"]') || null);
          if (q) anchor = q.matches && q.matches('[name="quantity"]') ? (q.closest('.product-form__input, .quantity, .product-form__quantity') || q) : outermost(q, QUANTITY);
        } else if (placement === 'above_buy_now' && buyNow) { anchor = st.cta; after = false; }
        else if (placement === 'below_add_to_cart' && addBtn) { anchor = addBtn; }
        if (!anchor) { anchor = buttons && buttons !== st.cta ? buttons : st.cta; after = false; }
        if (after) insertAfter(st.box, anchor); else insertBefore(st.box, anchor);
      }

      // The offer banner under the product price, when chosen there.
      if (st.priceBanner) {
        var p2 = firstShown(scope, PRICE, form);
        if (p2) insertAfter(st.priceBanner, outermost(p2, PRICE));
        else insertBefore(st.priceBanner, st.box);
      }
      st.addBtn = addBtn;
      st.buyNow = buyNow;
    }

    function connected() {
      return st.form.isConnected && st.box.isConnected && st.cta.isConnected
        && (!st.priceBanner || st.priceBanner.isConnected) && (!st.addBtn || st.addBtn.isConnected)
        && st.buyNow === buyNowHost(st.form);
    }

    /* --- what the shopper sees --- */

    function selection() {
      var sel = formSelection(st.form);
      if (!/^\d+$/.test(sel.variantId)) {
        var m = /[?&]variant=(\d+)/.exec(window.location.search);
        if (m) sel.variantId = m[1];
      }
      return sel;
    }

    function priceOf(variantId) {
      for (var i = 0; i < st.info.variants.length; i++) {
        var v = st.info.variants[i];
        if (v.id === variantId && isFinite(v.price) && v.price >= 0) return v.price / 100;
      }
      return null;
    }

    // COD on this product, for this amount: { shown, reason }.
    function codState(subtotal) {
      var cfg = st.cfg;
      if (!st.pp.cod.enabled || !cfg || st.codOff) return { shown: false };
      if (st.excluded) return cfg.excludedBehavior === 'hide' ? { shown: false } : { shown: true, reason: bxT('storefront.cod.not_for_product', 'Not available for this product') };
      if (subtotal != null && cfg.minOrder > 0 && subtotal < cfg.minOrder) return { shown: true, reason: bxT('storefront.cod.min_order', 'Available on orders from {amount}', { amount: st.fmt(cfg.minOrder) }) };
      if (subtotal != null && cfg.maxOrder > 0 && subtotal > cfg.maxOrder) return { shown: true, reason: bxT('storefront.cod.max_order', 'Available on orders up to {amount}', { amount: st.fmt(cfg.maxOrder) }) };
      return { shown: true };
    }

    function soldOut() {
      var b = st.addBtn;
      return Boolean(b && (b.disabled || b.getAttribute('aria-disabled') === 'true'));
    }

    // This product (`productId`, numeric) was left out of the prepaid
    // discount, by itself or by a collection it's in: no offer on this page
    // (Shopify won't give it at checkout).
    function prepaidExcludedHere(prepaid, productId) {
      var products = prepaid && Array.isArray(prepaid.excludedProducts) ? prepaid.excludedProducts : [];
      if (productId && products.map(String).indexOf(String(productId)) !== -1) return true;
      var ids = prepaid && Array.isArray(prepaid.excludedCollections) ? prepaid.excludedCollections : [];
      for (var i = 0; i < ids.length; i++) if (PRODUCT_COLLECTIONS.indexOf(String(ids[i])) !== -1) return true;
      return false;
    }

    function view() {
      var pp = st.pp;
      var sel = selection();
      var unit = priceOf(sel.variantId);
      var prepaid = pp.online.enabled && !prepaidExcludedHere(pp.prepaid, st.info && st.info.id) ? pp.prepaid : null;
      var active = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || CURRENCY;
      var codFee = codFeeFor(st.cfg, unit != null ? Math.round(unit * sel.quantity * 100) / 100 : null, st.info && st.info.id ? [st.info.id] : null);
      var pr = unit != null
        ? pricing(unit, sel.quantity, prepaid, codFee, Boolean(prepaid && prepaid.currency && prepaid.currency === active))
        // Price unknown: promise the percentage only when there's no minimum to check.
        : { subtotal: null, percent: prepaid ? prepaid.percent : null, qualifies: Boolean(prepaid && !(prepaid.minSubtotal > 0)), minMissing: false, savings: 0, online: null, cod: null, codFee: codFee, codTotal: null };
      var cod = codState(pr.subtotal);
      var shown = { online: Boolean(pp.online.enabled), cod: cod.shown };
      var method = st.method;
      if (!method || !shown[method] || (method === 'cod' && cod.reason && shown.online)) {
        method = pp.defaultMethod === 'cod' && shown.cod && !cod.reason ? 'cod' : shown.online ? 'online' : shown.cod ? 'cod' : null;
      }
      return { sel: sel, pr: pr, prepaid: prepaid, cod: cod, shown: shown, method: method, soldOut: soldOut() };
    }

    function offerLine(v) {
      var p = v.prepaid;
      if (!p || !st.pp.layout.showBanner) return null;
      // The minimum is in the shop currency (what the discount Function compares).
      var vars = { percent: v.pr.percent, amount: v.pr.savings > 0 ? st.fmt(v.pr.savings) : '', min: shortMoney(p.currency || CURRENCY)(p.minSubtotal), price: v.pr.online != null ? st.fmt(v.pr.online) : '' };
      // Texts left at BRIX's English default show in the shopper's language ('' = none).
      if (v.pr.qualifies) {
        var title = p.offerTitle ? fill(bxText(p.offerTitle, 'storefront.pay.offer_title', '{percent}% off when you pay online', vars), vars) : '';
        // {amount} needs a real price: without one, the description isn't shown.
        var sub = p.offerDescription && (v.pr.savings > 0 || !/\{amount\}|\{price\}/.test(p.offerDescription)) ? fill(bxText(p.offerDescription, 'storefront.pay.offer_description', 'Pay online and save {amount}', vars), vars) : '';
        return title ? { title: title, sub: sub } : null;
      }
      if (v.pr.minMissing && p.minNotMetText) return { title: fill(bxText(p.minNotMetText, 'storefront.pay.min_not_met', 'Get {percent}% off on orders above {min}', vars), vars), sub: '' };
      return null;
    }

    function bannerHtml(line) {
      return '<div class="bxpay-banner" data-brix-pay-banner>' + icon('tag', 18) + '<div><b>' + esc(line.title) + '</b>' + (line.sub ? '<span>' + esc(line.sub) + '</span>' : '') + '</div></div>';
    }

    function cardHtml(method, v, line) {
      var pp = st.pp;
      var on = v.method === method;
      var isOnline = method === 'online';
      var conf = isOnline ? pp.online : pp.cod;
      var disabled = !isOnline && Boolean(v.cod.reason);
      var color = isOnline ? st.colors.online : st.colors.cod;
      var label = isOnline ? bxText(conf.label, 'storefront.pay.online_label', 'Pay Online') : bxText(conf.label, 'storefront.cod.title', 'Cash on Delivery');
      var description = !conf.description ? '' : isOnline ? bxText(conf.description, 'storefront.pay.online_description', 'Get instant savings')
        : bxText(conf.description, 'storefront.pay.cod_description', 'Pay when your order arrives');
      var top = '<b class="bxpay-l">' + esc(label) + '</b>';
      var rest = '';
      var sr = '';
      if (isOnline) {
        if (v.pr.qualifies && v.prepaid && v.prepaid.showBadge) top += '<span class="bxpay-badge">' + esc(bxT('storefront.cod.save_percent', 'Save {percent}%', { percent: Number(v.pr.percent) })) + '</span>';
        if (description) rest += '<span class="bxpay-d">' + esc(description) + '</span>';
        if (line && pp.layout.bannerPlacement === 'in_online_card') rest += '<span class="bxpay-o">' + esc(line.title) + '</span>';
        if (v.pr.online != null) {
          if (v.pr.qualifies && v.pr.savings > 0) {
            rest += '<span class="bxpay-p">' + bxHtml('storefront.pay.get_it_for', 'Get it for {price}', 'price', '<b>' + esc(st.fmt(v.pr.online)) + '</b>') + '<s>' + esc(st.fmt(v.pr.subtotal)) + '</s>' +
              (v.prepaid.showSavingsAmount ? ' <span class="bxpay-save">' + esc(bxT('storefront.pay.save_amount', '(save {amount})', { amount: st.fmt(v.pr.savings) })) + '</span>' : '') + '</span>';
            sr = bxT('storefront.pay.online_instead_of', 'Pay online: {price} instead of {was}.', { price: st.fmt(v.pr.online), was: st.fmt(v.pr.subtotal) });
          } else {
            rest += '<span class="bxpay-p">' + bxHtml('storefront.pay.pay', 'Pay {price}', 'price', '<b>' + esc(st.fmt(v.pr.subtotal)) + '</b>') + '</span>';
          }
        }
      } else {
        if (description) rest += '<span class="bxpay-d">' + esc(description) + '</span>';
        if (disabled) rest += '<span class="bxpay-why">' + esc(v.cod.reason) + '</span>';
        else if (v.pr.cod != null) {
          var fee = v.pr.codFee > 0 && st.cfg.showCodFee !== false ? ' + ' + st.fmt(v.pr.codFee) + ' ' + feeLabel(st.cfg) : '';
          rest += '<span class="bxpay-p">' + bxHtml('storefront.pay.pay', 'Pay {price}', 'price', '<b>' + esc(st.fmt(v.pr.cod)) + '</b>') + esc(fee) + '</span>';
        }
      }
      var showIcon = pp.layout.showIcons && conf.showIcon;
      return '<div class="bxpay-card" role="radio" data-method="' + method + '" aria-checked="' + (on ? 'true' : 'false') + '"' +
        (disabled ? ' aria-disabled="true"' : '') + ' tabindex="' + (on ? '0' : '-1') + '" style="--c:' + color + '">' +
        (pp.layout.showRadio ? '<span class="bxpay-radio" aria-hidden="true"></span>' : '') +
        (showIcon ? '<span class="bxpay-ic">' + icon(isOnline ? 'card' : 'cash', 22) + '</span>' : '') +
        '<span class="bxpay-main"><span class="bxpay-top">' + top + '</span>' + rest + (sr ? '<span class="bxpay-sr">' + esc(sr) + '</span>' : '') + '</span>' +
        '<span class="bxpay-tick" aria-hidden="true">' + icon('check', 12) + '</span></div>';
    }

    function render(v) {
      var pp = st.pp;
      var box = st.box;
      if (!v.shown.online && !v.shown.cod) {
        box.innerHTML = '';
        box.style.setProperty('display', 'none', 'important');
        st.cta.innerHTML = '';
        if (st.priceBanner) st.priceBanner.innerHTML = '';
        return;
      }
      box.style.setProperty('display', 'block', 'important');
      var line = offerLine(v);
      var where = pp.layout.bannerPlacement;
      var layout = pp.layout;
      var classes = 'bxpay cs-' + layout.cardStyle + ' ss-' + (layout.selectedStyle === 'background' ? 'background' : 'border') + (layout.showRadio ? '' : ' no-radio');
      var headId = 'bxpay-h-' + st.id;
      var html = '<div class="' + classes + '" dir="' + bxDir() + '" style="' + st.vars + '">' +
        (line && where === 'above_selector' ? bannerHtml(line) : '') +
        (pp.heading ? '<span class="bxpay-h" id="' + headId + '">' + esc(bxText(pp.heading, 'storefront.pay.heading', 'Choose payment method')) + '</span>' : '') +
        '<div class="bxpay-cards' + (layout.cardLayout === 'horizontal' ? ' is-h' : '') + '" role="radiogroup" ' +
        (pp.heading ? 'aria-labelledby="' + headId + '"' : 'aria-label="' + esc(bxT('storefront.pay.method', 'Payment method')) + '"') + '>' +
        (v.shown.online ? cardHtml('online', v, line) : '') + (v.shown.cod ? cardHtml('cod', v, line) : '') +
        '</div></div>';
      box.innerHTML = html;
      if (st.priceBanner) st.priceBanner.innerHTML = line && where === 'below_price' ? '<div class="bxpay" style="' + st.vars + ';margin:10px 0">' + bannerHtml(line) + '</div>' : '';

      // The purchase button for the chosen method.
      var look = Object.assign({}, PRODUCT_BUTTON_DEFAULTS, (st.cfg && st.cfg.productButton) || {});
      if (v.method === 'cod') {
        st.cta.innerHTML = buttonHtml(st.cfg, codLabel(st.cfg, productText(st.cfg), v.pr.subtotal, st.info && st.info.id ? [st.info.id] : null), v.cod.reason || '', Boolean(v.cod.reason) || v.soldOut, look, { look: lookOf(st.cfg, 'product') });
      } else if (v.method === 'online' && !st.buyNow) {
        var bg = st.colors.online;
        st.cta.innerHTML = buttonHtml(st.cfg, onlineLabel(pp.online.buttonText, v.pr, v.prepaid), '', v.soldOut, look, {
          attr: 'data-brix-pay-online', icon: 'card', look: lookOf(st.cfg, 'product'), paint: 'background:' + bg + ';color:' + readableOn(bg) + ';box-shadow:none;',
        });
      } else {
        st.cta.innerHTML = '';
      }
      if (st.focus) {
        var card = box.querySelector('.bxpay-card[data-method="' + st.focus + '"]');
        st.focus = null;
        if (card) { try { card.focus(); } catch (e) { /* ignore */ } }
      }
    }

    // Shopify's Buy it now: hidden while COD is chosen; its text gets the
    // saving while Pay Online is chosen. Only DOM writes when something differs,
    // so the page's MutationObserver settles straight away.
    var nativeButton = buyNowButton;

    function applyNative(v) {
      var scope = st.form.closest('.shopify-section') || st.form;
      var hide = v.method === 'cod';
      if (hide !== scope.hasAttribute('data-brix-pay-cod')) {
        if (hide) scope.setAttribute('data-brix-pay-cod', ''); else scope.removeAttribute('data-brix-pay-cod');
      }
      st.scope = scope;
      // A Buy it now found by the merchant's selector (COD → Customize →
      // Product page, e.g. Shiprocket's .shiprocket-headless) isn't one of
      // Shopify's that the rule above hides: it stayed next to "Buy with COD"
      // with COD chosen. Hidden on itself (a redrawn one is marked again here).
      var customs = customBuyNows(st.cfg);
      customs.forEach(function (custom) {
        if (hide === custom.hasAttribute('data-brix-pay-hidden')) return;
        if (hide) custom.setAttribute('data-brix-pay-hidden', ''); else custom.removeAttribute('data-brix-pay-hidden');
      });
      var btns = customs.length ? customs.map(textTarget).filter(Boolean) : [nativeButton(st.buyNow)].filter(Boolean);
      var tagged = hasPriceTags(st.pp.online.buttonText);
      var relabel = st.pp.relabelBuyNow && (tagged ? v.pr.subtotal != null : v.pr.qualifies && v.prepaid && v.prepaid.showBadge);
      var label = relabel ? onlineLabel(st.pp.online.buttonText, v.pr, v.prepaid) : null;
      btns.forEach(function (btn) {
        if (!btn.hasAttribute('data-brix-pay-orig')) btn.setAttribute('data-brix-pay-orig', btn.textContent.replace(SAVE_SUFFIX, '').trim());
        if (label) { setButtonText(btn, label); return; }
        clearButtonLabel(btn);
        var orig = btn.getAttribute('data-brix-pay-orig');
        if (orig && btn.textContent !== orig) btn.textContent = orig;
      });
    }

    function track(name, params) { Track.ui(st.cfg, name, params); }

    function keyOf(v) {
      return [v.method, v.sel.variantId, v.sel.quantity, v.pr.subtotal, v.cod.reason || '', v.soldOut, Boolean(st.buyNow)].join('|');
    }

    function refresh(force) {
      if (!st) return;
      if (!connected()) {
        var form = findProductForm(st.info.variantIds);
        if (!form) return;
        st.form = form;
        place();
        force = true;
      }
      var v = view();
      var key = keyOf(v);
      if (force || key !== st.key) {
        st.key = key;
        st.method = v.method;
        render(v);
        if (!st.viewed && (v.shown.online || v.shown.cod)) {
          st.viewed = true;
          track('brix_payment_method_viewed', { methods: [v.shown.online && 'online', v.shown.cod && 'cod'].filter(Boolean).join(','), default_method: v.method || '' });
        }
        if (!st.offerViewed && v.pr.qualifies && v.shown.online) {
          st.offerViewed = true;
          track('brix_prepaid_offer_viewed', { percent: Number(v.pr.percent) });
        }
      }
      st.last = v;
      applyNative(v);
    }

    function choose(method, byKeyboard) {
      var v = st.last;
      if (!v || !v.shown[method] || method === v.method) { if (byKeyboard) st.focus = method; return; }
      if (method === 'cod' && v.cod.reason) return;
      st.method = method;
      st.focus = byKeyboard ? method : null;
      track('brix_payment_method_selected', { payment_method: method });
      refresh(true);
    }

    function bindBox(box) {
      box.addEventListener('click', function (e) {
        var card = e.target.closest && e.target.closest('.bxpay-card');
        if (card && box.contains(card)) choose(card.getAttribute('data-method'), false);
      });
      box.addEventListener('keydown', function (e) {
        var card = e.target.closest && e.target.closest('.bxpay-card');
        if (!card) return;
        var cards = [].slice.call(box.querySelectorAll('.bxpay-card:not([aria-disabled="true"])'));
        var i = cards.indexOf(card);
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); choose(card.getAttribute('data-method'), true); return; }
        var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step || cards.length < 2) return;
        e.preventDefault();
        var next = cards[(i + step + cards.length) % cards.length];
        choose(next.getAttribute('data-method'), true);
      });
    }

    function bindCta(cta) {
      cta.addEventListener('click', function (e) {
        var cod = e.target.closest && e.target.closest('[data-brix-cod-btn]');
        var online = e.target.closest && e.target.closest('[data-brix-pay-online]');
        if (!cod && !online) return;
        e.preventDefault();
        e.stopPropagation();
        var v = st.last;
        var sel = selection();
        if (!/^\d+$/.test(sel.variantId) || (cod && cod.disabled) || (online && online.disabled)) return;
        if (online) {
          if (v && v.pr.qualifies) track('brix_prepaid_offer_clicked', { percent: Number(v.pr.percent) });
          // Buy now: a checkout with just this item, where Shopify applies the
          // prepaid discount (Shiprocket shops: Shiprocket with a code for it).
          payOnlineItems([sel], { prepaid: Boolean(v && v.pr.qualifies) });
          return;
        }
        open({
          surface: 'product',
          items: [sel],
          onPayOnline: function () { payOnlineItems([sel], { prepaid: Boolean(st.last && st.last.pr.qualifies) }); },
        });
      });
    }

    function start(cfg, pp) {
      if (st || !pp || !pp.online || !pp.cod || !pp.layout || !pp.appearance) return;
      // Both methods off (or COD unavailable with Pay Online off): nothing on the page.
      if (!pp.online.enabled && !pp.cod.enabled) return;
      productInfo().then(function (info) {
        var form = findProductForm(info.variantIds);
        if (!form || st) return;
        ensureStyle();
        var a = pp.appearance;
        var colors = {
          online: hex(a.onlineColor, '#008060'), cod: hex(a.codColor, '#111827'), bg: hex(a.cardBackground, '#ffffff'),
          border: hex(a.borderColor, '#d1d5db'), selBg: hex(a.selectedBackground, '#f0fdf4'),
          badgeBg: hex(a.badgeBackground, '#008060'), badgeFg: hex(a.badgeText, '#ffffff'),
        };
        var gap = SPACING[pp.layout.spacing] || 12;
        var radius = Math.max(0, Math.min(24, Math.round(Number(pp.layout.radius)) || 0));
        st = {
          id: ++seq,
          cfg: cfg,
          pp: pp,
          info: info,
          form: form,
          excluded: Boolean(cfg) && hasExcludedTag(info.tags, excludedTags(cfg)),
          // No COD card for a product the merchant's picks leave out, or an
          // unlisted product COD may not sell (as without payment options).
          codOff: Boolean(cfg) && (!codShownHere(cfg, info) || unlistedBlockedHere(cfg, info)),
          method: null,
          colors: colors,
          fmt: shortMoney((window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || CURRENCY),
          vars: '--bxpay-online:' + colors.online + ';--bxpay-bg:' + colors.bg + ';--bxpay-fg:' + readableOn(colors.bg) +
            ';--bxpay-fill:color-mix(in srgb,' + colors.border + ' 30%,' + colors.bg + ');--bxpay-border:' + colors.border +
            ';--bxpay-sel-bg:' + colors.selBg + ';--bxpay-sel-fg:' + readableOn(colors.selBg) +
            ';--bxpay-badge-bg:' + colors.badgeBg + ';--bxpay-badge-fg:' + colors.badgeFg +
            ';--bxpay-r:' + radius + 'px;--bxpay-gap:' + gap + 'px;--bxpay-pad:' + (gap + 2) + 'px ' + (gap + 2) + 'px',
          box: newSlot('data-brix-pay'),
          cta: newSlot('data-brix-pay-cta'),
          priceBanner: pp.layout.bannerPlacement === 'below_price' && pp.layout.showBanner ? newSlot('data-brix-pay-banner-slot') : null,
          key: '',
        };
        bindBox(st.box);
        bindCta(st.cta);
        place();
        refresh(true);

        // A tap on Shopify's Buy it now while Pay Online is chosen. On shops
        // that check out through Shiprocket, its text button (not Shop Pay /
        // PayPal) goes to Shiprocket with the prepaid code instead of Shopify
        // checkout; only when that's known at the tap, else Shopify as before.
        document.addEventListener('click', function (e) {
          var v = st.last;
          if (!v || v.method !== 'online' || !st.buyNow) return;
          var path = e.composedPath ? e.composedPath() : [];
          var customs = customBuyNows(st.cfg);
          var hit = customs.filter(function (c) { return path.indexOf(c) >= 0; })[0];
          if (!(hit || path.indexOf(st.buyNow) >= 0 || (e.target.closest && e.target.closest(BUY_NOW) === st.buyNow))) return;
          if (v.pr.qualifies) track('brix_prepaid_offer_clicked', { percent: Number(v.pr.percent) });
          var text = customs.length ? (hit || st.buyNow) : nativeButton(st.buyNow);
          if (!shiprocketOn() || !text || path.indexOf(text) < 0 || v.soldOut) return;
          var sel = selection();
          if (!/^\d+$/.test(sel.variantId)) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          payOnlineItems([sel], { prepaid: v.pr.qualifies });
        }, true);

        // Variant and quantity changes: themes fire change/input, redraw the
        // form, or set the hidden variant id without any event. All three end
        // in refresh(), which only touches the page when something changed.
        var timer = null;
        var soon = function () { clearTimeout(timer); timer = setTimeout(function () { refresh(false); }, 120); };
        document.addEventListener('change', soon, true);
        document.addEventListener('input', soon, true);
        if (window.MutationObserver) {
          new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
              var t = records[i].target.nodeType === 1 ? records[i].target : records[i].target.parentElement;
              if (t && !t.closest('[data-brix-pay], [data-brix-pay-cta], [data-brix-pay-banner-slot]')) { soon(); return; }
            }
          }).observe(document.querySelector('main') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'value'] });
        }
        setInterval(function () { if (!document.hidden) refresh(false); }, 600);
      });
    }

    // For the browser checks: what the selector currently shows.
    function snapshot() {
      if (!st || !st.last) return null;
      var v = st.last;
      return { method: v.method, shown: v.shown, pricing: v.pr, variantId: v.sel.variantId, quantity: v.sel.quantity };
    }

    return { start: start, snapshot: snapshot, pricing: pricing, fill: fill, onlineLabel: onlineLabel, prepaidExcludedHere: prepaidExcludedHere };
  })();

  function initProductButton() {
    if (!isProductPage()) return;
    loadConfig().then(function (cfg) {
      // Payment options on: they own the product page's COD button. Off with
      // a prepaid discount still on (cards: false): only its details come, for
      // the drawers; the product page keeps its plain COD button.
      if (paymentValue && paymentValue.cards !== false) { Pay.start(cfg, paymentValue); return; }
      if (!cfg || cfg.surfaces.product === false) return;
      productInfo().then(function (info) {
        // Left out by the merchant's product picks, or an unlisted product COD may not sell.
        if (!codShownHere(cfg, info) || unlistedBlockedHere(cfg, info)) return;
        var excluded = hasExcludedTag(info.tags, excludedTags(cfg));
        if (excluded && cfg.excludedBehavior === 'hide') return;
        mountProductButton(cfg, info, excluded);
        // Price tags in the button text follow the chosen variant and quantity
        // (themes fire change/input, or set the hidden variant id silently).
        if (hasPriceTags(cfg.buttons.productText) || (cfg.productButton && cfg.productButton.buyNowText) || cfg.codFeePercent > 0) {
          var relabel = function () { if (productMount && productMount.relabel) productMount.relabel(); };
          var later = null;
          var soon = function () { clearTimeout(later); later = setTimeout(relabel, 120); };
          document.addEventListener('change', soon, true);
          document.addEventListener('input', soon, true);
          setInterval(function () { if (!document.hidden) relabel(); }, 600);
        }
        // Many themes redraw the product form or its buttons when a variant is
        // picked, which removes the COD button; put it back when that happens.
        if (!window.MutationObserver) return;
        var timer = null;
        new MutationObserver(function () {
          clearTimeout(timer);
          timer = setTimeout(function () { mountProductButton(cfg, info, excluded); }, 120);
        }).observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
      });
    });
  }

  window.BrixCod = {
    open: open,
    isAvailable: isAvailable,
    config: loadConfig,
    comboButton: comboButton,
    mountDrawerButton: mountDrawerButton,
    paymentSnapshot: Pay.snapshot,
    prepaidCartCode: prepaidCartCode,
    prepareCartCode: prepareCartCode,
    priceTagValues: priceTagValues,
    payOnlinePack: payOnlinePack,
    setPackPrice: setPackPrice,
  };

  function init() {
    initProductButton();
    initThemeDrawer();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

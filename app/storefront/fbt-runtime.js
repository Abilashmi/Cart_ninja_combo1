/* BRIX Frequently Bought Together - storefront widget (runtime).
 *
 * Built into extensions/cart-drawer/assets/brix_fbt.js by
 * scripts/build-fbt-asset.mjs, which puts the shared core
 * (app/utils/fbt-core.shared.js createFbtCore) where the marker below is.
 * Edit this file and the core, then run `npm run build:fbt`. ES5 only and
 * ASCII only: the asset may be served without a charset.
 *
 * Each [data-brix-fbt] element (snippets/fbt-widget-render.liquid) gets the
 * widget for its product page:
 *   1. settings from php_backend/save_fbt_widget.php (fbt_widget.config_v2,
 *      or the pre-v2 rules and template converted by FbtCore.fromLegacy),
 *   2. which products to offer: FbtCore.plan (merchant rules for this
 *      product, its collections, every product; then the automatic pairs;
 *      then Shopify's own recommendations), each resolved through
 *      /products/<handle>.js so only products that can be bought show,
 *   3. FbtCore.html renders it (Amazon-style bundle, or cards that each add
 *      one product), and items go to /cart/add.js marked _brix_source=fbt so
 *      the order is counted as an FBT order (webhooks.orders.paid).
 */
(function () {
  'use strict';
  if (window.__brixFbtLoaded) return;
  window.__brixFbtLoaded = true;

  // Replaced by the shared core when the asset is built.
  var FbtCore = (/*__FBT_CORE__*/ function () { return null; })();
  var PHP = 'https://int.thebrix.io';
  var ROOT = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  var CACHE_MS = 60000;
  var configPromise = {};

  function getJson(url) {
    return window.fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  function list(value) {
    return String(value || '').split(',').map(function (s) { return s.replace(/^\s+|\s+$/g, ''); }).filter(Boolean);
  }

  /* --- settings --- */

  function parseMaybe(value) {
    if (value && typeof value === 'object') return value;
    if (typeof value !== 'string' || !value) return null;
    try { return JSON.parse(value); } catch (e) { return null; }
  }

  // { enabled, config, placement } for the shop; cached per page and briefly
  // in sessionStorage so moving between product pages doesn't refetch.
  function loadSettings(shop) {
    if (configPromise[shop]) return configPromise[shop];
    var key = 'brix_fbt_cfg_v2:' + shop;
    try {
      var cached = JSON.parse(window.sessionStorage.getItem(key) || 'null');
      if (cached && Date.now() - cached.at < CACHE_MS) {
        configPromise[shop] = Promise.resolve(cached.value);
        return configPromise[shop];
      }
    } catch (e) { /* storage blocked */ }
    configPromise[shop] = getJson(PHP + '/save_fbt_widget.php?shopdomain=' + encodeURIComponent(shop)).then(function (res) {
      var data = res && res.status === 'success' ? res.data : null;
      if (!data) return { enabled: false };
      var tplKey = data.selectedTemp || 'fbt1';
      var tpl = parseMaybe(data[{ fbt1: 'temp1', fbt2: 'temp2', fbt3: 'temp3' }[tplKey] || 'temp1']) || {};
      var v2 = parseMaybe(data.config_v2);
      var value = {
        enabled: data.publishable !== false && data.isEnabled !== false,
        config: v2 ? FbtCore.normalizeConfig(v2) : FbtCore.fromLegacy(parseMaybe(data.condition) || [], tpl, data.aiProductCount != null ? data.aiProductCount : data.ai_product_count),
        placement: v2 ? FbtCore.normalizeConfig(v2).placement : tpl.widgetPlacement || data.widgetPlacement || 'below_cart',
      };
      try { window.sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), value: value })); } catch (e) { /* ignore */ }
      return value;
    }).catch(function () { return { enabled: false }; });
    return configPromise[shop];
  }

  /* --- which products --- */

  function productJson(handle) {
    return getJson(ROOT + 'products/' + encodeURIComponent(handle) + '.js').catch(function () { return null; });
  }

  function fromCollection(handle, max) {
    return getJson(ROOT + 'collections/' + encodeURIComponent(handle) + '/products.json?limit=' + Math.min(30, max + 6))
      .then(function (res) {
        return ((res && res.products) || []).map(function (p) { return { id: String(p.id), handle: p.handle, title: p.title }; });
      })
      .catch(function () { return []; });
  }

  function fromShopify(productId, max) {
    function get(intent) {
      return getJson(ROOT + 'recommendations/products.json?product_id=' + encodeURIComponent(productId) + '&limit=' + Math.min(10, max + 2) + '&intent=' + intent)
        .then(function (res) { return ((res && res.products) || []).map(function (p) { return { id: String(p.id), handle: p.handle, title: p.title }; }); })
        .catch(function () { return []; });
    }
    // Complementary (set up in Shopify's Search & Discovery app) first, then related.
    return get('complementary').then(function (items) {
      return items.length >= max ? items : get('related').then(function (more) { return items.concat(more); });
    });
  }

  // Candidate product refs in priority order, a few more than needed so
  // sold-out ones can be dropped.
  function candidates(config, product) {
    var steps = FbtCore.plan(config, product);
    var want = config.maxItems + 3;
    var picked = [];
    var i = 0;
    function next() {
      if (i >= steps.length || picked.length >= want) return Promise.resolve(picked);
      var step = steps[i++];
      if (step.kind === 'products') {
        FbtCore.addOffers(picked, step.items, product.id, want);
        return next();
      }
      var more = step.kind === 'collection' ? fromCollection(step.ref.handle, want) : fromShopify(product.id, want);
      return more.then(function (items) { FbtCore.addOffers(picked, items, product.id, want); return next(); });
    }
    return next();
  }

  /* --- cart --- */

  function openCartDrawer(detail) {
    try {
      if (window.__CC_DRAWER_API && typeof window.__CC_DRAWER_API.openNow === 'function') { window.__CC_DRAWER_API.openNow(detail || {}); return; }
    } catch (e) { /* fall through */ }
    ['cc:open-now', 'theme:cart:open', 'cart:open', 'cart:refresh'].forEach(function (name) {
      try {
        document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
        window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
      } catch (e) { /* old browser */ }
    });
  }

  function addToCart(items) {
    return window.fetch(ROOT + 'cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        items: items.map(function (it) { return { id: Number(it.variantId), quantity: 1, properties: { _brix_source: 'fbt' } }; }),
      }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw new Error((body && (body.description || body.message)) || 'Could not add to cart.');
        return body;
      });
    });
  }

  /* --- placement (next to the product's Add to cart) --- */

  var ATC = ['form[action*="/cart/add"] [type="submit"][name="add"]', 'form[action*="/cart/add"] [type="submit"]', 'button[name="add"]',
    '.product-form__submit', '#AddToCart', '[id^="ProductSubmitButton"]', '[data-add-to-cart]', 'product-form button[type="submit"]'];

  function findAtc() {
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < ATC.length; i++) {
        var nodes = document.querySelectorAll(ATC[i]);
        for (var j = 0; j < nodes.length; j++) {
          var b = nodes[j];
          if (b.closest('[data-brix-fbt], cart-drawer, .quick-add-modal, product-recommendations')) continue;
          if (pass === 1 || b.offsetParent !== null) return b;
        }
      }
    }
    return null;
  }

  function place(el, placement) {
    if (el.getAttribute('data-in-section') === '1' || placement === 'custom') return;
    function go() {
      var atc = findAtc();
      if (!atc) return false;
      var anchor = atc.closest('.product-form__buttons, .product-form__buy-buttons, [class*="buy-buttons"], .product-form__submit') || atc;
      var form = atc.closest('form');
      if (form && !form.contains(anchor)) anchor = atc;
      if (placement === 'above_cart') { if (anchor.previousSibling !== el) anchor.parentNode.insertBefore(el, anchor); }
      else if (anchor.nextSibling !== el) anchor.parentNode.insertBefore(el, anchor.nextSibling);
      return true;
    }
    if (go() || !window.MutationObserver) return;
    var obs = new MutationObserver(function () { if (go()) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 8000);
  }

  /* --- one widget --- */

  function formVariantId(productId) {
    var forms = document.querySelectorAll('form[action*="/cart/add"]');
    for (var i = 0; i < forms.length; i++) {
      var idEl = forms[i].querySelector('[name="id"]');
      if (!idEl || forms[i].closest('[data-brix-fbt], cart-drawer, .quick-add-modal, product-recommendations')) continue;
      if (forms[i].querySelector('[name="product-id"]') && forms[i].querySelector('[name="product-id"]').value !== String(productId)) continue;
      return String(idEl.value || '');
    }
    var m = /[?&]variant=(\d+)/.exec(window.location.search);
    return m ? m[1] : '';
  }

  function ensureCss() {
    if (document.getElementById('brix-fbt-css')) return;
    var style = document.createElement('style');
    style.id = 'brix-fbt-css';
    style.textContent = FbtCore.css();
    document.head.appendChild(style);
  }

  function mount(el) {
    if (el.getAttribute('data-brix-fbt-mounted')) return;
    el.setAttribute('data-brix-fbt-mounted', '1');
    var shop = el.getAttribute('data-shop') || (window.Shopify && window.Shopify.shop) || '';
    var product = {
      id: el.getAttribute('data-product-id') || '',
      handle: el.getAttribute('data-product-handle') || '',
      collectionIds: list(el.getAttribute('data-collection-ids')),
      collectionHandles: list(el.getAttribute('data-collection-handles')),
    };
    var moneyFormat = el.getAttribute('data-money-format') || '{{amount}}';
    var designMode = el.getAttribute('data-design-mode') === 'true';
    if (!shop || !product.id || !product.handle) return;

    loadSettings(shop).then(function (s) {
      if (!s.enabled) {
        if (designMode) {
          el.style.display = 'block';
          el.innerHTML = '<div style="padding:14px;border:1.5px dashed #d1d5db;border-radius:8px;color:#6b7280;font-size:13px;text-align:center">BRIX Frequently Bought Together is off, or not on your plan. Turn it on in the BRIX app.</div>';
        }
        return null;
      }
      var config = s.config;
      return Promise.all([candidates(config, product), productJson(product.handle)]).then(function (res) {
        var refs = res[0];
        var current = res[1];
        return Promise.all(refs.map(function (r) { return r.handle ? productJson(r.handle) : Promise.resolve(null); })).then(function (products) {
          var items = [];
          for (var i = 0; i < products.length && items.length < config.maxItems; i++) {
            var p = products[i];
            if (!p || String(p.id) === String(product.id)) continue;
            var item = FbtCore.itemFromProduct(p, 'p' + p.id, config.preselect || config.style === 'cards');
            if (item) items.push(item);
          }
          if (!items.length) return null;
          var cur = current ? FbtCore.itemFromProduct(current, 'current', true, formVariantId(product.id)) : null;
          start(el, config, s.placement, cur, items, moneyFormat);
          return true;
        });
      });
    }).catch(function () { /* the page stays as it is */ });
  }

  function start(el, config, placement, current, items, moneyFormat) {
    var state = { busy: '', added: {}, status: '' };
    var money = function (cents) { return FbtCore.formatMoney(cents, moneyFormat); };
    function all() { return (current ? [current] : []).concat(items); }
    function find(key) { var a = all(); for (var i = 0; i < a.length; i++) if (a[i].key === key) return a[i]; return null; }
    function render() {
      el.innerHTML = FbtCore.html({
        config: config,
        current: config.style === 'bundle' && !config.showCurrent ? null : current,
        items: items, money: money, busy: state.busy, added: state.added, status: state.status,
      });
    }
    // The page's own product follows the variant picked in the product form.
    function syncCurrent() {
      if (!current) return;
      var v = formVariantId(current.productId);
      if (v && v !== current.variantId && FbtCore.chooseVariant(current, v)) render();
    }

    ensureCss();
    el.style.display = 'block';
    el.style.margin = '16px 0';
    el.style.width = '100%';
    render();
    place(el, placement);

    el.addEventListener('change', function (e) {
      var t = e.target;
      var key = t.getAttribute('data-fbt-toggle');
      if (key) { var it = find(key); if (it) { it.checked = t.checked; state.added.all = false; render(); } return; }
      key = t.getAttribute('data-fbt-variant');
      if (key) { var item = find(key); if (item && FbtCore.chooseVariant(item, t.value)) { state.added[key] = false; render(); } }
    });
    el.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-fbt-add], [data-fbt-addall]');
      if (!btn || btn.disabled || state.busy) return;
      e.preventDefault();
      var key = btn.getAttribute('data-fbt-add');
      var chosen;
      if (key) chosen = [find(key)];
      else if (config.style === 'bundle') chosen = all().filter(function (it) { return it.checked; });
      else chosen = all();
      chosen = chosen.filter(Boolean);
      if (!chosen.length) return;
      state.busy = key || 'all';
      state.status = '';
      render();
      addToCart(chosen).then(function (res) {
        state.busy = '';
        state.added[key || 'all'] = true;
        if (!key) chosen.forEach(function (it) { state.added[it.key] = true; });
        render();
        openCartDrawer({ source: 'fbt', items: (res && res.items) || [] });
      }).catch(function (err) {
        state.busy = '';
        state.status = (err && err.message) || 'Could not add to cart.';
        render();
      });
    });
    document.addEventListener('change', function (e) { if (!el.contains(e.target)) setTimeout(syncCurrent, 150); }, true);
    setInterval(function () { if (!document.hidden) syncCurrent(); }, 1000);
  }

  function init() {
    // A section block the merchant placed wins over the app embed's copy.
    var placed = document.querySelector('[data-brix-fbt][data-in-section="1"]');
    var nodes = document.querySelectorAll('[data-brix-fbt]');
    for (var i = 0; i < nodes.length; i++) if (!placed || nodes[i] === placed) mount(nodes[i]);
  }

  window.BrixFbt = { core: FbtCore, init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

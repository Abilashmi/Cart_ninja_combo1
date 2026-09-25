/*
 * BRIX Packs storefront widget.
 *
 * Served at /packs.js by app/routes/packs[.]js.jsx (loaded as a raw string, so
 * this file is plain browser JavaScript — no imports, no JSX).
 *
 * Flow: fetch /api/packs-storefront -> pick the Pack for the variant currently
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
  var shop = root.getAttribute('data-shop');
  var productId = root.getAttribute('data-product-id');
  var preview = /[?&]brix_packs_preview=1\b/.test(location.search);

  var CART_EVENTS = ['cart:item-added', 'cart:updated', 'cart:add', 'cart:refresh', 'on:cart:add', 'shopify:cart:added', 'theme:cart:open', 'cart:open'];
  var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  var state = { data: null, pack: null, tierIndex: 0, chosen: [], busy: false, message: null };
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
    var input = document.querySelector('form[action*="/cart/add"] [name="id"]');
    if (input && input.value) return numericId(input.value);
    var fromUrl = new URLSearchParams(location.search).get('variant');
    return fromUrl ? numericId(fromUrl) : null;
  }

  function packForVariant(packs, variantId) {
    if (!packs.length) return null;
    if (!variantId) return packs.length === 1 ? packs[0] : null;
    for (var i = 0; i < packs.length; i += 1) if (numericId(packs[i].variantId) === variantId) return packs[i];
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
    '.brix-packs-tiers{display:grid;gap:var(--brix-packs-gap);margin:0;padding:0;border:0}',
    '.brix-packs-widget[data-template="visual_offer"] .brix-packs-tiers{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}',
    '.brix-packs-tier{position:relative;display:grid;grid-template-columns:auto 1fr auto;column-gap:12px;align-items:center;width:100%;margin:0;padding:var(--brix-packs-card-pad);background:var(--brix-packs-card);color:var(--brix-packs-text);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius);font:inherit;text-align:left;cursor:pointer}',
    '.brix-packs-tier:hover:not([disabled]){border-color:var(--brix-packs-primary)}',
    '.brix-packs-tier:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:2px}',
    '.brix-packs-tier[aria-checked="true"]{background:var(--brix-packs-selected);border-color:var(--brix-packs-primary);box-shadow:0 0 0 1px var(--brix-packs-primary)}',
    '.brix-packs-tier[disabled]{opacity:.5;cursor:not-allowed}',
    '.brix-packs-radio{width:18px;height:18px;border:2px solid var(--brix-packs-border);border-radius:50%;display:inline-block;position:relative}',
    '.brix-packs-tier[aria-checked="true"] .brix-packs-radio{border-color:var(--brix-packs-primary)}',
    '.brix-packs-tier[aria-checked="true"] .brix-packs-radio::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--brix-packs-primary)}',
    '.brix-packs-title{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:var(--brix-packs-title);font-weight:var(--brix-packs-weight)}',
    '.brix-packs-meta{display:block;font-size:var(--brix-packs-desc);opacity:.75}',
    '.brix-packs-badge{display:inline-block;padding:2px 8px;background:var(--brix-packs-badge);color:var(--brix-packs-text);border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.2px;text-transform:uppercase}',
    '.brix-packs-price{text-align:right;color:var(--brix-packs-price)}',
    '.brix-packs-price strong{display:block;font-size:var(--brix-packs-priceSize);font-weight:var(--brix-packs-weight)}',
    '.brix-packs-was{font-size:var(--brix-packs-desc);text-decoration:line-through;opacity:.6}',
    '.brix-packs-save{display:block;font-size:var(--brix-packs-desc);font-weight:600;color:var(--brix-packs-discount)}',
    '.brix-packs-widget[data-template="visual_offer"] .brix-packs-tier{grid-template-columns:1fr;row-gap:6px;text-align:center;justify-items:center;padding-top:calc(var(--brix-packs-card-pad) + 6px)}',
    '.brix-packs-widget[data-template="visual_offer"] .brix-packs-radio{display:none}',
    '.brix-packs-widget[data-template="visual_offer"] .brix-packs-price{text-align:center}',
    '.brix-packs-widget[data-template="visual_offer"] .brix-packs-title{justify-content:center}',
    '.brix-packs-widget[data-template="visual_offer"] .brix-packs-badge{position:absolute;top:-10px;left:50%;transform:translateX(-50%);white-space:nowrap}',
    '.brix-packs-widget[data-template="visual_offer"] .brix-packs-save{padding:2px 10px;background:var(--brix-packs-selected);border-radius:999px}',
    '.brix-packs-img{display:block;object-fit:cover;border-radius:calc(var(--brix-packs-radius) / 2);max-width:100%}',
    '.brix-packs-img[data-size="small"]{width:48px;height:48px}.brix-packs-img[data-size="medium"]{width:72px;height:72px}.brix-packs-img[data-size="large"]{width:104px;height:104px}',
    '.brix-packs-widget[data-template="visual_offer"][data-image-position="left"] .brix-packs-tier{grid-template-columns:auto 1fr auto;text-align:left;justify-items:stretch}',
    '.brix-packs-widget[data-template="visual_offer"][data-image-position="left"] .brix-packs-price,.brix-packs-widget[data-template="visual_offer"][data-image-position="left"] .brix-packs-title{text-align:left;justify-content:flex-start}',
    '.brix-packs-choose{margin-top:12px;display:grid;gap:8px}',
    '.brix-packs-choose label{display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;font-size:var(--brix-packs-desc)}',
    '.brix-packs-choose select{width:100%;padding:8px;font:inherit;border:1px solid var(--brix-packs-border);border-radius:calc(var(--brix-packs-radius) / 2);background:var(--brix-packs-card);color:var(--brix-packs-text)}',
    '.brix-packs-promo{margin:12px 0 0;font-size:var(--brix-packs-desc);opacity:.8;text-align:var(--brix-packs-align)}',
    '.brix-packs-msg{margin:12px 0 0;padding:8px 10px;border-radius:6px;font-size:13px}',
    '.brix-packs-msg[data-type="error"]{background:#fde7e7;color:#8a1f1f;border:1px solid #f0b3b3}',
    '.brix-packs-msg[data-type="success"]{background:#e3f5ea;color:#14532d;border:1px solid #a7d7b8}',
    '.brix-packs-add{display:block;width:100%;margin-top:var(--brix-packs-btn-gap);padding:13px 16px;background:var(--brix-packs-button);color:var(--brix-packs-button-text);border:0;border-radius:var(--brix-packs-radius);font:inherit;font-weight:700;cursor:pointer}',
    '.brix-packs-add[disabled]{opacity:.55;cursor:not-allowed}',
    '@media (max-width:480px){.brix-packs-tier{column-gap:10px}.brix-packs-widget[data-template="visual_offer"] .brix-packs-tiers{grid-template-columns:1fr 1fr}}',
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

  function tierDisabled(pack, tier) {
    return !pack.available || (pack.maxQuantity !== null && pack.maxQuantity !== undefined && tier.quantity > pack.maxQuantity);
  }

  function ensureChosen(pack, quantity) {
    var next = [];
    for (var i = 0; i < quantity; i += 1) next.push(state.chosen[i] || numericId(pack.variantId));
    state.chosen = next;
  }

  // Effective price/savings for a tier as displayed (choose-each-item recomputes
  // from the variants the shopper picked; other templates use the server values).
  function displayedTier(pack, tier, index) {
    if (pack.template === 'choose_each_item' && index === state.tierIndex && pack.variants) {
      var prices = state.chosen.map(function (id) {
        for (var i = 0; i < pack.variants.length; i += 1) if (pack.variants[i].id === id) return pack.variants[i].price;
        return pack.basePrice;
      });
      return calc(prices, tier, money.decimals);
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
    var images = custom.images || {};

    var section = el('section', { class: 'brix-packs-widget', 'data-template': pack.template, 'data-image-position': images.position === 'left' ? 'left' : 'top', 'aria-label': content.heading || 'Packs' });
    applyCustomization(section, custom);

    var head = el('div', { class: 'brix-packs-head' }, [
      content.heading ? el('h2', { class: 'brix-packs-heading', text: content.heading }) : null,
      content.subheading ? el('p', { class: 'brix-packs-sub', text: content.subheading }) : null,
    ]);
    section.appendChild(head);

    var discount = state.data.checkoutDiscount;
    if (state.data.preview && discount && !discount.verified) {
      section.appendChild(el('div', { class: 'brix-packs-preview', role: 'status', text: 'Preview only \u2014 ' + (discount.message || 'the checkout discount is not active') + ' Shoppers do not see this widget until it is, and this discount will not be applied at checkout.' }));
    }

    var group = el('div', { class: 'brix-packs-tiers', role: 'radiogroup', 'aria-label': content.heading || 'Choose a pack' });
    pack.tiers.forEach(function (tier, index) {
      var shown = displayedTier(pack, tier, index);
      var disabled = tierDisabled(pack, tier);
      var selected = index === state.tierIndex;
      var saveText = null;
      if (savingsCfg.visible !== false && shown.savings > 0) {
        if (savingsCfg.mode === 'save_percent' || money.hidden) saveText = 'Save ' + percentLabel(shown.subtotal, shown.savings);
        else saveText = 'Save ' + money.format(shown.savings);
      }
      var image = (pack.template === 'visual_offer' && images.enabled !== false && pack.productImage)
        ? el('img', { class: 'brix-packs-img', src: pack.productImage, alt: '', loading: 'lazy', 'data-size': images.size || 'medium' }) : null;
      var meta = tier.quantity + ' item' + (tier.quantity === 1 ? '' : 's');
      if (!money.hidden && shown.savings > 0 && tier.quantity > 0) meta += ' \u00b7 ' + money.format(shown.price / tier.quantity) + ' each';
      var button = el('button', {
        type: 'button', class: 'brix-packs-tier', role: 'radio', 'aria-checked': selected ? 'true' : 'false', 'data-index': index,
        disabled: disabled, title: disabled ? (pack.available ? 'Only ' + pack.maxQuantity + ' in stock' : 'Sold out') : null,
        tabindex: selected ? '0' : '-1',
        onclick: function () { selectTier(index); },
        onkeydown: function (event) { onTierKey(event, index); },
      }, [
        el('span', { class: 'brix-packs-radio', 'aria-hidden': 'true' }),
        image,
        el('span', {}, [
          el('span', { class: 'brix-packs-title' }, [tier.name || 'Buy ' + tier.quantity, tier.badge ? el('span', { class: 'brix-packs-badge', text: tier.badge }) : null]),
          el('span', { class: 'brix-packs-meta', text: meta }),
        ]),
        money.hidden ? el('span', { class: 'brix-packs-price' }, [saveText ? el('span', { class: 'brix-packs-save', text: saveText }) : null]) : el('span', { class: 'brix-packs-price' }, [
          shown.savings > 0 ? el('span', { class: 'brix-packs-was', text: money.format(shown.subtotal) }) : null,
          el('strong', { text: money.format(shown.price) }),
          saveText ? el('span', { class: 'brix-packs-save', text: saveText }) : null,
        ]),
      ]);
      group.appendChild(button);
    });
    section.appendChild(group);

    if (pack.template === 'choose_each_item' && pack.variants) section.appendChild(renderChoosers(pack));

    if (content.promoText) section.appendChild(el('p', { class: 'brix-packs-promo', text: content.promoText }));
    if (state.message) section.appendChild(el('div', { class: 'brix-packs-msg', role: 'alert', 'data-type': state.message.type, text: state.message.text }));

    var selectedTier = pack.tiers[state.tierIndex];
    var addDisabled = state.busy || !selectedTier || tierDisabled(pack, selectedTier);
    section.appendChild(el('button', { type: 'button', class: 'brix-packs-add', disabled: addDisabled, onclick: addToCart, text: state.busy ? 'Adding\u2026' : (pack.available ? (content.cta || 'Add Pack to Cart') : 'Sold out') }));
    root.appendChild(section);
  }

  function renderChoosers(pack) {
    var tier = pack.tiers[state.tierIndex];
    var wrap = el('div', { class: 'brix-packs-choose' });
    if (!tier) return wrap;
    ensureChosen(pack, tier.quantity);
    var sellable = pack.variants.filter(function (variant) { return variant.availableForSale; });
    for (var i = 0; i < tier.quantity; i += 1) {
      (function (slot) {
        var select = el('select', { id: 'brix-packs-item-' + slot, 'aria-label': 'Item ' + (slot + 1) + ' variant', onchange: function (event) { state.chosen[slot] = event.target.value; state.message = null; render(); } },
          sellable.map(function (variant) {
            return el('option', { value: variant.id, selected: variant.id === state.chosen[slot], text: variant.title + (money.hidden ? '' : ' \u2014 ' + money.format(variant.price)) });
          }));
        wrap.appendChild(el('label', { for: 'brix-packs-item-' + slot }, [el('span', { text: 'Item ' + (slot + 1) }), select]));
      })(i);
    }
    return wrap;
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
    if (pack.template !== 'choose_each_item') return [{ id: Number(numericId(pack.variantId)), quantity: tier.quantity, properties: properties }];
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

  function addToCart() {
    var pack = state.pack;
    var tier = pack && pack.tiers[state.tierIndex];
    if (!tier || state.busy) return;
    state.busy = true;
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
        state.message = { type: 'success', text: 'Added to your cart.' };
        var detail = { packId: pack.id, quantity: tier.quantity, items: body && body.items };
        document.dispatchEvent(new CustomEvent('brix:packs:added', { detail: detail }));
        notifyCartUpdated(detail);
      })
      .catch(function (error) {
        state.message = { type: 'error', text: error && error.message && error.message.indexOf('Failed to fetch') < 0 ? error.message : 'Could not reach the cart. Check your connection and try again.' };
      })
      .then(function () { state.busy = false; render(); });
  }

  // ── boot ───────────────────────────────────────────────────────────────────

  function place() {
    var form = document.querySelector('form[action*="/cart/add"]');
    if (form && form.parentNode && root.nextElementSibling !== form) form.parentNode.insertBefore(root, form);
  }

  function showFor(variantId) {
    var next = packForVariant(state.data.packs, variantId);
    if (next === state.pack) return;
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

  if (!shop || !productId || !api) { fail('missing shop, product or API address.'); return; }

  var url = api + '/api/packs-storefront?shop=' + encodeURIComponent(shop) + '&productId=' + encodeURIComponent(productId) + (preview ? '&preview=1' : '');
  fetch(url, { headers: { Accept: 'application/json' } })
    .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
    .then(function (result) {
      if (!result.ok || !result.body || !result.body.success) { fail((result.body && result.body.error) || 'the Packs service returned an error.'); return; }
      var data = result.body;
      if (!data.packs || !data.packs.length) {
        if (preview) fail('no widget to show (' + (data.reason || 'no active Pack') + ').');
        return;
      }
      injectStyle();
      money = makeMoney(data.currency);
      state.data = data;
      place();
      lastVariant = currentVariantId();
      showFor(lastVariant);
      setInterval(function () {
        var variant = currentVariantId();
        if (variant !== lastVariant) { lastVariant = variant; showFor(variant); }
      }, 700);
    })
    .catch(function () { fail('could not reach the Packs service.'); });
})();

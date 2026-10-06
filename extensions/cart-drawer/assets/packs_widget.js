/*
 * BRIX Packs storefront widget.
 *
 * Stores load it from the theme extension (blocks/Packs.liquid -> asset_url);
 * the admin preview and tests load it from the Node app's /packs.js
 * (app/routes/packs[.]js.jsx). Plain browser JavaScript — no imports, no JSX.
 * The admin's PackPreview also imports this file and mounts it through
 * window.BrixPacksWidget.mount, so the builder preview IS the storefront UI.
 *
 * Data source: `data-endpoint` on the root. On stores that is
 * php_backend/packs_storefront.php via the app proxy, which returns stored
 * Packs WITHOUT prices (pricing:'client'); they are priced here from the
 * product page's live Liquid variant data (see priceOnPage). Without
 * `data-endpoint` it uses the Node /api/packs-storefront, which returns
 * Packs already priced from the Shopify Admin API.
 *
 * Flow: fetch Pack data -> pick the Pack for the variant currently selected
 * on the product page -> the shopper picks a pack size (horizontal pack
 * cards), then one REAL Shopify variant per item, through one of three
 * templates (customization.design.preset):
 *   slots       Horizontal Select    one slot per item, a dropdown per Shopify option
 *   quick_add   Quick Add Picker     grid of variant cards with a top-right "+"
 *   image_slots Image Variant Select packs as rows; per item its photo and a
 *               dropdown per Shopify option side by side, like slots — an
 *               option whose values have their own variant photos gets a
 *               photo dropdown. Nothing is pre-selected.
 * Option names/values come from Shopify (never assumed to be Size/Color); a
 * combination that isn't a real variant is never swapped for another one.
 * Add to cart sends one line per real variant with the units picked, marked
 * with _brix_pack_* properties; the discount itself is applied by the BRIX
 * Packs Shopify Function at checkout (extensions/brix-packs-discount). The
 * widget never claims a discount the server hasn't verified (checkoutDiscount).
 *
 * All CSS is prefixed `.brix-packs-` so it can't touch theme or cart drawer UI.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var CART_EVENTS = ['cart:item-added', 'cart:updated', 'cart:add', 'cart:refresh', 'on:cart:add', 'shopify:cart:added', 'theme:cart:open', 'cart:open'];
  var HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var scriptEl = document.currentScript;

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

  function icon(kind) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(SVG_NS, 'path');
    var shapes = {
      plus: 'M10 4v12M4 10h12',
      image: 'M3 5.5A1.5 1.5 0 0 1 4.5 4h11A1.5 1.5 0 0 1 17 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5zM3 13l4-4 3.5 3.5L13 10l4 4M12.5 7.5h.01',
    };
    path.setAttribute('d', shapes[kind]);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', kind === 'plus' ? '2.2' : '1.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function shallow(source, extra) {
    var copy = {};
    Object.keys(source || {}).forEach(function (key) { copy[key] = source[key]; });
    Object.keys(extra || {}).forEach(function (key) { copy[key] = extra[key]; });
    return copy;
  }

  function numericId(value) {
    var match = /(\d+)$/.exec(String(value == null ? '' : value));
    return match ? match[1] : null;
  }

  function hasStockCap(variant) {
    return variant.maxQuantity !== null && variant.maxQuantity !== undefined && isFinite(Number(variant.maxQuantity));
  }

  function forSale(variant) {
    return variant.availableForSale !== false;
  }

  // Same rounding rules as calculateTierFromPrices in app/utils/packs.shared.js
  // (integer minor units). Used only to display totals; the checkout discount
  // is computed independently by the Shopify Function.
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
    var order = [];
    (product.variants || []).forEach(function (variant) {
      var price = Number(variant.price) / 100;
      var stock = Number(variant.inventoryQuantity);
      var id = String(variant.id);
      order.push(id);
      byId[id] = {
        id: id,
        title: variant.title,
        price: isFinite(price) && price >= 0 ? price : null,
        availableForSale: Boolean(variant.available),
        maxQuantity: variant.inventoryManagement === 'shopify' && variant.inventoryPolicy === 'deny' && stock > 0 ? stock : null,
        inventoryQuantity: isFinite(stock) ? stock : null,
        image: variant.image || '',
        // Option values in product-option order (Liquid's variant.options).
        options: Array.isArray(variant.options) ? variant.options.map(String) : [],
      };
    });

    var packs = [];
    (data.packs || []).forEach(function (pack) {
      var saved = byId[numericId(pack.variantId)];
      if (!saved || saved.price === null) return;
      // Every variant the Pack covers, in the product's own order.
      var allowed = (pack.allowedVariantIds || []).map(numericId);
      var variants = order.map(function (id) { return byId[id]; }).filter(function (variant) {
        return variant.price !== null && (pack.variantScope === 'all' || allowed.indexOf(variant.id) >= 0);
      });
      if (!variants.length) variants = [saved];
      // Price from an in-stock variant when the saved one has sold out
      // (a Pack saved before its first variant ran out).
      var anchor = forSale(saved) ? saved : (variants.filter(forSale)[0] || saved);
      var tiers = (pack.tiers || []).map(function (tier) {
        var t = shallow(tier);
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
      var copy = shallow(pack);
      copy.basePrice = anchor.price;
      copy.tiers = tiers;
      copy.variants = variants;
      copy.productOptions = Array.isArray(product.options) ? product.options : null;
      copy.available = variants.some(forSale);
      copy.maxQuantity = anchor.maxQuantity;
      copy.productTitle = product.title || pack.productTitle;
      copy.variantTitle = anchor.title;
      copy.productImage = product.image || pack.productImage;
      packs.push(copy);
    });

    var priced = shallow(data);
    priced.packs = packs;
    priced.currency = { code: code, locale: document.documentElement.lang || undefined };
    return priced;
  }

  function makeMoney(currency, preferredLocale) {
    var shopCode = currency.code;
    var active = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || shopCode;
    var rate = 1;
    var hidden = false;
    if (active !== shopCode) {
      var parsed = parseFloat(window.Shopify && window.Shopify.currency && window.Shopify.currency.rate);
      if (isFinite(parsed) && parsed > 0) rate = parsed; else hidden = true;
    }
    var locale = preferredLocale || document.documentElement.lang || currency.locale || undefined;
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

  function cartAddUrl() {
    var base = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
    return base + 'cart/add.js';
  }

  function token() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function buyNowOn(pack) {
    var content = (pack && pack.customization && pack.customization.content) || {};
    return Boolean(pack) && content.showBuyNow !== false;
  }

  // ── item selection (mirrors app/utils/packs.shared.js — keep in sync) ───────

  var DEFAULT_OPTION_VALUE = 'Default Title';

  // normalizeOptionData: option names from Shopify -> [{ name, values }] for
  // the values these variants use; each variant gains `optionValues`. Without
  // real options ("Default Title") there is nothing to choose; without option
  // data but several variants, one "Variant" option of their titles is used.
  function normalizeOptionData(productOptions, variants) {
    var list = Array.isArray(variants) ? variants : [];
    var raw = Array.isArray(productOptions) ? productOptions : [];
    var names = raw.map(function (option) { return option && typeof option === 'object' ? option.name : option; }).filter(function (name) { return typeof name === 'string' && name; });
    var valueOrder = raw.map(function (option) { return option && Array.isArray(option.values) ? option.values.map(String) : []; });
    var usable = names.length > 0 && list.length > 0 && list.every(function (variant) { return Array.isArray(variant.options) && variant.options.length >= names.length; });
    if (!usable) {
      var titled = list.map(function (variant) { return shallow(variant, { optionValues: list.length > 1 ? [String(variant.title)] : [] }); });
      return { options: list.length > 1 ? [{ name: 'Variant', values: titled.map(function (variant) { return variant.optionValues[0]; }) }] : [], variants: titled };
    }
    var shaped = list.map(function (variant) { return shallow(variant, { optionValues: variant.options.slice(0, names.length).map(String) }); });
    if (names.length === 1 && shaped.every(function (variant) { return variant.optionValues[0] === DEFAULT_OPTION_VALUE; })) {
      return { options: [], variants: shaped.map(function (variant) { return shallow(variant, { optionValues: [] }); }) };
    }
    var options = names.map(function (name, index) {
      var used = [];
      shaped.forEach(function (variant) { if (used.indexOf(variant.optionValues[index]) < 0) used.push(variant.optionValues[index]); });
      var preferred = valueOrder[index] || [];
      var values = preferred.filter(function (value) { return used.indexOf(value) >= 0; }).concat(used.filter(function (value) { return preferred.indexOf(value) < 0; }));
      return { name: name, values: values };
    });
    return { options: options, variants: shaped };
  }

  function emptySelection(options) {
    return options.map(function (option) { return option.values.length === 1 ? option.values[0] : ''; });
  }

  // Exact match only — never a "closest" variant.
  function resolveVariant(variants, options, values) {
    if (options.length === 0) return variants.length === 1 ? variants[0] : null;
    if (!Array.isArray(values) || values.length !== options.length || values.some(function (value) { return !value; })) return null;
    for (var i = 0; i < variants.length; i += 1) {
      var match = true;
      for (var j = 0; j < values.length; j += 1) if (variants[i].optionValues[j] !== values[j]) { match = false; break; }
      if (match) return variants[i];
    }
    return null;
  }

  // Choices for option `index`, filtered by the options chosen before it.
  function optionChoices(variants, options, values, index) {
    return options[index].values.map(function (value) {
      var matching = variants.filter(function (variant) {
        if (variant.optionValues[index] !== value) return false;
        for (var j = 0; j < index; j += 1) if (values[j] && variant.optionValues[j] !== values[j]) return false;
        return true;
      });
      return { value: value, exists: matching.length > 0, available: matching.some(forSale) };
    });
  }

  function selectionStatus(variants, options, values) {
    var missing = options.filter(function (option, index) { return !(values && values[index]); }).map(function (option) { return option.name; });
    if (missing.length) return { variant: null, problem: 'incomplete', missing: missing };
    var variant = resolveVariant(variants, options, values);
    if (!variant) return { variant: null, problem: 'unavailable', missing: missing };
    if (!forSale(variant)) return { variant: variant, problem: 'sold_out', missing: missing };
    return { variant: variant, problem: null, missing: missing };
  }

  // Whether option `index` is shown with photos in the Image Variant Select:
  // any of its values has a variant photo. Each value then shows the photo of
  // its variant that best matches the item's other choices; a product
  // without variant photos keeps plain dropdowns.
  function optionHasImages(variants, index) {
    for (var i = 0; i < variants.length; i += 1) if (variants[i].image && variants[i].optionValues[index]) return true;
    return false;
  }

  // Same Variant Packs: one variant for every item. Mix & Match: any variant
  // per item, repeats allowed. (No separate merchant setting exists.)
  function packSelectionRules(pack) {
    return { sameVariant: !pack || pack.packType !== 'mix_match', allowDuplicates: true };
  }

  // Horizontal Select and Image Variant Select always give every item of the
  // chosen pack its own selection (Buy 2 -> Item 1 + Item 2), whatever the
  // Pack type; only the Quick Add Picker keeps one pick for a Same Variant
  // Pack. The checkout discount allows any of the Pack's variants per line.
  function widgetSelectionRules(pack, layout) {
    var rules = packSelectionRules(pack);
    if (layout !== 'quick_add') rules.sameVariant = false;
    return rules;
  }

  function pickBlockReason(picks, variant, rules) {
    if (!forSale(variant)) return 'sold_out';
    if (picks.length >= rules.quantity) return 'full';
    var already = picks.filter(function (id) { return String(id) === String(variant.id); }).length;
    if (already > 0 && rules.allowDuplicates === false) return 'duplicate';
    if (hasStockCap(variant) && already + 1 > Number(variant.maxQuantity)) return 'stock';
    return null;
  }

  function groupCartItems(variantIds) {
    var lines = [];
    variantIds.forEach(function (id) {
      for (var i = 0; i < lines.length; i += 1) if (lines[i].id === String(id)) { lines[i].quantity += 1; return; }
      lines.push({ id: String(id), quantity: 1 });
    });
    return lines;
  }

  // Templates; saved Packs that still use a removed layout map to the closest
  // one (LEGACY_DESIGN_MAP in app/utils/packs.shared.js — this file reads raw
  // saved settings from PHP, so it maps them itself).
  var LEGACY_LAYOUTS = { classic: 'slots', highlight: 'slots', premium: 'slots', tabs: 'slots', stacked: 'slots', visual: 'image_slots' };
  function layoutOf(design) {
    if (design === 'slots' || design === 'quick_add' || design === 'image_slots') return design;
    return LEGACY_LAYOUTS[design] || 'slots';
  }

  // ── styles ─────────────────────────────────────────────────────────────────

  var CSS = [
    '.brix-packs-widget{box-sizing:border-box;min-width:0;margin:var(--brix-packs-section) 0;padding:var(--brix-packs-pad);background:var(--brix-packs-bg);color:var(--brix-packs-text);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius);font-family:inherit;line-height:1.35;text-align:left}',
    '.brix-packs-widget.is-shadow{box-shadow:0 2px 10px rgba(0,0,0,.14)}',
    '.brix-packs-widget *{box-sizing:border-box}',
    '.brix-packs-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
    '.brix-packs-head{text-align:var(--brix-packs-align)}',
    '.brix-packs-heading{margin:0 0 4px;font-size:var(--brix-packs-h);font-weight:var(--brix-packs-weight);color:var(--brix-packs-text);line-height:1.2}',
    '.brix-packs-sub{margin:0 0 6px;font-size:var(--brix-packs-desc);opacity:.75}',
    '.brix-packs-preview{margin:6px 0 10px;padding:8px 10px;background:#fff4d6;color:#5c4400;border:1px solid #e1b955;border-radius:6px;font-size:12px}',
    '.brix-packs-badge{display:inline-block;padding:2px 8px;background:var(--brix-packs-badge);color:var(--brix-packs-text);border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.2px;text-transform:uppercase;line-height:1.4}',
    '.brix-packs-save{display:block;font-size:var(--brix-packs-desc);font-weight:600;color:var(--brix-packs-discount)}',
    '.brix-packs-was{font-size:var(--brix-packs-desc);opacity:.55;text-decoration:line-through}',
    /* ── Pack cards: always one horizontal row; scrolls sideways when there isn't room. */
    // Cards share the row and wrap when it is too narrow — never a scrollbar.
    '.brix-packs-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:var(--brix-packs-gap);margin:4px 0 0;padding:12px 0 4px}',
    '.brix-packs-card{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;margin:0;padding:12px 12px 10px;background:var(--brix-packs-card);color:var(--brix-packs-text);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius);font:inherit;text-align:left;cursor:pointer;transition:border-color .15s,box-shadow .15s,background .15s}',
    '.brix-packs-card:hover:not([disabled]){border-color:var(--brix-packs-primary)}',
    '.brix-packs-card:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:2px}',
    '.brix-packs-card[aria-checked="true"]{background:var(--brix-packs-selected);border-color:var(--brix-packs-primary);box-shadow:inset 0 0 0 1px var(--brix-packs-primary)}',
    '.brix-packs-card[disabled]{opacity:.5;cursor:not-allowed}',
    '.brix-packs-card .brix-packs-badge{position:absolute;top:-10px;left:10px;max-width:calc(100% - 12px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}',
    '.brix-packs-card-check{position:absolute;top:10px;right:10px;width:18px;height:18px;border:2px solid var(--brix-packs-border);border-radius:50%;background:var(--brix-packs-card)}',
    '.brix-packs-card[aria-checked="true"] .brix-packs-card-check{border-color:var(--brix-packs-primary);background:var(--brix-packs-primary)}',
    '.brix-packs-card[aria-checked="true"] .brix-packs-card-check::after{content:"";position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid var(--brix-packs-button-text);border-width:0 2px 2px 0;transform:rotate(45deg)}',
    '.brix-packs-card-name{padding-right:24px;font-size:var(--brix-packs-title);font-weight:var(--brix-packs-weight);line-height:1.2;overflow-wrap:anywhere}',
    '.brix-packs-card-count{font-size:var(--brix-packs-desc);opacity:.7}',
    '.brix-packs-card-price{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;margin-top:6px;color:var(--brix-packs-price)}',
    '.brix-packs-card-price strong{font-size:var(--brix-packs-priceSize);font-weight:var(--brix-packs-weight);line-height:1.15}',
    '.brix-packs-card-note{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em}',
    /* ── Selection area shared by all templates. */
    '.brix-packs-body{display:flex;flex-direction:column;gap:12px;margin-top:14px}',
    '.brix-packs-progress{display:flex;flex-direction:column;gap:6px;outline:none}',
    '.brix-packs-progress-row{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 10px}',
    '.brix-packs-progress-title{font-size:var(--brix-packs-title);font-weight:var(--brix-packs-weight)}',
    '.brix-packs-progress-count{font-size:var(--brix-packs-desc);font-weight:600;font-variant-numeric:tabular-nums}',
    '.brix-packs-bar{height:4px;border-radius:999px;background:var(--brix-packs-border);overflow:hidden}',
    '.brix-packs-bar span{display:block;height:100%;border-radius:inherit;background:var(--brix-packs-primary);transition:width .2s}',
    '.brix-packs-state{font-size:var(--brix-packs-desc);font-weight:600;overflow-wrap:anywhere}',
    '.brix-packs-state[data-tone="done"]{color:var(--brix-packs-discount)}',
    '.brix-packs-state[data-tone="todo"]{font-weight:500;opacity:.65}',
    '.brix-packs-state[data-tone="problem"]{color:#b42318}',
    '.brix-packs-label{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;opacity:.6}',
    '.brix-packs-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px}',
    '.brix-packs-field{display:flex;flex-direction:column;gap:4px;min-width:0}',
    '.brix-packs-field-label{font-size:12px;font-weight:600;opacity:.8}',
    '.brix-packs-field-value{display:flex;align-items:center;min-height:40px;padding:0 10px;font-size:14px;font-weight:600;background:var(--brix-packs-bg);border:1px dashed var(--brix-packs-border);border-radius:calc(var(--brix-packs-radius) / 1.5)}',
    '.brix-packs-select{position:relative;display:block}',
    '.brix-packs-select::after{content:"";position:absolute;top:50%;right:13px;width:7px;height:7px;margin-top:-6px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:rotate(45deg);opacity:.6;pointer-events:none}',
    '.brix-packs-widget select{-webkit-appearance:none;-moz-appearance:none;appearance:none;width:100%;min-height:40px;margin:0;padding:8px 32px 8px 10px;font:inherit;font-size:14px;color:var(--brix-packs-text);background:var(--brix-packs-card);border:1px solid var(--brix-packs-border);border-radius:calc(var(--brix-packs-radius) / 1.5);cursor:pointer}',
    '.brix-packs-widget select:hover{border-color:var(--brix-packs-primary)}',
    '.brix-packs-widget select:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:1px}',
    '.brix-packs-widget select[aria-invalid="true"]{border-color:#b42318;box-shadow:inset 0 0 0 1px #b42318}',
    '.brix-packs-problem{margin:0;font-size:12px;font-weight:600;color:#b42318}',
    '.brix-packs-problem::before{content:"! ";font-weight:800}',
    '.brix-packs-noimg{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#9aa0a6;background:#f3f3f4}',
    '.brix-packs-noimg svg{width:40%;max-width:44px;height:auto}',
    /* ── Template 1 · Horizontal Select: one compact slot per item. */
    '.brix-packs-slots{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}',
    '.brix-packs-slot{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;background:var(--brix-packs-card);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius)}',
    '.brix-packs-slot[data-state="done"]{border-color:var(--brix-packs-primary)}',
    '.brix-packs-slot[data-state="problem"]{border-color:#b42318}',
    '.brix-packs-thumb{flex-shrink:0;width:56px;height:56px;overflow:hidden;border-radius:calc(var(--brix-packs-radius) / 1.5);background:#f3f3f4;border:1px solid rgba(0,0,0,.06)}',
    '.brix-packs-thumb img{display:block;width:100%;height:100%;object-fit:cover}',
    '.brix-packs-slots[data-size="small"] .brix-packs-thumb{width:44px;height:44px}.brix-packs-slots[data-size="large"] .brix-packs-thumb{width:76px;height:76px}',
    '.brix-packs-slot-main{flex:1;display:flex;flex-direction:column;gap:8px;min-width:0}',
    '.brix-packs-slot-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 10px}',
    /* ── Template 3 · Image Variant Select: packs as rows; the chosen row opens
       per item its photo and a dropdown per option, side by side (a photo
       dropdown when the option's values have their own variant photos). */
    '.brix-packs-stack{margin-top:4px;background:var(--brix-packs-card);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius)}',
    '.brix-packs-stack-item:first-child{border-radius:var(--brix-packs-radius) var(--brix-packs-radius) 0 0}.brix-packs-stack-item:last-child{border-radius:0 0 var(--brix-packs-radius) var(--brix-packs-radius)}.brix-packs-stack-item:only-child{border-radius:var(--brix-packs-radius)}',
    '.brix-packs-stack-item + .brix-packs-stack-item{border-top:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border)}',
    '.brix-packs-stack-item[data-selected="1"]{background:var(--brix-packs-selected);box-shadow:inset 3px 0 0 var(--brix-packs-primary)}',
    '.brix-packs-tier{position:relative;display:grid;grid-template-columns:auto 1fr auto;column-gap:16px;align-items:center;width:100%;margin:0;padding:var(--brix-packs-card-pad);background:transparent;color:var(--brix-packs-text);border:0;border-radius:inherit;font:inherit;text-align:left;cursor:pointer}',
    '.brix-packs-tier[data-image="1"]{grid-template-columns:auto auto 1fr auto}',
    '.brix-packs-tier:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:-2px}',
    '.brix-packs-tier[disabled]{opacity:.5;cursor:not-allowed}',
    '.brix-packs-radio{width:18px;height:18px;border:2px solid var(--brix-packs-border);border-radius:50%;display:inline-block;position:relative}',
    '.brix-packs-tier[aria-checked="true"] .brix-packs-radio{border-color:var(--brix-packs-primary)}',
    '.brix-packs-tier[aria-checked="true"] .brix-packs-radio::after{content:"";position:absolute;inset:3px;border-radius:50%;background:var(--brix-packs-primary)}',
    '.brix-packs-img{display:block;object-fit:cover;border-radius:calc(var(--brix-packs-radius) / 2);max-width:100%;background:#f3f3f4}',
    '.brix-packs-img[data-size="small"]{width:48px;height:48px}.brix-packs-img[data-size="medium"]{width:72px;height:72px}.brix-packs-img[data-size="large"]{width:104px;height:104px}',
    '.brix-packs-content{min-width:0}',
    '.brix-packs-title{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:var(--brix-packs-title);font-weight:var(--brix-packs-weight)}',
    '.brix-packs-meta{display:block;font-size:var(--brix-packs-desc);opacity:.75}',
    '.brix-packs-price{text-align:right;color:var(--brix-packs-price)}',
    '.brix-packs-price strong{display:block;font-size:var(--brix-packs-priceSize);font-weight:var(--brix-packs-weight)}',
    '.brix-packs-price .brix-packs-was{display:block}',
    '.brix-packs-expand{padding:0 var(--brix-packs-card-pad) var(--brix-packs-card-pad)}',
    '.brix-packs-islots{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}',
    '.brix-packs-islot{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;background:var(--brix-packs-card);border:1px solid var(--brix-packs-border);border-radius:calc(var(--brix-packs-radius) / 1.5)}',
    '.brix-packs-islot[data-state="done"]{border-color:var(--brix-packs-primary)}',
    '.brix-packs-islot[data-state="problem"]{border-color:#b42318}',
    '.brix-packs-islot-photo{flex-shrink:0;width:64px;height:64px;overflow:hidden;border-radius:calc(var(--brix-packs-radius) / 1.5);background:#f3f3f4;border:1px solid rgba(0,0,0,.06)}',
    '.brix-packs-islot-photo img{display:block;width:100%;height:100%;object-fit:cover}',
    '.brix-packs-islot-name{font-size:14px;font-weight:600;overflow-wrap:anywhere}',
    '.brix-packs-pdd{position:relative}',
    '.brix-packs-pdd-trigger{display:flex;align-items:center;gap:8px;width:100%;min-height:40px;margin:0;padding:4px 10px 4px 5px;font:inherit;font-size:14px;color:var(--brix-packs-text);background:var(--brix-packs-card);border:1px solid var(--brix-packs-border);border-radius:calc(var(--brix-packs-radius) / 1.5);text-align:left;cursor:pointer}',
    '.brix-packs-pdd-trigger[data-empty="1"]{padding-left:10px}',
    '.brix-packs-pdd-trigger:hover,.brix-packs-pdd-trigger[aria-expanded="true"]{border-color:var(--brix-packs-primary)}',
    '.brix-packs-pdd-trigger:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:1px}',
    '.brix-packs-pdd-trigger[aria-invalid="true"]{border-color:#b42318;box-shadow:inset 0 0 0 1px #b42318}',
    '.brix-packs-pdd-thumb{flex-shrink:0;display:block;width:30px;height:30px;overflow:hidden;border-radius:calc(var(--brix-packs-radius) / 2.5);background:#f3f3f4}',
    '.brix-packs-pdd-thumb img{display:block;width:100%;height:100%;object-fit:cover}',
    '.brix-packs-pdd-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.brix-packs-pdd-caret{flex-shrink:0;width:7px;height:7px;margin:-4px 3px 0 0;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:rotate(45deg);opacity:.6}',
    '.brix-packs-pdd-list{position:absolute;z-index:30;left:0;right:0;top:calc(100% + 4px);max-height:264px;overflow:auto;margin:0;padding:4px;list-style:none;background:var(--brix-packs-card);color:var(--brix-packs-text);border:1px solid var(--brix-packs-border);border-radius:calc(var(--brix-packs-radius) / 1.5);box-shadow:0 8px 24px rgba(0,0,0,.14)}',
    '.brix-packs-pdd-option{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;font-size:14px;cursor:pointer}',
    '.brix-packs-pdd-option .brix-packs-pdd-thumb{width:36px;height:36px}',
    '.brix-packs-pdd-option .brix-packs-pdd-value{white-space:normal;overflow-wrap:anywhere}',
    '.brix-packs-pdd-option:hover,.brix-packs-pdd-option:focus{background:var(--brix-packs-selected);outline:none}',
    '.brix-packs-pdd-option[aria-selected="true"]{box-shadow:inset 3px 0 0 var(--brix-packs-primary);font-weight:600}',
    '.brix-packs-pdd-option[aria-disabled="true"]{opacity:.5;cursor:not-allowed}',
    '.brix-packs-pdd-note{font-size:11px;font-weight:600;text-transform:uppercase;opacity:.75;white-space:nowrap}',
    /* ── Template 2 · Quick Add Picker: variant cards with a top-right "+". */
    // A scroll box of about two rows; the third row peeks in so it's clear the list scrolls.
    '.brix-packs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:var(--brix-packs-gap);max-height:min(470px,70vh);margin:0;padding:3px 6px 3px 3px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;list-style:none}',
    '.brix-packs-vcard{position:relative;display:flex;flex-direction:column;gap:2px;min-width:0;padding:6px 6px 10px;background:var(--brix-packs-card);border:var(--brix-packs-bw) var(--brix-packs-bs) var(--brix-packs-border);border-radius:var(--brix-packs-radius);transition:border-color .15s,box-shadow .15s}',
    '.brix-packs-vcard[data-selected="1"]{background:var(--brix-packs-selected);border-color:var(--brix-packs-primary);box-shadow:inset 0 0 0 1px var(--brix-packs-primary)}',
    '.brix-packs-vcard-media{position:relative;aspect-ratio:1/1;margin-bottom:6px;overflow:hidden;border-radius:calc(var(--brix-packs-radius) / 1.5);background:#f3f3f4}',
    '.brix-packs-vcard-media img{display:block;width:100%;height:100%;object-fit:cover}',
    '.brix-packs-vcard[data-soldout="1"] .brix-packs-vcard-media{opacity:.45}',
    '.brix-packs-vcard-name{padding:0 4px;font-size:var(--brix-packs-desc);font-weight:600;line-height:1.3;overflow-wrap:anywhere}',
    '.brix-packs-vcard-price{padding:0 4px;font-size:var(--brix-packs-desc);color:var(--brix-packs-price);opacity:.85}',
    '.brix-packs-vcard-note{padding:0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;opacity:.75}',
    '.brix-packs-vcard-tag{position:absolute;bottom:6px;left:6px;padding:2px 7px;border-radius:999px;background:var(--brix-packs-primary);color:var(--brix-packs-button-text);font-size:11px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.18)}',
    '.brix-packs-qadd{position:absolute;top:12px;right:12px;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;margin:0;padding:0;background:var(--brix-packs-card);color:var(--brix-packs-text);border:1px solid var(--brix-packs-border);border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.16);font:inherit;cursor:pointer;transition:background .15s,color .15s,border-color .15s}',
    '.brix-packs-qadd svg{width:16px;height:16px}',
    '.brix-packs-qadd:hover:not([aria-disabled="true"]){background:var(--brix-packs-primary);color:var(--brix-packs-button-text);border-color:var(--brix-packs-primary)}',
    '.brix-packs-step{position:absolute;top:12px;right:12px;display:inline-flex;align-items:center;height:34px;background:var(--brix-packs-primary);color:var(--brix-packs-button-text);border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.2)}',
    '.brix-packs-step-btn{width:32px;height:34px;margin:0;padding:0;background:transparent;color:inherit;border:0;border-radius:999px;font:inherit;font-size:18px;font-weight:600;line-height:1;cursor:pointer}',
    '.brix-packs-step-count{min-width:14px;font-size:13px;font-weight:700;text-align:center}',
    '.brix-packs-qadd[aria-disabled="true"],.brix-packs-step-btn[aria-disabled="true"]{opacity:.4;cursor:not-allowed;box-shadow:none}',
    '.brix-packs-qadd:focus-visible,.brix-packs-step-btn:focus-visible,.brix-packs-chip-x:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:2px}',
    '.brix-packs-picked{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}',
    '.brix-packs-chip{display:inline-flex;align-items:center;gap:2px;max-width:100%;padding:3px 3px 3px 10px;background:var(--brix-packs-card);border:1px solid var(--brix-packs-border);border-radius:999px;font-size:12px;font-weight:600}',
    '.brix-packs-chip.is-empty{padding:3px 10px;border-style:dashed;font-weight:500;opacity:.6}',
    '.brix-packs-chip-x{width:24px;height:24px;margin:0;padding:0;background:transparent;color:inherit;border:0;border-radius:50%;font:inherit;font-size:16px;line-height:1;cursor:pointer}',
    '.brix-packs-chip-x:hover{background:var(--brix-packs-selected)}',
    /* ── Total, messages, buttons. */
    '.brix-packs-total{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--brix-packs-border)}',
    '.brix-packs-total-label{font-size:var(--brix-packs-desc);font-weight:600}',
    '.brix-packs-total-price{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:0 8px;color:var(--brix-packs-price)}',
    '.brix-packs-total-price strong{font-size:var(--brix-packs-priceSize);font-weight:var(--brix-packs-weight)}',
    '.brix-packs-hint{margin:6px 0 0;font-size:var(--brix-packs-desc);opacity:.8}',
    '.brix-packs-promo{margin:12px 0 0;font-size:var(--brix-packs-desc);opacity:.8;text-align:var(--brix-packs-align)}',
    '.brix-packs-msg{margin:12px 0 0;padding:8px 10px;border-radius:6px;font-size:13px}',
    '.brix-packs-msg[data-type="error"]{background:#fde7e7;color:#8a1f1f;border:1px solid #f0b3b3}',
    '.brix-packs-msg[data-type="success"]{background:#e3f5ea;color:#14532d;border:1px solid #a7d7b8}',
    '.brix-packs-msg[data-type="info"]{background:#eef3fb;color:#1f3b6e;border:1px solid #c5d3ec}',
    '.brix-packs-add,.brix-packs-buy{display:block;width:100%;padding:var(--brix-packs-btn-py) 16px;border-radius:var(--brix-packs-btn-radius);font:inherit;font-size:var(--brix-packs-btn-size);font-weight:var(--brix-packs-btn-weight);text-transform:var(--brix-packs-btn-case);letter-spacing:var(--brix-packs-btn-spacing);cursor:pointer;transition:filter .15s}',
    '.brix-packs-add{margin-top:var(--brix-packs-btn-gap);background:var(--brix-packs-button);color:var(--brix-packs-button-text);border:var(--brix-packs-btn-bw) solid var(--brix-packs-add-border)}',
    '.brix-packs-buy{background:var(--brix-packs-buy-bg);color:var(--brix-packs-buy-text);border:var(--brix-packs-btn-bw) solid var(--brix-packs-buy-border)}',
    '.brix-packs-add:hover:not([disabled]),.brix-packs-buy:hover:not([disabled]){filter:brightness(.92)}',
    '.brix-packs-add:focus-visible,.brix-packs-buy:focus-visible{outline:2px solid var(--brix-packs-primary);outline-offset:2px}',
    '.brix-packs-add[disabled],.brix-packs-buy[disabled]{opacity:.55;cursor:not-allowed}',
    '.brix-packs-actions{display:flex;flex-direction:var(--brix-packs-btn-dir);gap:10px;margin-top:var(--brix-packs-btn-gap)}',
    '.brix-packs-actions .brix-packs-add,.brix-packs-actions .brix-packs-buy{margin-top:0;flex:1 1 0}',
    '@media (max-width:480px){.brix-packs-card .brix-packs-badge{left:6px;padding:2px 6px;letter-spacing:0}.brix-packs-card{padding:10px 10px 8px}.brix-packs-card-check{top:8px;right:8px}.brix-packs-tier,.brix-packs-tier[data-image="1"]{column-gap:10px}.brix-packs-img[data-size]{width:52px;height:52px}.brix-packs-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.brix-packs-slot{padding:10px}.brix-packs-islot{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:8px 10px;padding:10px}.brix-packs-islot .brix-packs-slot-main{display:contents}.brix-packs-islot .brix-packs-fields,.brix-packs-islot .brix-packs-problem,.brix-packs-islot-name{grid-column:1/-1}.brix-packs-islot .brix-packs-fields{grid-template-columns:repeat(auto-fit,minmax(96px,1fr))}.brix-packs-islot-photo{width:36px;height:36px}}',
  ].join('\n');

  function injectStyle() {
    var existing = document.getElementById('brix-packs-style');
    if (existing) { if (existing.textContent !== CSS) existing.textContent = CSS; return; }
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
    var buttonVars = buttonStyleVars(custom, color, px);
    Object.keys(buttonVars).forEach(function (name) { vars[name] = buttonVars[name]; });
    Object.keys(vars).forEach(function (name) { section.style.setProperty(name, vars[name]); });
    if (borders.shadow) section.classList.add('is-shadow');
  }

  // Add to Cart + Buy Now styling (customization.buttons). Packs saved before
  // that group existed fall back to their old look — Buy Now an outline in the
  // button color on the card background — same as mergeCustomization's
  // legacyButtonColors in app/utils/packs.shared.js.
  function buttonStyleVars(custom, color, px) {
    var b = custom.buttons || {};
    var button = color('button', '#008060');
    function bColor(key, fallback) { return HEX.test(b[key] || '') ? b[key] : fallback; }
    var reversed = b.order === 'buy_first';
    var dir = b.layout === 'stacked' ? (reversed ? 'column-reverse' : 'column') : (reversed ? 'row-reverse' : 'row');
    var weight = [400, 500, 600, 700].indexOf(Number(b.fontWeight)) >= 0 ? String(Number(b.fontWeight)) : '700';
    return {
      '--brix-packs-add-border': bColor('addBorder', button),
      '--brix-packs-buy-bg': bColor('buyNowBackground', color('cardBackground', '#ffffff')),
      '--brix-packs-buy-text': bColor('buyNowText', button),
      '--brix-packs-buy-border': bColor('buyNowBorder', button),
      '--brix-packs-btn-radius': px(b.radius, Number((custom.borders || {}).radius) >= 0 ? Number(custom.borders.radius) : 8),
      '--brix-packs-btn-bw': px(b.borderWidth, 2),
      '--brix-packs-btn-py': px(b.paddingY, 13),
      '--brix-packs-btn-size': b.fontSize === undefined ? 'inherit' : px(b.fontSize, 15),
      '--brix-packs-btn-weight': weight,
      '--brix-packs-btn-case': b.uppercase ? 'uppercase' : 'none',
      '--brix-packs-btn-spacing': b.uppercase ? '.04em' : 'normal',
      '--brix-packs-btn-dir': dir,
    };
  }

  // ── one widget instance ────────────────────────────────────────────────────
  //
  // opts.adminPreview: rendered in the BRIX admin — add to cart / Buy Now only
  // describe what they would send instead of calling Shopify.

  var instances = 0;

  function createWidget(root, opts) {
    opts = opts || {};
    var adminPreview = Boolean(opts.adminPreview);
    var uid = 'brix-packs-' + (instances += 1);
    // slots: per item slot, the chosen value of every option ('' = not chosen);
    //   Same Variant Packs keep one slot that stands for every item.
    // picks: variant ids chosen in the Quick Add Picker, one per item.
    // open: a pack card was chosen; the Quick Add Picker shows its grid only then.
    // openPicker: '<slot>-<option index>' of the open Image Variant Select photo dropdown, or null.
    var state = { data: null, pack: null, tierIndex: 0, slots: [], picks: [], busy: false, message: null, redirecting: false, open: false, openPicker: null };
    // A click anywhere outside the open dropdown closes it.
    function onDocumentClick(event) {
      if (state.openPicker === null) return;
      var open = root.querySelector('.brix-packs-pdd[data-open="1"]');
      if (open && open.contains(event.target)) return;
      state.openPicker = null;
      render();
    }
    document.addEventListener('click', onDocumentClick);
    var themeVariant = null; // the variant selected on the product page (storefront)
    var money = null;
    var cache = { pack: null, model: null };

    // The Pack's variants + Shopify options, normalised once per Pack object.
    function model(pack) {
      if (cache.pack === pack) return cache.model;
      var list = pack.variants && pack.variants.length ? pack.variants : [{ id: numericId(pack.variantId) || String(pack.variantId), title: pack.variantTitle || '', price: pack.basePrice, availableForSale: pack.available !== false, maxQuantity: pack.maxQuantity, image: '', options: [] }];
      // Sold-out variants are left out of the choices; the Pack still sells its
      // in-stock ones. Only when every variant is sold out is the Pack shown sold out.
      var inStock = list.filter(forSale);
      if (inStock.length) list = inStock;
      var normalized = normalizeOptionData(pack.productOptions, list.map(function (variant) { return shallow(variant, { id: String(variant.id) }); }));
      var imageOptions = normalized.options.map(function (option, index) { return optionHasImages(normalized.variants, index); });
      cache = { pack: pack, model: { options: normalized.options, variants: normalized.variants, rules: widgetSelectionRules(pack, layoutFor(pack)), imageOptions: imageOptions } };
      return cache.model;
    }

    function variantById(m, id) {
      for (var i = 0; i < m.variants.length; i += 1) if (m.variants[i].id === String(id)) return m.variants[i];
      return null;
    }

    // The theme's selected variant when it's one of the Pack's (and for sale),
    // else the first variant that is for sale.
    function defaultVariant(m) {
      var sellable = m.variants.filter(forSale);
      for (var i = 0; i < sellable.length; i += 1) if (sellable[i].id === themeVariant) return sellable[i];
      return sellable[0] || m.variants[0] || null;
    }

    function layoutFor(pack) {
      var custom = pack.customization || {};
      return layoutOf(custom.design && custom.design.preset);
    }

    // A single-variant product's only variant is called "Default Title" by Shopify.
    function variantName(pack, variant) {
      if (!variant) return '';
      if (variant.optionValues && variant.optionValues.length) return variant.optionValues.join(' / ');
      return !variant.title || variant.title === DEFAULT_OPTION_VALUE ? (pack.productTitle || '') : variant.title;
    }

    function tierName(tier) {
      return tier.name || 'Buy ' + tier.quantity;
    }

    function itemsText(count) {
      return count + ' item' + (count === 1 ? '' : 's');
    }

    // A Same Variant Pack in the Quick Add Picker starts on the shopper's
    // current variant; elsewhere the shopper chooses every item themselves.
    function seedsFromTheme(pack) {
      return model(pack).rules.sameVariant;
    }

    function seed(pack) {
      state.slots = [];
      state.picks = [];
      var m = model(pack);
      if (!seedsFromTheme(pack)) return;
      var variant = defaultVariant(m);
      if (!variant) return;
      state.slots = [variant.optionValues.slice()];
      state.picks = [variant.id];
    }

    // Keep one slot per item (one for Same Variant) and at most one pick per item.
    function syncSelections(pack) {
      var tier = pack.tiers[state.tierIndex];
      if (!tier) return;
      var m = model(pack);
      var count = m.rules.sameVariant ? 1 : tier.quantity;
      var slots = [];
      for (var i = 0; i < count; i += 1) {
        var existing = state.slots[i];
        slots.push(existing && existing.length === m.options.length ? existing : emptySelection(m.options));
      }
      state.slots = slots;
      if (m.rules.sameVariant) {
        var first = state.picks[0];
        state.picks = [];
        if (first) for (var j = 0; j < tier.quantity; j += 1) state.picks.push(first);
      } else if (state.picks.length > tier.quantity) {
        state.picks = state.picks.slice(0, tier.quantity);
      }
    }

    // One entry per item in the chosen Pack: { variant, problem } where problem
    // is null | 'incomplete' | 'unavailable' | 'sold_out' | 'stock'.
    function itemsFor(pack, tier) {
      var m = model(pack);
      var items = [];
      var i;
      if (layoutFor(pack) === 'quick_add') {
        for (i = 0; i < tier.quantity; i += 1) {
          var picked = state.picks[i] ? variantById(m, state.picks[i]) : null;
          items.push(picked ? { variant: picked, problem: forSale(picked) ? null : 'sold_out', missing: [] } : { variant: null, problem: 'incomplete', missing: [] });
        }
      } else if (m.rules.sameVariant) {
        var status = selectionStatus(m.variants, m.options, state.slots[0]);
        for (i = 0; i < tier.quantity; i += 1) items.push(status);
      } else {
        for (i = 0; i < tier.quantity; i += 1) items.push(selectionStatus(m.variants, m.options, state.slots[i]));
      }
      // The Pack has no stock of its own: each unit comes out of its variant's
      // Shopify inventory, so a variant can't be picked more often than it has.
      var counts = {};
      return items.map(function (item) {
        if (!item.variant || item.problem) return item;
        counts[item.variant.id] = (counts[item.variant.id] || 0) + 1;
        if (hasStockCap(item.variant) && counts[item.variant.id] > Number(item.variant.maxQuantity)) return { variant: item.variant, problem: 'stock', missing: [] };
        return item;
      });
    }

    function readyCount(items) {
      return items.filter(function (item) { return item.variant && !item.problem; }).length;
    }

    // Unit price for items not picked yet: the Same Variant Pack's chosen
    // variant, else the Pack's anchor price.
    function fallbackPrice(pack) {
      var m = model(pack);
      if (m.rules.sameVariant) {
        var variant = layoutFor(pack) === 'quick_add' ? (state.picks[0] && variantById(m, state.picks[0])) : selectionStatus(m.variants, m.options, state.slots[0] || []).variant;
        variant = variant || defaultVariant(m);
        if (variant && variant.price !== null && variant.price !== undefined) return Number(variant.price);
      }
      // Items not picked yet are priced like the variant selected on the page.
      var onPage = themeVariant ? variantById(m, themeVariant) : null;
      if (onPage && forSale(onPage) && onPage.price !== null && onPage.price !== undefined) return Number(onPage.price);
      return Number(pack.basePrice) || 0;
    }

    function shownTier(pack, tier, index) {
      var unit = fallbackPrice(pack);
      var prices = [];
      if (index === state.tierIndex) {
        itemsFor(pack, tier).forEach(function (item) { prices.push(item.variant && item.variant.price !== null && item.variant.price !== undefined ? Number(item.variant.price) : unit); });
      } else {
        for (var i = 0; i < tier.quantity; i += 1) prices.push(unit);
      }
      return calc(prices, tier, money.decimals);
    }

    // A pack size is offered only if the Pack's variants can supply it.
    function tierDisabled(pack, tier) {
      if (pack.available === false) return true;
      var m = model(pack);
      var sellable = m.variants.filter(forSale);
      if (!sellable.length) return true;
      var capacity = 0;
      for (var i = 0; i < sellable.length; i += 1) {
        if (!hasStockCap(sellable[i])) return false;
        var max = Number(sellable[i].maxQuantity);
        capacity = m.rules.sameVariant ? Math.max(capacity, max) : capacity + max;
      }
      return capacity < tier.quantity;
    }

    // Best photo for a slot: the resolved variant's, else the first variant
    // matching what's chosen so far that has one, else the product photo.
    function slotImage(pack, values, status) {
      if (status.variant && status.variant.image) return status.variant.image;
      var m = model(pack);
      for (var i = 0; i < m.variants.length; i += 1) {
        var variant = m.variants[i];
        if (!variant.image) continue;
        var matches = true;
        for (var j = 0; j < m.options.length; j += 1) if (values && values[j] && variant.optionValues[j] !== values[j]) { matches = false; break; }
        if (matches && values && values.some(function (value, index) { return value && m.options[index].values.length > 1; })) return variant.image;
      }
      return pack.productImage || (m.variants.length === 1 ? m.variants[0].image : '') || '';
    }

    function photo(src, alt) {
      if (src) return el('img', { src: src, alt: alt || '', loading: 'lazy', decoding: 'async' });
      return el('span', { class: 'brix-packs-noimg', role: alt ? 'img' : null, 'aria-label': alt || null }, [icon('image')]);
    }

    function problemText(pack, item, m) {
      var name = variantName(pack, item.variant);
      if (item.problem === 'unavailable') {
        var last = m.options[m.options.length - 1];
        return 'This combination isn\u2019t available. Choose a different ' + (last ? last.name : 'option') + '.';
      }
      if (item.problem === 'sold_out') return name + ' is sold out. Choose another option.';
      if (item.problem === 'stock') return 'Only ' + item.variant.maxQuantity + ' of ' + name + ' left in stock. Choose another option' + (m.rules.sameVariant ? ' or a smaller pack.' : '.');
      return '';
    }

    function slotTone(item) {
      if (item.variant && !item.problem) return 'done';
      return item.problem === 'incomplete' ? 'todo' : 'problem';
    }

    // Only says something when the shopper still has to act; a chosen item is
    // shown by the slot's own done state, not a repeated "\u2713 name" label.
    function stateTag(pack, item) {
      var tone = slotTone(item);
      var text;
      if (tone === 'done') return null;
      if (item.problem === 'incomplete') text = item.missing.length ? 'Choose ' + item.missing.join(', ').toLowerCase() : 'Not chosen';
      else text = 'Needs a change';
      return el('span', { class: 'brix-packs-state', 'data-tone': tone, text: text });
    }

    // For a Same Variant Pack the one slot speaks for every unit: show its worst problem.
    function slotItem(m, items, slot) {
      if (!m.rules.sameVariant) return items[slot];
      for (var i = 0; i < items.length; i += 1) if (items[i].problem && items[i].problem !== 'incomplete') return items[i];
      return items[0];
    }

    function slotLabel(m, tier, slot) {
      if (!m.rules.sameVariant) return 'Item ' + (slot + 1);
      return tier.quantity > 1 ? 'All ' + tier.quantity + ' items' : 'Your item';
    }

    // One <select> per Shopify option; an option with a single value is shown, not asked.
    function optionField(pack, slot, index, slotText, item, msgId) {
      var m = model(pack);
      var option = m.options[index];
      var values = state.slots[slot];
      var current = values[index] || '';
      if (option.values.length === 1) {
        return el('div', { class: 'brix-packs-field' }, [
          el('span', { class: 'brix-packs-field-label', text: option.name }),
          el('span', { class: 'brix-packs-field-value', text: option.values[0] }),
        ]);
      }
      var id = uid + '-s' + slot + '-o' + index;
      var choices = optionChoices(m.variants, m.options, values, index);
      var invalid = Boolean(current) && (item.problem === 'unavailable' || item.problem === 'sold_out' || item.problem === 'stock') && index === lastChosenIndex(values);
      var select = el('select', {
        id: id, 'data-fk': 'o-' + slot + '-' + index, 'aria-invalid': invalid ? 'true' : null, 'aria-describedby': invalid ? msgId : null,
        onchange: function (event) { chooseOption(slot, index, event.target.value); },
      }, [el('option', { value: '', disabled: true, selected: !current, text: 'Select ' + option.name })].concat(choices.map(function (choice) {
        var note = choice.available ? '' : (choice.exists ? ' \u2014 Sold out' : ' \u2014 Unavailable');
        return el('option', { value: choice.value, selected: choice.value === current, disabled: !choice.available, text: choice.value + note });
      })));
      return el('div', { class: 'brix-packs-field' }, [
        el('label', { class: 'brix-packs-field-label', for: id }, [el('span', { class: 'brix-packs-sr', text: slotText + ' ' }), option.name]),
        el('span', { class: 'brix-packs-select' }, [select]),
      ]);
    }

    function lastChosenIndex(values) {
      for (var i = values.length - 1; i >= 0; i -= 1) if (values[i]) return i;
      return -1;
    }

    function fieldsFor(pack, slot, slotText, item, msgId) {
      var m = model(pack);
      if (!m.options.length) return null;
      return el('div', { class: 'brix-packs-fields' }, m.options.map(function (option, index) { return optionField(pack, slot, index, slotText, item, msgId); }));
    }

    function progress(title, done, total, countText) {
      return el('div', { class: 'brix-packs-progress', tabindex: '-1', 'data-fk': 'progress' }, [
        el('div', { class: 'brix-packs-progress-row' }, [
          el('span', { class: 'brix-packs-progress-title', text: title }),
          el('span', { class: 'brix-packs-progress-count', 'aria-live': 'polite', text: countText || done + ' / ' + total + ' selected' }),
        ]),
        el('div', { class: 'brix-packs-bar', role: 'progressbar', 'aria-label': 'Items selected', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) }, [
          el('span', { style: 'width:' + (total ? Math.round((done / total) * 100) : 0) + '%' }),
        ]),
      ]);
    }

    function progressTitle(m, tier) {
      if (!m.rules.sameVariant) return tierName(tier) + ' \u2014 Choose ' + itemsText(tier.quantity);
      return tier.quantity > 1 ? tierName(tier) + ' \u2014 ' + tier.quantity + ' of the same item' : tierName(tier) + ' \u2014 Choose your item';
    }

    // Template 1 · Horizontal Select: a compact slot per item.
    function renderSlots(pack, tier, items, custom) {
      var m = model(pack);
      var images = custom.images || {};
      var showImages = images.enabled !== false;
      var list = el('ol', { class: 'brix-packs-slots', 'data-size': images.size || 'medium' });
      var count = m.rules.sameVariant ? 1 : tier.quantity;
      for (var slot = 0; slot < count; slot += 1) {
        var item = slotItem(m, items, slot);
        var label = slotLabel(m, tier, slot);
        var msgId = uid + '-m' + slot;
        var problem = problemText(pack, item, m);
        var tone = slotTone(item);
        list.appendChild(el('li', { class: 'brix-packs-slot', 'data-state': tone }, [
          showImages ? el('span', { class: 'brix-packs-thumb' }, [photo(slotImage(pack, state.slots[slot], item), '')]) : null,
          el('div', { class: 'brix-packs-slot-main' }, [
            el('div', { class: 'brix-packs-slot-head' }, [el('span', { class: 'brix-packs-label', text: label }), stateTag(pack, item)]),
            fieldsFor(pack, slot, label, item, msgId),
            problem ? el('p', { class: 'brix-packs-problem', id: msgId, text: problem }) : null,
          ]),
        ]));
      }
      return list;
    }

    // Template 3 · Image Variant Select: per item (one for a Same Variant
    // Pack) its photo and one dropdown per Shopify option, side by side like
    // the Horizontal Select. An option whose values have their own variant
    // photos (usually Color) gets a photo dropdown; one without (usually
    // Size) the plain one. Nothing is pre-selected.
    function renderImageSlots(pack, tier, items) {
      var m = model(pack);
      var list = el('ol', { class: 'brix-packs-islots' });
      var count = m.rules.sameVariant ? 1 : tier.quantity;
      for (var slot = 0; slot < count; slot += 1) {
        var item = slotItem(m, items, slot);
        var label = slotLabel(m, tier, slot);
        var msgId = uid + '-m' + slot;
        var problem = problemText(pack, item, m);
        var src = slotImage(pack, state.slots[slot], item);
        var fields = m.options.length ? el('div', { class: 'brix-packs-fields' }, m.options.map(photoOrPlainField(pack, slot, label, item, msgId))) : null;
        list.appendChild(el('li', { class: 'brix-packs-islot', 'data-state': slotTone(item) }, [
          src ? el('span', { class: 'brix-packs-islot-photo' }, [photo(src, '')]) : null,
          el('div', { class: 'brix-packs-slot-main' }, [
            el('div', { class: 'brix-packs-slot-head' }, [el('span', { class: 'brix-packs-label', text: label }), stateTag(pack, item)]),
            fields || el('span', { class: 'brix-packs-islot-name', text: variantName(pack, item.variant) }),
            problem ? el('p', { class: 'brix-packs-problem', id: msgId, text: problem }) : null,
          ]),
        ]));
      }
      return list;
    }

    function photoOrPlainField(pack, slot, label, item, msgId) {
      var m = model(pack);
      return function (option, index) {
        var photos = m.imageOptions[index] && option.values.length > 1;
        return (photos ? photoOptionField : optionField)(pack, slot, index, label, item, msgId);
      };
    }

    // Like optionField, but every value is listed with its variant photo.
    // Values cascade from the options before it in the same way.
    function photoOptionField(pack, slot, index, slotText, item, msgId) {
      var m = model(pack);
      var option = m.options[index];
      var values = state.slots[slot];
      var current = values[index] || '';
      var key = slot + '-' + index;
      var open = state.openPicker === key;
      var choices = optionChoices(m.variants, m.options, values, index);
      var invalid = Boolean(current) && (item.problem === 'unavailable' || item.problem === 'sold_out' || item.problem === 'stock') && index === lastChosenIndex(values);
      function thumb(value) { return el('span', { class: 'brix-packs-pdd-thumb' }, [photo(valueImage(m, values, index, value), '')]); }
      function focusTrigger() {
        var node = root.querySelector('[data-fk="pdd-' + key + '"]');
        if (node) node.focus();
      }
      function close() { state.openPicker = null; render(); focusTrigger(); }
      function pick(value) { state.openPicker = null; chooseOption(slot, index, value); focusTrigger(); }
      var trigger = el('button', {
        type: 'button', class: 'brix-packs-pdd-trigger', 'data-fk': 'pdd-' + key, 'data-empty': current ? null : '1',
        'aria-haspopup': 'listbox', 'aria-expanded': open ? 'true' : 'false', 'aria-label': slotText + ' ' + option.name + ': ' + (current || 'not chosen'),
        'aria-invalid': invalid ? 'true' : null, 'aria-describedby': invalid ? msgId : null,
        onclick: function (event) { event.stopPropagation(); state.openPicker = open ? null : key; render(); },
        onkeydown: function (event) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); state.openPicker = key; render(); } },
      }, [
        current ? thumb(current) : null,
        el('span', { class: 'brix-packs-pdd-value', text: current || 'Select ' + option.name }),
        el('span', { class: 'brix-packs-pdd-caret', 'aria-hidden': 'true' }),
      ]);
      var children = [trigger];
      if (open) {
        children.push(el('ul', { class: 'brix-packs-pdd-list', role: 'listbox', 'aria-label': slotText + ' ' + option.name }, choices.map(function (choice, position) {
          var note = choice.available ? '' : (choice.exists ? 'Sold out' : 'Unavailable');
          return el('li', {
            role: 'option', class: 'brix-packs-pdd-option', tabindex: '-1', 'data-value': choice.value,
            'aria-selected': choice.value === current ? 'true' : 'false', 'aria-disabled': note ? 'true' : null,
            onclick: function (event) { event.stopPropagation(); if (!note) pick(choice.value); },
            onkeydown: function (event) {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!note) pick(choice.value); return; }
              if (event.key === 'Escape') { event.preventDefault(); close(); return; }
              if (event.key === 'Tab') { state.openPicker = null; render(); return; }
              var step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              var next = event.currentTarget.parentNode.children[(position + step + choices.length) % choices.length];
              if (next) next.focus();
            },
          }, [
            thumb(choice.value),
            el('span', { class: 'brix-packs-pdd-value', text: choice.value }),
            note ? el('span', { class: 'brix-packs-pdd-note', text: note }) : null,
          ]);
        })));
      }
      return el('div', { class: 'brix-packs-field' }, [
        el('span', { class: 'brix-packs-field-label' }, [el('span', { class: 'brix-packs-sr', text: slotText + ' ' }), option.name]),
        el('div', { class: 'brix-packs-pdd', 'data-open': open ? '1' : null }, children),
      ]);
    }

    // Photo for one option value: the variant with that value that best
    // matches the item's other choices, else any variant with that value.
    function valueImage(m, values, index, value) {
      var fallback = '';
      for (var i = 0; i < m.variants.length; i += 1) {
        var variant = m.variants[i];
        if (!variant.image || variant.optionValues[index] !== value) continue;
        var matches = true;
        for (var j = 0; j < m.options.length; j += 1) if (j !== index && values && values[j] && variant.optionValues[j] !== values[j]) { matches = false; break; }
        if (matches) return variant.image;
        if (!fallback) fallback = variant.image;
      }
      return fallback;
    }

    function blockText(reason, pack, variant) {
      var name = variantName(pack, variant);
      if (reason === 'full') return 'Your pack is full. Remove an item to choose a different one.';
      if (reason === 'duplicate') return name + ' is already in your pack. Each item must be different.';
      if (reason === 'stock') return 'Only ' + variant.maxQuantity + ' of ' + name + ' left in stock.';
      if (reason === 'sold_out') return name + ' is sold out.';
      return '';
    }

    function sameBlockReason(variant, tier) {
      if (!forSale(variant)) return 'sold_out';
      if (hasStockCap(variant) && Number(variant.maxQuantity) < tier.quantity) return 'stock';
      return null;
    }

    function countOf(id) {
      return state.picks.filter(function (pick) { return pick === id; }).length;
    }

    // Template 2 · Quick Add Picker: the Pack's variants as photo cards.
    function renderQuickAdd(pack, tier, items) {
      var m = model(pack);
      var same = m.rules.sameVariant;
      var ordered = m.variants.filter(forSale).concat(m.variants.filter(function (variant) { return !forSale(variant); }));
      var grid = el('ul', { class: 'brix-packs-grid', 'aria-label': 'Choose items' });
      ordered.forEach(function (variant) {
        var count = countOf(variant.id);
        var name = variantName(pack, variant);
        var reason = same ? sameBlockReason(variant, tier) : pickBlockReason(state.picks, variant, { quantity: tier.quantity, allowDuplicates: m.rules.allowDuplicates });
        var why = reason ? blockText(reason, pack, variant) : '';
        var control;
        if (count > 0) {
          control = el('div', { class: 'brix-packs-step', role: 'group', 'aria-label': name + ' in your pack' }, [
            el('button', { type: 'button', class: 'brix-packs-step-btn', 'data-fk': 'rm-' + variant.id, 'aria-label': same ? 'Remove ' + name + ' from your pack' : 'Remove one ' + name, onclick: function () { removePick(variant.id); } }, ['\u2212']),
            el('span', { class: 'brix-packs-step-count', 'aria-hidden': 'true', text: String(count) }),
            same ? null : el('button', { type: 'button', class: 'brix-packs-step-btn', 'data-fk': 'add-' + variant.id, 'aria-label': 'Add another ' + name + (why ? ' (' + why + ')' : ''), 'aria-disabled': reason ? 'true' : null, title: why || null, onclick: function () { addPick(variant); } }, ['+']),
          ]);
        } else {
          var label = same ? (tier.quantity > 1 ? 'Choose ' + name + ' for all ' + tier.quantity + ' items' : 'Choose ' + name) : 'Add ' + name + ' to your pack';
          control = el('button', { type: 'button', class: 'brix-packs-qadd', 'data-fk': 'add-' + variant.id, 'aria-label': label + (why ? ' (' + why + ')' : ''), 'aria-disabled': reason ? 'true' : null, title: why || null, onclick: function () { addPick(variant); } }, [icon('plus')]);
        }
        var note = !forSale(variant) ? 'Sold out' : (hasStockCap(variant) && Number(variant.maxQuantity) <= 5 ? 'Only ' + variant.maxQuantity + ' left' : null);
        grid.appendChild(el('li', { class: 'brix-packs-vcard', 'data-selected': count ? '1' : null, 'data-soldout': forSale(variant) ? null : '1', 'data-variant-id': variant.id }, [
          el('div', { class: 'brix-packs-vcard-media' }, [
            photo(variant.image || pack.productImage, ''),
            count ? el('span', { class: 'brix-packs-vcard-tag', text: '\u2713 ' + (same ? '\u00d7' + count : count > 1 ? '\u00d7' + count : 'Added') }) : null,
          ]),
          control,
          el('span', { class: 'brix-packs-vcard-name', text: name }),
          money.hidden ? null : el('span', { class: 'brix-packs-vcard-price', text: money.format(variant.price) }),
          note ? el('span', { class: 'brix-packs-vcard-note', text: note }) : null,
        ]));
      });
      var chips;
      if (same) {
        chips = items[0] && items[0].variant
          ? [el('li', { class: 'brix-packs-chip' }, [el('span', { text: variantName(pack, items[0].variant) + ' \u00d7 ' + tier.quantity }), el('button', { type: 'button', class: 'brix-packs-chip-x', 'data-fk': 'chip-0', 'aria-label': 'Remove ' + variantName(pack, items[0].variant) + ' from your pack', onclick: function () { state.picks = []; state.message = null; render(); } }, ['\u00d7'])])]
          : [el('li', { class: 'brix-packs-chip is-empty', text: 'Nothing chosen yet' })];
      } else {
        chips = items.map(function (item, index) {
          if (!item.variant) return el('li', { class: 'brix-packs-chip is-empty', text: 'Item ' + (index + 1) });
          var name = variantName(pack, item.variant);
          return el('li', { class: 'brix-packs-chip' }, [
            el('span', { text: (index + 1) + '. ' + name }),
            el('button', { type: 'button', class: 'brix-packs-chip-x', 'data-fk': 'chip-' + index, 'aria-label': 'Remove item ' + (index + 1) + ', ' + name, onclick: function () { removeAt(index); } }, ['\u00d7']),
          ]);
        });
      }
      return [grid, el('ol', { class: 'brix-packs-picked', 'aria-label': 'Your pack' }, chips)];
    }

    function render() {
      var active = document.activeElement;
      var focusKey = active && root.contains(active) ? active.getAttribute('data-fk') : null;
      var oldGrid = root.querySelector('.brix-packs-grid');
      var gridScroll = oldGrid ? oldGrid.scrollTop : 0; // kept so tapping + doesn't jump the list to the top
      root.textContent = '';
      var pack = state.pack;
      if (!pack || !state.data) return;
      var custom = pack.customization || {};
      var content = custom.content || {};
      var savingsCfg = custom.savings || {};
      var saveWord = (savingsCfg.label && String(savingsCfg.label).trim()) || 'Save';
      var design = (custom.design && custom.design.preset) || 'slots';
      var layout = layoutOf(design);
      var m = model(pack);
      var tier = pack.tiers[state.tierIndex];

      var section = el('section', { class: 'brix-packs-widget', 'data-template': pack.template, 'data-design': design, 'data-layout': layout, 'data-mode': m.rules.sameVariant ? 'same' : 'mix', 'aria-label': content.heading || 'Packs' });
      applyCustomization(section, custom);

      section.appendChild(el('div', { class: 'brix-packs-head' }, [
        content.heading ? el('h2', { class: 'brix-packs-heading', text: content.heading }) : null,
        content.subheading ? el('p', { class: 'brix-packs-sub', text: content.subheading }) : null,
      ]));

      var discount = state.data.checkoutDiscount;
      if (state.data.preview && discount && !discount.verified) {
        section.appendChild(el('div', { class: 'brix-packs-preview', role: 'status', text: 'Preview only \u2014 ' + (discount.message || 'the checkout discount is not active') + ' Shoppers do not see this widget until it is, and this discount will not be applied at checkout.' }));
      }

      function saveTextFor(shown) {
        if (savingsCfg.visible === false || !(shown.savings > 0)) return null;
        if (savingsCfg.mode === 'save_percent' || money.hidden) return saveWord + ' ' + percentLabel(shown.subtotal, shown.savings);
        return saveWord + ' ' + money.format(shown.savings);
      }

      // Pack cards — one horizontal row of radio buttons. Image Variant Select
      // lists the packs as rows instead; the chosen row opens its item dropdowns.
      var rows = layout === 'image_slots';
      var cards = el('div', { class: rows ? 'brix-packs-stack' : 'brix-packs-cards', role: 'radiogroup', 'aria-label': content.heading || 'Choose a pack' });
      // Quick Add Picker: nothing is chosen (and no grid shown) until the shopper picks a pack.
      var closed = layout === 'quick_add' && !state.open;
      var images = custom.images || {};
      var rowImage = rows && images.enabled !== false && pack.productImage ? pack.productImage : '';
      pack.tiers.forEach(function (t, index) {
        var shown = shownTier(pack, t, index);
        var selected = !closed && index === state.tierIndex;
        var disabled = tierDisabled(pack, t);
        var save = saveTextFor(shown);
        var tierProps = {
          type: 'button', class: rows ? 'brix-packs-tier' : 'brix-packs-card', role: 'radio', 'aria-checked': selected ? 'true' : 'false', 'data-index': index, 'data-fk': 'tier-' + index,
          disabled: disabled, title: disabled ? (pack.available === false ? 'Sold out' : 'Not enough stock for this pack') : null, tabindex: index === state.tierIndex ? '0' : '-1',
          onclick: function () { selectTier(index, false); },
          onkeydown: function (event) { onTierKey(event, index); },
        };
        if (rows) {
          var meta = itemsText(t.quantity) + (!money.hidden && shown.savings > 0 ? ' \u00b7 ' + money.format(shown.price / t.quantity) + ' each' : '');
          var row = el('div', { class: 'brix-packs-stack-item', 'data-selected': selected ? '1' : null }, [
            el('button', shallow(tierProps, { 'data-image': rowImage ? '1' : null }), [
              el('span', { class: 'brix-packs-radio', 'aria-hidden': 'true' }),
              rowImage ? el('img', { class: 'brix-packs-img', src: rowImage, alt: '', loading: 'lazy', 'data-size': images.size || 'medium' }) : null,
              el('span', { class: 'brix-packs-content' }, [
                el('span', { class: 'brix-packs-title' }, [tierName(t), t.badge ? el('span', { class: 'brix-packs-badge', text: t.badge }) : null]),
                el('span', { class: 'brix-packs-meta', text: disabled ? (pack.available === false ? 'Sold out' : 'Low stock') : meta }),
              ]),
              el('span', { class: 'brix-packs-price' }, [
                !money.hidden && shown.savings > 0 ? el('span', { class: 'brix-packs-was', text: money.format(shown.subtotal) }) : null,
                money.hidden ? null : el('strong', { text: money.format(shown.price) }),
                save ? el('span', { class: 'brix-packs-save', text: save }) : null,
              ]),
            ]),
          ]);
          if (selected) row.appendChild(el('div', { class: 'brix-packs-expand', role: 'group', 'aria-label': 'Choose your items' }, [renderImageSlots(pack, t, itemsFor(pack, t))]));
          cards.appendChild(row);
          return;
        }
        cards.appendChild(el('button', tierProps, [
          t.badge ? el('span', { class: 'brix-packs-badge', text: t.badge }) : null,
          el('span', { class: 'brix-packs-card-check', 'aria-hidden': 'true' }),
          el('span', { class: 'brix-packs-card-name', text: tierName(t) }),
          el('span', { class: 'brix-packs-card-count', text: itemsText(t.quantity) }),
          money.hidden ? null : el('span', { class: 'brix-packs-card-price' }, [
            el('strong', { text: money.format(shown.price) }),
            shown.savings > 0 ? el('span', { class: 'brix-packs-was', text: money.format(shown.subtotal) }) : null,
          ]),
          save ? el('span', { class: 'brix-packs-save', text: save }) : null,
          disabled ? el('span', { class: 'brix-packs-card-note', text: pack.available === false ? 'Sold out' : 'Low stock' }) : null,
        ]));
      });
      section.appendChild(cards);

      var items = tier ? itemsFor(pack, tier) : [];
      var done = readyCount(items);
      var ready = !closed && Boolean(tier) && items.length > 0 && done === items.length;
      if (tier && closed) {
        section.appendChild(el('p', { class: 'brix-packs-hint', role: 'status', text: 'Choose a pack to pick your items.' }));
      } else if (tier && rows) {
        // The chosen row already shows the price and the item dropdowns.
        if (!ready && !tierDisabled(pack, tier)) section.appendChild(el('p', { class: 'brix-packs-hint', role: 'status', text: hintText(m, tier, items) }));
      } else if (tier) {
        var body = el('div', { class: 'brix-packs-body', 'aria-label': 'Choose your items', role: 'group' });
        if (layout === 'quick_add') {
          body.appendChild(progress(m.rules.sameVariant ? progressTitle(m, tier) : 'Choose ' + itemsText(tier.quantity), done, tier.quantity, 'Selected: ' + done + ' / ' + tier.quantity));
          renderQuickAdd(pack, tier, items).forEach(function (node) { body.appendChild(node); });
        } else {
          body.appendChild(progress(progressTitle(m, tier), done, tier.quantity));
          body.appendChild(renderSlots(pack, tier, items, custom));
        }
        section.appendChild(body);

        var shownCurrent = shownTier(pack, tier, state.tierIndex);
        section.appendChild(el('div', { class: 'brix-packs-total' }, [
          el('span', { class: 'brix-packs-total-label', text: tierName(tier) + ' \u00b7 ' + itemsText(tier.quantity) }),
          money.hidden ? null : el('span', { class: 'brix-packs-total-price' }, [
            shownCurrent.savings > 0 ? el('span', { class: 'brix-packs-was', text: money.format(shownCurrent.subtotal) }) : null,
            el('strong', { text: money.format(shownCurrent.price) }),
          ]),
        ]));
        if (!ready && !tierDisabled(pack, tier)) section.appendChild(el('p', { class: 'brix-packs-hint', role: 'status', text: hintText(m, tier, items) }));
      }

      if (content.promoText) section.appendChild(el('p', { class: 'brix-packs-promo', text: content.promoText }));
      if (state.message) section.appendChild(el('div', { class: 'brix-packs-msg', role: state.message.type === 'error' ? 'alert' : 'status', 'data-type': state.message.type, text: state.message.text }));

      var addDisabled = Boolean(state.busy) || !tier || tierDisabled(pack, tier) || !ready;
      var addButton = el('button', { type: 'button', class: 'brix-packs-add', 'data-fk': 'add-to-cart', disabled: addDisabled, onclick: function () { addToCart(false); }, text: state.busy === 'add' ? 'Adding\u2026' : (pack.available === false ? 'Sold out' : (content.cta || 'Add Pack to Cart')) });
      // Buy Now checks out only this Pack; the shopper's cart is left as it was.
      if (buyNowOn(pack) && pack.available !== false) {
        section.appendChild(el('div', { class: 'brix-packs-actions' }, [
          addButton,
          el('button', { type: 'button', class: 'brix-packs-buy', 'data-fk': 'buy-now', disabled: addDisabled, onclick: function () { addToCart(true); }, text: state.busy === 'buy' ? 'Going to checkout\u2026' : (content.buyNow || 'Buy Now') }),
        ]));
      } else {
        section.appendChild(addButton);
      }
      root.appendChild(section);
      var newGrid = root.querySelector('.brix-packs-grid');
      if (newGrid && gridScroll) newGrid.scrollTop = gridScroll;
      restoreFocus(focusKey);
      // Keep keyboard focus inside an open photo dropdown after re-rendering.
      if (state.openPicker !== null) {
        var list = root.querySelector('.brix-packs-pdd[data-open="1"] .brix-packs-pdd-list');
        var option = list && (list.querySelector('[aria-selected="true"]') || list.querySelector('[role="option"]'));
        if (option) option.focus();
      }
    }

    // Re-rendering replaces the DOM; keep keyboard focus on the same control
    // (or its closest replacement, e.g. "−" that became "+").
    function restoreFocus(focusKey) {
      if (!focusKey) return;
      var candidates = [focusKey, focusKey.replace(/^rm-/, 'add-'), focusKey.replace(/^chip-\d+$/, 'progress'), 'progress'];
      for (var i = 0; i < candidates.length; i += 1) {
        var target = root.querySelector('[data-fk="' + candidates[i] + '"]');
        if (target && !target.disabled) { target.focus(); return; }
      }
    }

    function hintText(m, tier, items) {
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].problem && items[i].problem !== 'incomplete') return (m.rules.sameVariant ? 'Your item' : 'Item ' + (i + 1)) + ' needs a different option before you can add this pack.';
      }
      var left = items.length - readyCount(items);
      if (m.rules.sameVariant) return 'Choose your item to add this pack.';
      return 'Choose ' + left + ' more item' + (left === 1 ? '' : 's') + ' to add this pack.';
    }

    function chooseOption(slot, index, value) {
      var values = state.slots[slot].slice();
      values[index] = value;
      state.slots[slot] = values;
      state.message = null;
      render();
    }

    function addPick(variant) {
      var pack = state.pack;
      var tier = pack && pack.tiers[state.tierIndex];
      if (!tier) return;
      var m = model(pack);
      var reason = m.rules.sameVariant ? sameBlockReason(variant, tier) : pickBlockReason(state.picks, variant, { quantity: tier.quantity, allowDuplicates: m.rules.allowDuplicates });
      if (reason) { state.message = { type: 'info', text: blockText(reason, pack, variant) }; render(); return; }
      if (m.rules.sameVariant) {
        state.picks = [];
        for (var i = 0; i < tier.quantity; i += 1) state.picks.push(variant.id);
      } else {
        state.picks = state.picks.concat([variant.id]);
      }
      state.message = null;
      render();
    }

    function removePick(id) {
      if (model(state.pack).rules.sameVariant) state.picks = [];
      else {
        var at = state.picks.lastIndexOf(id);
        if (at >= 0) state.picks = state.picks.slice(0, at).concat(state.picks.slice(at + 1));
      }
      state.message = null;
      render();
    }

    function removeAt(index) {
      state.picks = state.picks.slice(0, index).concat(state.picks.slice(index + 1));
      state.message = null;
      render();
    }

    function selectTier(index, moveFocus) {
      var tier = state.pack.tiers[index];
      if (!tier || tierDisabled(state.pack, tier)) return;
      state.tierIndex = index;
      state.open = true;
      state.openPicker = null;
      state.message = null;
      syncSelections(state.pack);
      render();
      if (moveFocus) {
        var node = root.querySelector('[data-fk="tier-' + index + '"]');
        if (node) node.focus();
      }
    }

    function onTierKey(event, index) {
      var keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
      if (!keys[event.key]) return;
      event.preventDefault();
      var count = state.pack.tiers.length;
      for (var step = 1; step <= count; step += 1) {
        var next = (index + keys[event.key] * step + count * step) % count;
        if (!tierDisabled(state.pack, state.pack.tiers[next])) { selectTier(next, true); return; }
      }
    }

    // ── cart ─────────────────────────────────────────────────────────────────

    function notifyCartUpdated(detail) {
      CART_EVENTS.forEach(function (name) {
        try { document.dispatchEvent(new CustomEvent(name, { detail: detail })); window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) { /* a theme listener threw \u2014 never block the cart flow */ }
      });
    }

    // One line per real variant with the number of units picked for it (e.g.
    // Black/M twice -> one line of quantity 2), all sharing one Pack group so
    // the checkout Function prices them together.
    function buildItems(pack, tier) {
      var properties = { _brix_pack_id: String(pack.id), _brix_pack_quantity: String(tier.quantity), _brix_pack_version: String(pack.version), _brix_pack_group: token() };
      var ids = itemsFor(pack, tier).map(function (item) { return item.variant.id; });
      return groupCartItems(ids).map(function (line) { return { id: Number(line.id), quantity: line.quantity, properties: properties }; });
    }

    function cartErrorMessage(response, body) {
      if (body && (body.description || body.message)) return String(body.description || body.message);
      if (response.status === 422) return 'Some items are not available in that quantity. Try a smaller pack.';
      return 'Could not add the pack to your cart. Please try again.';
    }

    // Buy Now checks out ONLY the Pack, like Shopify's own Buy it now: it creates
    // a separate cart through the Storefront API (tokenless access allows cart
    // writes from the storefront) and goes to that cart's checkout. The shopper's
    // regular cart is never touched. Every line keeps its _brix_pack_* properties
    // (cart line attributes) so the Packs discount Function still applies.
    var STOREFRONT_API = '/api/2026-07/graphql.json';
    var CART_CREATE = 'mutation BrixPackBuyNow($input: CartInput!) { cartCreate(input: $input) { cart { checkoutUrl } userErrors { message } } }';

    function buyNowCart(items) {
      var input = {
        lines: items.map(function (item) {
          return {
            merchandiseId: 'gid://shopify/ProductVariant/' + item.id,
            quantity: item.quantity,
            attributes: Object.keys(item.properties).map(function (key) { return { key: key, value: item.properties[key] }; }),
          };
        }),
      };
      // Price the checkout in the shopper's market, like the page they're on.
      var country = window.Shopify && window.Shopify.country;
      if (/^[A-Z]{2}$/.test(country || '')) input.buyerIdentity = { countryCode: country };
      return fetch(STOREFRONT_API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ query: CART_CREATE, variables: { input: input } }) })
        .then(function (response) {
          return response.json().catch(function () { return null; }).then(function (body) {
            var result = body && body.data && body.data.cartCreate;
            var userError = result && result.userErrors && result.userErrors[0];
            if (userError && userError.message) throw new Error(userError.message);
            var url = result && result.cart && result.cart.checkoutUrl;
            if (!response.ok || !url) throw new Error('Could not start checkout for this pack. Please try again, or add it to your cart.');
            return url;
          });
        });
    }

    function addItems(items) {
      return fetch(cartAddUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: items }) })
        .then(function (response) {
          return response.json().catch(function () { return null; }).then(function (body) {
            if (!response.ok) throw new Error(cartErrorMessage(response, body));
            return body;
          });
        });
    }

    // buyNow: check out just this Pack (see buyNowCart); otherwise add it to the cart.
    function addToCart(buyNow) {
      var pack = state.pack;
      var tier = pack && pack.tiers[state.tierIndex];
      if (!tier || state.busy) return;
      var items = itemsFor(pack, tier);
      if (readyCount(items) !== items.length) {
        state.message = { type: 'error', text: hintText(model(pack), tier, items) };
        render();
        return;
      }
      var lines = buildItems(pack, tier);
      if (adminPreview) {
        var m = model(pack);
        var summary = lines.map(function (line) { return variantName(pack, variantById(m, line.id)) + ' \u00d7 ' + line.quantity; }).join(', ');
        state.message = { type: 'info', text: 'Preview only \u2014 on your store this ' + (buyNow ? 'checks out just this pack: ' : 'adds to the cart: ') + summary + '.' };
        render();
        return;
      }
      state.busy = buyNow ? 'buy' : 'add';
      state.message = null;
      render();
      var request = buyNow ? buyNowCart(lines) : addItems(lines);
      request
        .then(function (result) {
          var detail = { packId: pack.id, quantity: tier.quantity, items: buyNow ? lines : result && result.items, buyNow: Boolean(buyNow) };
          document.dispatchEvent(new CustomEvent('brix:packs:added', { detail: detail }));
          if (buyNow) { state.redirecting = true; window.location.assign(result); return; }
          state.message = { type: 'success', text: 'Added to your cart.' };
          notifyCartUpdated(detail);
        })
        .catch(function (error) {
          state.message = { type: 'error', text: error && error.message && error.message.indexOf('Failed to fetch') < 0 ? error.message : 'Could not reach the store. Check your connection and try again.' };
        })
        .then(function () { if (state.redirecting) return; state.busy = false; render(); });
    }

    // ── instance API ─────────────────────────────────────────────────────────

    function firstEnabledTier(pack) {
      for (var i = 0; i < pack.tiers.length; i += 1) if (!tierDisabled(pack, pack.tiers[i])) return i;
      return 0;
    }

    return {
      setData: function (data, locale) {
        state.data = data;
        money = makeMoney(data.currency || { code: 'USD' }, locale);
      },
      packs: function () { return (state.data && state.data.packs) || []; },
      // Show `pack` for the theme's selected `variantId`. keep: the same Pack
      // with new settings (admin preview edits) — keep the shopper's choices.
      show: function (pack, variantId, keep) {
        var variantChanged = (variantId || null) !== themeVariant;
        themeVariant = variantId || null;
        if (!pack) { state.pack = null; render(); return; }
        if (keep || pack === state.pack) {
          var wasSame = state.pack ? model(state.pack).rules.sameVariant : null;
          state.pack = pack;
          if (state.tierIndex >= pack.tiers.length) state.tierIndex = firstEnabledTier(pack);
          // A new variant picked in the theme takes over a Same Variant Pack;
          // a Pack switched between Same Variant and Mix & Match starts over.
          var same = model(pack).rules.sameVariant;
          if ((variantChanged && seedsFromTheme(pack)) || wasSame !== same) seed(pack);
        } else {
          state.pack = pack;
          state.tierIndex = firstEnabledTier(pack);
          state.open = false;
          state.message = null;
          seed(pack);
        }
        syncSelections(pack);
        render();
      },
      // Admin design thumbnails: show the second pack with one item chosen.
      demo: function () {
        var pack = state.pack;
        if (!pack || !pack.tiers.length) return;
        var m = model(pack);
        state.tierIndex = Math.min(1, pack.tiers.length - 1);
        state.open = true;
        syncSelections(pack);
        var first = m.variants.filter(forSale)[0];
        if (first && !m.rules.sameVariant) {
          state.slots[0] = first.optionValues.slice();
          state.picks = [first.id];
        }
        render();
      },
      destroy: function () { document.removeEventListener('click', onDocumentClick); root.textContent = ''; state.pack = null; },
    };
  }

  // For the BRIX admin preview: render one Pack into `node`.
  //   config: { pack, currency: { code, locale }, locale?, checkoutDiscount?, demo? }
  function mount(node, config) {
    injectStyle();
    var widget = createWidget(node, { adminPreview: true });
    function apply(next, keep) {
      widget.setData({ packs: [next.pack], currency: next.currency, checkoutDiscount: next.checkoutDiscount || null, preview: false }, next.locale);
      widget.show(next.pack, next.variantId || null, keep);
      if (next.demo && !keep) widget.demo();
    }
    apply(config, false);
    return { update: function (next) { apply(next, true); }, destroy: function () { widget.destroy(); } };
  }

  window.BrixPacksWidget = { mount: mount, version: 2 };

  // ── storefront boot ────────────────────────────────────────────────────────

  var root = document.querySelector('[data-brix-packs-root]');
  if (!root || root.getAttribute('data-brix-packs-ready')) return;
  root.setAttribute('data-brix-packs-ready', '1');

  var api = (root.getAttribute('data-api') || '').replace(/\/$/, '');
  if (!api && scriptEl && scriptEl.src) {
    try { api = new URL(scriptEl.src).origin; } catch (e) { api = ''; }
  }
  var endpoint = root.getAttribute('data-endpoint') || (api ? api + '/api/packs-storefront' : '');
  var shop = root.getAttribute('data-shop');
  var productId = root.getAttribute('data-product-id');
  var preview = /[?&]brix_packs_preview=1\b/.test(location.search);
  var widget = null;
  var current = null;
  var lastVariant = null;
  var pageVariantIds = []; // every variant of the page's product (PHP data path)

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

  // Theme variant pickers (Dawn and other Online Store 2.0 themes, then older ones).
  var PICKER_SELECTORS = ['variant-selects', 'variant-radios', 'variant-picker', '.product-form__variants', '.product__variants', '.variant-picker', '.product-options', '.product-variants', '.selector-wrapper', '.swatch', '[data-variant-picker]', '[data-product-options]'];
  var QUANTITY_SELECTORS = ['quantity-input', '.product-form__quantity', '.product-form__input--quantity', '.product__quantity', '.quantity-selector', '.quantity'];
  var PRODUCT_INFO_SELECTORS = 'product-info, .product__info-container, .product__info-wrapper, .product-single__meta, .product__info, .product-info, [data-product-info]';

  // The block that holds the product's price, options and buy buttons.
  function productInfo(form) {
    return form.closest(PRODUCT_INFO_SELECTORS) || form.closest('.shopify-section') || form.parentElement || form;
  }

  // Every variant of the product can be bought through this Pack, so the
  // theme's own variant picker isn't needed while it shows.
  function coversAllVariants(pack) {
    if (!pack) return false;
    if (pack.variantScope === 'all') return true;
    if (!pageVariantIds.length) return false;
    var covered = (pack.variants || []).map(function (variant) { return String(variant.id); });
    return pageVariantIds.every(function (id) { return covered.indexOf(id) >= 0; });
  }

  // While a Pack is shown for the selected variant, the Pack's own button adds
  // it to the cart with the Pack's quantity, so the theme's quantity selector
  // and Add to cart button are hidden (and restored when no Pack applies).
  // The theme's variant picker goes too when the Pack offers every variant
  // (hidePicker) — the shopper picks their variants inside the Pack.
  function setThemeControlsHidden(hidden, hidePayment, hidePicker) {
    var form = productForm();
    if (!form) return;
    var info = productInfo(form);
    function outside(node) { return !root.contains(node) && !node.contains(root) && !node.contains(form); }
    // getAttribute, not form.id: the form contains <input name="id">, which
    // shadows the form's `id` property.
    var formId = form.getAttribute('id');
    var inputs = Array.prototype.slice.call(info.querySelectorAll('input[name="quantity"]')).concat(Array.prototype.slice.call(form.querySelectorAll('input[name="quantity"]')));
    if (formId) inputs = inputs.concat(Array.prototype.slice.call(document.querySelectorAll('input[name="quantity"][form="' + formId + '"]')));
    inputs.forEach(function (input) {
      if (root.contains(input)) return;
      var box = input.closest(QUANTITY_SELECTORS.join(',')) || input.parentElement;
      if (!box) return;
      box = box.closest('.product-form__input') || box;
      if (outside(box)) setHidden(box, hidden);
    });
    Array.prototype.forEach.call(info.querySelectorAll(QUANTITY_SELECTORS.join(',')), function (box) {
      if (outside(box)) setHidden(box.closest('.product-form__input') || box, hidden);
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
    // Variant picker: the theme's picker elements, plus any visible option
    // control the theme keeps inside the form. The hidden <input name="id">
    // stays, so the page still knows its variant.
    var pickers = Array.prototype.slice.call(info.querySelectorAll(PICKER_SELECTORS.join(',')));
    Array.prototype.forEach.call(form.querySelectorAll('select[name="id"], select[name^="options["], input[type="radio"][name^="options["]'), function (control) {
      pickers.push(control.closest('fieldset, .product-form__input, .selector-wrapper') || control);
    });
    pickers.forEach(function (node) {
      if (outside(node)) setHidden(node, hidden && Boolean(hidePicker));
    });
  }

  function showFor(variantId) {
    var next = packForVariant(widget.packs(), variantId);
    setThemeControlsHidden(Boolean(next), buyNowOn(next), coversAllVariants(next));
    if (next) place(next);
    current = next;
    widget.show(next, variantId);
  }

  function fail(message) {
    if (preview) {
      injectStyle();
      root.textContent = '';
      root.appendChild(el('div', { class: 'brix-packs-preview', role: 'alert', text: 'BRIX Packs preview: ' + message }));
    }
    if (window.console && console.warn) console.warn('[BRIX Packs] ' + message);
  }

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
        pageVariantIds = (product.variants || []).map(function (variant) { return String(variant.id); });
        data = priceOnPage(data, product);
        if (!data.packs.length) data.reason = 'price_unverified';
      }
      if (!data.packs || !data.packs.length) {
        if (preview) fail('no widget to show (' + (data.reason || 'no active Pack') + ').');
        return;
      }
      injectStyle();
      widget = createWidget(root, {});
      widget.setData(data);
      lastVariant = currentVariantId();
      showFor(lastVariant);
      setInterval(function () {
        var variant = currentVariantId();
        if (variant !== lastVariant) { lastVariant = variant; showFor(variant); }
        else {
          setThemeControlsHidden(Boolean(current), buyNowOn(current), coversAllVariants(current)); // a theme re-render can bring them back
          if (current && !root.isConnected) { place(current); } // a theme re-render replaced the block the Pack sat in
        }
      }, 700);
    })
    .catch(function () { fail('could not reach the Packs service.'); });
})();

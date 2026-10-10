// Serves the storefront combo-page mounter as a real .js asset. Published
// combo pages (app/routes/api.bundle-templates.jsx's PAGE_BODY) load this
// via a plain <script src="..."> tag — Shopify Pages don't process Liquid in
// their body content, so this can't be a theme-extension asset; it has to be
// served directly from this app instead (see conversation: verified live on
// fpzz1i-ds.myshopify.com that {{ 'x' | asset_url }} renders as literal text
// inside a Page body).
//
// Renders the combo UI directly into the page (no iframe) — ported from
// app/routes/preview.$templateId.jsx's Layout1-4Preview/ProductCard/
// CdoPreviewBar (all four layouts; an unknown layout falls back to an
// iframe, see mountDirect's layout guard below). Reasons this replaced the previous
// iframe-based approach:
//   - SEO: content inside an iframe isn't indexed as part of the parent page.
//   - No cross-origin postMessage plumbing needed for height/viewport sync
//     (the whole brix-combo-viewport/brix-combo-resize dance in the old
//     version existed purely to work around the iframe boundary).
// This file is the single source of truth for storefront combo rendering
// now — preview.$templateId.jsx's React version is still used for the admin
// builder's own "preview" page, so keep both in sync when changing pricing/
// selection/checkout logic (see computePricing/onCheckout below vs. that
// file's identically-named logic).
//
// Box-priced combos (config.pricing_mode 'weight', measured by weight, number
// of items or value) price the box with the shared core from
// app/utils/combo-weight.shared.js, injected below as source text — the same
// code the checkout Function and BRIX COD run. The Quick Shop template
// (layout6) is drawn by app/utils/combo-quickshop.shared.js, injected the same
// way and also used by the builder preview.
import { createComboWeightCore } from '../utils/combo-weight.shared.js';
import { createQuickShopKit, QUICK_SHOP_CSS } from '../utils/combo-quickshop.shared.js';

const SCRIPT_BODY = String.raw`
(function () {
  var CURRENT_SCRIPT = document.currentScript;
  var API_ORIGIN = CURRENT_SCRIPT ? new URL(CURRENT_SCRIPT.src).origin : '';
  var WeightCore = (${createComboWeightCore.toString()})();
  var QuickShop = (${createQuickShopKit.toString()})(WeightCore);

  var instances = new Map(); // root element -> state object

  /* === HELPERS === */

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Converts a plain JS style object (camelCase keys, string values already
  // carrying their own units e.g. '20px') into an inline style="..." string.
  // Deliberately mirrors how the React source's inline style objects read,
  // so each render function below stays a near-transliteration of its JSX
  // counterpart instead of hand-built CSS strings.
  function styleStr(obj) {
    var out = '';
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      if (v == null || v === '') continue;
      var kebab = k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
      out += kebab + ':' + v + ';';
    }
    return out;
  }

  // Small inline SVG icons — replaces plain-text Unicode glyphs (✓ ✕ ‹ › ⚠)
  // that render as platform-default emoji/dingbat fonts (inconsistent look,
  // and read as "emoji" even though they're functional UI indicators, not
  // decoration). 1em sizing + currentColor means each inherits the calling
  // element's existing font-size/color inline styles with no other changes
  // needed at the call site.
  var ICON_CHECK = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polyline points="4 12 10 18 20 6"></polyline></svg>';
  var ICON_CLOSE = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="display:block;"><line x1="5" y1="5" x2="19" y2="19"></line><line x1="19" y1="5" x2="5" y2="19"></line></svg>';
  var ICON_CHEVRON_LEFT = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polyline points="15 5 8 12 15 19"></polyline></svg>';
  var ICON_CHEVRON_RIGHT = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><polyline points="9 5 16 12 9 19"></polyline></svg>';
  var ICON_WARNING = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M12 3 L22 20 L2 20 Z"></path><line x1="12" y1="10" x2="12" y2="15"></line><circle cx="12" cy="17.5" r="0.75" fill="currentColor" stroke="none"></circle></svg>';

  function getCurrencySymbol(code) {
    var map = {
      USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹',
      AUD: 'A$', CAD: 'C$', CHF: 'CHF', CNY: '¥', SEK: 'kr', NZD: 'NZ$',
      MXN: '$', SGD: 'S$', HKD: 'HK$', NOK: 'kr', KRW: '₩', TRY: '₺',
      RUB: '₽', BRL: 'R$', ZAR: 'R', THB: '฿', MYR: 'RM',
      PHP: '₱', IDR: 'Rp', VND: '₫', KES: 'KSh', NGN: '₦',
      PKR: '₨', BDT: '৳', AED: 'د.إ', SAR: '﷼', QAR: '﷼',
    };
    return map[code] || code || '$';
  }

  /* === CONFIG-DERIVED STYLE HELPERS (mirror preview.$templateId.jsx) === */

  function getBoxSpacing(config, prefix, isMobile) {
    function get(part) {
      var desktop = config[prefix + '_' + part];
      if (!isMobile) return desktop;
      var mobile = config[prefix + '_' + part + '_mobile'];
      return mobile == null ? desktop : mobile;
    }
    return {
      paddingTop: get('padding_top'), paddingRight: get('padding_right'),
      paddingBottom: get('padding_bottom'), paddingLeft: get('padding_left'),
      marginTop: get('margin_top'), marginRight: get('margin_right'),
      marginBottom: get('margin_bottom'), marginLeft: get('margin_left'),
    };
  }

  // container_padding_{side}_desktop/mobile — the outer content wrapper's
  // padding in the generic (layout2/layout4) render path.
  function getContainerPadding(config, isMobile) {
    function side(s) {
      return isMobile ? config['container_padding_' + s + '_mobile'] : config['container_padding_' + s + '_desktop'];
    }
    return {
      paddingTop: side('top'), paddingRight: side('right'),
      paddingBottom: side('bottom'), paddingLeft: side('left'),
    };
  }

  function getBannerSizing(config, isMobile) {
    var bannerWidth = isMobile
      ? (config.banner_width_mobile || config.banner_width_desktop || 100)
      : (config.banner_width_desktop || 100);
    var bannerHeight = isMobile
      ? (config.banner_height_mobile || config.banner_height_desktop || 120)
      : (config.banner_height_desktop || 180);
    var finalBannerHeight = config.banner_fit_mode === 'adapt' ? 'auto' : (bannerHeight + 'px');
    var bannerObjectFit = (config.banner_fit_mode === 'cover' || config.banner_fit_mode === 'contain')
      ? config.banner_fit_mode : 'initial';
    var bannerUrl = (isMobile && config.banner_image_mobile_url)
      ? config.banner_image_mobile_url : config.banner_image_url;
    return { bannerWidth: bannerWidth, finalBannerHeight: finalBannerHeight, bannerObjectFit: bannerObjectFit, bannerUrl: bannerUrl };
  }

  function getProductSizing(config, isMobile) {
    var productTitleSize = isMobile ? (config.product_title_size_mobile || 14) : (config.product_title_size_desktop || 16);
    var productPriceSize = isMobile ? (config.product_price_size_mobile || 14) : (config.product_price_size_desktop || 15);
    var ratio = config.product_image_ratio || 'square';
    var productImageAspectRatio = ratio === 'portrait' ? '3 / 4' : ratio === 'rectangle' ? '4 / 3' : '1 / 1';
    return { productTitleSize: productTitleSize, productPriceSize: productPriceSize, productImageAspectRatio: productImageAspectRatio };
  }

  function getHeadingStyleObj(config) {
    var fontFamily = (config.heading_font_family && config.heading_font_family !== 'inherit')
      ? ("'" + config.heading_font_family + "', sans-serif") : 'inherit';
    return {
      fontFamily: fontFamily,
      letterSpacing: (config.heading_letter_spacing == null ? 0 : config.heading_letter_spacing) + 'px',
      lineHeight: config.heading_line_height == null ? 1.2 : config.heading_line_height,
      textTransform: config.heading_text_transform || 'none',
    };
  }

  function getTitleWidthStyleObj(config, isMobile) {
    if (isMobile) return { width: '100%' };
    var mode = config.title_max_width_mode || 'auto';
    if (mode === 'full') return { width: '100%' };
    if (mode === 'custom') return { width: '100%', maxWidth: (config.title_max_width_custom == null ? 400 : config.title_max_width_custom) + 'px' };
    return { width: (config.title_width || 100) + '%' };
  }

  /* === DATA FETCH === */

  function fetchJson(url) {
    return fetch(url).then(function (r) { return r.json(); });
  }

  function fetchComboData(shop, templateId) {
    return fetchJson(API_ORIGIN + '/api/combo-page-data?shop=' + encodeURIComponent(shop) + '&templateId=' + encodeURIComponent(templateId));
  }

  function fetchComboDataByHandle(shop, handle) {
    return fetchJson(API_ORIGIN + '/api/combo-page-data?shop=' + encodeURIComponent(shop) + '&handle=' + encodeURIComponent(handle));
  }

  // AI picks for "Enable AI Suggestions for Customers" (config.ai_mode):
  // { [productId]: [productId, ...] }, generated once per template version
  // on the server (api.combo-ai-suggestions.jsx). Loaded after the page has
  // rendered, so a slow AI call never delays the combo itself.
  function loadAiSuggestions(root, state) {
    fetchJson(API_ORIGIN + '/api/combo-ai-suggestions?shop=' + encodeURIComponent(state.shop) + '&templateId=' + encodeURIComponent(state.templateId))
      .then(function (json) {
        if (!json || !json.success || !json.data || !json.data.pairs) return;
        state.aiPairs = json.data.pairs;
        // The row only shows once something is selected; re-rendering an
        // untouched page would just reset slider scroll positions.
        if (state.totalSelected > 0) render(root);
      })
      .catch(function () {});
  }

  /* === STATE === */

  function buildState(shop, data) {
    var productMap = {};
    var variantPriceMap = {};
    var variantGramsMap = {};
    var handle;
    for (handle in data.productsByHandle) {
      if (!Object.prototype.hasOwnProperty.call(data.productsByHandle, handle)) continue;
      var prods = data.productsByHandle[handle] || [];
      for (var i = 0; i < prods.length; i++) {
        var p = prods[i];
        productMap[p.id] = p;
        var variants = p.variants || [];
        for (var j = 0; j < variants.length; j++) {
          var v = variants[j];
          variantPriceMap[v.id] = v.price != null ? parseFloat(v.price) : parseFloat(p.price || 0);
          variantGramsMap[v.id] = v.grams > 0 ? v.grams : null;
        }
      }
    }
    var cfg = data.config || {};
    var weight = (cfg.pricing_mode === 'weight' || cfg.layout === WeightCore.WEIGHT_BOX_LAYOUT || cfg.layout === WeightCore.QUICK_SHOP_LAYOUT) && data.weightPricing ? data.weightPricing : null;
    var qualifying = {};
    if (weight) {
      for (var q = 0; q < (weight.qualifyingProductIds || []).length; q++) qualifying[weight.qualifyingProductIds[q]] = true;
    }

    return {
      shop: shop,
      templateId: data.templateId,
      templateName: data.templateName,
      config: data.config || {},
      productsByHandle: data.productsByHandle || {},
      collectionNameMap: data.collectionNameMap || {},
      activeDiscounts: data.activeDiscounts || [],
      // Internal per-shop switch (php_backend/integrations_admin.php) — see onCheckout.
      shiprocketEnabled: data.shiprocketEnabled === true,
      codAvailable: false, // set once brix_cod.js confirms COD is on (see whenCodAvailable)
      aiPairs: null, // set by loadAiSuggestions when config.ai_mode is on
      productMap: productMap,
      variantPriceMap: variantPriceMap,
      // Weight pricing: grams per variant (null = no weight, doesn't count),
      // the tiers etc. from the server, and which products count toward the box.
      variantGramsMap: variantGramsMap,
      weightMode: !!weight,
      weight: weight,
      qualifying: qualifying,
      box: null, // WeightCore.computeBox result, recomputed by computePricing()
      canCheckout: false,
      checkingOut: false,
      // Quick Shop (layout6): filters, open menu, the bar's item list.
      qsUi: { chip: 'all', dd: {}, instock: false, menu: null, sheetOpen: false },
      qsLastTier: null, // the tier shown last render, to celebrate a new one once
      selectedMap: {}, // { [variantId]: { productId, qty } }
      pendingVariant: {}, // { [productId]: variantId } — current dropdown/carousel selection before adding
      imgIndex: {}, // { [productId]: index }
      popupOpenProductId: null,
      activeTab: 'all', // layout2/layout3 collection switcher
      // layout3 hero: countdown, rotating bundle title, visible banner slide
      timeLeft: getLayout3TimerSeconds(data.config || {}),
      bundleIndex: 0,
      currentSlide: 0,
      cartDrawerOpen: false,
      toast: null,
      toastTimer: null,
      isMobile: (typeof window.matchMedia === 'function') && window.matchMedia('(max-width: 767px)').matches,
      // derived, recomputed by computePricing() before every render:
      totalSelected: 0, maxProducts: 5, totalPrice: 0, selectedDiscount: null,
      discountApplicable: false, finalPrice: 0,
      viewedTracked: false,
    };
  }

  /* === PRICING (mirrors preview.$templateId.jsx's ComboPreviewPage) === */

  /* === WEIGHT PRICING (shared core: same rules as checkout and COD) === */

  function shopCurrency(state) {
    for (var pid in state.productMap) return state.productMap[pid].currency;
    return null;
  }

  function weightPricingOf(state) {
    return { measure: state.weight.measure, tiers: state.weight.tiers || [], max_grams: state.weight.maxGrams == null ? null : state.weight.maxGrams, unit: state.weight.unit };
  }

  // The box for a selection ({ [variantId]: { productId, qty } }), priced in
  // the page's (shop) currency. Checkout converts with Shopify's own rate.
  function weightBoxFor(state, selectedMap) {
    var decimals = WeightCore.decimalsFor(shopCurrency(state));
    var lines = [];
    for (var vid in selectedMap) {
      var sel = selectedMap[vid];
      var qty = sel.qty || 0;
      lines.push({
        key: vid,
        unitGrams: state.variantGramsMap[vid],
        quantity: qty,
        subtotalMinor: WeightCore.toMinor((state.variantPriceMap[vid] || 0) * qty, decimals),
        qualifies: !!state.qualifying[sel.productId],
      });
    }
    var box = WeightCore.computeBox({ pricing: weightPricingOf(state), lines: lines, decimals: decimals, rate: 1 });
    box.decimals = decimals;
    return box;
  }

  function computeWeightPricing(state) {
    var totalSelected = 0;
    var totalPrice = 0;
    for (var vid in state.selectedMap) {
      var sel = state.selectedMap[vid];
      totalSelected += (sel.qty || 0);
      totalPrice += (state.variantPriceMap[vid] || 0) * (sel.qty || 0);
    }
    var box = weightBoxFor(state, state.selectedMap);
    var discount = state.weight.enabled ? box.discountMinor / Math.pow(10, box.decimals) : 0;
    var tiers = state.weight.tiers || [];
    state.box = box;
    state.totalSelected = totalSelected;
    state.maxProducts = Infinity; // no item-count limit in weight mode
    state.totalPrice = totalPrice;
    state.selectedDiscount = null;
    state.discountApplicable = discount > 0;
    state.finalPrice = Math.max(0, totalPrice - discount);
    // A Weight Box can be checked out once it weighs at least the first tier,
    // and not over the max; Quick Shop lets any box through unless the
    // merchant requires the first tier.
    state.canCheckout = WeightCore.usesQuickShop(state.config.layout)
      ? QuickShop.canCheckout(state.config, box, totalSelected, tiers)
      : totalSelected > 0 && !box.overMax && tiers.length > 0 && box.grams >= tiers[0].min_grams;
  }

  // Would this selection be over the max weight? Shows the merchant's message if so.
  function blockedByMaxWeight(root, state, nextSelectedMap) {
    if (!state.weightMode || state.weight.maxGrams == null) return false;
    var box = weightBoxFor(state, nextSelectedMap);
    if (!box.overMax) return false;
    var byItems = state.weight.measure === 'quantity';
    showToast(root, state, WeightCore.fillMessage(state.weight.messages && state.weight.messages.over_max, {
      max: byItems ? WeightCore.formatItems(state.weight.maxGrams) : WeightCore.formatWeight(state.weight.maxGrams, state.weight.unit),
      weight: byItems ? WeightCore.formatItems(box.amount) : WeightCore.formatWeight(box.grams, state.weight.unit),
    }));
    return true;
  }

  function withQty(selectedMap, variantId, productId, qty) {
    var next = {};
    for (var vid in selectedMap) next[vid] = selectedMap[vid];
    next[variantId] = { productId: productId, qty: qty };
    return next;
  }

  function computePricing(state) {
    if (state.weightMode) { computeWeightPricing(state); return; }
    var config = state.config;
    var totalSelected = 0;
    var vid;
    for (vid in state.selectedMap) totalSelected += (state.selectedMap[vid].qty || 0);
    var maxProducts = parseInt(config.max_products) || 5;

    var totalPrice = 0;
    for (vid in state.selectedMap) {
      var sel = state.selectedMap[vid];
      totalPrice += (state.variantPriceMap[vid] || 0) * (sel.qty || 0);
    }

    var selectedDiscount = null;
    if (config.has_discount_offer && config.selected_discount_id) {
      for (var i = 0; i < state.activeDiscounts.length; i++) {
        if (String(state.activeDiscounts[i].id) === String(config.selected_discount_id)) {
          selectedDiscount = state.activeDiscounts[i];
          break;
        }
      }
    }
    var discountType = (selectedDiscount && selectedDiscount.valueType) || config.discount_selection || '';
    var discountVal = (selectedDiscount && selectedDiscount.value) ? parseFloat(selectedDiscount.value) : (parseFloat(config.discount_amount) || 0);
    var hasDiscount = !!discountType && discountVal > 0;
    var isDiscountUnlocked = totalSelected >= (parseInt(config.discount_threshold) || maxProducts);
    var discountApplicable = hasDiscount && isDiscountUnlocked;
    var discountedPrice = discountApplicable
      ? (String(discountType).toLowerCase() === 'percentage' ? totalPrice * (1 - discountVal / 100) : Math.max(0, totalPrice - discountVal))
      : totalPrice;

    state.totalSelected = totalSelected;
    state.maxProducts = maxProducts;
    state.totalPrice = totalPrice;
    state.selectedDiscount = selectedDiscount;
    state.discountApplicable = discountApplicable;
    state.finalPrice = discountApplicable ? discountedPrice : totalPrice;
  }

  function buildSelectedProducts(state) {
    var list = [];
    for (var variantId in state.selectedMap) {
      var sel = state.selectedMap[variantId];
      var product = state.productMap[sel.productId];
      var variant = null;
      if (product && product.variants) {
        for (var i = 0; i < product.variants.length; i++) {
          if (String(product.variants[i].id) === String(variantId)) { variant = product.variants[i]; break; }
        }
      }
      var img = (variant && variant.image) || (product && product.image);
      list.push({
        id: sel.productId, variantId: variantId, quantity: sel.qty || 0,
        price: state.variantPriceMap[variantId] || 0,
        image: img ? img.url : null,
        title: product ? product.title : '',
      });
    }
    return list;
  }

  function getBarCurrencySymbol(state) {
    var currency = null;
    for (var vid in state.selectedMap) {
      var p = state.productMap[state.selectedMap[vid].productId];
      if (p) { currency = p.currency; break; }
    }
    if (!currency) {
      for (var pid in state.productMap) { currency = state.productMap[pid].currency; break; }
    }
    return getCurrencySymbol(currency);
  }

  function trackEvent(state, eventType, revenue) {
    try {
      fetch(API_ORIGIN + '/api/bundle-analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          shop_domain: state.shop,
          template_id: state.templateId,
          event_type: eventType,
          revenue: revenue || 0,
        }),
      }).catch(function () {});
    } catch (e) {}
  }

  /* === ACTIONS === */

  function showToast(root, state, message) {
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toast = message;
    render(root);
    state.toastTimer = setTimeout(function () { state.toast = null; render(root); }, 2800);
  }

  function onAdd(root, state, product, variantId, qty) {
    qty = qty || 1;
    if (state.selectedMap[variantId]) return;
    if (state.weightMode) {
      if (blockedByMaxWeight(root, state, withQty(state.selectedMap, variantId, product.id, qty))) return;
      state.selectedMap[variantId] = { productId: product.id, qty: qty };
      render(root);
      return;
    }
    var currentTotalQty = 0;
    for (var vid in state.selectedMap) currentTotalQty += (state.selectedMap[vid].qty || 0);
    var maxProducts = parseInt(state.config.max_products) || 5;
    if (currentTotalQty + qty > maxProducts) {
      showToast(root, state, (state.config.limit_reached_message || 'Limit reached! You can only select {{limit}} items.').replace('{{limit}}', maxProducts));
      return;
    }
    state.selectedMap[variantId] = { productId: product.id, qty: qty };
    render(root);
  }

  function onQtyChange(root, state, variantId, qty) {
    if (!state.selectedMap[variantId]) return;
    if (qty <= 0) { delete state.selectedMap[variantId]; render(root); return; }
    if (state.weightMode) {
      var current = state.selectedMap[variantId];
      if (qty > (current.qty || 0) && blockedByMaxWeight(root, state, withQty(state.selectedMap, variantId, current.productId, qty))) return;
      current.qty = qty;
      render(root);
      return;
    }
    var otherTotalQty = 0;
    for (var vid in state.selectedMap) {
      if (vid === String(variantId)) continue;
      otherTotalQty += (state.selectedMap[vid].qty || 0);
    }
    var maxProducts = parseInt(state.config.max_products) || 5;
    if (otherTotalQty + qty > maxProducts) {
      showToast(root, state, (state.config.limit_reached_message || 'Limit reached! You can only select {{limit}} items.').replace('{{limit}}', maxProducts));
      state.selectedMap[variantId].qty = Math.max(1, maxProducts - otherTotalQty);
      render(root);
      return;
    }
    state.selectedMap[variantId].qty = qty;
    render(root);
  }

  function onRemove(root, state, variantId) {
    if (!state.selectedMap[variantId]) return;
    delete state.selectedMap[variantId];
    render(root);
  }

  function onReset(root, state) {
    state.selectedMap = {};
    render(root);
  }

  function getActiveVariantId(state, product) {
    var pending = state.pendingVariant[product.id];
    if (pending) return pending;
    var variants = product.variants || [];
    return (variants[0] && variants[0].id) || product.variantId || '';
  }

  function onCardAddClick(root, state, product) {
    var variantId = getActiveVariantId(state, product);
    var isAdded = !!state.selectedMap[variantId];
    var showQtySelector = state.config.show_quantity_selector !== false;
    var hasVariants = (product.variants || []).length > 1;
    var variantsDisplay = state.config.product_card_variants_display || 'static';

    if (isAdded) {
      if (!showQtySelector) { onRemove(root, state, variantId); return; }
      onQtyChange(root, state, variantId, (state.selectedMap[variantId].qty || 0) + 1);
      return;
    }
    if (hasVariants && variantsDisplay === 'popup') {
      state.popupOpenProductId = product.id;
      render(root);
      return;
    }
    onAdd(root, state, product, variantId, 1);
  }

  function onCardInc(root, state, product) {
    var variantId = getActiveVariantId(state, product);
    if (!state.selectedMap[variantId]) { onAdd(root, state, product, variantId, 1); return; }
    onQtyChange(root, state, variantId, (state.selectedMap[variantId].qty || 0) + 1);
  }

  function onCardDec(root, state, product) {
    var variantId = getActiveVariantId(state, product);
    if (!state.selectedMap[variantId]) return;
    var qty = state.selectedMap[variantId].qty || 0;
    if (qty <= 1) onRemove(root, state, variantId);
    else onQtyChange(root, state, variantId, qty - 1);
  }

  /* === WEIGHT COMBOS: the box goes into the real cart === */

  function shopRoot() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
  }

  function cartPost(path, body) {
    return fetch(shopRoot() + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        if (!r.ok) {
          var err = new Error((json && (json.description || json.message)) || 'Could not add your box to the cart. Please try again.');
          err.status = r.status;
          throw err;
        }
        return json;
      });
    });
  }

  // Line properties that tell the checkout Function (and BRIX COD) which box
  // a line belongs to. Only sent when the box discount is live, so a shopper
  // is never shown a price checkout won't give.
  function weightLineProperties(state) {
    if (!state.weightMode || !state.weight.enabled) return null;
    if (!state.boxToken) state.boxToken = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return {
      _brix_combo_id: String(state.templateId),
      _brix_combo_version: String(state.weight.hash || ''),
      _brix_combo_group: state.boxToken,
    };
  }

  // Puts a box in the shopper's real cart, then opens Shopify checkout. Any
  // earlier box of the same combo is replaced (one box per combo per cart);
  // the rest of the cart goes along. Rejects with Shopify's message (e.g. a
  // 422 for stock) so the page can show it and stay put.
  // box: { templateId, items: [{ variantId, quantity, properties }], attributes, destination: 'checkout' | 'cart' }
  function addComboToCart(box) {
    return fetch(shopRoot() + 'cart.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .catch(function () { return { items: [] }; })
      .then(function (cart) {
        var updates = {};
        var found = false;
        (cart.items || []).forEach(function (item) {
          if (item.properties && String(item.properties._brix_combo_id) === String(box.templateId)) { updates[item.key] = 0; found = true; }
        });
        return found ? cartPost('cart/update.js', { updates: updates }) : null;
      })
      .then(function () {
        return cartPost('cart/add.js', {
          items: box.items.map(function (it) {
            var line = { id: Number(it.variantId), quantity: it.quantity };
            if (it.properties) line.properties = it.properties;
            return line;
          }),
        });
      })
      .then(function () { return box.attributes ? cartPost('cart/update.js', { attributes: box.attributes }) : null; })
      .then(function () { window.location.href = shopRoot() + (box.destination === 'cart' ? 'cart' : 'checkout'); });
  }

  // Items, discount code and combo attributes for the current selection —
  // the same ones onCheckout below sends to Shopify / Shiprocket.
  // Weight combos carry their box properties and never a discount code.
  function buildComboItems(state) {
    var items = [];
    var properties = weightLineProperties(state);
    for (var variantId in state.selectedMap) {
      var sel = state.selectedMap[variantId];
      var item = { variantId: Number(String(variantId).split('/').pop()), quantity: sel.qty || 1 };
      if (properties) item.properties = properties;
      items.push(item);
    }
    return {
      items: items,
      coupon: state.discountApplicable && state.selectedDiscount && state.selectedDiscount.code ? state.selectedDiscount.code : null,
      attributes: {
        combo_source: 'ComboForge',
        combo_template_id: String(state.templateId),
        combo_template_name: state.templateName,
      },
    };
  }

  // The COD button's text, with its price tags ({cod_price} ...) filled in for
  // this combo's price (BrixCod.comboButton().label).
  function codText(state) {
    var cb = state.codButton;
    if (!cb) return state.config.cod_btn_text || 'Cash on Delivery';
    return typeof cb.label === 'function' ? cb.label(state.finalPrice) : cb.text;
  }

  // Where the COD button goes next to Checkout: replace | above | below.
  function codPlacement(state) {
    var p = state.codButton && state.codButton.placement;
    return p === 'replace' || p === 'above' ? p : 'below';
  }

  // BRIX COD Checkout: the Cash on Delivery sheet comes from the cart-drawer
  // app embed (extensions/cart-drawer/assets/brix_cod.js). Its "Pay online"
  // falls back to this page's normal checkout (onCheckout).
  function onCod(root, state) {
    if (state.totalSelected === 0 || !window.BrixCod) return;
    if (state.weightMode && !state.canCheckout) return;
    var co = buildComboItems(state);
    if (co.items.length === 0) return;
    trackEvent(state, 'click', state.finalPrice);
    window.BrixCod.open({
      surface: 'combo',
      items: co.items,
      coupon: co.coupon,
      attributes: co.attributes,
      onPayOnline: function () { onCheckout(root, state); },
    });
  }

  // Waits briefly for brix_cod.js (same app embed, may run a moment later)
  // and calls cb() only when the merchant has COD on for combo pages.
  function whenCodAvailable(cb) {
    var tries = 0;
    (function check() {
      if (window.BrixCod) {
        window.BrixCod.isAvailable('combo').then(function (ok) { if (ok) cb(); });
        return;
      }
      if (++tries < 40) setTimeout(check, 100);
    })();
  }

  // Weight combos: into the real cart and on to Shopify checkout, where the
  // Function applies the box price. Shiprocket (it can't run our Function)
  // only when the merchant picks it for this combo: checkoutBoxWithShiprocket.
  function onWeightCheckout(root, state) {
    if (!state.canCheckout || state.checkingOut) return;
    var co = buildComboItems(state);
    if (co.items.length === 0) return;
    trackEvent(state, 'click', state.finalPrice);
    state.checkingOut = true;
    render(root);
    var quickShop = WeightCore.usesQuickShop(state.config.layout);
    var destination = quickShop ? QuickShop.opt(state.config, 'qs_btn_action') : 'checkout';
    var via = quickShop ? QuickShop.opt(state.config, 'qs_checkout_with') : 'shopify';
    if (destination === 'checkout' && via !== 'shopify' && state.shiprocketEnabled && window.BrixCheckout) {
      checkoutBoxWithShiprocket(root, state, co, via === 'shiprocket');
      return;
    }
    addBoxAndGo(root, state, co, destination);
  }

  function addBoxAndGo(root, state, co, destination) {
    addComboToCart({ templateId: state.templateId, items: co.items, attributes: co.attributes, destination: destination }).catch(function (err) {
      state.checkingOut = false;
      showToast(root, state, (err && err.message) || 'Could not add your box to the cart. Please try again.');
    });
  }

  // Box combos the merchant sends to Shiprocket (qs_checkout_with). Shiprocket
  // can't run the box Function, so for 'shiprocket' BRIX makes a one-time
  // Shopify code worth this box's discount (api.combo-box-code, priced on the
  // server) and hands it over with the items; 'shiprocket_own' = the
  // merchant's own Shiprocket offer prices it, no code. If the code can't be
  // made, the box goes to Shopify checkout as usual, where the Function applies.
  function checkoutBoxWithShiprocket(root, state, co, withCode) {
    var items = co.items.map(function (it) { return { variantId: it.variantId, quantity: it.quantity }; });
    var codeReady = !withCode ? Promise.resolve(null) : fetch(API_ORIGIN + '/api/combo-box-code', {
      method: 'POST',
      // text/plain keeps this a simple CORS request (no preflight); the server reads JSON from the body.
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ shop: state.shop, templateId: state.templateId, items: items }),
    }).then(function (r) { return r.json(); }).then(function (json) {
      if (!json || !json.success) throw new Error('box code unavailable');
      return json.code || null;
    });
    codeReady.then(function (code) {
      var params = new URLSearchParams();
      for (var key in co.attributes) params.set('attributes[' + key + ']', co.attributes[key]);
      if (code) params.set('discount', code);
      var lines = items.map(function (it) { return it.variantId + ':' + it.quantity; }).join(',');
      window.BrixCheckout.checkoutItems({
        items: items,
        coupon: code,
        attributes: co.attributes,
        // Shopify checkout with the same items and code if Shiprocket doesn't open.
        fallbackUrl: shopRoot() + 'cart/' + lines + '?' + params.toString(),
        onOpen: function () { state.checkingOut = false; render(root); },
      });
    }).catch(function () {
      addBoxAndGo(root, state, co, 'checkout');
    });
  }

  function onCheckout(root, state) {
    if (state.totalSelected === 0) return;
    if (state.weightMode) { onWeightCheckout(root, state); return; }
    var cartLines = [];
    var items = [];
    for (var variantId in state.selectedMap) {
      var sel = state.selectedMap[variantId];
      var shortId = String(variantId).split('/').pop();
      cartLines.push(shortId + ':' + (sel.qty || 1));
      items.push({ variantId: Number(shortId), quantity: sel.qty || 1 });
    }
    if (cartLines.length === 0) return;
    trackEvent(state, 'click', state.finalPrice);

    var shopDomain = state.shop.replace(/^https?:\/\//, '');
    var params = new URLSearchParams();
    params.set('attributes[combo_source]', 'ComboForge');
    params.set('attributes[combo_template_id]', String(state.templateId));
    params.set('attributes[combo_template_name]', state.templateName);
    var cartPath = '/cart/' + cartLines.join(',') + '?' + params.toString();

    var destination;
    if (state.discountApplicable && state.selectedDiscount && state.selectedDiscount.code) {
      destination = 'https://' + shopDomain + '/discount/' + encodeURIComponent(state.selectedDiscount.code) + '?redirect=' + encodeURIComponent(cartPath);
    } else {
      destination = 'https://' + shopDomain + cartPath;
    }

    // Shops we've switched to Shiprocket checkout: hand it the same items,
    // discount code and combo attributes the cart link above carries.
    // window.BrixCheckout comes from the cart-drawer app embed
    // (extensions/cart-drawer/assets/brix_checkout.js) and falls back to
    // destination itself if Shiprocket isn't on the page or fails to open.
    if (state.shiprocketEnabled && window.BrixCheckout) {
      window.BrixCheckout.checkoutItems({
        items: items,
        coupon: state.discountApplicable && state.selectedDiscount && state.selectedDiscount.code ? state.selectedDiscount.code : null,
        attributes: {
          combo_source: 'ComboForge',
          combo_template_id: String(state.templateId),
          combo_template_name: state.templateName,
        },
        fallbackUrl: destination,
      });
      return;
    }
    window.location.href = destination;
  }

  /* === RENDER: PRODUCT CARD (mirrors preview.$templateId.jsx's ProductCard) === */

  function renderProductCard(state, product, isMobile) {
    var config = state.config;
    var btnBg = config.add_btn_bg || config.product_add_btn_color || '#000';
    var btnTextColor = config.add_btn_text_color || config.product_add_btn_text_color || '#fff';
    var btnRadius = config.add_btn_border_radius == null ? 8 : config.add_btn_border_radius;
    var btnFontWeight = config.add_btn_font_weight || config.product_add_btn_font_weight || 600;
    var btnFontSize = isMobile
      ? (config.add_btn_font_size_mobile != null ? config.add_btn_font_size_mobile : (config.add_btn_font_size != null ? config.add_btn_font_size : (config.product_add_btn_font_size != null ? config.product_add_btn_font_size : 14)))
      : (config.add_btn_font_size != null ? config.add_btn_font_size : (config.product_add_btn_font_size != null ? config.product_add_btn_font_size : 14));
    var addBtnText = config.add_btn_text || config.product_add_btn_text || 'Add';
    var cardRadius = config.card_border_radius || 12;
    var textColor = config.text_color || '#1a1a1a';
    var primaryColor = config.primary_color || '#000000';
    var highlightColor = config.selection_highlight_color || '#22c55e';
    var showAddBtn = config.show_add_to_cart_btn !== false;
    var showQtySelector = config.show_quantity_selector !== false;
    var showSelectionTick = config.show_selection_tick !== false;
    var variantsDisplay = config.product_card_variants_display || 'static';
    var enableHover = !!config.enable_product_hover;
    var hoverMode = config.product_hover_mode || 'second_image';
    // Whether THIS product actually has content to reveal on hover — used
    // below to scope the CSS opacity-fade rule (.brix-combo-card-media--
    // hoverable) so the main image only fades out when there's something to
    // replace it with. Previously the fade rule applied unconditionally to
    // every card, so hovering (or lingering on, e.g. right after clicking
    // the image nav arrows, which are children of this same container)
    // a product with hover disabled — or enabled but missing a second image/
    // description for that specific product — faded the image to nothing,
    // leaving a blank/grey box until the mouse actually left and re-entered.
    var hasHoverContent = enableHover && (
      (hoverMode === 'second_image' && !!product.secondImageSrc) ||
      (hoverMode === 'description' && !!product.descriptionHtml)
    );
    var sizing = getProductSizing(config, isMobile);
    var cardPadding = config.product_card_padding == null ? 10 : config.product_card_padding;

    var variants = product.variants || [];
    var hasVariants = variants.length > 1;
    var activeVariantId = getActiveVariantId(state, product);
    var activeVariant = null;
    for (var i = 0; i < variants.length; i++) { if (String(variants[i].id) === String(activeVariantId)) { activeVariant = variants[i]; break; } }

    var selection = state.selectedMap[activeVariantId];
    var isAdded = !!selection;
    var qty = selection ? (selection.qty || 0) : 0;
    var displayPrice = activeVariant && activeVariant.price != null ? parseFloat(activeVariant.price) : parseFloat(product.price || 0);

    var otherAdded = [];
    if (hasVariants) {
      for (i = 0; i < variants.length; i++) {
        var v = variants[i];
        if (String(v.id) !== String(activeVariantId) && state.selectedMap[v.id]) otherAdded.push(v);
      }
    }

    var images = (product.images && product.images.length > 0) ? product.images : (product.image ? [product.image] : []);
    var imgIdx = state.imgIndex[product.id] || 0;
    var safeImgIndex = imgIdx >= images.length ? 0 : imgIdx;
    var displayImage = (activeVariant && activeVariant.image) || images[safeImgIndex] || product.image;

    var showVariantSelect = hasVariants && variantsDisplay !== 'popup' && (variantsDisplay !== 'hover' || isMobile);
    var showHoverVariants = hasVariants && variantsDisplay === 'hover' && !isMobile;

    var html = '';
    html += '<div class="brix-combo-card" data-product-id="' + esc(product.id) + '" style="' + styleStr({
      border: '2px solid ' + (isAdded ? highlightColor : '#eee'),
      borderRadius: cardRadius + 'px', overflow: 'hidden', background: '#fff',
      display: 'flex', flexDirection: 'column', position: 'relative', transition: 'border-color 0.2s',
    }) + '">';

    if (isAdded && showSelectionTick) {
      html += '<div style="' + styleStr({
        position: 'absolute', top: '8px', right: '8px', zIndex: '4',
        background: highlightColor, color: '#fff', width: '22px', height: '22px',
        borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '12px', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }) + '">' + ICON_CHECK + '</div>';
    }

    if (hasVariants && variantsDisplay === 'popup' && state.popupOpenProductId === product.id) {
      html += '<div data-combo-action="popup-close" style="' + styleStr({
        position: 'absolute', top: '0', left: '0', right: '0', bottom: '0',
        background: 'rgba(255,255,255,0.98)', zIndex: '5', display: 'flex', flexDirection: 'column', padding: '10px',
      }) + '">';
      html += '<div style="' + styleStr({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }) + '">';
      html += '<span style="' + styleStr({ fontWeight: '700', fontSize: '12px', textTransform: 'uppercase', color: '#666' }) + '">Pick Options</span>';
      html += '<button type="button" data-combo-action="popup-close" style="' + styleStr({ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px', lineHeight: '1' }) + '">' + ICON_CLOSE + '</button>';
      html += '</div>';
      html += '<div style="' + styleStr({ flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }) + '">';
      for (i = 0; i < variants.length; i++) {
        var pv = variants[i];
        html += '<div data-combo-action="popup-pick" data-product-id="' + esc(product.id) + '" data-variant-id="' + esc(pv.id) + '" style="' + styleStr({
          padding: '8px', border: '1px solid #eee', borderRadius: '8px', textAlign: 'center',
          fontSize: '12px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s',
          background: (pv.id === activeVariantId) ? highlightColor : '#f9f9f9',
          color: (pv.id === activeVariantId) ? '#fff' : '#333',
        }) + '">' + esc(pv.title) + '</div>';
      }
      html += '</div></div>';
    }

    // Media
    html += '<div class="brix-combo-card-media' + (hasHoverContent ? ' brix-combo-card-media--hoverable' : '') + '" style="' + styleStr({
      width: '100%', aspectRatio: sizing.productImageAspectRatio, background: '#f5f5f5',
      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative',
    }) + '">';
    html += '<div data-combo-action="lightbox-open" data-product-id="' + esc(product.id) + '" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;">';
    if (displayImage) {
      html += '<img class="brix-combo-media-main" src="' + esc(displayImage.url) + '" alt="' + esc(displayImage.altText || product.title) + '" style="' + styleStr({
        width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease, opacity 0.3s ease',
      }) + '" />';
    } else {
      html += '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
    }
    html += '</div>';

    if (hasHoverContent) {
      html += '<div class="brix-combo-media-hover" style="' + styleStr({
        position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
        background: 'rgba(255,255,255,0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '12px', boxSizing: 'border-box', textAlign: 'center', opacity: '0', transition: 'opacity 0.2s',
      }) + '">';
      if (hoverMode === 'second_image' && product.secondImageSrc) {
        html += '<img src="' + esc(product.secondImageSrc) + '" alt="Hover view" style="width:100%;height:100%;object-fit:cover;" />';
      } else if (hoverMode === 'description' && product.descriptionHtml) {
        html += '<div style="' + styleStr({
          fontSize: '13px', color: '#333', lineHeight: '1.5', fontWeight: '500',
          display: '-webkit-box', WebkitLineClamp: '6', WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }) + '">' + product.descriptionHtml + '</div>';
      }
      html += '</div>';
    }

    if (showHoverVariants) {
      html += '<div class="brix-combo-hover-variants" style="' + styleStr({
        position: 'absolute', bottom: '0', left: '0', right: '0', background: 'rgba(255,255,255,0.95)',
        padding: '10px', borderTop: '1px solid #eee', zIndex: '3', display: 'none', flexWrap: 'wrap',
        gap: '4px', maxHeight: '80px', overflowY: 'auto',
      }) + '">';
      for (i = 0; i < variants.length; i++) {
        var hv = variants[i];
        html += '<div data-combo-action="variant-pick" data-product-id="' + esc(product.id) + '" data-variant-id="' + esc(hv.id) + '" style="' + styleStr({
          fontSize: '10px', padding: '2px 6px', borderRadius: '4px', cursor: 'pointer',
          border: (hv.id === activeVariantId) ? ('1px solid ' + highlightColor) : '1px solid #ddd',
          background: (hv.id === activeVariantId) ? highlightColor : 'white',
          color: (hv.id === activeVariantId) ? 'white' : 'black',
        }) + '">' + esc(hv.title) + '</div>';
      }
      html += '</div>';
    }

    if (!enableHover && !(activeVariant && activeVariant.image) && images.length > 1) {
      html += '<button type="button" data-combo-action="img-prev" data-product-id="' + esc(product.id) + '" style="' + styleStr({
        position: 'absolute', left: '4px', top: '50%', transform: 'translateY(-50%)', width: '26px', height: '26px',
        borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: '14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }) + '">' + ICON_CHEVRON_LEFT + '</button>';
      html += '<button type="button" data-combo-action="img-next" data-product-id="' + esc(product.id) + '" style="' + styleStr({
        position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', width: '26px', height: '26px',
        borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.85)', cursor: 'pointer', fontSize: '14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }) + '">' + ICON_CHEVRON_RIGHT + '</button>';
      html += '<div style="' + styleStr({ position: 'absolute', bottom: '6px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '4px' }) + '">';
      for (i = 0; i < images.length; i++) {
        html += '<span data-combo-action="img-dot" data-product-id="' + esc(product.id) + '" data-idx="' + i + '" style="' + styleStr({
          width: '6px', height: '6px', borderRadius: '50%', cursor: 'pointer',
          background: (i === safeImgIndex) ? primaryColor : 'rgba(0,0,0,0.25)',
        }) + '"></span>';
      }
      html += '</div>';
    }
    html += '</div>'; // .brix-combo-card-media

    // Body
    html += '<div style="' + styleStr({ padding: cardPadding + 'px', display: 'flex', flexDirection: 'column', flex: '1' }) + '">';
    html += '<div style="' + styleStr({
      fontSize: sizing.productTitleSize + 'px', fontWeight: '500', lineHeight: '1.3', marginBottom: '4px',
      display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden', color: textColor,
    }) + '">' + esc(product.title) + '</div>';

    if (showVariantSelect) {
      html += '<select data-combo-action="variant-select" data-product-id="' + esc(product.id) + '" style="' + styleStr({
        marginBottom: '8px', fontSize: '12px', padding: '5px 6px', border: '1px solid #ddd',
        borderRadius: '6px', background: '#fff', color: textColor,
      }) + '">';
      for (i = 0; i < variants.length; i++) {
        var sv = variants[i];
        html += '<option value="' + esc(sv.id) + '"' + (sv.id === activeVariantId ? ' selected' : '') + '>' + esc(sv.title) + '</option>';
      }
      html += '</select>';
    }

    if (otherAdded.length > 0) {
      var parts = [];
      for (i = 0; i < otherAdded.length; i++) {
        var oa = otherAdded[i];
        parts.push(esc(oa.title) + ' ×' + (state.selectedMap[oa.id].qty || 0));
      }
      html += '<div style="' + styleStr({ fontSize: '11px', color: highlightColor, marginBottom: '6px' }) + '">Also in combo: ' + parts.join(', ') + '</div>';
    }

    html += '<div style="' + styleStr({ fontSize: sizing.productPriceSize + 'px', fontWeight: '600', color: primaryColor, marginBottom: '8px' }) + '">'
      + getCurrencySymbol(product.currency) + displayPrice.toFixed(2) + '</div>';

    // Weight combos: what this item adds to the box, or that it doesn't count.
    if (state.weightMode) {
      var unitGrams = state.variantGramsMap[activeVariantId];
      var counts = !!state.qualifying[product.id] && unitGrams > 0;
      html += '<div style="' + styleStr({
        alignSelf: 'flex-start', marginBottom: '8px', padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '600',
        background: counts ? '#f3f4f6' : '#fef3c7', color: counts ? '#374151' : '#92400e',
      }) + '">' + (counts ? esc(WeightCore.formatWeight(unitGrams, unitGrams < 1000 ? 'g' : 'kg')) : 'Not counted in box') + '</div>';
    }

    // flexWrap + the Add button's nowrap below: on narrow cards (2 columns on
    // a phone) the stepper and Add button don't fit on one row, and merchant
    // themes that set word-break on buttons then squeeze the label to one
    // letter per line. Wrapping drops the button to its own full-width row
    // instead; where the row already fits, nothing changes.
    html += '<div style="' + styleStr({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', padding: '6px 0 0', borderTop: '1px solid #eee', justifyContent: 'space-between' }) + '">';
    if (showQtySelector) {
      html += '<div style="' + styleStr({ display: 'flex', gap: '4px', alignItems: 'center' }) + '">';
      html += '<button type="button" data-combo-action="qty-dec" data-product-id="' + esc(product.id) + '" style="' + styleStr({
        width: '30px', height: '30px', border: '1px solid #ddd', background: '#f9f9f9', borderRadius: '6px 0 0 6px',
        cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1',
      }) + '">−</button>';
      html += '<span style="' + styleStr({ width: '35px', textAlign: 'center', fontWeight: '700', fontSize: '14px', border: '1px solid #ddd', borderLeft: 'none', borderRight: 'none', padding: '6px 0' }) + '">' + qty + '</span>';
      html += '<button type="button" data-combo-action="qty-inc" data-product-id="' + esc(product.id) + '" style="' + styleStr({
        width: '30px', height: '30px', border: '1px solid #ddd', background: '#f9f9f9', borderRadius: '0 6px 6px 0',
        cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1',
      }) + '">+</button>';
      html += '</div>';
    }
    if (showAddBtn) {
      html += '<button type="button" data-combo-action="card-add" data-product-id="' + esc(product.id) + '" style="' + styleStr({
        flex: '1', background: isAdded ? '#ff4d4d' : btnBg, color: btnTextColor, border: 'none',
        padding: '8px 12px', marginLeft: '4px', borderRadius: btnRadius + 'px', cursor: 'pointer',
        fontWeight: btnFontWeight, fontSize: btnFontSize + 'px', transition: 'all 0.2s', whiteSpace: 'nowrap',
      }) + '">' + esc(addBtnText) + '</button>';
    }
    html += '</div>'; // actions row
    html += '</div>'; // body
    html += '</div>'; // .brix-combo-card
    return html;
  }

  /* === RENDER: SECTIONS (mirrors Layout1Preview) === */

  function renderPriceSummary(state) {
    if (state.totalSelected === 0) return '';
    var html = '<div style="' + styleStr({ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: '8px', margin: '0 0 8px', fontSize: '15px' }) + '">';
    var symbol = getBarCurrencySymbol(state);
    if (state.discountApplicable) {
      html += '<span style="' + styleStr({ textDecoration: 'line-through', color: '#999', fontSize: '13px' }) + '">' + symbol + state.totalPrice.toFixed(2) + '</span>';
      html += '<span style="' + styleStr({ color: '#22c55e', fontWeight: '800' }) + '">' + symbol + state.finalPrice.toFixed(2) + '</span>';
    } else {
      html += '<span style="' + styleStr({ fontWeight: '700' }) + '">' + symbol + state.totalPrice.toFixed(2) + '</span>';
    }
    html += '</div>';
    return html;
  }

  // What the weight meter says right now (also announced to screen readers).
  function weightMessage(state) {
    return WeightCore.boxMessage(state.weight, state.box);
  }

  // Weight meter: replaces the item-count progress bar for weight combos.
  // Tier ticks along the bar, the box weight, and what to add next.
  function renderWeightMeter(state) {
    var config = state.config;
    var w = state.weight;
    var box = state.box;
    var tiers = w.tiers || [];
    var unit = w.unit;
    var top = tiers.length ? tiers[tiers.length - 1].min_grams : 1000;
    var scale = w.maxGrams != null ? w.maxGrams : Math.round(top * 1.2);
    var percent = scale > 0 ? Math.min(100, (box.grams / scale) * 100) : 0;
    var msg = weightMessage(state);
    var success = config.progress_success_color || '#16a34a';
    var barColor = box.overMax ? '#dc2626' : (box.tier && w.enabled ? success : (config.progress_bar_color || '#111827'));
    var textColor = config.progress_text_color || '#374151';
    var toneColor = msg.tone === 'error' ? '#b91c1c' : msg.tone === 'success' ? success : textColor;

    var html = '<div class="brix-combo-weight" style="' + styleStr({ padding: '16px 20px', background: '#fff', borderBottom: '1px solid #eee' }) + '">';
    html += '<div style="' + styleStr({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '10px', color: textColor }) + '">';
    html += '<span style="' + styleStr({ fontSize: '13px', fontWeight: '700', letterSpacing: '0.4px', textTransform: 'uppercase' }) + '">' + esc(config.progress_text || 'Your box') + '</span>';
    html += '<span style="' + styleStr({ fontSize: '15px', fontWeight: '800', fontVariantNumeric: 'tabular-nums' }) + '">'
      + esc(WeightCore.formatWeight(box.grams, unit))
      + (w.maxGrams != null ? '<span style="font-weight:500;color:#6b7280;"> / ' + esc(WeightCore.formatWeight(w.maxGrams, unit)) + ' max</span>' : '')
      + '</span></div>';

    html += '<div style="position:relative;height:10px;border-radius:10px;background:#e5e7eb;overflow:hidden;" role="progressbar" aria-valuemin="0" aria-valuemax="' + scale + '" aria-valuenow="' + Math.round(box.grams) + '" aria-label="Box weight">';
    html += '<div style="' + styleStr({ height: '100%', width: percent + '%', background: barColor, borderRadius: '10px', transition: 'width 0.4s ease, background 0.3s' }) + '"></div>';
    html += '</div>';

    if (w.enabled && tiers.length) {
      html += '<div style="position:relative;height:30px;margin-top:4px;">';
      for (var i = 0; i < tiers.length; i++) {
        var t = tiers[i];
        var left = scale > 0 ? Math.min(100, (t.min_grams / scale) * 100) : 0;
        var reached = box.grams >= t.min_grams && !box.overMax;
        html += '<div style="' + styleStr({
          position: 'absolute', left: left + '%', top: '0', transform: left > 90 ? 'translateX(-100%)' : (left < 10 ? 'none' : 'translateX(-50%)'),
          fontSize: '11px', lineHeight: '1.3', whiteSpace: 'nowrap', textAlign: 'center',
          color: reached ? success : '#6b7280', fontWeight: reached ? '700' : '500',
        }) + '" title="' + esc(t.label) + '">'
          + '<div style="width:2px;height:6px;background:currentColor;margin:0 auto 2px;"></div>'
          + esc(WeightCore.formatWeight(t.min_grams, unit)) + '</div>';
      }
      html += '</div>';
    }

    html += '<div aria-live="polite" style="' + styleStr({ marginTop: '8px', fontSize: '13px', fontWeight: '600', color: toneColor }) + '">' + esc(msg.text) + '</div>';
    if (box.unweighedKeys && box.unweighedKeys.length) {
      html += '<div style="margin-top:4px;font-size:12px;color:#6b7280;">' + box.unweighedKeys.length + ' selected item' + (box.unweighedKeys.length === 1 ? ' has' : 's have') + ' no weight and ' + (box.unweighedKeys.length === 1 ? 'doesn\'t' : 'don\'t') + ' count toward the box.</div>';
    }
    html += '</div>';
    return html;
  }

  function renderProgressBar(state) {
    if (state.weightMode) return renderWeightMeter(state);
    var config = state.config;
    if (!config.show_progress_bar) return '';
    var threshold = state.maxProducts;
    var percent = threshold > 0 ? Math.min(100, Math.floor((state.totalSelected / threshold) * 100)) : 0;
    var progressTextColor = config.progress_text_color || '#5c5f62';
    var topFill = state.totalSelected >= threshold ? (config.progress_success_color || '#28a745') : (config.progress_bar_color || '#1a6644');

    var html = '<div style="' + styleStr({
      background: '#fff', padding: '20px', position: 'sticky', top: '0', zIndex: '10',
      borderBottom: '1px solid #eee', boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
    }) + '">';
    html += '<div style="' + styleStr({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '15px', fontWeight: '800', marginBottom: '12px' }) + '">';
    html += '<span style="' + styleStr({ color: progressTextColor, letterSpacing: '0.5px', textTransform: 'uppercase' }) + '">' + esc(config.progress_text || 'Bundle Progress') + '</span>';
    html += '<span style="' + styleStr({ color: progressTextColor }) + '">' + percent + '%</span>';
    html += '</div>';
    html += '<div style="' + styleStr({ background: '#e0e0e0', height: '8px', borderRadius: '10px', overflow: 'hidden', position: 'relative' }) + '">';
    html += '<div style="' + styleStr({
      backgroundColor: topFill, height: '100%', width: percent + '%', transition: 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
      borderRadius: '10px', position: 'relative', overflow: 'hidden', minWidth: percent > 0 ? '4px' : '0',
    }) + '">';
    html += '<div class="brix-combo-shimmer" style="' + styleStr({ position: 'absolute', top: '0', left: '0', right: '0', bottom: '0', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)', transform: 'translateX(-100%)' }) + '"></div>';
    html += '</div></div>';
    html += '<div style="' + styleStr({ marginTop: '12px', fontSize: '13px', color: '#6d7175', display: 'flex', alignItems: 'center', gap: '6px' }) + '">';
    if (state.totalSelected < threshold) {
      html += '<span>Add <strong>' + Math.max(0, threshold - state.totalSelected) + '</strong> more for <strong>' + esc(config.discount_text || config.progress_text || 'Bundle Discount') + '</strong></span>';
    } else {
      html += '<span style="' + styleStr({ color: progressTextColor, fontWeight: '700' }) + '">Discount Unlocked!</span>';
    }
    html += '</div></div>';
    return html;
  }

  function renderBanner(state, isMobile) {
    var config = state.config;
    var sizing = getBannerSizing(config, isMobile);
    if (config.show_banner === false || !sizing.bannerUrl) return '';
    var html = '<div style="' + styleStr({
      width: config.banner_full_width ? 'calc(100% + 40px)' : (sizing.bannerWidth + '%'),
      height: sizing.finalBannerHeight,
      margin: config.banner_full_width ? '0 -20px' : '0 auto',
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }) + '">';
    html += '<img src="' + esc(sizing.bannerUrl) + '" alt="Banner" style="' + styleStr({
      width: '100%', height: config.banner_fit_mode === 'adapt' ? 'auto' : '100%', objectFit: sizing.bannerObjectFit, display: 'block',
    }) + '" /></div>';
    return html;
  }

  function renderTitleDescription(state, isMobile) {
    var config = state.config;
    if (config.show_title_description === false) return '';
    var headingColor = config.heading_color || '#333';
    var descriptionColor = config.description_color || '#666';
    var headingSize = config.heading_size || 28;
    var descriptionSize = config.description_size || 15;
    var headingAlign = config.heading_align || 'left';
    var descriptionAlign = config.description_align || 'left';
    var headingFontWeight = config.heading_font_weight || '700';
    var descriptionFontWeight = config.description_font_weight || '400';
    var titleBox = getBoxSpacing(config, 'title_container', isMobile);
    var descBox = getBoxSpacing(config, 'description_container', isMobile);
    var headingStyle = getHeadingStyleObj(config);
    var titleWidthStyle = getTitleWidthStyleObj(config, isMobile);

    var html = '<div style="padding:24px 20px;">';
    var titleWrapStyle = { textAlign: headingAlign,
      paddingTop: (titleBox.paddingTop || 0) + 'px', paddingRight: (titleBox.paddingRight || 0) + 'px',
      paddingBottom: (titleBox.paddingBottom || 0) + 'px', paddingLeft: (titleBox.paddingLeft || 0) + 'px',
      marginTop: (titleBox.marginTop || 0) + 'px', marginRight: (titleBox.marginRight || 0) + 'px',
      marginBottom: (titleBox.marginBottom || 0) + 'px', marginLeft: (titleBox.marginLeft || 0) + 'px' };
    for (var k in titleWidthStyle) titleWrapStyle[k] = titleWidthStyle[k];
    html += '<div style="' + styleStr(titleWrapStyle) + '">';
    html += '<h1 style="' + styleStr({
      margin: '0', fontSize: headingSize + 'px', color: headingColor, fontWeight: headingFontWeight,
      fontFamily: headingStyle.fontFamily, letterSpacing: headingStyle.letterSpacing,
      lineHeight: headingStyle.lineHeight, textTransform: headingStyle.textTransform,
    }) + '">' + esc(config.collection_title || 'Create Your Combo') + '</h1></div>';

    if (config.collection_description) {
      html += '<div style="' + styleStr({
        width: isMobile ? '100%' : ((config.title_width || 100) + '%'), textAlign: descriptionAlign,
        paddingTop: (descBox.paddingTop || 0) + 'px', paddingRight: (descBox.paddingRight || 0) + 'px',
        paddingBottom: (descBox.paddingBottom || 0) + 'px', paddingLeft: (descBox.paddingLeft || 0) + 'px',
        marginTop: (descBox.marginTop || 0) + 'px', marginRight: (descBox.marginRight || 0) + 'px',
        marginBottom: (descBox.marginBottom || 0) + 'px', marginLeft: (descBox.marginLeft || 0) + 'px',
      }) + '">';
      html += '<p style="' + styleStr({ margin: '0', fontSize: descriptionSize + 'px', color: descriptionColor, fontWeight: descriptionFontWeight, lineHeight: '1.5' }) + '">' + esc(config.collection_description) + '</p>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderSteps(state, isMobile) {
    var config = state.config;
    var allSteps = [1, 2, 3, 4, 5];
    var activeSteps = [];
    for (var s = 0; s < allSteps.length; s++) {
      var step = allSteps[s];
      if (step === 1 || config['step_' + step + '_collection'] || config['step_' + step + '_title']) activeSteps.push(step);
    }

    var gridColumns = isMobile ? (config.mobile_columns || 2) : (config.desktop_columns || 3);
    var productsGap = config.products_gap || 16;
    var isSlider = config.grid_layout_type === 'slider';
    var showNavArrows = config.show_nav_arrows !== false;
    var showScrollbar = !!config.show_scrollbar;

    var html = '<div style="padding:20px;">';
    html += renderPriceSummary(state);

    for (var i = 0; i < activeSteps.length; i++) {
      var step = activeSteps[i];
      var stepTitle = config['step_' + step + '_title'] || ('Category ' + step);
      var stepSubtitle = config['step_' + step + '_subtitle'] || 'Select your items';
      var stepColl = config['step_' + step + '_collection'];
      var stepProducts = (stepColl && state.productsByHandle[stepColl]) || [];
      var collName = stepColl ? (state.collectionNameMap[stepColl] || stepColl) : null;

      html += '<div style="margin-bottom:40px;">';
      html += '<div style="margin-bottom:16px;"><div style="display:flex;align-items:center;gap:8px;"><h3 style="font-size:18px;font-weight:700;margin:0;">' + esc(stepTitle) + '</h3></div>';
      html += '<p style="font-size:13px;color:#888;margin:4px 0 0;">' + esc(stepSubtitle) + (collName ? ' <span style="color:#aaa;">— ' + esc(collName) + '</span>' : '') + '</p></div>';

      if (!stepColl) {
        html += '<div style="padding:32px 16px;text-align:center;background:#f9fafb;border-radius:8px;border:2px dashed #e1e3e5;color:#8c9196;font-size:13px;">';
        html += '<div style="font-weight:600;margin-bottom:4px;">No collection selected</div><div>Choose a collection for this step.</div></div>';
      } else if (stepProducts.length === 0) {
        html += '<div style="padding:32px 16px;text-align:center;background:#f9fafb;border-radius:8px;border:2px dashed #e1e3e5;color:#8c9196;font-size:13px;">';
        html += '<div style="font-weight:600;margin-bottom:4px;">No products found</div><div>The selected collection has no products.</div></div>';
      } else if (isSlider) {
        html += '<div style="position:relative;">';
        html += '<div class="brix-combo-slider-track' + (showScrollbar ? ' show-scrollbar' : '') + '" data-step="' + step + '" style="display:flex;gap:12px;overflow-x:auto;padding-bottom:' + (showScrollbar ? '10px' : '0') + ';scroll-behavior:smooth;">';
        for (var pi = 0; pi < stepProducts.length; pi++) {
          html += '<div style="min-width:160px;width:160px;">' + renderProductCard(state, stepProducts[pi], isMobile) + '</div>';
        }
        html += '</div>';
        if (showNavArrows) {
          html += '<div data-combo-action="slider-scroll" data-step="' + step + '" data-dir="left" style="' + styleStr({
            position: 'absolute', left: config.arrow_position === 'outside' ? '-22px' : '8px', top: '50%', transform: 'translateY(-50%)',
            width: (config.arrow_size || 36) + 'px', height: (config.arrow_size || 36) + 'px',
            background: config.arrow_bg_color || '#000', color: config.arrow_color || '#fff',
            borderRadius: (config.arrow_border_radius == null ? 50 : config.arrow_border_radius) + ((config.arrow_border_radius == null || config.arrow_border_radius === 50) ? '%' : 'px'),
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
            zIndex: '10', cursor: 'pointer', opacity: (config.arrow_opacity == null ? 0.9 : config.arrow_opacity),
          }) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></div>';
          html += '<div data-combo-action="slider-scroll" data-step="' + step + '" data-dir="right" style="' + styleStr({
            position: 'absolute', right: config.arrow_position === 'outside' ? '-22px' : '8px', top: '50%', transform: 'translateY(-50%)',
            width: (config.arrow_size || 36) + 'px', height: (config.arrow_size || 36) + 'px',
            background: config.arrow_bg_color || '#000', color: config.arrow_color || '#fff',
            borderRadius: (config.arrow_border_radius == null ? 50 : config.arrow_border_radius) + ((config.arrow_border_radius == null || config.arrow_border_radius === 50) ? '%' : 'px'),
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
            zIndex: '10', cursor: 'pointer', opacity: (config.arrow_opacity == null ? 0.9 : config.arrow_opacity),
          }) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>';
        }
        html += '</div>';
      } else {
        html += '<div style="display:grid;grid-template-columns:repeat(' + gridColumns + ', minmax(0, 1fr));gap:' + productsGap + 'px;">';
        for (var gi = 0; gi < stepProducts.length; gi++) {
          html += renderProductCard(state, stepProducts[gi], isMobile);
        }
        html += '</div>';
      }
      html += '</div>'; // step wrapper
    }
    html += '</div>'; // steps padding wrapper
    return html;
  }

  /* === RENDER: LAYOUT4 "Editorial Split" (mirrors Layout4Preview) === */

  // React drops a style property whose value is undefined and appends px to
  // bare numbers; styleStr does neither, so numeric config values go through
  // this (null is skipped by styleStr, same end result as React's omission).
  function px(v) {
    if (v == null || v === '') return null;
    return isNaN(Number(v)) ? v : (Number(v) + 'px');
  }

  // First argument that is not null/undefined — stands in for the React
  // source's ?? chains (0 is a real value there, so || would be wrong).
  function firstSet() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] != null) return arguments[i];
    }
    return undefined;
  }

  // Mirrors preview.$templateId.jsx's ProgressBar — the generic (layout2/3/4)
  // bar, which is a different design from layout1's sticky one above.
  function renderGenericProgressBar(state) {
    if (state.weightMode) return renderWeightMeter(state);
    var config = state.config;
    if (!config.show_progress_bar) return '';
    var threshold = parseInt(state.maxProducts) || 5;
    var percent = Math.min(100, Math.floor((state.totalSelected / threshold) * 100));
    var isUnlocked = state.totalSelected >= threshold;
    var remaining = Math.max(0, threshold - state.totalSelected);
    var barColor = isUnlocked ? (config.progress_success_color || '#22c55e') : (config.progress_bar_color || '#000');
    var textColor = config.progress_text_color || '#333';

    var html = '<div style="' + styleStr({
      width: (config.progress_bar_width || 100) + '%', margin: '8px auto 16px', padding: '0 5px', boxSizing: 'border-box',
    }) + '">';
    html += '<div style="' + styleStr({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', fontSize: '13px', fontWeight: '700', marginBottom: '10px' }) + '"><div>';
    if (isUnlocked) {
      html += '<span style="' + styleStr({ fontWeight: '700', color: textColor, textTransform: 'uppercase' }) + '">' + esc(config.discount_unlocked_text || 'DISCOUNT UNLOCKED!') + '</span>';
    } else {
      html += '<span style="' + styleStr({ textTransform: 'uppercase', fontWeight: '700', color: textColor, letterSpacing: '0.5px' }) + '">ADD ' + remaining + ' MORE FOR ' + esc(config.discount_text || 'DISCOUNT') + '</span>';
    }
    html += '</div><div style="' + styleStr({ color: textColor, fontWeight: '800' }) + '">' + percent + '%</div></div>';
    html += '<div style="' + styleStr({ height: '12px', borderRadius: '12px', width: '100%', boxSizing: 'border-box', background: '#e0e0e0', overflow: 'hidden', position: 'relative' }) + '">';
    html += '<div style="' + styleStr({
      height: '100%', width: percent + '%', background: barColor, borderRadius: '12px',
      transition: 'width 0.5s ease, background 0.4s', position: 'relative', overflow: 'hidden',
    }) + '">';
    html += '<div class="brix-combo-shimmer" style="' + styleStr({ position: 'absolute', top: '0', left: '0', right: '0', bottom: '0', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent)', transform: 'translateX(-100%)' }) + '"></div>';
    html += '</div></div></div>';
    return html;
  }

  // Mirrors preview.$templateId.jsx's GenericProductGrid: one flat list of
  // products (no steps), as a responsive grid or a horizontal slider with
  // fixed-style arrows. The arrows are divs rather than the React source's
  // buttons so the merchant theme's own button styles can't restyle them.
  function renderGenericProductGrid(state, products, isMobile) {
    var config = state.config;
    var gridColumns = isMobile ? (config.mobile_columns || 2) : (config.desktop_columns || 3);
    var gridGap = Number(firstSet(config.products_gap, 12));
    var isSlider = config.grid_layout_type === 'slider';
    var cardWidth = isMobile ? '220px' : '280px';

    var html = '<div style="' + styleStr({ width: (config.grid_width || 100) + '%', margin: '0 auto' }) + '">';
    html += '<div style="position:relative;width:100%;">';
    if (isSlider) {
      var dirs = ['left', 'right'];
      for (var d = 0; d < dirs.length; d++) {
        var arrowStyle = {
          position: 'absolute', top: '50%', transform: 'translateY(-50%)',
          width: '36px', height: '36px', borderRadius: '50%', background: '#fff', border: '1px solid #ddd', color: '#000',
          fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          zIndex: '10', boxShadow: '0 4px 10px rgba(0,0,0,0.1)', boxSizing: 'border-box',
        };
        arrowStyle[dirs[d]] = '10px';
        html += '<div role="button" data-combo-action="slider-scroll" data-step="grid" data-dir="' + dirs[d] + '" data-amount="300" style="' + styleStr(arrowStyle) + '">'
          + (dirs[d] === 'left' ? ICON_CHEVRON_LEFT : ICON_CHEVRON_RIGHT) + '</div>';
      }
    }
    html += '<div class="brix-combo-slider-track" data-step="grid" style="' + styleStr({
      display: isSlider ? 'flex' : 'grid',
      gridTemplateColumns: isSlider ? 'none' : ('repeat(' + gridColumns + ', minmax(0, 1fr))'),
      flexDirection: isSlider ? 'row' : 'column', flexWrap: 'nowrap', gap: gridGap + 'px',
      width: '100%', boxSizing: 'border-box', alignItems: 'stretch',
      overflowX: isSlider ? 'auto' : 'visible', overflowY: 'hidden',
      WebkitOverflowScrolling: 'touch', scrollSnapType: isSlider ? 'x mandatory' : 'none',
      paddingLeft: isSlider ? '20px' : '0', paddingRight: isSlider ? '20px' : '0',
    }) + '">';
    for (var i = 0; i < products.length; i++) {
      html += '<div style="' + styleStr({
        minWidth: isSlider ? cardWidth : 'auto', width: isSlider ? cardWidth : 'auto',
        flexShrink: '0', scrollSnapAlign: 'start',
      }) + '">' + renderProductCard(state, products[i], isMobile) + '</div>';
    }
    html += '</div></div></div>';
    return html;
  }

  // Products of the given collections, in order, each product only once.
  function uniqueProducts(state, handles) {
    var seen = {};
    var out = [];
    for (var h = 0; h < handles.length; h++) {
      var prods = state.productsByHandle[handles[h]] || [];
      for (var i = 0; i < prods.length; i++) {
        if (seen[prods[i].id]) continue;
        seen[prods[i].id] = true;
        out.push(prods[i]);
      }
    }
    return out;
  }

  // Banner first, then price/progress, title, and every product from every
  // collection in one de-duplicated grid; the preview bar sits outside the
  // card so the card's overflow:hidden can't clip its sticky positioning.
  function renderLayout4(state, isMobile) {
    var config = state.config;
    var headingSize = isMobile ? firstSet(config.heading_size_mobile, config.heading_size, 22) : firstSet(config.heading_size, 32);
    var descriptionSize = isMobile ? firstSet(config.description_size_mobile, config.description_size, 13) : firstSet(config.description_size, 16);
    var headingAlign = isMobile ? (config.heading_align_mobile || config.heading_align || 'left') : (config.heading_align || 'left');
    var descriptionAlign = isMobile ? (config.description_align_mobile || config.description_align || 'left') : (config.description_align || 'left');
    var titleBox = getBoxSpacing(config, 'title_container', isMobile);
    var descBox = getBoxSpacing(config, 'description_container', isMobile);
    var pad = getContainerPadding(config, isMobile);
    var padLeft = Number(pad.paddingLeft) || 0;
    var padRight = Number(pad.paddingRight) || 0;
    var sizing = getBannerSizing(config, isMobile);
    var headingStyle = getHeadingStyleObj(config);

    var allProducts = uniqueProducts(state, Object.keys(state.productsByHandle));

    var html = '<div style="' + styleStr({ background: '#eef1f5', padding: '16px', boxSizing: 'border-box' }) + '">';
    html += '<div style="' + styleStr({
      fontFamily: 'inherit', color: config.text_color || '#1a1a1a',
      paddingTop: px(pad.paddingTop), paddingRight: px(pad.paddingRight),
      paddingBottom: px(pad.paddingBottom), paddingLeft: px(pad.paddingLeft),
      background: config.bg_color || '#f9f9f9', maxWidth: '100%', margin: '0 auto',
      border: '1px solid #e5e5e5', borderRadius: '12px', boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
      position: 'relative', overflow: 'hidden', boxSizing: 'border-box',
    }) + '">';

    if (config.show_banner !== false && sizing.bannerUrl) {
      html += '<div style="' + styleStr({
        width: config.banner_full_width ? ('calc(100% + ' + (padLeft + padRight) + 'px)') : (sizing.bannerWidth + '%'),
        height: sizing.finalBannerHeight,
        paddingTop: px(config.banner_padding_top), paddingBottom: px(config.banner_padding_bottom),
        margin: config.banner_full_width ? ('0 -' + padLeft + 'px') : '0 auto',
        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }) + '">';
      html += '<img src="' + esc(sizing.bannerUrl) + '" alt="Banner" style="' + styleStr({
        width: '100%', height: config.banner_fit_mode === 'adapt' ? 'auto' : '100%', objectFit: sizing.bannerObjectFit, display: 'block',
      }) + '" /></div>';
    }

    html += '<div style="padding:20px;">' + renderPriceSummary(state) + renderGenericProgressBar(state) + '</div>';

    if (config.show_title_description !== false) {
      // Unlike layout1's title block, the React source passes no isMobile to
      // getTitleWidthStyle here, so the desktop width rule applies on mobile too.
      var titleWrapStyle = getTitleWidthStyleObj(config, false);
      titleWrapStyle.margin = '0 auto';
      titleWrapStyle.padding = '0 20px 20px';
      titleWrapStyle.boxSizing = 'border-box';
      html += '<div style="' + styleStr(titleWrapStyle) + '">';
      html += '<div style="' + styleStr({
        textAlign: headingAlign,
        paddingTop: px(titleBox.paddingTop), paddingRight: px(titleBox.paddingRight),
        paddingBottom: px(titleBox.paddingBottom), paddingLeft: px(titleBox.paddingLeft),
        marginTop: px(titleBox.marginTop), marginRight: px(titleBox.marginRight),
        marginBottom: px(titleBox.marginBottom), marginLeft: px(titleBox.marginLeft),
      }) + '">';
      html += '<h1 style="' + styleStr({
        margin: '0', fontSize: headingSize + 'px', color: config.heading_color || '#333',
        fontWeight: config.heading_font_weight || '700', textAlign: headingAlign,
        fontFamily: headingStyle.fontFamily, letterSpacing: headingStyle.letterSpacing,
        lineHeight: headingStyle.lineHeight, textTransform: headingStyle.textTransform,
      }) + '">' + esc(config.collection_title || 'Create Your Combo') + '</h1></div>';
      if (config.collection_description) {
        html += '<div style="' + styleStr({
          textAlign: descriptionAlign,
          paddingTop: px(descBox.paddingTop), paddingRight: px(descBox.paddingRight),
          paddingBottom: px(descBox.paddingBottom), paddingLeft: px(descBox.paddingLeft),
          marginTop: px(descBox.marginTop), marginRight: px(descBox.marginRight),
          marginBottom: px(descBox.marginBottom), marginLeft: px(descBox.marginLeft),
        }) + '">';
        html += '<p style="' + styleStr({
          margin: '0', fontSize: descriptionSize + 'px', color: config.description_color || '#666',
          fontWeight: config.description_font_weight || '400', textAlign: descriptionAlign, lineHeight: '1.5',
        }) + '">' + esc(config.collection_description) + '</p></div>';
      }
      html += '</div>';
    }

    html += '<div style="padding:0 20px 20px;">';
    if (allProducts.length === 0) {
      html += '<div style="padding:32px 16px;text-align:center;background:#f9fafb;border-radius:8px;border:2px dashed #e1e3e5;color:#8c9196;font-size:13px;">No products in this combo yet.</div>';
    } else {
      html += renderGenericProductGrid(state, allProducts, isMobile);
    }
    html += '</div>';

    html += '</div>'; // card wrapper
    html += renderAiSuggestions(state, isMobile);
    html += renderPreviewBar(state, isMobile);
    html += '</div>';
    return html;
  }

  /* === RENDER: LAYOUT2 "Velocity Stream" + LAYOUT3 (mirror Layout2Preview / Layout3Preview) === */

  // Collection switcher tabs: an optional "all" tab plus one per configured
  // col_N collection. titleKey is the config key holding a tab's fallback
  // label, with # standing for N ('step_#_title' / 'title_#').
  function getCollectionTabs(state, maxCols, allLabel, titleKey) {
    var config = state.config;
    var tabs = [];
    if (config.show_tab_all !== false) tabs.push({ label: allLabel, value: 'all' });
    for (var i = 1; i <= maxCols; i++) {
      var handle = config['col_' + i];
      if (!handle) continue;
      tabs.push({ label: state.collectionNameMap[handle] || config[titleKey.replace('#', i)] || handle, value: handle });
    }
    return tabs;
  }

  // Products for the active tab. "all" is every tab collection de-duplicated.
  // fallbackToAll covers layout3 templates set up with only a base
  // collection (collection_handle) and no col_N tabs — without it their
  // grid would always be empty.
  function getTabProducts(state, tabs, fallbackToAll) {
    if (state.activeTab !== 'all') return state.productsByHandle[state.activeTab] || [];
    var handles = [];
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].value !== 'all') handles.push(tabs[i].value);
    }
    if (handles.length === 0 && fallbackToAll) handles = Object.keys(state.productsByHandle);
    return uniqueProducts(state, handles);
  }

  function renderLayout2(state, isMobile) {
    var config = state.config;
    var tabs = getCollectionTabs(state, config.tab_count || 8, config.tab_all_label || 'Collections', 'step_#_title');
    var activeBg = config.tab_active_bg_color || config.selection_highlight_color || '#5e1c5f';
    var headingSize = isMobile ? firstSet(config.heading_size_mobile, config.heading_size, 22) : firstSet(config.heading_size, 32);
    var descriptionSize = isMobile ? firstSet(config.description_size_mobile, config.description_size, 13) : firstSet(config.description_size, 16);
    var headingAlign = isMobile ? (config.heading_align_mobile || config.heading_align || 'left') : (config.heading_align || 'left');
    var descriptionAlign = isMobile ? (config.description_align_mobile || config.description_align || 'left') : (config.description_align || 'left');
    var titleBox = getBoxSpacing(config, 'title_container', isMobile);
    var descBox = getBoxSpacing(config, 'description_container', isMobile);
    var pad = getContainerPadding(config, isMobile);
    var sizing = getBannerSizing(config, isMobile);
    var headingStyle = getHeadingStyleObj(config);
    var activeProducts = getTabProducts(state, tabs, false);

    var html = '<div style="' + styleStr({ background: '#eef1f5', padding: '16px', boxSizing: 'border-box' }) + '">';
    html += '<div style="' + styleStr({
      fontFamily: 'inherit', color: config.text_color || '#1a1a1a',
      paddingTop: px(pad.paddingTop), paddingRight: px(pad.paddingRight),
      paddingBottom: px(pad.paddingBottom), paddingLeft: px(pad.paddingLeft),
      background: config.bg_color || '#f9f9f9', maxWidth: '100%', margin: '0 auto',
      border: '1px solid #e5e5e5', borderRadius: '12px', boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
      position: 'relative', overflow: 'hidden', boxSizing: 'border-box',
    }) + '">';

    if (config.show_banner !== false && sizing.bannerUrl) {
      html += '<div style="' + styleStr({ position: 'relative', width: sizing.bannerWidth + '%', margin: '0 auto', height: sizing.finalBannerHeight, overflow: 'hidden' }) + '">';
      html += '<img src="' + esc(sizing.bannerUrl) + '" alt="Banner" style="' + styleStr({
        width: '100%', height: config.banner_fit_mode === 'adapt' ? 'auto' : '100%', objectFit: sizing.bannerObjectFit,
      }) + '" /></div>';
    }

    if (config.show_title_description !== false) {
      var titleWrapStyle = getTitleWidthStyleObj(config, false);
      titleWrapStyle.margin = '0 auto';
      html += '<div style="' + styleStr(titleWrapStyle) + '">';
      html += '<div style="' + styleStr({
        textAlign: headingAlign,
        paddingTop: px(titleBox.paddingTop), paddingRight: px(titleBox.paddingRight),
        paddingBottom: px(titleBox.paddingBottom), paddingLeft: px(titleBox.paddingLeft),
        marginTop: px(titleBox.marginTop), marginRight: px(titleBox.marginRight),
        marginBottom: px(titleBox.marginBottom), marginLeft: px(titleBox.marginLeft),
      }) + '">';
      html += '<h1 style="' + styleStr({
        fontSize: headingSize + 'px', margin: '0 0 4px', color: config.heading_color || '#333',
        fontWeight: config.heading_font_weight || '700', textAlign: headingAlign,
        fontFamily: headingStyle.fontFamily, letterSpacing: headingStyle.letterSpacing,
        lineHeight: headingStyle.lineHeight, textTransform: headingStyle.textTransform,
      }) + '">' + esc(config.collection_title || 'Create Your Combo') + '</h1></div>';
      if (config.collection_description) {
        html += '<div style="' + styleStr({
          textAlign: descriptionAlign,
          paddingTop: px(descBox.paddingTop), paddingRight: px(descBox.paddingRight),
          paddingBottom: px(descBox.paddingBottom), paddingLeft: px(descBox.paddingLeft),
          marginTop: px(descBox.marginTop), marginRight: px(descBox.marginRight),
          marginBottom: px(descBox.marginBottom), marginLeft: px(descBox.marginLeft),
        }) + '">';
        // margin:0 matches the admin preview, where Polaris resets <p> margins.
        html += '<p style="' + styleStr({
          margin: '0', fontSize: descriptionSize + 'px', color: config.description_color || '#666',
          fontWeight: config.description_font_weight || '400', textAlign: descriptionAlign,
        }) + '">' + esc(config.collection_description) + '</p></div>';
      }
      html += '</div>';
    }

    if (tabs.length > 0) {
      html += '<div style="' + styleStr({
        width: (config.tabs_width || 100) + '%', margin: '0 auto',
        marginTop: firstSet(config.tab_margin_top, 0) + 'px', marginBottom: firstSet(config.tab_margin_bottom, 24) + 'px',
      }) + '">';
      html += '<div style="' + styleStr({
        padding: '12px 20px', display: 'flex', justifyContent: config.tab_alignment || 'left',
        gap: '10px', overflowX: 'auto', borderBottom: '1px solid #eee', background: '#fff', scrollbarWidth: 'thin',
      }) + '">';
      for (var t = 0; t < tabs.length; t++) {
        var isActive = tabs[t].value === state.activeTab;
        // A div, not the React source's <button>, so the merchant theme's
        // own button styles can't restyle the tabs.
        html += '<div role="button" data-combo-action="tab-pick" data-tab="' + esc(tabs[t].value) + '" style="' + styleStr({
          padding: (config.tab_padding_vertical || 8) + 'px ' + (config.tab_padding_horizontal || 18) + 'px',
          borderRadius: firstSet(config.tab_border_radius, 25) + 'px',
          border: '1px solid ' + (isActive ? activeBg : (config.tab_border_color || '#eee')),
          background: isActive ? activeBg : (config.tab_bg_color || '#fff'),
          color: isActive ? (config.tab_active_text_color || '#fff') : (config.tab_text_color || '#444'),
          fontSize: (config.tab_font_size || 13) + 'px', fontWeight: '600', lineHeight: '1.2',
          cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.3s ease', flexShrink: '0',
        }) + '">' + esc(tabs[t].label) + '</div>';
      }
      html += '</div></div>';
    }

    html += '<div style="padding:20px;">' + renderPriceSummary(state) + renderGenericProgressBar(state);
    if (activeProducts.length === 0) {
      html += '<div style="padding:32px 16px;text-align:center;background:#f9fafb;border-radius:8px;border:2px dashed #e1e3e5;color:#8c9196;font-size:13px;">';
      html += '<div style="margin-bottom:8px;display:flex;justify-content:center;"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.35-4.35"></path></svg></div>';
      html += '<div style="font-weight:600;margin-bottom:4px;">No products in this tab</div></div>';
    } else {
      html += renderGenericProductGrid(state, activeProducts, isMobile);
    }
    html += '</div>';

    html += '</div>'; // card wrapper
    html += renderAiSuggestions(state, isMobile);
    html += renderPreviewBar(state, isMobile);
    html += '</div>';
    return html;
  }

  function splitList(str) {
    var parts = String(str || '').split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i].trim();
      if (s) out.push(s);
    }
    return out;
  }

  function getLayout3Banners(config) {
    var banners = [];
    for (var i = 1; i <= 3; i++) {
      if (config['banner_' + i + '_image']) {
        banners.push({ image: config['banner_' + i + '_image'], title: config['banner_' + i + '_title'], subtitle: config['banner_' + i + '_subtitle'] });
      }
    }
    return banners;
  }

  function getLayout3TimerSeconds(config) {
    return Number(config.timer_hours || 0) * 3600 + Number(config.timer_minutes || 0) * 60 + Number(config.timer_seconds || 0);
  }

  function formatCountdown(seconds) {
    var s = Math.max(0, seconds || 0);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return { h: two(Math.floor(s / 3600)), m: two(Math.floor((s % 3600) / 60)), s: two(s % 60) };
  }

  // "App style" layout: hero card (deal badge, banner or rotating banners,
  // title/price, countdown), progress bar, collection pills, two-column grid.
  // The countdown digits and the visible banner slide are updated in place
  // by startLayout3Timers, never by re-rendering, so a tick can't reset
  // scroll position or image carousels; state.timeLeft/currentSlide/
  // bundleIndex make any full re-render come out at the current values.
  function renderLayout3(state, isMobile) {
    var config = state.config;
    var primaryColor = config.primary_color || '#20D060';
    var highlight = config.selection_highlight_color || primaryColor;
    var bannerObjectFit = config.banner_fit_mode === 'contain' ? 'contain' : 'cover';
    var tabs = getCollectionTabs(state, 4, config.title_1 || 'All Packs', 'title_#');
    var activeProducts = getTabProducts(state, tabs, true);
    var banners = getLayout3Banners(config);
    var titles = splitList(config.bundle_titles);
    var subtitles = splitList(config.bundle_subtitles);
    var subtitle = subtitles[state.bundleIndex] || config.hero_subtitle;

    var html = '<div style="' + styleStr({ maxWidth: '480px', margin: '24px auto', padding: '0 16px', boxSizing: 'border-box' }) + '">';
    html += '<div style="' + styleStr({
      background: config.bg_color || '#eef2f7', fontFamily: 'inherit', color: config.text_color || '#111',
      borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
    }) + '">';
    html += '<div style="padding-bottom:24px;">';

    if (config.show_hero !== false) {
      html += '<div style="padding:16px 20px;">';
      html += '<div style="background:#fff;border-radius:20px;padding:16px;box-shadow:0 4px 15px rgba(0,0,0,0.03);">';
      html += '<div style="' + styleStr({
        background: primaryColor, color: '#000', fontSize: '10px', fontWeight: '800', padding: '4px 10px',
        borderRadius: '20px', display: 'inline-block', marginBottom: '12px', textTransform: 'uppercase',
      }) + '">DEAL OF THE DAY</div>';
      // The slides are absolutely positioned, so they can't give an
      // auto-height box any height — "adapt" only applies to the single image.
      var sliderOn = !!config.enable_banner_slider && banners.length > 1;
      html += '<div style="' + styleStr({
        width: '100%', height: (config.banner_fit_mode === 'adapt' && !sliderOn) ? 'auto' : '160px', background: '#f9f9f9',
        borderRadius: '12px', marginBottom: '16px', overflow: 'hidden', position: 'relative',
      }) + '">';
      if (sliderOn) {
        html += '<div style="width:100%;height:100%;position:relative;">';
        for (var b = 0; b < banners.length; b++) {
          var on = state.currentSlide === b;
          html += '<div data-brix-slide="' + b + '" style="' + styleStr({
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            opacity: on ? '1' : '0', transition: 'opacity 0.8s ease-in-out', zIndex: on ? '1' : '0',
          }) + '">';
          html += '<img src="' + esc(banners[b].image) + '" alt="' + esc(banners[b].title || '') + '" style="' + styleStr({ width: '100%', height: '100%', objectFit: bannerObjectFit, display: 'block' }) + '" />';
          html += '<div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent, rgba(0,0,0,0.7));padding:10px 15px;color:white;">';
          html += '<div style="font-weight:bold;font-size:14px;">' + esc(banners[b].title) + '</div>';
          html += '<div style="font-size:12px;opacity:0.9;">' + esc(banners[b].subtitle) + '</div></div></div>';
        }
        html += '</div>';
      } else if (config.hero_image_url) {
        html += '<img src="' + esc(config.hero_image_url) + '" alt="Hero" style="' + styleStr({ width: '100%', height: '100%', objectFit: bannerObjectFit, display: 'block' }) + '" />';
      }
      html += '</div>';

      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;">';
      html += '<div style="font-size:18px;font-weight:800;line-height:1.2;flex:1;">' + esc(titles[state.bundleIndex] || config.hero_title || 'Combo Bundle') + '</div>';
      if (config.hero_price) {
        html += '<div style="' + styleStr({ fontSize: '18px', fontWeight: '800', color: primaryColor, marginLeft: '12px' }) + '">' + esc(config.hero_price) + '</div>';
      }
      html += '</div>';
      if (config.hero_compare_price) {
        html += '<div style="font-size:12px;text-decoration:line-through;color:#bbb;text-align:right;margin-top:-4px;margin-bottom:8px;">' + esc(config.hero_compare_price) + '</div>';
      }
      if (subtitle) {
        html += '<div style="font-size:12px;color:#888;margin-bottom:16px;">' + esc(subtitle) + '</div>';
      }
      if (config.timer_hours || config.timer_minutes || config.timer_seconds) {
        var time = formatCountdown(state.timeLeft);
        var units = ['h', 'm', 's'];
        html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:11px;color:#888;font-weight:600;">ENDS IN:';
        for (var u = 0; u < units.length; u++) {
          html += '<span data-brix-timer="' + units[u] + '" style="' + styleStr({ background: '#eafff2', color: primaryColor, padding: '4px 8px', borderRadius: '6px', fontWeight: '700', fontSize: '13px' }) + '">' + time[units[u]] + '</span>';
        }
        html += '</div>';
      }
      html += '</div></div>';
    }

    if (config.show_progress_bar || state.weightMode) {
      html += '<div style="padding:0 20px;">' + renderGenericProgressBar(state) + '</div>';
    }

    if (tabs.length > 0) {
      html += '<div class="brix-combo-slider-track" style="display:flex;gap:10px;overflow-x:auto;padding:8px 20px 20px;">';
      for (var t = 0; t < tabs.length; t++) {
        var isActive = tabs[t].value === state.activeTab;
        html += '<div role="button" data-combo-action="tab-pick" data-tab="' + esc(tabs[t].value) + '" style="' + styleStr({
          whiteSpace: 'nowrap', padding: '8px 20px', borderRadius: '20px',
          backgroundColor: isActive ? highlight : '#fff', border: '1px solid ' + (isActive ? highlight : '#eee'),
          fontSize: '12px', fontWeight: '600', color: isActive ? '#fff' : '#333', cursor: 'pointer',
          transition: 'all 0.2s ease', boxShadow: isActive ? '0 4px 10px rgba(0,0,0,0.1)' : 'none', flexShrink: '0',
        }) + '">' + esc(tabs[t].label) + '</div>';
      }
      html += '</div>';
    }

    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:0 20px 12px;"><div style="font-size:16px;font-weight:700;">Curated For You</div></div>';

    if (activeProducts.length === 0) {
      html += '<div style="margin:0 20px;padding:32px 16px;text-align:center;background:#f9fafb;border-radius:8px;border:2px dashed #e1e3e5;color:#8c9196;font-size:13px;">No products in this category</div>';
    } else {
      html += '<div style="display:grid;grid-template-columns:minmax(0, 1fr) minmax(0, 1fr);gap:12px;padding:0 20px;">';
      for (var p = 0; p < activeProducts.length; p++) {
        html += renderProductCard(state, activeProducts[p], isMobile);
      }
      html += '</div>';
    }

    html += '</div>'; // padding-bottom wrapper
    html += '</div>'; // card wrapper
    html += renderAiSuggestions(state, isMobile);
    html += renderPreviewBar(state, isMobile);
    html += '</div>';
    return html;
  }

  // Layout3's banner rotation and countdown. Started once per root, after
  // its first render; both stop themselves if the root leaves the page.
  function startLayout3Timers(root, state) {
    var config = state.config;
    var banners = getLayout3Banners(config);
    if (config.enable_banner_slider && banners.length > 1) {
      var slideTimer = setInterval(function () {
        if (!document.contains(root)) { clearInterval(slideTimer); return; }
        state.currentSlide = (state.currentSlide + 1) % banners.length;
        var slides = root.querySelectorAll('[data-brix-slide]');
        for (var i = 0; i < slides.length; i++) {
          var on = Number(slides[i].getAttribute('data-brix-slide')) === state.currentSlide;
          slides[i].style.opacity = on ? '1' : '0';
          slides[i].style.zIndex = on ? '1' : '0';
        }
      }, (Number(config.slider_speed) || 5) * 1000);
    }

    var initialSeconds = getLayout3TimerSeconds(config);
    if (!(initialSeconds > 0)) return;
    var titles = splitList(config.bundle_titles);
    var countdown = setInterval(function () {
      if (!document.contains(root)) { clearInterval(countdown); return; }
      if (state.timeLeft <= 0) {
        if (!config.auto_reset_timer) { clearInterval(countdown); return; }
        state.timeLeft = initialSeconds;
        if (config.change_bundle_on_timer_end && titles.length > 0) {
          // The hero title/subtitle change with the bundle, so this one case
          // does need a full re-render.
          state.bundleIndex = (state.bundleIndex + 1) % titles.length;
          render(root);
          return;
        }
      } else {
        state.timeLeft -= 1;
      }
      var time = formatCountdown(state.timeLeft);
      var units = ['h', 'm', 's'];
      for (var u = 0; u < units.length; u++) {
        var el = root.querySelector('[data-brix-timer="' + units[u] + '"]');
        if (el) el.textContent = time[units[u]];
      }
    }, 1000);
  }

  /* === RENDER: AI SUGGESTIONS ("Enable AI Suggestions for Customers") === */

  var AI_SUGGESTION_LIMIT = 4;

  // Products the AI paired with what the shopper has picked, newest pick
  // first, round-robin so every pick contributes its best match before any
  // pick's second-best. Never repeats a product already in the combo, and
  // hides once the combo is full (nothing more can be added).
  function getAiSuggestions(state) {
    if (!state.config.ai_mode || !state.aiPairs) return [];
    if (state.totalSelected === 0 || state.totalSelected >= state.maxProducts) return [];
    var selected = {};
    var order = [];
    for (var vid in state.selectedMap) {
      var pid = state.selectedMap[vid].productId;
      if (!selected[pid]) { selected[pid] = true; order.push(pid); }
    }
    var out = [];
    var seen = {};
    for (var rank = 0; rank < 3 && out.length < AI_SUGGESTION_LIMIT; rank++) {
      for (var i = order.length - 1; i >= 0 && out.length < AI_SUGGESTION_LIMIT; i--) {
        var picks = state.aiPairs[order[i]] || [];
        var id = picks[rank];
        if (!id || selected[id] || seen[id] || !state.productMap[id]) continue;
        seen[id] = true;
        out.push(state.productMap[id]);
      }
    }
    return out;
  }

  var ICON_SPARKLE = '<svg width="1em" height="1em" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M7 1.5l1.2 3.3 3.3 1.2-3.3 1.2L7 10.5 5.8 7.2 2.5 6l3.3-1.2L7 1.5z"></path><path d="M11.5 9.5v3M10 11h3"></path></svg>';

  function renderAiSuggestions(state, isMobile) {
    var products = getAiSuggestions(state);
    if (products.length === 0) return '';
    var config = state.config;
    var textColor = config.text_color || '#1a1a1a';
    var btnBg = config.add_btn_bg || config.product_add_btn_color || '#000';
    var btnTextColor = config.add_btn_text_color || config.product_add_btn_text_color || '#fff';
    var btnRadius = config.add_btn_border_radius == null ? 8 : config.add_btn_border_radius;
    var symbol = getBarCurrencySymbol(state);
    var cardWidth = isMobile ? 132 : 156;

    var html = '<div class="brix-combo-ai" style="' + styleStr({
      width: (config.preview_bar_width || 100) + '%', margin: '24px auto 0', padding: isMobile ? '14px' : '16px 18px',
      background: '#fff', border: '1px solid #eee', borderRadius: (config.preview_border_radius || 12) + 'px',
      boxSizing: 'border-box', color: textColor, boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
    }) + '">';
    html += '<div style="' + styleStr({ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '15px', fontWeight: '700', marginBottom: '12px' }) + '">'
      + '<span style="display:flex;font-size:15px;">' + ICON_SPARKLE + '</span>'
      + '<span>' + esc(config.ai_suggestions_title || 'Pairs well with your picks') + '</span></div>';
    html += '<div class="brix-combo-ai-track" style="' + styleStr({ display: 'flex', gap: '12px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }) + '">';
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var hasVariants = (p.variants || []).length > 1;
      var price = state.variantPriceMap[getActiveVariantId(state, p)];
      if (price == null || isNaN(price)) price = parseFloat(p.price || 0);
      var img = p.image || (p.images && p.images[0]);
      html += '<div style="' + styleStr({
        width: cardWidth + 'px', minWidth: cardWidth + 'px', flexShrink: '0', display: 'flex', flexDirection: 'column',
        border: '1px solid #eee', borderRadius: (config.card_border_radius || 12) + 'px', overflow: 'hidden', background: '#fff',
      }) + '">';
      html += '<div style="width:100%;aspect-ratio:1/1;background:#f6f6f6;">'
        + (img ? '<img src="' + esc(img.url) + '" alt="' + esc(img.altText || p.title) + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;" />' : '')
        + '</div>';
      html += '<div style="padding:8px 10px 10px;display:flex;flex-direction:column;gap:4px;flex:1;">';
      html += '<div style="' + styleStr({
        fontSize: '13px', fontWeight: '600', lineHeight: '1.3', color: textColor, overflow: 'hidden',
        display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', minHeight: '34px',
      }) + '">' + esc(p.title) + '</div>';
      html += '<div style="font-size:13px;font-weight:700;color:' + esc(textColor) + ';">' + (hasVariants ? 'From ' : '') + symbol + price.toFixed(2) + '</div>';
      html += '<button type="button" data-combo-action="ai-pick" data-product-id="' + esc(p.id) + '" style="' + styleStr({
        marginTop: 'auto', width: '100%', padding: '8px 10px', border: 'none', borderRadius: btnRadius + 'px',
        background: btnBg, color: btnTextColor, fontSize: '13px', fontWeight: '700', cursor: 'pointer',
      }) + '">' + esc(hasVariants ? 'Choose' : (config.add_btn_text || config.product_add_btn_text || 'Add')) + '</button>';
      html += '</div></div>';
    }
    html += '</div></div>';
    return html;
  }

  function findProductCard(root, productId) {
    var id = window.CSS && CSS.escape ? CSS.escape(productId) : String(productId).replace(/"/g, '\\"');
    return root.querySelector('.brix-combo-card[data-product-id="' + id + '"]');
  }

  // A product with several variants is chosen on its own card (variant
  // picker, popup, etc. all live there), so the suggestion scrolls to that
  // card instead of guessing a variant. Layouts with collection tabs may not
  // have the card on screen; switch to a tab that holds it first.
  function onAiPick(root, state, product) {
    if ((product.variants || []).length <= 1) {
      onAdd(root, state, product, getActiveVariantId(state, product), 1);
      return;
    }
    var card = findProductCard(root, product.id);
    if (!card && (state.config.layout === 'layout2' || state.config.layout === 'layout3')) {
      var tab = 'all';
      for (var n = 1; n <= 8; n++) {
        var handle = state.config['col_' + n];
        var prods = handle ? (state.productsByHandle[handle] || []) : [];
        var found = false;
        for (var i = 0; i < prods.length; i++) { if (prods[i].id === product.id) { found = true; break; } }
        if (found) { tab = handle; break; }
      }
      state.activeTab = tab;
      render(root);
      card = findProductCard(root, product.id);
    }
    if (!card) {
      onAdd(root, state, product, getActiveVariantId(state, product), 1);
      return;
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('brix-combo-ai-flash');
    void card.offsetWidth;
    card.classList.add('brix-combo-ai-flash');
  }

  /* === RENDER: PREVIEW BAR (mirrors app/components/CdoPreviewBar.jsx) === */

  function renderPreviewBar(state, isMobile) {
    var config = state.config;
    if (!config.show_preview_bar) return '';
    var symbol = getBarCurrencySymbol(state);
    var maxSel = state.maxProducts;
    var previewGap = config.preview_item_gap == null ? 12 : config.preview_item_gap;
    var previewShape = config.preview_item_shape || 'circle';
    var baseSize = config.preview_item_size || (isMobile ? 40 : 48);
    var hasDiscount = state.finalPrice < state.totalPrice;
    var selectedProducts = buildSelectedProducts(state);
    // Checkout/Add to Cart must stay disabled until the merchant's
    // configured combo condition (max_products / discount_threshold, the
    // same "maxSel" this function already uses for the progress bar and
    // "Add N more" messaging below) is actually reached — previously this
    // only checked "at least one item selected", so checkout enabled itself
    // long before the configured condition (e.g. 4 or 5 items) was met.
    var canOpenDrawer = state.weightMode ? (state.canCheckout && !state.checkingOut) : state.totalSelected >= maxSel;

    var html = '<div style="' + styleStr({
      width: (config.preview_bar_width || 100) + '%', margin: '40px auto 10px',
      position: config.inline_preview_sticky ? 'sticky' : 'relative',
      bottom: config.inline_preview_sticky ? '10px' : 'auto', zIndex: config.inline_preview_sticky ? '999' : '1',
    }) + '">';
    html += '<div style="' + styleStr({
      background: config.layout === 'layout4' ? 'rgba(255,255,255,0.7)' : (config.preview_bar_bg || '#fff'),
      backdropFilter: (config.layout === 'layout4' || config.inline_preview_sticky) ? 'blur(10px)' : 'none',
      color: config.preview_bar_text_color || '#333', borderRadius: (config.preview_border_radius || 12) + 'px',
      padding: (config.preview_bar_padding || 20) + 'px', minHeight: (config.preview_bar_height || 90) + 'px',
      width: '100%', boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      border: (config.layout === 'layout4' || config.inline_preview_sticky) ? '1px solid rgba(0,0,0,0.05)' : '1px solid #eee',
      boxShadow: config.inline_preview_sticky ? '0 -8px 30px rgba(0,0,0,0.12)' : '0 4px 12px rgba(0,0,0,0.05)',
    }) + '">';

    html += '<div style="' + styleStr({ display: 'flex', flexDirection: 'column', width: '100%', gap: isMobile ? '12px' : '15px', position: 'relative' }) + '">';

    if (config.preview_bar_title || config.preview_motivation_text) {
      html += '<div style="' + styleStr({
        display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between',
        alignItems: isMobile ? 'center' : 'flex-end', width: '100%', borderBottom: '1px solid rgba(0,0,0,0.05)',
        paddingBottom: '10px', marginBottom: '5px',
      }) + '">';
      if (config.preview_bar_title) {
        html += '<div style="' + styleStr({ fontSize: (config.preview_bar_title_size || 16) + 'px', color: config.preview_bar_title_color || config.preview_bar_text_color || '#333', fontWeight: '800', textAlign: isMobile ? 'center' : 'left' }) + '">' + esc(config.preview_bar_title) + '</div>';
      }
      var remaining = Math.max(0, maxSel - state.totalSelected);
      var isUnlocked = state.weightMode ? !!(state.box.tier && state.weight.enabled && !state.box.overMax) : state.totalSelected >= maxSel;
      var motivationText = state.weightMode
        ? weightMessage(state).text
        : isUnlocked
          ? (config.preview_motivation_unlocked_text || 'Discount Unlocked!')
          : (config.preview_motivation_text || 'Add {{remaining}} more for discount!').replace('{{remaining}}', remaining);
      html += '<div style="' + styleStr({ fontSize: (config.preview_motivation_size || 13) + 'px', color: config.preview_motivation_color || (isUnlocked ? '#28a745' : '#666'), fontWeight: '600', textAlign: isMobile ? 'center' : 'right' }) + '">' + esc(motivationText) + '</div>';
      html += '</div>';
    }

    html += '<div style="' + styleStr({ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: isMobile ? '20px' : '15px' }) + '">';

    // Thumbnails
    html += '<div style="' + styleStr({ display: 'flex', alignItems: 'center', gap: previewGap + 'px', flexShrink: '0', maxWidth: '100%', overflowX: 'auto', justifyContent: isMobile ? 'center' : 'flex-start', width: isMobile ? '100%' : 'auto' }) + '">';
    var flattened = [];
    for (var fi = 0; fi < selectedProducts.length; fi++) {
      for (var q = 0; q < (selectedProducts[fi].quantity || 0); q++) flattened.push(selectedProducts[fi]);
    }
    // Weight combos have no item count: one slot per chosen item, plus an empty one.
    var slotCount = state.weightMode ? Math.min(flattened.length + 1, 12) : maxSel;
    for (var ti = 0; ti < slotCount; ti++) {
      var item = flattened[ti];
      var shapeStyle = {
        width: baseSize + 'px', height: baseSize + 'px', borderRadius: previewShape === 'circle' ? '50%' : '8px',
        background: config.preview_item_color || '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)', flexShrink: '0', overflow: 'hidden',
        border: item ? ('2px solid ' + (config.preview_item_border_color || '#000')) : '2px dashed #ccc',
        boxShadow: item ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
      };
      html += '<div style="' + styleStr(shapeStyle) + '">';
      if (item) {
        html += '<img src="' + esc(item.image || '') + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" alt="selected" />';
      } else {
        html += '<span style="font-size:' + (baseSize * 0.5) + 'px;color:#bbb;">+</span>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Price + buttons
    html += '<div style="' + styleStr({ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', gap: isMobile ? '15px' : '20px', width: isMobile ? '100%' : 'auto' }) + '">';
    html += '<div style="' + styleStr({ display: 'flex', flexDirection: 'column', alignItems: isMobile ? 'center' : 'flex-start', justifyContent: 'center', whiteSpace: 'nowrap', flexShrink: '0', width: isMobile ? '100%' : 'auto' }) + '">';
    if (hasDiscount) {
      html += '<span style="' + styleStr({ fontSize: (config.original_price_size || 14) + 'px', color: config.preview_original_price_color || '#999', textDecoration: 'line-through', lineHeight: '1' }) + '">Total: ' + symbol + state.totalPrice.toFixed(2) + '</span>';
    }
    html += '<span style="' + styleStr({
      fontSize: (config.discounted_price_size || 18) + 'px',
      color: config.preview_discount_price_color || config.selection_highlight_color || '#000',
      fontWeight: '800', marginTop: hasDiscount ? '4px' : '0', lineHeight: '1',
    }) + '">Final: ' + symbol + state.finalPrice.toFixed(2) + '</span>';
    html += '</div>';

    html += '<div style="' + styleStr({ display: 'flex', flexDirection: 'row', gap: '10px', alignItems: 'center', width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }) + '">';
    if (config.show_reset_btn !== false) {
      html += '<button type="button" data-combo-action="reset" style="' + styleStr({
        flex: isMobile ? '1' : 'none', width: isMobile ? '100%' : 'auto', background: config.preview_reset_btn_bg || '#ff4d4d',
        color: config.preview_reset_btn_text_color || '#fff', border: 'none', padding: '10px 20px',
        borderRadius: (config.preview_border_radius || 6) + 'px', fontWeight: '700', cursor: 'pointer',
        minHeight: isMobile ? '48px' : 'auto', fontSize: isMobile ? '13px' : 'inherit',
      }) + '">' + esc(config.preview_reset_btn_text || 'Reset Combo') + '</button>';
    }
    // COD goes where the merchant put it (COD → Customize → Position in combo
    // page): replace, above (before) or below (after) Checkout.
    var codShown = state.codAvailable && config.show_cod_button !== false;
    var codPlace = codPlacement(state);
    var checkoutHtml = '';
    var codHtml = '';
    if (config.show_preview_checkout_btn !== false && !(codShown && codPlace === 'replace')) {
      checkoutHtml += '<button type="button" data-combo-action="checkout"' + (!canOpenDrawer ? ' disabled' : '') + ' style="' + styleStr({
        flex: isMobile ? '1' : 'none', width: isMobile ? '100%' : 'auto',
        background: config.preview_checkout_btn_bg || config.checkout_btn_bg || '#000',
        color: config.preview_checkout_btn_text_color || config.checkout_btn_text_color || '#fff',
        border: 'none', padding: '10px 20px', borderRadius: (config.preview_border_radius || 6) + 'px', fontWeight: '700',
        cursor: canOpenDrawer ? 'pointer' : 'not-allowed', minHeight: isMobile ? '48px' : 'auto',
        fontSize: isMobile ? '13px' : 'inherit', opacity: canOpenDrawer ? '1' : '0.6',
      }) + '">' + esc(config.preview_checkout_btn_text || 'Checkout') + '</button>';
    }
    if (codShown) {
      // Look and text from COD → Customize → Combo page button (state.codButton,
      // from BrixCod.comboButton). The template's own colours are only used
      // until that has loaded.
      var cb = state.codButton;
      var codBase = styleStr({
        flex: isMobile ? '1' : 'none', width: isMobile ? '100%' : 'auto',
        padding: '10px 20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        cursor: canOpenDrawer ? 'pointer' : 'not-allowed', minHeight: isMobile ? '48px' : 'auto',
        opacity: canOpenDrawer ? '1' : '0.6',
      });
      var codLook = cb ? cb.css : styleStr({
        background: config.cod_btn_bg || '#ffffff',
        color: config.cod_btn_text_color || '#111827',
        border: '1.5px solid ' + (config.cod_btn_text_color || '#111827'),
        borderRadius: (config.preview_border_radius || 6) + 'px', fontWeight: '700',
        fontSize: isMobile ? '13px' : 'inherit',
      });
      codHtml += '<button type="button" data-combo-action="cod"' + (!canOpenDrawer ? ' disabled' : '') + ' style="' + codBase + codLook + '">'
        + (cb ? cb.icon : '') + esc(codText(state)) + '</button>';
    }
    html += codPlace === 'below' ? checkoutHtml + codHtml : codHtml + checkoutHtml;
    if (config.show_preview_add_to_cart_btn) {
      html += '<button type="button" data-combo-action="cart-drawer-open"' + (!canOpenDrawer ? ' disabled' : '') + ' style="' + styleStr({
        flex: isMobile ? '1' : 'none', width: isMobile ? '100%' : 'auto', background: config.preview_add_to_cart_btn_bg || '#fff',
        color: config.preview_add_to_cart_btn_text_color || '#000', border: 'none', padding: '10px 20px',
        borderRadius: (config.preview_border_radius || 6) + 'px', fontWeight: '700',
        cursor: canOpenDrawer ? 'pointer' : 'not-allowed', minHeight: isMobile ? '48px' : 'auto',
        fontSize: isMobile ? '13px' : 'inherit', opacity: canOpenDrawer ? '1' : '0.6',
      }) + '">' + esc(config.preview_add_to_cart_btn_text || 'Add to Cart') + '</button>';
    }
    html += '</div></div></div></div></div>';

    if (state.cartDrawerOpen) {
      html += '<div data-combo-action="cart-drawer-close" style="position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:9998;"></div>';
      html += '<div style="' + styleStr({
        position: 'fixed', right: '0', top: '0', height: '100vh', width: isMobile ? '100%' : '380px',
        background: '#fff', zIndex: '9999', boxShadow: '-10px 0 30px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column',
      }) + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #ececec;font-weight:800;font-size:18px;">';
      html += '<span>Cart</span><button type="button" data-combo-action="cart-drawer-close" style="border:none;background:transparent;font-size:20px;cursor:pointer;line-height:1;">×</button></div>';
      html += '<div style="flex:1;overflow-y:auto;padding:14px 18px;">';
      if (selectedProducts.length === 0) {
        html += '<div style="color:#666;font-size:14px;">Your cart is empty.</div>';
      } else {
        for (var di = 0; di < selectedProducts.length; di++) {
          var item2 = selectedProducts[di];
          html += '<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f0f0f0;">';
          html += '<img src="' + esc(item2.image || '') + '" alt="' + esc(item2.title || 'Product') + '" style="width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid #eee;" />';
          html += '<div style="flex:1;min-width:0;"><div style="font-weight:700;font-size:13px;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(item2.title || 'Selected product') + '</div>';
          html += '<div style="font-size:12px;color:#666;margin-top:3px;">Qty: ' + (item2.quantity || 0) + '</div>';
          html += '<div style="font-size:12px;color:#222;margin-top:3px;">' + symbol + ((item2.price || 0) * (item2.quantity || 0)).toFixed(2) + '</div></div></div>';
        }
      }
      html += '</div>';
      html += '<div style="border-top:1px solid #ececec;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;font-weight:700;"><span>Total</span><span>' + symbol + state.finalPrice.toFixed(2) + '</span></div>';
      html += '</div>';
    }

    html += '</div>'; // outer wrapper
    return html;
  }

  function renderToast(state) {
    if (!state.toast) return '';
    return '<div role="alert" style="' + styleStr({
      position: 'fixed', top: '20px', left: '50%', transform: 'translate(-50%, 0)', zIndex: '10000',
      background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#b91c1c',
      fontSize: '13px', fontWeight: '600', padding: '12px 18px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '90vw',
    }) + '"><span style="display:flex;">' + ICON_WARNING + '</span><span>' + esc(state.toast) + '</span></div>';
  }

  function renderLightbox(state) {
    if (!state.lightboxProductId) return '';
    var product = state.productMap[state.lightboxProductId];
    if (!product) return '';
    var images = (product.images && product.images.length > 0) ? product.images : (product.image ? [product.image] : []);
    if (images.length === 0) return '';
    var idx = state.lightboxIdx || 0;
    if (idx >= images.length) idx = 0;
    var img = images[idx];

    var html = '<div data-combo-action="lightbox-close" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;cursor:pointer;">';
    if (images.length > 1) {
      html += '<button data-combo-action="lightbox-prev" style="position:absolute;left:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.15);border:none;color:#fff;width:48px;height:48px;border-radius:50%;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + ICON_CHEVRON_LEFT + '</button>';
      html += '<button data-combo-action="lightbox-next" style="position:absolute;right:20px;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.15);border:none;color:#fff;width:48px;height:48px;border-radius:50%;font-size:24px;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + ICON_CHEVRON_RIGHT + '</button>';
    }
    html += '<button data-combo-action="lightbox-close" style="position:absolute;top:20px;right:20px;background:rgba(255,255,255,0.15);border:none;color:#fff;width:40px;height:40px;border-radius:50%;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;">' + ICON_CLOSE + '</button>';
    html += '<img src="' + esc(img.url) + '" alt="' + esc(img.altText || '') + '" style="max-width:85vw;max-height:75vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,0.5);" />';
    html += '</div>';
    return html;
  }

  /* === The Weight Box (layout5) is drawn as Quick Shop (renderLayout6), always priced by weight. === */

  // Collection handles of a box page's pills (col_1..col_N, tab_count).
  function weightBoxHandles(config) {
    var out = [];
    for (var i = 1; i <= (config.tab_count || 4); i++) {
      var h = config['col_' + i];
      if (h && out.indexOf(h) === -1) out.push(h);
    }
    return out;
  }

  function renderLayout6(state, isMobile) {
    var config = state.config;
    var currency = shopCurrency(state);
    var w = state.weight;
    var cb = state.codButton;
    var model = QuickShop.buildModel({
      config: config,
      templateName: state.templateName,
      productsByHandle: state.productsByHandle,
      handles: weightBoxHandles(config),
      collectionNames: state.collectionNameMap,
      selection: state.selectedMap,
      pending: state.pendingVariant,
      ui: { chip: state.qsUi.chip, dd: state.qsUi.dd, instock: state.qsUi.instock, menu: state.qsUi.menu, sheetOpen: state.qsUi.sheetOpen, checkingOut: state.checkingOut },
      // Not live (plan, inactive, checkout discount not active): no offer is shown.
      pricing: w ? { measure: w.measure, unit: w.unit, tiers: w.tiers, maxGrams: w.maxGrams, messages: w.messages, enabled: !!w.enabled } : { tiers: [], enabled: false },
      qualifies: function (productId) { return !w || !!state.qualifying[productId]; },
      symbol: getCurrencySymbol(currency),
      decimals: WeightCore.decimalsFor(currency),
      isMobile: isMobile,
      cod: {
        shown: state.codAvailable && config.show_cod_button !== false,
        placement: codPlacement(state),
        text: codText(state),
        css: cb ? 'display:inline-flex;align-items:center;justify-content:center;gap:8px;' + cb.css : '',
        icon: cb ? cb.icon : '',
      },
    });
    // Celebrate a newly reached tier once (the next render plays nothing).
    var tierMin = model.box.tier && model.view.enabled ? model.box.tier.min_grams : null;
    model.bar.celebrate = QuickShop.on(config, 'qs_bar_celebrate') && tierMin !== null && (state.qsLastTier === null || tierMin > state.qsLastTier);
    state.qsLastTier = tierMin;
    return QuickShop.render(model);
  }

  /* === RENDER: ROOT === */

  function render(root) {
    var state = instances.get(root);
    if (!state) return;
    computePricing(state);
    var isMobile = state.isMobile;
    var config = state.config;

    var html;
    // The Weight Box is drawn as Quick Shop (always priced by weight).
    if (WeightCore.usesQuickShop(config.layout)) {
      html = renderLayout6(state, isMobile);
    } else if (config.layout === 'layout4') {
      html = renderLayout4(state, isMobile);
    } else if (config.layout === 'layout2') {
      html = renderLayout2(state, isMobile);
    } else if (config.layout === 'layout3') {
      html = renderLayout3(state, isMobile);
    } else {
      html = '<div style="' + styleStr({ maxWidth: '100%', margin: '24px auto', padding: '0 16px', boxSizing: 'border-box' }) + '">';
      html += '<div style="' + styleStr({
        background: config.bg_color || '#fff', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
        overflow: 'hidden', fontFamily: 'inherit', color: config.text_color || '#1a1a1a', position: 'relative',
      }) + '">';
      html += renderProgressBar(state);
      html += renderBanner(state, isMobile);
      html += renderTitleDescription(state, isMobile);
      html += renderSteps(state, isMobile);
      html += '</div>'; // close card wrapper before the preview bar so its sticky positioning is not clipped by the overflow:hidden ancestor
      html += renderAiSuggestions(state, isMobile);
      html += renderPreviewBar(state, isMobile);
      html += '</div>';
    }
    html += renderToast(state);
    html += renderLightbox(state);
    if (config.custom_css) html += '<style>' + config.custom_css + '</style>';

    var app = root.querySelector('.brix-combo-app');
    if (app) app.innerHTML = html;
  }

  /* === GLOBAL STYLES (injected once) === */

  // Quick Shop (renderLayout6, also the Weight Box): app/utils/combo-quickshop.shared.js.
  var QUICK_SHOP_CSS = ${JSON.stringify(QUICK_SHOP_CSS)};

  var stylesInjected = false;
  function injectGlobalStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement('style');
    style.textContent =
      '@keyframes combo-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }' +
      // Scoped to --hoverable (only present when this specific product
      // actually has hover-replacement content — see hasHoverContent in
      // renderProductCard) so hovering a card with no second image/
      // description doesn't fade the main product photo to nothing.
      '.brix-combo-card-media--hoverable:hover .brix-combo-media-main { opacity: 0; }' +
      '.brix-combo-card-media--hoverable:hover .brix-combo-media-hover { opacity: 1 !important; }' +
      // Not scoped to --hoverable: .brix-combo-hover-variants is a separate,
      // independently-gated feature (showHoverVariants) and is simply absent
      // from the DOM on cards that don't use it, so this rule is inert there.
      '.brix-combo-card-media:hover .brix-combo-hover-variants { display: flex !important; }' +
      '.brix-combo-shimmer { animation: combo-shimmer 2s infinite; }' +
      '.brix-combo-slider-track { scrollbar-width: none; -ms-overflow-style: none; }' +
      '.brix-combo-slider-track::-webkit-scrollbar { display: none; }' +
      '.brix-combo-slider-track.show-scrollbar { scrollbar-width: auto; -ms-overflow-style: auto; }' +
      '.brix-combo-slider-track.show-scrollbar::-webkit-scrollbar { display: block; height: 4px; }' +
      '.brix-combo-ai-track { scrollbar-width: thin; }' +
      '@keyframes brix-combo-ai-flash { 0%, 100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); } 30%, 70% { box-shadow: 0 0 0 4px rgba(0,0,0,0.35); } }' +
      '.brix-combo-ai-flash { animation: brix-combo-ai-flash 1.6s ease-in-out; }' +
      QUICK_SHOP_CSS;
    document.head.appendChild(style);
  }

  function loadGoogleFont(family) {
    if (!family || family === 'inherit' || family === 'Inter') return;
    var id = 'brix-combo-font-' + family.replace(/[^a-z0-9]/gi, '-');
    if (document.getElementById(id)) return;
    var link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(family) + ':wght@300;400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }

  /* === EVENT WIRING (delegated, bound once per root) === */

  function wireEvents(root) {
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-combo-action]');
      if (!el || !root.contains(el)) return;
      var state = instances.get(root);
      if (!state) return;
      var action = el.getAttribute('data-combo-action');
      var productId = el.getAttribute('data-product-id');
      var product = productId ? state.productMap[productId] : null;
      // Quick Shop filters, menus and the bar's item list.
      if (WeightCore.usesQuickShop(state.config.layout) && QuickShop.applyUiAction(state.qsUi, action, el)) { render(root); return; }

      if (action === 'card-add' && product) { onCardAddClick(root, state, product); return; }
      if (action === 'ai-pick' && product) { onAiPick(root, state, product); return; }
      if (action === 'qty-inc' && product) { onCardInc(root, state, product); return; }
      if (action === 'qty-dec' && product) { onCardDec(root, state, product); return; }
      if (action === 'popup-close') { state.popupOpenProductId = null; render(root); return; }
      if (action === 'tab-pick') { state.activeTab = el.getAttribute('data-tab') || 'all'; render(root); return; }
      if (action === 'popup-pick' && product) {
        var vId = el.getAttribute('data-variant-id');
        state.pendingVariant[productId] = vId;
        state.popupOpenProductId = null;
        onAdd(root, state, product, vId, 1);
        return;
      }
      if (action === 'variant-pick' && product) {
        state.pendingVariant[productId] = el.getAttribute('data-variant-id');
        render(root);
        return;
      }
      if (action === 'img-prev' && product) {
        var images1 = (product.images && product.images.length > 0) ? product.images : (product.image ? [product.image] : []);
        var cur = state.imgIndex[productId] || 0;
        state.imgIndex[productId] = cur <= 0 ? images1.length - 1 : cur - 1;
        render(root);
        return;
      }
      if (action === 'img-next' && product) {
        var images2 = (product.images && product.images.length > 0) ? product.images : (product.image ? [product.image] : []);
        var cur2 = state.imgIndex[productId] || 0;
        state.imgIndex[productId] = cur2 >= images2.length - 1 ? 0 : cur2 + 1;
        render(root);
        return;
      }
      if (action === 'img-dot' && product) {
        state.imgIndex[productId] = parseInt(el.getAttribute('data-idx'), 10) || 0;
        render(root);
        return;
      }
      if (action === 'lightbox-open' && product) {
        var imgs = (product.images && product.images.length > 0) ? product.images : (product.image ? [product.image] : []);
        if (imgs.length === 0) return;
        state.lightboxProductId = productId;
        state.lightboxIdx = 0;
        render(root);
        return;
      }
      if (action === 'lightbox-close') { state.lightboxProductId = null; render(root); return; }
      if (action === 'lightbox-prev' || action === 'lightbox-next') {
        e.stopPropagation();
        var lp = state.productMap[state.lightboxProductId];
        if (!lp) return;
        var limgs = (lp.images && lp.images.length > 0) ? lp.images : (lp.image ? [lp.image] : []);
        var lidx = state.lightboxIdx || 0;
        state.lightboxIdx = action === 'lightbox-prev'
          ? (lidx <= 0 ? limgs.length - 1 : lidx - 1)
          : (lidx >= limgs.length - 1 ? 0 : lidx + 1);
        render(root);
        return;
      }
      if (action === 'slider-scroll') {
        var step = el.getAttribute('data-step');
        var dir = el.getAttribute('data-dir');
        var track = root.querySelector('.brix-combo-slider-track[data-step="' + step + '"]');
        var amount = parseInt(el.getAttribute('data-amount'), 10) || 250;
        if (track) track.scrollBy({ left: dir === 'left' ? -amount : amount, behavior: 'smooth' });
        return;
      }
      // The Weight Box's own panel: +/- per item, and the phone bottom sheet.
      if (action === 'box-inc' || action === 'box-dec') {
        var boxVariant = el.getAttribute('data-variant-id');
        var boxSel = state.selectedMap[boxVariant];
        if (!boxSel) return;
        if (action === 'box-inc') onQtyChange(root, state, boxVariant, (boxSel.qty || 0) + 1);
        else if ((boxSel.qty || 0) <= 1) onRemove(root, state, boxVariant);
        else onQtyChange(root, state, boxVariant, boxSel.qty - 1);
        return;
      }
      if (action === 'checkout') { onCheckout(root, state); return; }
      if (action === 'cod') { onCod(root, state); return; }
      if (action === 'reset') { onReset(root, state); return; }
      if (action === 'cart-drawer-open') { state.cartDrawerOpen = true; render(root); return; }
      if (action === 'cart-drawer-close') { state.cartDrawerOpen = false; render(root); return; }
    });

    root.addEventListener('change', function (e) {
      var el = e.target.closest('[data-combo-action="variant-select"]');
      if (!el || !root.contains(el)) return;
      var state = instances.get(root);
      if (!state) return;
      var productId = el.getAttribute('data-product-id');
      state.pendingVariant[productId] = el.value;
      render(root);
    });

    if (typeof window.matchMedia === 'function') {
      var mq = window.matchMedia('(max-width: 767px)');
      var onMqChange = function (e) {
        var state = instances.get(root);
        if (!state) return;
        state.isMobile = e.matches;
        render(root);
      };
      if (mq.addEventListener) mq.addEventListener('change', onMqChange);
      else if (mq.addListener) mq.addListener(onMqChange);
    }
  }

  /* === MOUNT === */

  // Fallback for a layout value the direct renderer above doesn't know.
  // Layouts 1-4 are all rendered directly, so this only runs for a layout
  // added to the builder later and not yet ported here. It embeds the full
  // React preview route in an iframe (this file's pre-direct-render
  // approach) rather than rendering a broken/empty page. The frame only
  // loads where the preview route's frame-ancestors header allows the
  // storefront's domain, which excludes custom domains today — so port a
  // new layout here rather than relying on this.
  // A box sent up by the preview frame: only numeric ids, sane quantities,
  // BRIX box properties and the combo attributes are kept.
  function boxFromFrame(data) {
    var items = (Array.isArray(data.items) ? data.items : []).map(function (it) {
      var props = null;
      if (it && it.properties && typeof it.properties === 'object') {
        props = {};
        ['_brix_combo_id', '_brix_combo_version', '_brix_combo_group'].forEach(function (k) {
          if (typeof it.properties[k] === 'string' && it.properties[k].length <= 64) props[k] = it.properties[k];
        });
        if (!props._brix_combo_id) props = null;
      }
      var item = { variantId: Number(it && it.variantId), quantity: Math.floor(Number(it && it.quantity)) };
      if (props) item.properties = props;
      return item;
    }).filter(function (it) { return it.variantId > 0 && it.quantity > 0 && it.quantity <= 100; });
    var attributes = {};
    var raw = data.attributes && typeof data.attributes === 'object' ? data.attributes : {};
    ['combo_source', 'combo_template_id', 'combo_template_name'].forEach(function (k) {
      if (raw[k] != null) attributes[k] = String(raw[k]).slice(0, 200);
    });
    return { templateId: '', items: items, attributes: attributes };
  }

  function mountIframe(root, shop, templateId) {
    root.innerHTML = '';
    var iframe = document.createElement('iframe');
    iframe.src = API_ORIGIN + '/preview/' + encodeURIComponent(templateId) +
      '?shop=' + encodeURIComponent(shop) + '&embed=1';
    iframe.style.cssText = 'width:100%;border:0;display:block;min-height:200px;';
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('title', 'Combo');
    root.appendChild(iframe);

    function postViewport() {
      try {
        iframe.contentWindow.postMessage({ type: 'brix-combo-viewport', width: window.innerWidth }, '*');
      } catch (err) {}
    }
    iframe.addEventListener('load', postViewport);

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(postViewport, 150);
    });

    window.addEventListener('message', function (e) {
      if (!e.data || e.source !== iframe.contentWindow) return;
      if (e.data.type === 'brix-combo-resize') {
        if (typeof e.data.height === 'number' && e.data.height > 0) {
          iframe.style.height = e.data.height + 'px';
        }
      } else if (e.data.type === 'brix-combo-ready') {
        postViewport();
        // The layout renders inside this iframe, but the COD sheet lives on
        // this (parent) page — tell the frame to show its COD button.
        whenCodAvailable(function () {
          var tell = function (b) {
            try {
              iframe.contentWindow.postMessage({
                type: 'brix-combo-cod-available',
                // Text (with its price tags), fee and position, so the frame
                // draws the button as the page's own layouts do.
                text: b ? b.text : null, codFee: b ? b.codFee : 0, placement: b ? b.placement : 'below',
              }, '*');
            } catch (err) {}
          };
          if (typeof window.BrixCod.comboButton === 'function') window.BrixCod.comboButton().then(tell).catch(function () { tell(null); });
          else tell(null);
        });
      } else if (e.data.type === 'brix-combo-checkout') {
        // Weight combos: the frame runs on the app's origin and can't reach
        // the shopper's cart, so it hands the box to this page.
        var box = boxFromFrame(e.data);
        box.templateId = templateId;
        if (!box.items.length) return;
        addComboToCart(box).catch(function (err) {
          try { iframe.contentWindow.postMessage({ type: 'brix-combo-checkout-failed', message: (err && err.message) || '' }, '*'); } catch (err2) {}
        });
      } else if (e.data.type === 'brix-combo-cod-open' && window.BrixCod) {
        var fallback = String(e.data.fallbackUrl || '');
        var shopOrigin = 'https://' + String(shop).replace(/^https?:\/\//, '');
        var codBox = boxFromFrame(e.data);
        codBox.templateId = templateId;
        var isWeightBox = codBox.items.some(function (it) { return it.properties && it.properties._brix_combo_id; });
        window.BrixCod.open({
          surface: 'combo',
          items: codBox.items,
          coupon: e.data.coupon || null,
          attributes: e.data.attributes || null,
          onPayOnline: function () {
            if (isWeightBox) { addComboToCart(codBox).catch(function () {}); return; }
            if (fallback.indexOf(shopOrigin + '/') === 0 || fallback.indexOf(window.location.origin + '/') === 0) window.location.href = fallback;
          },
        });
      }
    });
  }

  // A combo page is meant to be its own clean landing page, not sandwiched
  // between the theme's default page-title section and unrelated content —
  // once we've confirmed a page really is a combo page, hide everything
  // except the site header/footer so the widget gets the full space between
  // them. Every level from the mount point up to <body> is cleared: on Dawn
  // the page title (h1.main-page-title) is a sibling of the page's .rte,
  // and the template's other sections are siblings of its section in <main>.
  // Runs once per page load, right after a successful mount.
  var pageChromeHidden = false;
  function hidePageChrome(root) {
    if (pageChromeHidden) return;
    pageChromeHidden = true;

    var HEADER_FOOTER_RE = /(^|[-_ ])(header|footer)([-_ ]|$)/i;
    // cc-root is this same app's own cart-drawer widget mount point
    // (extensions/cart-drawer/blocks/cart_drawer.liquid, target: "body") —
    // a sibling of <main>, not something a header/footer name match would
    // catch. Must survive the hide pass, or shoppers lose their cart drawer
    // while on the combo page.
    // The site header/footer are never inside the page's main area; a
    // "page-header" class in there is the page title (seen on a live theme:
    // <h1 class="main-page-title page-header">), so it is never kept.
    var mainArea = document.querySelector('main, [role="main"], #MainContent');
    function shouldPreserve(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.id === 'cc-root') return true;
      var tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'noscript') return true;
      // Fixed layers (the theme's cart drawer, popups, chat buttons) take no
      // room on the page, and hiding them would break them.
      try { if (window.getComputedStyle(el).position === 'fixed') return true; } catch (e) { }
      if (mainArea && mainArea !== el && mainArea.contains(el)) return false;
      if (/^h[1-6]$/.test(tag)) return false;
      if (tag === 'header' || tag === 'footer') return true;
      var id = el.id || '';
      var cls = (typeof el.className === 'string') ? el.className : '';
      // <sticky-header> and the like count too.
      return HEADER_FOOTER_RE.test(tag) || HEADER_FOOTER_RE.test(id) || HEADER_FOOTER_RE.test(cls);
    }
    function hideOtherChildren(container, keep) {
      var children = container.children;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        if (el === keep || shouldPreserve(el)) continue;
        el.setAttribute('data-brix-combo-hidden', '1');
        el.style.display = 'none';
      }
    }

    var level = root;
    while (level && level !== document.body && level.parentElement) {
      hideOtherChildren(level.parentElement, level);
      level = level.parentElement;
    }
  }

  // Hiding sibling content (above) makes the combo page read as a clean
  // takeover, but does nothing about the WIDTH of the column the widget
  // itself sits in — most themes wrap page-template content in a narrow
  // page-width/container-style column (e.g. Dawn: max-width 1200px,
  // margin 0 auto), which squeezes the widget into that column and makes
  // an otherwise-full-width layout (like layout1) look boxed/embedded, even
  // though nothing about our own markup is actually iframed or bordered.
  // Walks the ancestor chain from the mount point up to (not including)
  // <body> and strips any max-width constraint found via computed style —
  // safe because every sibling in this chain was already hidden above, so
  // this ancestor chain exists purely to host our widget at this point.
  function widenAncestorContainers(root) {
    var el = root.parentElement;
    var guard = 0;
    while (el && el !== document.body && guard < 20) {
      guard++;
      try {
        var cs = window.getComputedStyle(el);
        if (cs.maxWidth && cs.maxWidth !== 'none') {
          el.style.setProperty('max-width', 'none', 'important');
        }
      } catch (e) { }
      el = el.parentElement;
    }
  }

  function mountDirect(root, shop, templateId, prefetchedData) {
    var dataPromise = prefetchedData
      ? Promise.resolve({ success: true, data: prefetchedData })
      : fetchComboData(shop, templateId);

    dataPromise.then(function (json) {
      if (!json.success || !json.data) { root.innerHTML = ''; return; }

      hidePageChrome(root);
      widenAncestorContainers(root);

      var layout = json.data.config && json.data.config.layout;
      if (layout && !/^layout[1-6]$/.test(layout)) {
        mountIframe(root, shop, json.data.templateId || templateId);
        return;
      }

      injectGlobalStyles();
      root.innerHTML = '<div class="brix-combo-app" style="min-height:120px;"></div>';
      var state = buildState(shop, json.data);
      instances.set(root, state);
      wireEvents(root);
      loadGoogleFont(state.config.heading_font_family);
      render(root);
      if (layout === 'layout3') startLayout3Timers(root, state);
      trackEvent(state, 'view');
      if (state.config.ai_mode) loadAiSuggestions(root, state);
      if (state.config.show_cod_button !== false) {
        whenCodAvailable(function () {
          state.codAvailable = true;
          render(root);
          // The merchant's combo page button look (COD → Customize).
          if (typeof window.BrixCod.comboButton === 'function') {
            window.BrixCod.comboButton().then(function (b) { if (b) { state.codButton = b; render(root); } }).catch(function () {});
          }
        });
      }
    }).catch(function () {
      root.innerHTML = '';
    });
  }

  // Explicit mount point — used when a page's own body/template already
  // knows which combo template it is (the guaranteed-template path, pending
  // Shopify's themeFilesUpsert exemption; see api.bundle-templates.jsx).
  //
  // The cart-drawer app embed (extensions/cart-drawer/blocks/cart_drawer.liquid)
  // also loads a copy of this same script globally on every page, from a
  // separately-deployed origin — so this exact div can get init()'d twice,
  // once by each copy. Mark the root as claimed so only the first script to
  // reach it actually mounts.
  function init(root) {
    if (root.dataset.brixComboMounted) return;
    var shop = root.dataset.shop;
    var templateId = root.dataset.templateId;
    if (!shop || !templateId) return;
    root.dataset.brixComboMounted = '1';
    mountDirect(root, shop, templateId, null);
  }

  // Auto-detect mode — runs on every page via the cart-drawer app embed
  // (already loaded globally on every page for merchants who've enabled it),
  // since that embed has no way to know in advance which pages are combo
  // pages. Cheap early-outs: only even attempts a lookup on /pages/* URLs,
  // and skips entirely if an explicit [data-brix-combo-root] already exists.
  //
  // The handle lookup already returns the FULL page payload (config,
  // products, discounts) — not just a templateId — so it's passed straight
  // into mountDirect as prefetchedData instead of triggering a second
  // fetch (the previous iframe version had to re-fetch by templateId here,
  // since the iframe's own route did its own separate data load).
  function autoDetectAndInject() {
    if (document.querySelector('[data-brix-combo-root]')) return;

    var match = window.location.pathname.match(/\/pages\/([^/?#]+)/);
    if (!match) return;
    var handle = match[1];

    var shop = (window.Shopify && window.Shopify.shop) || window.location.hostname;

    var main = document.querySelector('main#MainContent') || document.querySelector('main[role="main"]') || document.querySelector('main');
    var container = main || document.body;

    var root = document.createElement('div');
    root.setAttribute('data-brix-combo-root', '');
    root.dataset.brixComboMounted = '1';
    root.style.display = 'none'; // hidden until we confirm this handle is actually a combo page
    container.appendChild(root);

    fetchComboDataByHandle(shop, handle)
      .then(function (json) {
        if (json.success && json.data && json.data.templateId) {
          mountDirect(root, shop, json.data.templateId, json.data);
          root.style.display = '';
        } else {
          root.remove(); // not a combo page — leave the theme's own content untouched
        }
      })
      .catch(function () { root.remove(); });
  }

  function boot() {
    var roots = document.querySelectorAll('[data-brix-combo-root]');
    for (var i = 0; i < roots.length; i++) init(roots[i]);
    autoDetectAndInject();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`;

export async function loader() {
  return new Response(SCRIPT_BODY, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// Serves the storefront combo-page mounter as a real .js asset. Published
// combo pages (app/routes/api.bundle-templates.jsx's PAGE_BODY) load this
// via a plain <script src="..."> tag — Shopify Pages don't process Liquid in
// their body content, so this can't be a theme-extension asset; it has to be
// served directly from this app instead (see conversation: verified live on
// fpzz1i-ds.myshopify.com that {{ 'x' | asset_url }} renders as literal text
// inside a Page body).
//
// Renders the combo UI directly into the page (no iframe) — ported from
// app/routes/preview.$templateId.jsx's Layout1Preview/ProductCard/
// CdoPreviewBar (layout1 only; layout2/3/4 aren't ported yet, see
// renderApp's layout guard below). Reasons this replaced the previous
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
const SCRIPT_BODY = String.raw`
(function () {
  var CURRENT_SCRIPT = document.currentScript;
  var API_ORIGIN = CURRENT_SCRIPT ? new URL(CURRENT_SCRIPT.src).origin : '';

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

  /* === STATE === */

  function buildState(shop, data) {
    var productMap = {};
    var variantPriceMap = {};
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
        }
      }
    }

    return {
      shop: shop,
      templateId: data.templateId,
      templateName: data.templateName,
      config: data.config || {},
      productsByHandle: data.productsByHandle || {},
      collectionNameMap: data.collectionNameMap || {},
      activeDiscounts: data.activeDiscounts || [],
      productMap: productMap,
      variantPriceMap: variantPriceMap,
      selectedMap: {}, // { [variantId]: { productId, qty } }
      pendingVariant: {}, // { [productId]: variantId } — current dropdown/carousel selection before adding
      imgIndex: {}, // { [productId]: index }
      popupOpenProductId: null,
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

  function computePricing(state) {
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

  function onCheckout(root, state) {
    if (state.totalSelected === 0) return;
    var cartLines = [];
    for (var variantId in state.selectedMap) {
      var sel = state.selectedMap[variantId];
      var shortId = String(variantId).split('/').pop();
      cartLines.push(shortId + ':' + (sel.qty || 1));
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

    html += '<div style="' + styleStr({ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 0 0', borderTop: '1px solid #eee', justifyContent: 'space-between' }) + '">';
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
        fontWeight: btnFontWeight, fontSize: btnFontSize + 'px', transition: 'all 0.2s',
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

  function renderProgressBar(state) {
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
    var canOpenDrawer = state.totalSelected >= maxSel;

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
      var isUnlocked = state.totalSelected >= maxSel;
      var motivationText = isUnlocked
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
    for (var ti = 0; ti < maxSel; ti++) {
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
    if (config.show_preview_checkout_btn !== false) {
      html += '<button type="button" data-combo-action="checkout"' + (!canOpenDrawer ? ' disabled' : '') + ' style="' + styleStr({
        flex: isMobile ? '1' : 'none', width: isMobile ? '100%' : 'auto',
        background: config.preview_checkout_btn_bg || config.checkout_btn_bg || '#000',
        color: config.preview_checkout_btn_text_color || config.checkout_btn_text_color || '#fff',
        border: 'none', padding: '10px 20px', borderRadius: (config.preview_border_radius || 6) + 'px', fontWeight: '700',
        cursor: canOpenDrawer ? 'pointer' : 'not-allowed', minHeight: isMobile ? '48px' : 'auto',
        fontSize: isMobile ? '13px' : 'inherit', opacity: canOpenDrawer ? '1' : '0.6',
      }) + '">' + esc(config.preview_checkout_btn_text || 'Checkout') + '</button>';
    }
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

  /* === RENDER: ROOT === */

  function render(root) {
    var state = instances.get(root);
    if (!state) return;
    computePricing(state);
    var isMobile = state.isMobile;
    var config = state.config;

    var html = '<div style="' + styleStr({ maxWidth: '100%', margin: '24px auto', padding: '0 16px', boxSizing: 'border-box' }) + '">';
    html += '<div style="' + styleStr({
      background: config.bg_color || '#fff', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
      overflow: 'hidden', fontFamily: 'inherit', color: config.text_color || '#1a1a1a', position: 'relative',
    }) + '">';
    html += renderProgressBar(state);
    html += renderBanner(state, isMobile);
    html += renderTitleDescription(state, isMobile);
    html += renderSteps(state, isMobile);
    html += '</div>'; // close card wrapper before the preview bar so its sticky positioning is not clipped by the overflow:hidden ancestor
    html += renderPreviewBar(state, isMobile);
    html += '</div>';
    html += renderToast(state);
    html += renderLightbox(state);
    if (config.custom_css) html += '<style>' + config.custom_css + '</style>';

    var app = root.querySelector('.brix-combo-app');
    if (app) app.innerHTML = html;
  }

  /* === GLOBAL STYLES (injected once) === */

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
      '.brix-combo-slider-track.show-scrollbar::-webkit-scrollbar { display: block; height: 4px; }';
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

      if (action === 'card-add' && product) { onCardAddClick(root, state, product); return; }
      if (action === 'qty-inc' && product) { onCardInc(root, state, product); return; }
      if (action === 'qty-dec' && product) { onCardDec(root, state, product); return; }
      if (action === 'popup-close') { state.popupOpenProductId = null; render(root); return; }
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
        if (track) track.scrollBy({ left: dir === 'left' ? -250 : 250, behavior: 'smooth' });
        return;
      }
      if (action === 'checkout') { onCheckout(root, state); return; }
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

  // Fallback for layouts the direct renderer above doesn't cover yet
  // (layout2 "Velocity Stream", layout3, layout4 "Editorial Split" — only
  // layout1 "Guided Architect" has been ported to vanilla JS so far). Keeps
  // those templates working exactly as before rather than rendering a
  // broken/empty page: embeds the full React preview route in an iframe,
  // same as this file's previous (pre-direct-render) approach.
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
      }
    });
  }

  // A combo page is meant to be its own clean landing page, not sandwiched
  // between the theme's default page-title section and unrelated content —
  // once we've confirmed a page really is a combo page, hide everything
  // except the site header/footer so the widget gets the full space between
  // them. Runs once per page load, right after a successful mount.
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
    function shouldPreserve(el) {
      if (!el || el.nodeType !== 1) return false;
      if (el.id === 'cc-root') return true;
      var tag = el.tagName.toLowerCase();
      if (tag === 'header' || tag === 'footer' || tag === 'script' || tag === 'style' || tag === 'link' || tag === 'noscript') return true;
      var id = el.id || '';
      var cls = (typeof el.className === 'string') ? el.className : '';
      return HEADER_FOOTER_RE.test(id) || HEADER_FOOTER_RE.test(cls);
    }
    function hideOtherChildren(container) {
      if (!container) return;
      var children = container.children;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        if (el === root || (el.contains && el.contains(root))) continue;
        if (shouldPreserve(el)) continue;
        el.setAttribute('data-brix-combo-hidden', '1');
        el.style.display = 'none';
      }
    }

    hideOtherChildren(document.body);
    hideOtherChildren(root.parentElement);
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
      if (layout && layout !== 'layout1') {
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
      trackEvent(state, 'view');
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

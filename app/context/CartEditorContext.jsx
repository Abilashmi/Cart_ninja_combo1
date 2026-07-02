import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { defaultCartEditorState } from '../types/cartEditorTypes';

function parseJSONSafe(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}

function dbFlag(v) {
  return v === 1 || v === '1' || v === true;
}

function hydrateFromRecord(record, base) {
  if (!record) return base;
  const pb = parseJSONSafe(record.progress_data);
  const cs = parseJSONSafe(record.coupon_data);
  const up = parseJSONSafe(record.upsell_data);
  const cbStyle = parseJSONSafe(record.checkout_button_style);
  return {
    ...base,
    status: dbFlag(record.cartStatus ?? record.cart_status) ? 'active' : 'inactive',
    body: {
      ...base.body,
      progressBar: { ...base.body.progressBar, ...pb, enabled: dbFlag(record.progress_status) },
      couponSlider: { ...base.body.couponSlider, ...cs, enabled: dbFlag(record.coupon_status), ...(cs.position != null ? { position: normalizeCouponPosition(cs.position, base.body.couponSlider.position) } : {}) },
      upsellProducts: { ...base.body.upsellProducts, ...up, enabled: dbFlag(record.upsell_status) },
    },
    footer: {
      ...base.footer,
      checkoutButton: {
        ...base.footer.checkoutButton,
        ...(record.checkoutName ? { text: record.checkoutName } : {}),
        ...(record.checkoutFooterText ? { footerText: record.checkoutFooterText } : {}),
        ...(cbStyle.backgroundColor ? { bgColor: cbStyle.backgroundColor } : {}),
        ...(cbStyle.textColor ? { textColor: cbStyle.textColor } : {}),
        ...(cbStyle.borderRadius != null ? { borderRadius: cbStyle.borderRadius } : {}),
      },
      customCSS: record.customCSS || base.footer.customCSS,
      watermarkEnabled: record.watermark_enabled != null ? dbFlag(record.watermark_enabled) : base.footer.watermarkEnabled,
    },
  };
}

function hydrateFromConfig(cfg, base) {
  if (!cfg) return base;
  return {
    ...base,
    settings: {
      ...base.settings,
      general: {
        ...base.settings.general,
        ...(cfg.open_on_add        != null ? { openOnAdd:        dbFlag(cfg.open_on_add) }        : {}),
        ...(cfg.open_on_icon_click != null ? { openOnIconClick:  dbFlag(cfg.open_on_icon_click) } : {}),
        ...(cfg.position           != null ? { position:         cfg.position }                   : {}),
      },
      design: {
        ...base.settings.design,
        ...(cfg.design_width         != null ? { width:        cfg.design_width }                     : {}),
        ...(cfg.design_border_radius != null ? { borderRadius: Number(cfg.design_border_radius) }     : {}),
        ...(cfg.design_shadow        != null ? { shadow:       dbFlag(cfg.design_shadow) }            : {}),
        ...(cfg.design_animation     != null ? { animation:    cfg.design_animation }                 : {}),
      },
    },
    header: {
      ...base.header,
      ...(cfg.header_title         != null ? { title:        cfg.header_title }                  : {}),
      ...(cfg.header_close_style   != null ? { closeStyle:   cfg.header_close_style }            : {}),
      ...(cfg.header_bg_color      != null ? { bgColor:      cfg.header_bg_color }               : {}),
      ...(cfg.header_text_color    != null ? { textColor:    cfg.header_text_color }             : {}),
      ...(cfg.header_border_bottom != null ? { borderBottom: dbFlag(cfg.header_border_bottom) } : {}),
    },
    body: {
      ...base.body,
      announcements: {
        ...base.body.announcements,
        ...(cfg.announcement_enabled    != null ? { enabled:   dbFlag(cfg.announcement_enabled) }   : {}),
        ...(cfg.announcement_text       != null ? { text:      cfg.announcement_text }               : {}),
        ...(cfg.announcement_bg_color   != null ? { bgColor:   cfg.announcement_bg_color }           : {}),
        ...(cfg.announcement_text_color != null ? { textColor: cfg.announcement_text_color }         : {}),
        ...(cfg.announcement_font_size  != null ? { fontSize:  Number(cfg.announcement_font_size) }  : {}),
      },
      emptyCart: {
        ...base.body.emptyCart,
        ...(cfg.empty_cart_message                   != null ? { message:               cfg.empty_cart_message }                                : {}),
        ...(cfg.empty_cart_show_continue_shopping    != null ? { showContinueShopping:  dbFlag(cfg.empty_cart_show_continue_shopping) }         : {}),
        ...(cfg.empty_cart_show_recommendations      != null ? { showRecommendations:   dbFlag(cfg.empty_cart_show_recommendations) }           : {}),
      },
    },
    footer: {
      ...base.footer,
      checkoutButton: {
        ...base.footer.checkoutButton,
        ...(cfg.checkout_button_text          != null ? { text:         cfg.checkout_button_text }               : {}),
        ...(cfg.checkout_footer_text          != null ? { footerText:   cfg.checkout_footer_text }               : {}),
        ...(cfg.checkout_button_bg_color      != null ? { bgColor:      cfg.checkout_button_bg_color }           : {}),
        ...(cfg.checkout_button_text_color    != null ? { textColor:    cfg.checkout_button_text_color }         : {}),
        ...(cfg.checkout_button_border_radius != null ? { borderRadius: Number(cfg.checkout_button_border_radius) } : {}),
      },
      customCSS: cfg.custom_css ?? base.footer.customCSS,
    },
  };
}

function hydrateFromProgressBar(pb, base) {
  if (!pb) return base;
  const tiers = Array.isArray(pb.tiers) ? pb.tiers.map((t) => ({
    id:          t.id          ?? String(t.sort_order ?? 0),
    // Keep minValue (DB/storefront) and minimumSpend (editor UI + preview) in sync
    minValue:     Number(t.min_value ?? t.minValue ?? t.minimumSpend ?? 0),
    minimumSpend: Number(t.min_value ?? t.minValue ?? t.minimumSpend ?? 0),
    minQuantity: Number(t.min_quantity ?? t.minQuantity ?? 0),
    description: t.description ?? 'Milestone',
    rewardType:  t.reward_type  ?? t.rewardType  ?? 'free_shipping',
    iconType:    t.icon_type    ?? t.iconType    ?? 'preset',
    iconPreset:  t.icon_preset  ?? t.iconPreset  ?? 'gift',
    iconCustomSvg: t.icon_custom_svg ?? t.iconCustomSvg ?? null,
    products:    Array.isArray(t.reward_products) ? t.reward_products : [],
  })) : base.body.progressBar.tiers;

  return {
    ...base,
    body: {
      ...base.body,
      progressBar: {
        ...base.body.progressBar,
        enabled:          dbFlag(pb.is_enabled),
        mode:             pb.mode             ?? base.body.progressBar.mode,
        showWhenEmpty:    dbFlag(pb.show_on_empty),
        position:         pb.placement        ?? base.body.progressBar.position,
        borderRadius:     Number(pb.border_radius ?? base.body.progressBar.borderRadius),
        completionMessage: pb.completion_text ?? base.body.progressBar.completionMessage,
        confetti:         dbFlag(pb.enable_confetti),
        colors: {
          ...base.body.progressBar.colors,
          background: pb.bar_background_color  ?? base.body.progressBar.colors?.background,
          fill:       pb.bar_foreground_color   ?? base.body.progressBar.colors?.fill,
          icon:       pb.icon_color             ?? base.body.progressBar.colors?.icon,
          message:    pb.completion_text_color  ?? base.body.progressBar.colors?.message,
        },
        tiers,
      },
    },
  };
}

function normalizeCouponPosition(pos, fallback) {
  if (pos === 'top' || pos === 'bottom') return pos;
  // Product-widget placement values leaked into coupon_slider_settings.position
  if (pos === 'above_cart' || pos === 'above_atc') return 'top';
  if (pos === 'below_cart' || pos === 'below_atc') return 'bottom';
  return fallback;
}

function hydrateFromCouponSlider(cs, base) {
  if (!cs) return base;
  // coupon_slider_settings.selected_coupons stores raw GIDs (from Product Widget).
  // Only adopt them as full coupon objects if each element is a plain object;
  // GID strings are NOT compatible with the Cart Editor coupon card format.
  const rawSelected = Array.isArray(cs.selected_coupons) ? cs.selected_coupons : [];
  const hasFullObjects = rawSelected.length > 0 && rawSelected.every(c => c && typeof c === 'object');
  return {
    ...base,
    body: {
      ...base.body,
      couponSlider: {
        ...base.body.couponSlider,
        enabled:        dbFlag(cs.is_enabled),
        template:       cs.selected_template ?? base.body.couponSlider.template,
        sectionTitle:   cs.title_text        ?? base.body.couponSlider.sectionTitle,
        titleColor:     cs.title_color       ?? base.body.couponSlider.titleColor,
        titleFontSize:  Number(cs.title_font_size ?? base.body.couponSlider.titleFontSize),
        titleTextAlign: cs.title_alignment   ?? base.body.couponSlider.titleTextAlign,
        position:       normalizeCouponPosition(cs.position, base.body.couponSlider.position),
        layout:         cs.layout            ?? base.body.couponSlider.layout,
        // Only override selectedCoupons if the stored items are full coupon objects, not bare GIDs
        ...(hasFullObjects ? { selectedCoupons: rawSelected } : {}),
      },
    },
  };
}

function hydrateFromUpsell(up, base) {
  if (!up) return base;
  return {
    ...base,
    body: {
      ...base.body,
      upsellProducts: {
        ...base.body.upsellProducts,
        enabled:          dbFlag(up.is_enabled),
        title:            up.title             ?? base.body.upsellProducts.title,
        titleColor:       up.title_color       ?? base.body.upsellProducts.titleColor,
        showWhenEmpty:    dbFlag(up.show_on_empty_cart),
        layout:           up.layout            ?? base.body.upsellProducts.layout,
        buttonText:       up.button_text       ?? base.body.upsellProducts.buttonText,
        buttonColor:      up.button_bg_color   ?? base.body.upsellProducts.buttonColor,
        buttonTextColor:  up.button_text_color ?? base.body.upsellProducts.buttonTextColor,
        buttonBorderRadius: Number(up.button_border_radius ?? base.body.upsellProducts.buttonBorderRadius ?? 6),
        showPrice:        dbFlag(up.show_price),
        position:         up.position          ?? base.body.upsellProducts.position,
        limit:            Number(up.display_limit ?? base.body.upsellProducts.limit),
        manualRules:      Array.isArray(up.manual_rules) ? up.manual_rules : [],
      },
    },
  };
}

function mergeConfigIntoState(base, cfg) {
  if (!cfg) return base;
  let next = { ...base };
  if (cfg.checkoutButtonStyle) {
    next = {
      ...next,
      footer: {
        ...next.footer,
        checkoutButton: {
          ...next.footer.checkoutButton,
          bgColor: cfg.checkoutButtonStyle.backgroundColor || next.footer.checkoutButton.bgColor,
          textColor: cfg.checkoutButtonStyle.textColor || next.footer.checkoutButton.textColor,
          borderRadius: cfg.checkoutButtonStyle.borderRadius ?? next.footer.checkoutButton.borderRadius,
        },
      },
    };
  }
  if (cfg.drawerTheme || cfg.drawerBorderRadius != null) {
    next = {
      ...next,
      settings: {
        ...next.settings,
        design: {
          ...next.settings.design,
          ...(cfg.drawerTheme ? { theme: cfg.drawerTheme } : {}),
          ...(cfg.drawerBorderRadius != null ? { borderRadius: cfg.drawerBorderRadius } : {}),
        },
      },
    };
  }
  if (cfg.moduleStates) {
    const bodyKeyMap = { progress_bar: 'progressBar', coupon_slider: 'couponSlider', upsells: 'upsellProducts', announcements: 'announcements' };
    for (const [storeKey, bodyKey] of Object.entries(bodyKeyMap)) {
      if (storeKey in cfg.moduleStates && next.body?.[bodyKey]) {
        next = { ...next, body: { ...next.body, [bodyKey]: { ...next.body[bodyKey], enabled: cfg.moduleStates[storeKey] } } };
      }
    }
  }
  return next;
}

const CartEditorContext = createContext();

export function CartEditorProvider({ children, availableCoupons = [], allProducts = [], initialStatus, initialRecord, initialConfigRecord, initialPbRecord, initialCsRecord, initialUpsellRecord }) {
  const [state, setState] = useState(() => {
    const base        = initialStatus ? { ...defaultCartEditorState, status: initialStatus } : { ...defaultCartEditorState };
    const fromRecord  = initialRecord       ? hydrateFromRecord(initialRecord, base)          : base;
    const fromConfig  = initialConfigRecord ? hydrateFromConfig(initialConfigRecord, fromRecord) : fromRecord;
    const fromPb      = initialPbRecord     ? hydrateFromProgressBar(initialPbRecord, fromConfig) : fromConfig;
    const fromCs      = initialCsRecord     ? hydrateFromCouponSlider(initialCsRecord, fromPb)    : fromPb;
    const fromUpsell  = initialUpsellRecord ? hydrateFromUpsell(initialUpsellRecord, fromCs)      : fromCs;

    console.log('[Context init] initialCsRecord:', JSON.stringify(initialCsRecord));
    console.log('[Context init] couponSlider.enabled after hydration:', fromUpsell.body.couponSlider.enabled);
    console.log('[Context init] progressBar.enabled:', fromUpsell.body.progressBar.enabled);
    console.log('[Context init] upsellProducts.enabled:', fromUpsell.body.upsellProducts.enabled);

    return fromUpsell;
  });

  // Shared accordion open state — lets CartPreview drive sidebar navigation
  const [openSection, setOpenSectionState] = useState('');

  useEffect(() => {
    // Only apply localStorage AI config if no fresh DB records exist
    // (DB records are authoritative — localStorage is only for real-time AI agent updates)
    if (initialCsRecord || initialPbRecord || initialUpsellRecord) return;
    function loadCartConfig() {
      try {
        const raw = localStorage.getItem("cartninja_cart_config");
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }
    setState((prev) => mergeConfigIntoState(prev, loadCartConfig()));
  }, [initialStatus, initialCsRecord, initialPbRecord, initialUpsellRecord]);

  // Listen for AI agent color/config changes and apply them live to the editor
  useEffect(() => {
    const handler = (e) => {
      const cart = e?.detail;
      if (!cart) return;
      setState((prev) => ({
        ...prev,
        ...(cart.drawerEnabled != null ? { status: cart.drawerEnabled ? 'active' : 'inactive' } : {}),
        body: {
          ...prev.body,
          progressBar: {
            ...prev.body.progressBar,
            ...(cart.goalBar?.enabled != null ? { enabled: cart.goalBar.enabled } : {}),
            ...(cart.goalBar?.barColor ? {
              barForegroundColor: cart.goalBar.barColor,
              fill_color: cart.goalBar.barColor,
              colors: { ...prev.body.progressBar.colors, fill: cart.goalBar.barColor },
            } : {}),
          },
          upsellProducts: {
            ...prev.body.upsellProducts,
            ...(cart.upsell?.enabled != null ? { enabled: cart.upsell.enabled } : {}),
            ...(cart.upsell?.buttonColor ? { buttonColor: cart.upsell.buttonColor } : {}),
            ...(cart.upsell?.accentColor ? { accentColor: cart.upsell.accentColor } : {}),
          },
          couponSlider: {
            ...prev.body.couponSlider,
            ...(cart.couponSlider?.enabled != null ? { enabled: cart.couponSlider.enabled } : {}),
          },
          announcements: {
            ...prev.body.announcements,
            ...(cart.announcement?.enabled != null ? { enabled: cart.announcement.enabled } : {}),
            ...(cart.announcement?.text ? { text: cart.announcement.text } : {}),
            ...(cart.announcement?.bgColor ? { bgColor: cart.announcement.bgColor } : {}),
            ...(cart.announcement?.textColor ? { textColor: cart.announcement.textColor } : {}),
          },
        },
        footer: {
          ...prev.footer,
          checkoutButton: {
            ...prev.footer.checkoutButton,
            ...(cart.checkoutButton?.backgroundColor ? { bgColor: cart.checkoutButton.backgroundColor } : {}),
            ...(cart.checkoutButton?.textColor ? { textColor: cart.checkoutButton.textColor } : {}),
            ...(cart.checkoutButton?.borderRadius != null ? { borderRadius: cart.checkoutButton.borderRadius } : {}),
          },
        },
      }));
    };
    window.addEventListener("cartEditorConfigUpdated", handler);
    return () => window.removeEventListener("cartEditorConfigUpdated", handler);
  }, []);

  useEffect(() => {
    function loadCartConfig() {
      try {
        const raw = localStorage.getItem("cartninja_cart_config");
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }
    // Map featureStore keys → CartEditorContext body keys
    const FEATURE_TO_BODY = {
      progress_bar: "progressBar",
      coupon_slider: "couponSlider",
      upsells: "upsellProducts",
      announcements: "announcements",
    };
    const handler = (e) => {
      const { key, value } = e?.detail || {};
      // Direct update from featureStore.set() — covers AI agent configure_* actions
      if (key && value !== undefined && FEATURE_TO_BODY[key]) {
        setState((prev) => ({
          ...prev,
          body: {
            ...prev.body,
            [FEATURE_TO_BODY[key]]: { ...prev.body[FEATURE_TO_BODY[key]], enabled: value },
          },
        }));
        return;
      }
      // Full re-read fallback (storage events, resets, etc.)
      setState((prev) => mergeConfigIntoState(prev, loadCartConfig()));
    };
    window.addEventListener("featureStateChanged", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("featureStateChanged", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  const setActiveSection = useCallback((section) => {
    setState(prev => ({ ...prev, activeSection: section }));
  }, []);

  // Opens accordion + highlights preview + auto-switches preview mode atomically
  const navigateToSection = useCallback((id) => {
    setOpenSectionState(id);
    setState(prev => ({
      ...prev,
      activeSection: id || '',
      previewMode: id === 'emptyCart' ? 'empty'
        : prev.previewMode === 'empty' && id && id !== 'emptyCart' ? 'items'
        : prev.previewMode,
    }));
  }, []);

  const setPreviewMode = useCallback((mode) => {
    setState(prev => ({ ...prev, previewMode: mode }));
  }, []);

  const setPreviewDevice = useCallback((device) => {
    setState(prev => ({ ...prev, previewDevice: device }));
  }, []);

  const setStatus = useCallback((status) => {
    // Status changes are persisted immediately by the toggle (not via the Save flow),
    // so this does not mark the editor dirty.
    setState(prev => ({ ...prev, status }));
  }, []);

  const updateDesign = useCallback((design) => {
    setState(prev => ({
      ...prev,
      settings: { ...prev.settings, design: { ...prev.settings.design, ...design } },
      isDirty: true,
    }));
  }, []);

  const updateGeneral = useCallback((general) => {
    setState(prev => ({
      ...prev,
      settings: { ...prev.settings, general: { ...prev.settings.general, ...general } },
      isDirty: true,
    }));
  }, []);

  const updateHeader = useCallback((header) => {
    setState(prev => ({ ...prev, header: { ...prev.header, ...header }, isDirty: true }));
  }, []);

  const updateAnnouncements = useCallback((data) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, announcements: { ...prev.body.announcements, ...data } },
      isDirty: true,
    }));
  }, []);

  const updateProgressBar = useCallback((data) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, progressBar: { ...prev.body.progressBar, ...data } },
      isDirty: true,
    }));
  }, []);

  const updateCouponSlider = useCallback((data) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, couponSlider: { ...prev.body.couponSlider, ...data } },
      isDirty: true,
    }));
  }, []);

  const updateUpsellProducts = useCallback((data) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, upsellProducts: { ...prev.body.upsellProducts, ...data } },
      isDirty: true,
    }));
  }, []);

  const updateCountdownTimer = useCallback((data) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, countdownTimer: { ...prev.body.countdownTimer, ...data } },
      isDirty: true,
    }));
  }, []);

  const updateEmptyCart = useCallback((data) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, emptyCart: { ...prev.body.emptyCart, ...data } },
      isDirty: true,
    }));
  }, []);

  const updateCheckoutButton = useCallback((data) => {
    setState(prev => ({
      ...prev,
      footer: { ...prev.footer, checkoutButton: { ...prev.footer.checkoutButton, ...data } },
      isDirty: true,
    }));
  }, []);

  const addCouponSliderItem = useCallback((item) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, couponSlider: { ...prev.body.couponSlider, selectedCoupons: [...prev.body.couponSlider.selectedCoupons, item] } },
      isDirty: true,
    }));
  }, []);

  const removeCouponSliderItem = useCallback((id) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, couponSlider: { ...prev.body.couponSlider, selectedCoupons: prev.body.couponSlider.selectedCoupons.filter((c) => c.id !== id) } },
      isDirty: true,
    }));
  }, []);

  const updateCouponSliderItem = useCallback((id, updates) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, couponSlider: { ...prev.body.couponSlider, selectedCoupons: prev.body.couponSlider.selectedCoupons.map((c) => c.id === id ? { ...c, ...updates } : c) } },
      isDirty: true,
    }));
  }, []);

  const addUpsellRule = useCallback((rule) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, upsellProducts: { ...prev.body.upsellProducts, manualRules: [...prev.body.upsellProducts.manualRules, rule] } },
      isDirty: true,
    }));
  }, []);

  const removeUpsellRule = useCallback((id) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, upsellProducts: { ...prev.body.upsellProducts, manualRules: prev.body.upsellProducts.manualRules.filter((r) => r.id !== id) } },
      isDirty: true,
    }));
  }, []);

  const updateUpsellRule = useCallback((id, updates) => {
    setState(prev => ({
      ...prev,
      body: { ...prev.body, upsellProducts: { ...prev.body.upsellProducts, manualRules: prev.body.upsellProducts.manualRules.map((r) => r.id === id ? { ...r, ...updates } : r) } },
      isDirty: true,
    }));
  }, []);

  const updateCustomCSS = useCallback((css) => {
    setState(prev => ({
      ...prev,
      footer: { ...prev.footer, customCSS: css },
      isDirty: true,
    }));
  }, []);

  const updateWatermark = useCallback((enabled) => {
    setState(prev => ({
      ...prev,
      footer: { ...prev.footer, watermarkEnabled: enabled },
      isDirty: true,
    }));
  }, []);

  const resetDirty = useCallback(() => {
    setState(prev => ({ ...prev, isDirty: false }));
  }, []);

  const resetAll = useCallback(() => {
    setState(defaultCartEditorState);
  }, []);

  const value = {
    ...state,
    availableCoupons,
    allProducts,
    openSection,
    navigateToSection,
    setActiveSection,
    setPreviewMode,
    setPreviewDevice,
    setStatus,
    updateDesign,
    updateGeneral,
    updateHeader,
    updateAnnouncements,
    updateProgressBar,
    updateCouponSlider,
    updateUpsellProducts,
    updateCountdownTimer,
    updateEmptyCart,
    updateCheckoutButton,
    updateCustomCSS,
    updateWatermark,
    addCouponSliderItem,
    removeCouponSliderItem,
    updateCouponSliderItem,
    addUpsellRule,
    removeUpsellRule,
    updateUpsellRule,
    resetDirty,
    resetAll,
  };

  return (
    <CartEditorContext.Provider value={value}>
      {children}
    </CartEditorContext.Provider>
  );
}

export function useCartEditor() {
  const context = useContext(CartEditorContext);
  if (!context) {
    throw new Error('useCartEditor must be used within CartEditorProvider');
  }
  return context;
}

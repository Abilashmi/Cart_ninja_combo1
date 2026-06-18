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
      couponSlider: { ...base.body.couponSlider, ...cs, enabled: dbFlag(record.coupon_status) },
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

export function CartEditorProvider({ children, availableCoupons = [], allProducts = [], initialStatus, initialRecord, initialConfigRecord }) {
  const [state, setState] = useState(() => {
    const base = initialStatus ? { ...defaultCartEditorState, status: initialStatus } : { ...defaultCartEditorState };
    const fromRecord = initialRecord ? hydrateFromRecord(initialRecord, base) : base;
    // config fields take precedence over the legacy blob (they are always more recent)
    return initialConfigRecord ? hydrateFromConfig(initialConfigRecord, fromRecord) : fromRecord;
  });

  useEffect(() => {
    function loadCartConfig() {
      try {
        const raw = localStorage.getItem("cartninja_cart_config");
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }
    setState((prev) => mergeConfigIntoState(prev, loadCartConfig()));
  }, [initialStatus]);

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

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { defaultCartEditorState } from '../types/cartEditorTypes';

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
    const bodyKeyMap = { progress_bar: 'progressBar', coupon_slider: 'couponSlider', upsells: 'upsellProducts' };
    for (const [storeKey, bodyKey] of Object.entries(bodyKeyMap)) {
      if (storeKey in cfg.moduleStates && next.body?.[bodyKey]) {
        next = { ...next, body: { ...next.body, [bodyKey]: { ...next.body[bodyKey], enabled: cfg.moduleStates[storeKey] } } };
      }
    }
  }
  return next;
}

function loadCartConfig() {
  try {
    const raw = localStorage.getItem("cartninja_cart_config");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const CartEditorContext = createContext();

export function CartEditorProvider({ children, availableCoupons = [], allProducts = [], initialStatus }) {
  const [state, setState] = useState(() => {
    let base = initialStatus ? { ...defaultCartEditorState, status: initialStatus } : { ...defaultCartEditorState };
    return mergeConfigIntoState(base, loadCartConfig());
  });

  useEffect(() => {
    const handler = () => {
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

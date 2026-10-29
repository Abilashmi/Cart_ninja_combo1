import { createElement, useEffect, useRef } from 'react';
// Stand-ins for everything the two admin pages import that can't run in a
// browser. Loaders/actions are replaced by the harness router.
export function useAppBridge() {
  return {
    toast: { show: (message, opts) => { (window.__toasts = window.__toasts || []).push({ message, ...(opts || {}) }); } },
    resourcePicker: async () => [],
  };
}
export const boundary = { headers: () => ({}), error: () => null };
export const authenticate = null;
export const listCustomCoupons = null;
export const addCustomCoupon = null;
export const getStoredCoupons = null;
export default function BrixBarStub() { return null; }
export const saveCouponSliderSettings = null;
export const getShopPlan = null;

// Shopify's contextual save bar (components/shared/AppSaveBar.jsx), like the
// real one: a <ui-save-bar> shown / hidden with `open` (when the page defines it).
export function SaveBar({ open, children, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.show !== 'function') return;
    if (open) el.show(); else el.hide();
  }, [open]);
  return createElement('ui-save-bar', { ...rest, ref }, children);
}

import { createElement, useEffect, useRef } from 'react';
// Minimal @shopify/app-bridge-react stand-in: records toasts on window.__toasts.
export function useAppBridge() {
  return {
    toast: { show: (message, opts) => { (window.__toasts = window.__toasts || []).push({ message, ...(opts || {}) }); } },
    resourcePicker: async () => [],
  };
}

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

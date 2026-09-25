// Minimal @shopify/app-bridge-react stand-in: records toasts on window.__toasts.
export function useAppBridge() {
  return {
    toast: { show: (message, opts) => { (window.__toasts = window.__toasts || []).push({ message, ...(opts || {}) }); } },
    resourcePicker: async () => [],
  };
}

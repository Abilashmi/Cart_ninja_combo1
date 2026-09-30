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

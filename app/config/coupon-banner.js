// Shared definitions for the product-page "Coupon Banner" module
// (app/routes/app.productwidget.jsx) — the page and the BRIX AI tool both read
// these, so a template's defaults can't drift between them. Plain data only.

// Sample copy each template starts with. Values are the ones the editor page
// has always used.
export const COUPON_BANNER_TEMPLATE_DEFAULTS = {
  template1: { name: 'Classic Banner', headingText: 'GET 10% OFF!', subtextText: 'Apply at checkout for savings', bgColor: '#ffffff', textColor: '#111827', accentColor: '#3b82f6', buttonColor: '#3b82f6', buttonTextColor: '#ffffff', borderRadius: 12, fontSize: 16, padding: 16 },
  template2: { name: 'Minimal Card', headingText: 'SPECIAL OFFER', subtextText: 'Free shipping on orders over ₹500', bgColor: '#f9fafb', textColor: '#374151', accentColor: '#10b981', buttonColor: '#10b981', buttonTextColor: '#ffffff', borderRadius: 8, fontSize: 14, padding: 14 },
  template3: { name: 'Bold & Vibrant', headingText: 'FLASH SALE!', subtextText: 'Use code: BOLD25 for extra 25% OFF', bgColor: '#000000', textColor: '#ffffff', accentColor: '#f59e0b', buttonColor: '#f59e0b', buttonTextColor: '#111827', borderRadius: 16, fontSize: 18, padding: 20 },
};

// merchant-facing name -> the key stored in the database
export const COUPON_BANNER_TEMPLATES = {
  'classic-banner': { key: 'template1', name: 'Classic Banner' },
  'minimal-card': { key: 'template2', name: 'Minimal Card' },
  'bold-vibrant': { key: 'template3', name: 'Bold & Vibrant' },
};

export const COUPON_BANNER_LAYOUTS = ['list', 'carousel', 'grid'];
export const COUPON_BANNER_PLACEMENTS = ['above_cart', 'below_cart'];

// Accepts either the merchant-facing id or the stored key ("template2").
export function couponBannerTemplateKey(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (/^template[123]$/.test(v)) return v;
  return COUPON_BANNER_TEMPLATES[v]?.key ?? null;
}

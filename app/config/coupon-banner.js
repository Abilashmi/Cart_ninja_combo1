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

// ── Custom (external) coupons ──────────────────────────────────────────────
// A code the merchant already created elsewhere (Shopify admin, Shiprocket,
// another app). BRIX only stores and displays the code. It never creates,
// changes or validates the discount behind it. Stored in
// coupon_slider_settings.custom_coupons (see coupon-banner.server.js) as
// [{ id, code, type: 'custom', source: 'external', createdAt }]. The `id`
// takes the place of a Shopify discount GID in selectedCouponsGlobal and the
// per-coupon style maps, so selection, styling and the storefront work unchanged.
export const CUSTOM_COUPON_ID_PREFIX = 'custom:';
export const CUSTOM_COUPON_MAX_LENGTH = 255; // Shopify's own discount-code limit

export const customCouponId = (code) => `${CUSTOM_COUPON_ID_PREFIX}${code}`;
export const isCustomCouponId = (id) => String(id || '').startsWith(CUSTOM_COUPON_ID_PREFIX);

// Trims whitespace but keeps the code's own case. Returns { code } or { error }.
export function validateCustomCouponCode(raw, existingCodes = []) {
  const code = String(raw ?? '').trim();
  if (!code) return { error: 'empty', message: 'Enter a coupon code.' };
  if (code.length > CUSTOM_COUPON_MAX_LENGTH) return { error: 'too_long', message: `Coupon codes can be at most ${CUSTOM_COUPON_MAX_LENGTH} characters.` };
  // Shopify matches discount codes case-insensitively, so SAVE10 and save10 are the same coupon.
  if (existingCodes.some((c) => String(c || '').trim().toLowerCase() === code.toLowerCase())) return { error: 'duplicate', message: 'Coupon already exists.' };
  return { code };
}

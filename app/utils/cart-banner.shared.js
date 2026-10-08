// BRIX Cart Drawer "Cart Image Banner": pure rules shared by the Cart Editor
// preview (CartPreview.jsx), the save path (cart-config-writes.server.js) and
// the tests. The storefront drawer (extensions/cart-drawer/assets/
// cart_drawer_inline.js, ccBannerSlot / ccBannerSources) mirrors these exactly;
// keep them in step.

export const BANNER_PLACEMENTS = [
  { value: 'above_progress', label: 'Above Progress Bar' },
  { value: 'below_progress', label: 'Below Progress Bar' },
  { value: 'above_products', label: 'Above Products' },
  { value: 'below_products', label: 'Below Products' },
  { value: 'above_checkout', label: 'Above Checkout' },
];
export const BANNER_PLACEMENT_VALUES = BANNER_PLACEMENTS.map((p) => p.value);
export const DEFAULT_BANNER_PLACEMENT = 'above_progress';

// Images: an https URL, or a browser-compressed raster data URL (the app has
// no write_files scope, so it can't upload to Shopify Files). Never SVG: the
// storefront puts the value straight into an <img>.
export const BANNER_IMAGE_MAX_CHARS = 700000; // ~510 KB of image data
const URL_RE = /^https:\/\/[^\s"'<>()\\]{1,1000}$/;
const DATA_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isValidBannerImage(value) {
  if (typeof value !== 'string' || !value) return false;
  if (value.startsWith('data:')) return value.length <= BANNER_IMAGE_MAX_CHARS && DATA_RE.test(value);
  return URL_RE.test(value);
}

/** A valid image or null (bad input is dropped, never stored). */
export function cleanBannerImage(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return isValidBannerImage(v) ? v : null;
}

export function cleanBannerPlacement(value) {
  return BANNER_PLACEMENT_VALUES.includes(value) ? value : DEFAULT_BANNER_PLACEMENT;
}

// Space above / below the banner, in px: the gap to the section next to it
// (the drawer body's own section gap is replaced, not added to).
export const BANNER_SPACING_DEFAULT = 12;
export const BANNER_SPACING_MAX = 40;

/** A whole number of px from 0 to BANNER_SPACING_MAX, or the fallback. */
export function cleanBannerSpacing(value, fallback = BANNER_SPACING_DEFAULT) {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n)) return fallback;
  return Math.min(BANNER_SPACING_MAX, Math.max(0, Math.round(n)));
}

/**
 * Which image each device shows. A missing one falls back to the other, so a
 * banner with only a desktop image still shows on phones (and the reverse).
 * Returns null when there's nothing to show.
 */
export function bannerSources(desktop, mobile) {
  const d = desktop || mobile || '';
  const m = mobile || desktop || '';
  return d ? { desktop: d, mobile: m } : null;
}

/** Whether the banner renders at all: on, and with at least one image. */
export function bannerVisible(banner) {
  return Boolean(banner && banner.enabled && bannerSources(banner.desktopImage, banner.mobileImage));
}

/**
 * Where the banner goes inside the drawer body. Body slots, top to bottom:
 *   top            – first thing in the body (before a top progress bar)
 *   afterTopBar    – right after a top progress bar
 *   beforeProducts – right before the cart items (or the empty-cart message)
 *   afterProducts  – right after the cart items (or the empty-cart message)
 *   beforeBottomBar – right before a bottom progress bar
 *   afterBottomBar  – right after a bottom progress bar
 *   end            – last thing in the body, just above the checkout footer
 * "Above/Below Progress Bar" follow the bar wherever it is; with no progress
 * bar showing, the banner goes to the top of the body.
 */
export function bannerSlot(placement, { progressShown = false, progressPosition = 'top' } = {}) {
  const p = cleanBannerPlacement(placement);
  if (p === 'above_products') return 'beforeProducts';
  if (p === 'below_products') return 'afterProducts';
  if (p === 'above_checkout') return 'end';
  if (!progressShown) return 'top';
  const bottom = progressPosition === 'bottom';
  if (p === 'above_progress') return bottom ? 'beforeBottomBar' : 'top';
  return bottom ? 'afterBottomBar' : 'afterTopBar';
}

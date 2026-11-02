// "Continue shopping" button next to a cart drawer's Checkout, shared by the
// Cart Editor (Checkout Button section, stored in cart_drawer.checkout_button_style
// as `continueShopping`) and BRIX COD (Customize → Cart drawer, settings
// `drawerContinue`). Off by default. Mirrored by cart_drawer_inline.js
// `ccContinueShopping`, brix_cod.js `continueLook` and cod_storefront.php
// `cods_continue()`: keep the four in step.
//
// placement: Cart Editor = above | below the Checkout button; COD = above |
// below the Pay now + COD buttons. style: outline | filled | link (outline and
// link draw the text in `bg`). action: close = closes the drawer, link = opens
// `url` (an https link or a store path; '' = /collections/all).

export const CONTINUE_PLACEMENTS = ['above', 'below'];
export const CONTINUE_STYLES = ['outline', 'filled', 'link'];
export const CONTINUE_ACTIONS = ['close', 'link'];
export const CONTINUE_LIMITS = { fontSize: [11, 20], radius: [0, 40], paddingY: [4, 24] };
export const CONTINUE_DEFAULT_URL = '/collections/all';

export const DEFAULT_CONTINUE_SHOPPING = Object.freeze({
  enabled: false,
  text: 'Continue shopping',
  placement: 'below',
  style: 'outline',
  bg: '#111827',
  color: '#ffffff',
  fontSize: 14,
  radius: 8,
  paddingY: 12,
  action: 'close',
  url: '',
});

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** An https link or a path on the store ("/collections/new"). */
export function isValidContinueUrl(value) {
  const v = String(value ?? '').trim();
  if (!v || v.length > 300) return false;
  if (/^\/(?!\/)[^\s<>"'\\]*$/.test(v)) return true;
  return /^https:\/\/[^\s<>"'\\]+$/i.test(v);
}

function clampInt(value, fallback, [min, max]) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

/** A complete, valid setting from a (partial, untrusted) patch over `base`. */
export function sanitizeContinueShopping(patch, base = DEFAULT_CONTINUE_SHOPPING) {
  const b = { ...DEFAULT_CONTINUE_SHOPPING, ...(base && typeof base === 'object' ? base : {}) };
  const p = patch && typeof patch === 'object' ? patch : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(p, key);
  const pick = (key, allowed) => (has(key) && allowed.includes(p[key]) ? p[key] : allowed.includes(b[key]) ? b[key] : DEFAULT_CONTINUE_SHOPPING[key]);
  const hex = (key) => (has(key) && HEX_RE.test(String(p[key] || '')) ? String(p[key]).toLowerCase() : HEX_RE.test(String(b[key] || '')) ? String(b[key]).toLowerCase() : DEFAULT_CONTINUE_SHOPPING[key]);
  const text = has('text') && typeof p.text === 'string' ? p.text.replace(/\s+/g, ' ').trim().slice(0, 40) : String(b.text || '');
  const url = has('url') ? (isValidContinueUrl(p.url) ? String(p.url).trim() : '') : (isValidContinueUrl(b.url) ? String(b.url).trim() : '');
  return {
    enabled: has('enabled') ? p.enabled === true : b.enabled === true,
    text: text || DEFAULT_CONTINUE_SHOPPING.text,
    placement: pick('placement', CONTINUE_PLACEMENTS),
    style: pick('style', CONTINUE_STYLES),
    bg: hex('bg'),
    color: hex('color'),
    fontSize: clampInt(has('fontSize') ? p.fontSize : b.fontSize, DEFAULT_CONTINUE_SHOPPING.fontSize, CONTINUE_LIMITS.fontSize),
    radius: clampInt(has('radius') ? p.radius : b.radius, DEFAULT_CONTINUE_SHOPPING.radius, CONTINUE_LIMITS.radius),
    paddingY: clampInt(has('paddingY') ? p.paddingY : b.paddingY, DEFAULT_CONTINUE_SHOPPING.paddingY, CONTINUE_LIMITS.paddingY),
    action: pick('action', CONTINUE_ACTIONS),
    url,
  };
}

/** Where the "link" action goes. */
export function continueHref(cs) {
  return (cs && cs.url) || CONTINUE_DEFAULT_URL;
}

/**
 * React style for the admin previews. `scale` = the preview's size against
 * the storefront (the Cart Editor preview draws 13px for the storefront's 15).
 */
export function continueShoppingStyle(cs, scale = 1) {
  const s = sanitizeContinueShopping(cs);
  const filled = s.style === 'filled';
  const link = s.style === 'link';
  return {
    boxSizing: 'border-box',
    width: '100%',
    display: 'block',
    // Longhands, so a caller can set the gap on one side.
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    padding: link ? `${Math.round(Math.max(2, s.paddingY / 2) * scale)}px 8px` : `${Math.round(s.paddingY * scale)}px 12px`,
    background: filled ? s.bg : 'transparent',
    color: filled ? s.color : s.bg,
    border: 'none',
    boxShadow: s.style === 'outline' ? `inset 0 0 0 1.5px ${s.bg}` : 'none',
    borderRadius: s.radius,
    fontSize: Math.round(s.fontSize * scale * 10) / 10,
    fontWeight: 600,
    lineHeight: 1.25,
    textAlign: 'center',
    textDecoration: link ? 'underline' : 'none',
    textUnderlineOffset: link ? 3 : undefined,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

/**
 * BRIX COD Checkout — pure helpers shared by the server (app/services/cod.server.js),
 * the admin page (app.cod.jsx) and the tests (tests/cod). No DB, no network.
 *
 * COD is India-first: phone numbers are Indian mobiles (+91) and the
 * address uses a 6-digit PIN code.
 */

import { DEFAULT_PRODUCT_PAYMENT, sanitizeProductPayment } from './product-payment.shared.js';

export const COD_SURFACES = ['drawer', 'product', 'combo'];
export const COD_SOURCES = COD_SURFACES; // where an order was placed from

// Where the COD button goes in a cart drawer (the theme's own drawer or the
// BRIX Cart Drawer), relative to that drawer's Checkout button.
export const COD_DRAWER_PLACEMENTS = ['replace', 'above', 'below'];
// What shoppers see when the cart (or product) has an excluded product tag.
export const COD_EXCLUDED_BEHAVIORS = ['unavailable', 'hide'];
export const COD_BUTTON_STYLES = ['filled', 'outline', 'minimal'];
export const COD_FEE_LABEL_DEFAULT = 'Cash on Delivery Fee';

export const DEFAULT_COD_SETTINGS = Object.freeze({
  enabled: false,
  surfaces: { drawer: true, product: true, combo: true },
  drawerPlacement: 'above',
  // Advanced: CSS selector for the theme drawer's Checkout button, for themes
  // brix_cod.js doesn't recognise on its own. '' = find it automatically.
  drawerSelector: '',
  codFeeEnabled: false, // codFee is charged only while this is on
  codFee: 0,
  showCodFee: true, // false = fee is still charged, but folded into one "Delivery charges" line
  codFeeLabel: COD_FEE_LABEL_DEFAULT,
  shippingFee: 0,
  freeShippingAbove: 0, // 0 = shippingFee always applies
  minOrder: 0, // 0 = no minimum
  maxOrder: 0, // 0 = no maximum
  requireOtp: true,
  dailyLimitPerPhone: 3,
  blockedPincodes: [],
  excludedProductTags: [],
  excludedBehavior: 'unavailable',
  allowCoupons: true,
  prepaidNudgeText: '',
  orderTags: ['COD'],
  // The COD button's look, per place. The top-level fields are the cart
  // drawer button; `product` and `combo` either follow it (same: true) or
  // have their own look. Resolve with codButtonLook(settings, surface).
  buttons: {
    drawerText: 'Cash on Delivery',
    productText: 'Buy with Cash on Delivery',
    comboText: 'Cash on Delivery',
    bg: '#111827',
    color: '#ffffff',
    style: 'filled', // filled | outline | minimal (outline/minimal use bg for text and border)
    radius: 12, // cart drawer button corners, px (product page has productButton.radius)
    fontSize: 15,
    bold: true,
    uppercase: false,
    icon: true, // the cash icon before the text
    product: { same: true, style: 'filled', bg: '#111827', color: '#ffffff', fontSize: 15, bold: true, uppercase: false, icon: true },
    // Matches how combo pages drew it before it was configurable here.
    combo: { same: false, style: 'outline', bg: '#111827', color: '#ffffff', radius: 8, fontSize: 15, bold: true, uppercase: false, icon: false },
  },
  // The product page COD button (brix_cod.js initProductButton). Sizes in px.
  productButton: {
    replaceBuyNow: true, // take the place of Shopify's "Buy it now" button and hide it
    marginTop: 10,
    marginBottom: 0,
    paddingY: 14,
    paddingX: 16,
    radius: 12,
  },
  // Look of the shopper's COD checkout popup (extensions/cart-drawer/assets/brix_cod.js).
  sheet: {
    logo: '', // '' | https URL | small data:image/... URL (resized in the admin)
    logoSize: 'md', // sm | md | lg
    accent: '', // '' = use the button colours
    radius: 'rounded', // rounded | soft | sharp
    showSummary: true,
    showTrust: true,
    thankYouText: '',
    // Coupon field on the review step (only when allowCoupons is on).
    showCoupon: true,
    couponLabel: 'Have a coupon code?',
    couponOpen: false, // show the code box open instead of the "Add" row
    offers: [], // [{ code, text }] suggested codes, tap to apply (max 5)
  },
  // GA4 / Meta Pixel for the popup. Public IDs only; the GA4 API secret and the
  // Meta Conversions API token live in the separate cod_secrets table.
  tracking: {
    ga4Id: '', // G-XXXXXXX
    metaPixelId: '',
    metaContentId: 'shopify', // shopify (shopify_IN_<product>_<variant>) | variant | sku
    dataLayer: true, // also push brix_cod_* events to GTM's dataLayer when present
  },
  // Product page payment selector (Pay Online / Cash on Delivery) and the
  // prepaid discount it advertises. See utils/product-payment.shared.js.
  productPayment: DEFAULT_PRODUCT_PAYMENT,
});

export const GA4_ID_RE = /^G-[A-Z0-9]{4,12}$/;
export const META_PIXEL_RE = /^\d{10,20}$/;
export const META_CONTENT_ID_FORMATS = ['shopify', 'variant', 'sku'];

// Allowed range for each productButton size: [min, max].
export const COD_PRODUCT_BUTTON_LIMITS = Object.freeze({
  marginTop: [0, 60],
  marginBottom: [0, 60],
  paddingY: [4, 32],
  paddingX: [4, 48],
  radius: [0, 40],
});

const COUPON_CODE_RE = /^[\w-]{1,60}$/;

/** Suggested offers for the popup: valid, unique codes with a short line of text, max 5. */
export function parseCodOffers(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((o) => ({ code: String(o?.code ?? '').trim(), text: String(o?.text ?? '').trim().slice(0, 80) }))
    .filter((o) => COUPON_CODE_RE.test(o.code) && !seen.has(o.code.toLowerCase()) && seen.add(o.code.toLowerCase()))
    .slice(0, 5);
}

export const COD_LOGO_MAX_CHARS = 40000;
const LOGO_URL_RE = /^https:\/\/[^\s"'<>()\\]{1,500}$/;
const LOGO_DATA_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A logo the storefront may put in an <img src>: https URL or a small raster data URL. */
export function isValidCodLogo(value) {
  if (typeof value !== 'string' || !value) return false;
  if (value.startsWith('data:')) return value.length <= COD_LOGO_MAX_CHARS && LOGO_DATA_RE.test(value);
  return LOGO_URL_RE.test(value);
}

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
// A CSS selector, nothing that could end a style block or an HTML attribute.
const SELECTOR_RE = /^[\w\s\-#.:[\]="'>~+*(),^$|/]{1,200}$/;

export function isValidDrawerSelector(value) {
  return typeof value === 'string' && SELECTOR_RE.test(value.trim());
}
const PIN_RE = /^[1-9]\d{5}$/;
const TAG_RE = /^[\w\- .:/]{1,40}$/;

function money(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

function int(value, fallback, min, max) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function text(value, fallback, max) {
  if (typeof value !== 'string') return fallback;
  const t = value.trim().slice(0, max);
  return t || fallback;
}

function list(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[,\n]/);
  return [];
}

export function parsePincodes(value) {
  return [...new Set(list(value).map((p) => String(p).trim()).filter((p) => PIN_RE.test(p)))].slice(0, 2000);
}

export function parseTags(value) {
  return [...new Set(list(value).map((t) => String(t).trim()).filter((t) => TAG_RE.test(t)))].slice(0, 50);
}

export const COD_BUTTON_FONT_SIZES = [12, 22];

/**
 * One COD button look: { style, bg, color, fontSize, bold, uppercase, icon }
 * (+ radius, + same). Valid fields of `patch` win, the rest keep `base`.
 */
function sanitizeButtonLook(patch, base, { radius = false, same = false } = {}) {
  const q = patch && typeof patch === 'object' ? patch : {};
  const out = {
    style: COD_BUTTON_STYLES.includes(q.style) ? q.style : (COD_BUTTON_STYLES.includes(base.style) ? base.style : 'filled'),
    bg: HEX_RE.test(q.bg || '') ? q.bg : (HEX_RE.test(base.bg || '') ? base.bg : '#111827'),
    color: HEX_RE.test(q.color || '') ? q.color : (HEX_RE.test(base.color || '') ? base.color : '#ffffff'),
    fontSize: int('fontSize' in q ? q.fontSize : base.fontSize, 15, ...COD_BUTTON_FONT_SIZES),
    bold: 'bold' in q ? Boolean(q.bold) : base.bold !== false,
    uppercase: 'uppercase' in q ? Boolean(q.uppercase) : Boolean(base.uppercase),
    icon: 'icon' in q ? Boolean(q.icon) : base.icon !== false,
  };
  if (radius) out.radius = int('radius' in q ? q.radius : base.radius, 12, 0, 40);
  if (same) out.same = 'same' in q ? Boolean(q.same) : base.same !== false;
  return out;
}

/**
 * The COD button for one place ('drawer' | 'product' | 'combo'), as drawn:
 * { text, style, bg, color, radius, fontSize, bold, uppercase, icon }.
 * Product and combo use the cart drawer look while their `same` is on. The
 * product page's corners are productButton.radius (with its other sizes).
 * Mirrored by php_backend/cod_storefront.php cods_button_looks().
 */
export function codButtonLook(settings, surface = 'drawer') {
  const b = { ...DEFAULT_COD_SETTINGS.buttons, ...(settings?.buttons || {}) };
  const pick = (l) => ({ style: l.style, bg: l.bg, color: l.color, fontSize: l.fontSize ?? 15, bold: l.bold !== false, uppercase: Boolean(l.uppercase), icon: l.icon !== false });
  const drawer = { ...pick(b), radius: b.radius ?? 12 };
  if (surface === 'product') {
    const own = b.product && b.product.same === false ? b.product : b;
    const pbRadius = settings?.productButton?.radius ?? DEFAULT_COD_SETTINGS.productButton.radius;
    return { ...pick(own), radius: pbRadius, text: b.productText };
  }
  if (surface === 'combo') {
    const own = b.combo && b.combo.same === false ? b.combo : null;
    return own ? { ...pick(own), radius: own.radius ?? 8, text: b.comboText } : { ...drawer, text: b.comboText };
  }
  return { ...drawer, text: b.drawerText };
}

/**
 * Merge a (possibly partial / untrusted) settings patch onto `base`, returning
 * a complete, valid settings object. Unknown keys are dropped.
 */
export function sanitizeCodSettings(patch = {}, base = DEFAULT_COD_SETTINGS) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const b = { ...DEFAULT_COD_SETTINGS, ...base };
  const surfaces = { ...DEFAULT_COD_SETTINGS.surfaces, ...(b.surfaces || {}) };
  if (p.surfaces && typeof p.surfaces === 'object') {
    for (const key of COD_SURFACES) if (key in p.surfaces) surfaces[key] = Boolean(p.surfaces[key]);
  }
  const D = DEFAULT_COD_SETTINGS.buttons;
  const bb = b.buttons || {};
  const pb = p.buttons && typeof p.buttons === 'object' ? p.buttons : null;
  const buttons = {
    ...sanitizeButtonLook(pb, { ...D, ...bb }, { radius: true }),
    drawerText: text(pb?.drawerText, bb.drawerText || D.drawerText, 60),
    productText: text(pb?.productText, bb.productText || D.productText, 60),
    comboText: text(pb?.comboText, bb.comboText || D.comboText, 60),
    product: sanitizeButtonLook(pb?.product, { ...D.product, ...(bb.product || {}) }, { same: true }),
    combo: sanitizeButtonLook(pb?.combo, { ...D.combo, ...(bb.combo || {}) }, { same: true, radius: true }),
  };
  const productButton = { ...DEFAULT_COD_SETTINGS.productButton, ...(b.productButton || {}) };
  if (p.productButton && typeof p.productButton === 'object') {
    const q = p.productButton;
    if ('replaceBuyNow' in q) productButton.replaceBuyNow = Boolean(q.replaceBuyNow);
    for (const [key, [min, max]] of Object.entries(COD_PRODUCT_BUTTON_LIMITS)) {
      if (key in q) productButton[key] = int(q[key], productButton[key], min, max);
    }
  }
  const sheet = { ...DEFAULT_COD_SETTINGS.sheet, ...(b.sheet || {}) };
  if (p.sheet && typeof p.sheet === 'object') {
    const q = p.sheet;
    if ('logo' in q) sheet.logo = isValidCodLogo(q.logo) ? q.logo : '';
    if (['sm', 'md', 'lg'].includes(q.logoSize)) sheet.logoSize = q.logoSize;
    if ('accent' in q) sheet.accent = HEX_RE.test(q.accent || '') ? q.accent : '';
    if (['rounded', 'soft', 'sharp'].includes(q.radius)) sheet.radius = q.radius;
    if ('showSummary' in q) sheet.showSummary = Boolean(q.showSummary);
    if ('showTrust' in q) sheet.showTrust = Boolean(q.showTrust);
    if ('thankYouText' in q) sheet.thankYouText = typeof q.thankYouText === 'string' ? q.thankYouText.trim().slice(0, 120) : '';
    if ('showCoupon' in q) sheet.showCoupon = Boolean(q.showCoupon);
    if ('couponLabel' in q) sheet.couponLabel = text(q.couponLabel, DEFAULT_COD_SETTINGS.sheet.couponLabel, 40);
    if ('couponOpen' in q) sheet.couponOpen = Boolean(q.couponOpen);
    if ('offers' in q) sheet.offers = parseCodOffers(q.offers);
  }
  const tracking = { ...DEFAULT_COD_SETTINGS.tracking, ...(b.tracking || {}) };
  if (p.tracking && typeof p.tracking === 'object') {
    const t = p.tracking;
    if ('ga4Id' in t) {
      const id = String(t.ga4Id || '').trim().toUpperCase();
      tracking.ga4Id = GA4_ID_RE.test(id) ? id : '';
    }
    if ('metaPixelId' in t) {
      const id = String(t.metaPixelId || '').trim();
      tracking.metaPixelId = META_PIXEL_RE.test(id) ? id : '';
    }
    if (META_CONTENT_ID_FORMATS.includes(t.metaContentId)) tracking.metaContentId = t.metaContentId;
    if ('dataLayer' in t) tracking.dataLayer = Boolean(t.dataLayer);
  }
  const has = (key) => Object.prototype.hasOwnProperty.call(p, key);
  const pick = (key, allowed) => (has(key) && allowed.includes(p[key]) ? p[key] : allowed.includes(b[key]) ? b[key] : DEFAULT_COD_SETTINGS[key]);
  const codFee = has('codFee') ? money(p.codFee, b.codFee) : money(b.codFee);
  // Before the fee switch existed, codFee itself was the switch (charged
  // whenever above 0). So a patch or stored settings with an amount but no
  // switch mean "on when there's an amount".
  const baseFeeFlag = base !== DEFAULT_COD_SETTINGS && typeof base?.codFeeEnabled === 'boolean' ? base.codFeeEnabled : null;
  let drawerSelector = has('drawerSelector') ? String(p.drawerSelector ?? '').trim() : String(b.drawerSelector || '').trim();
  if (drawerSelector && !isValidDrawerSelector(drawerSelector)) drawerSelector = has('drawerSelector') ? String(b.drawerSelector || '') : '';
  const out = {
    enabled: has('enabled') ? Boolean(p.enabled) : Boolean(b.enabled),
    surfaces,
    drawerPlacement: pick('drawerPlacement', COD_DRAWER_PLACEMENTS),
    drawerSelector,
    codFeeEnabled: has('codFeeEnabled') ? Boolean(p.codFeeEnabled) : has('codFee') ? codFee > 0 : baseFeeFlag ?? codFee > 0,
    codFee,
    showCodFee: has('showCodFee') ? Boolean(p.showCodFee) : b.showCodFee !== false,
    codFeeLabel: text(has('codFeeLabel') ? p.codFeeLabel : b.codFeeLabel, COD_FEE_LABEL_DEFAULT, 40),
    shippingFee: has('shippingFee') ? money(p.shippingFee, b.shippingFee) : money(b.shippingFee),
    freeShippingAbove: has('freeShippingAbove') ? money(p.freeShippingAbove, b.freeShippingAbove) : money(b.freeShippingAbove),
    minOrder: has('minOrder') ? money(p.minOrder, b.minOrder) : money(b.minOrder),
    maxOrder: has('maxOrder') ? money(p.maxOrder, b.maxOrder) : money(b.maxOrder),
    requireOtp: has('requireOtp') ? Boolean(p.requireOtp) : Boolean(b.requireOtp),
    dailyLimitPerPhone: int(has('dailyLimitPerPhone') ? p.dailyLimitPerPhone : b.dailyLimitPerPhone, 3, 1, 50),
    blockedPincodes: parsePincodes(has('blockedPincodes') ? p.blockedPincodes : b.blockedPincodes),
    excludedProductTags: parseTags(has('excludedProductTags') ? p.excludedProductTags : b.excludedProductTags),
    excludedBehavior: pick('excludedBehavior', COD_EXCLUDED_BEHAVIORS),
    allowCoupons: has('allowCoupons') ? Boolean(p.allowCoupons) : b.allowCoupons !== false,
    prepaidNudgeText: has('prepaidNudgeText') ? (typeof p.prepaidNudgeText === 'string' ? p.prepaidNudgeText.trim().slice(0, 140) : '') : String(b.prepaidNudgeText || ''),
    orderTags: parseTags(has('orderTags') ? p.orderTags : b.orderTags),
    buttons,
    productButton,
    sheet,
    tracking,
    productPayment: sanitizeProductPayment(p.productPayment, b.productPayment),
  };
  return out;
}

const GA_CLIENT_RE = /^\d{1,20}\.\d{1,20}$/;
const GA_SESSION_RE = /^\d{1,20}$/;
const FB_COOKIE_RE = /^fb\.\d\.\d{1,20}\.[\w.-]{1,200}$/;

/**
 * The shopper's analytics context sent with a COD order (from brix_cod.js):
 * GA client/session ids, Meta _fbp/_fbc cookies, consent flags and the page URL.
 * Untrusted input — anything that doesn't look right is dropped. Missing consent = false.
 */
export function sanitizeCodTrack(input) {
  const t = input && typeof input === 'object' ? input : {};
  const pick = (value, re) => (typeof value === 'string' && re.test(value) ? value : '');
  let pageUrl = '';
  if (typeof t.pageUrl === 'string' && t.pageUrl.length <= 500) {
    try {
      const u = new URL(t.pageUrl);
      if (u.protocol === 'https:' || u.protocol === 'http:') pageUrl = u.href;
    } catch { /* ignore */ }
  }
  return {
    gaClientId: pick(t.gaClientId, GA_CLIENT_RE),
    gaSessionId: pick(t.gaSessionId, GA_SESSION_RE),
    fbp: pick(t.fbp, FB_COOKIE_RE),
    fbc: pick(t.fbc, FB_COOKIE_RE),
    consent: {
      analytics: t.consent?.analytics === true,
      marketing: t.consent?.marketing === true,
    },
    pageUrl,
  };
}

/** "+91 98765 43210", "09876543210", "919876543210" → "9876543210", else null. */
export function normalizeIndianPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function isValidPincode(value) {
  return PIN_RE.test(String(value || '').trim());
}

export function maskPhone(phone) {
  const p = String(phone || '');
  return p.length === 10 ? `${p.slice(0, 2)}XXXX${p.slice(6)}` : 'XXXXXXXXXX';
}

export function splitName(full) {
  const parts = String(full || '').trim().replace(/\s+/g, ' ').split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/** Line properties that mark lines whose price only Shopify checkout can apply. */
export function isCheckoutOnlyLine(properties) {
  const props = properties || {};
  if (props._brix_pack_id) return true;
  return props._brixReward === 'true' || props._brixReward === true;
}

/** The COD fee actually charged: the amount, while the fee switch is on. */
export function codFeeOf(settings) {
  return settings.codFeeEnabled === false ? 0 : money(settings.codFee);
}

/** Shipping + COD fee charged as the order's shipping line. */
export function codCharges(settings, subtotal) {
  const shipping = settings.shippingFee > 0 && !(settings.freeShippingAbove > 0 && subtotal >= settings.freeShippingAbove)
    ? settings.shippingFee
    : 0;
  const codFee = codFeeOf(settings);
  return { shipping, codFee, total: money(shipping + codFee) };
}

/**
 * Rules checked against the real (Shopify-calculated) subtotal.
 * Returns null when COD is allowed, else { code, message } safe to show shoppers.
 */
export function checkCodRules({ settings, subtotal, pincode, productTags = [], surface, format = formatInr }) {
  if (!settings.enabled) return { code: 'cod_disabled', message: 'Cash on Delivery is not available right now.' };
  if (surface && settings.surfaces[surface] === false) return { code: 'cod_disabled', message: 'Cash on Delivery is not available here.' };
  if (settings.minOrder > 0 && subtotal < settings.minOrder) {
    return { code: 'below_min', message: `Cash on Delivery is available on orders from ${format(settings.minOrder)}.` };
  }
  if (settings.maxOrder > 0 && subtotal > settings.maxOrder) {
    return { code: 'above_max', message: `Cash on Delivery is available on orders up to ${format(settings.maxOrder)}.` };
  }
  if (pincode && settings.blockedPincodes.includes(String(pincode).trim())) {
    return { code: 'pincode_blocked', message: `Cash on Delivery isn't available for PIN code ${String(pincode).trim()}.` };
  }
  const excluded = settings.excludedProductTags.map((t) => t.toLowerCase());
  if (excluded.length && productTags.some((t) => excluded.includes(String(t).toLowerCase()))) {
    return { code: 'product_excluded', message: 'One of these products is not available with Cash on Delivery.' };
  }
  return null;
}

/** Money formatter for the store's real currency (never hardcoded). */
export function moneyFormatter(currencyCode = 'INR') {
  let nf;
  try { nf = new Intl.NumberFormat('en-IN', { style: 'currency', currency: currencyCode }); } catch { nf = null; }
  return (amount) => {
    const n = Number(amount) || 0;
    return nf ? nf.format(n) : `${currencyCode} ${n.toFixed(2)}`;
  };
}

export const formatInr = moneyFormatter('INR');

// Shopify's province codes for India (CountryCode IN).
const INDIA_STATE_CODES = {
  'andaman and nicobar islands': 'AN', 'andhra pradesh': 'AP', 'arunachal pradesh': 'AR', assam: 'AS', bihar: 'BR',
  chandigarh: 'CH', chhattisgarh: 'CG', 'dadra and nagar haveli and daman and diu': 'DN', 'dadra and nagar haveli': 'DN',
  'daman and diu': 'DD', delhi: 'DL', goa: 'GA', gujarat: 'GJ', haryana: 'HR', 'himachal pradesh': 'HP',
  'jammu and kashmir': 'JK', jharkhand: 'JH', karnataka: 'KA', kerala: 'KL', ladakh: 'LA', lakshadweep: 'LD',
  'madhya pradesh': 'MP', maharashtra: 'MH', manipur: 'MN', meghalaya: 'ML', mizoram: 'MZ', nagaland: 'NL',
  odisha: 'OR', orissa: 'OR', puducherry: 'PY', pondicherry: 'PY', punjab: 'PB', rajasthan: 'RJ', sikkim: 'SK',
  'tamil nadu': 'TN', telangana: 'TS', tripura: 'TR', 'uttar pradesh': 'UP', uttarakhand: 'UK', 'west bengal': 'WB',
};

export const INDIA_STATES = Object.keys(INDIA_STATE_CODES)
  .filter((s) => !['orissa', 'pondicherry', 'dadra and nagar haveli', 'daman and diu'].includes(s))
  .map((s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, 'and'));

export function provinceCodeFor(state) {
  const key = String(state || '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
  return INDIA_STATE_CODES[key] || null;
}

/** Validate the shopper's address form. Returns { address } or { error }. */
export function validateAddress(input = {}) {
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  const address1 = String(input.address1 || '').trim();
  const address2 = String(input.address2 || '').trim();
  const city = String(input.city || '').trim();
  const state = String(input.state || '').trim();
  const pincode = String(input.pincode || '').trim();
  const email = String(input.email || '').trim();
  if (name.length < 2) return { error: 'Enter your full name.' };
  if (address1.length < 5) return { error: 'Enter your house number, street and area.' };
  if (!isValidPincode(pincode)) return { error: 'Enter a valid 6-digit PIN code.' };
  if (city.length < 2) return { error: 'Enter your city.' };
  if (state.length < 2) return { error: 'Choose your state.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address, or leave it empty.' };
  return {
    address: {
      name: name.slice(0, 80), address1: address1.slice(0, 200), address2: address2.slice(0, 200),
      city: city.slice(0, 80), state: state.slice(0, 80), pincode, email: email.slice(0, 120),
    },
  };
}

/** Normalize storefront line input: [{ variantId, quantity, properties }]. */
export function normalizeLines(items) {
  if (!Array.isArray(items) || items.length === 0) return { error: 'Your cart is empty.' };
  if (items.length > 50) return { error: 'Too many items for one Cash on Delivery order.' };
  const merged = new Map();
  for (const item of items) {
    const id = String(item?.variantId ?? item?.variant_id ?? '').split('/').pop();
    const quantity = Math.trunc(Number(item?.quantity));
    if (!/^\d+$/.test(id) || !Number.isFinite(quantity) || quantity < 1 || quantity > 100) {
      return { error: 'One of the items in your cart is not valid. Refresh the page and try again.' };
    }
    const properties = {};
    for (const [k, v] of Object.entries(item?.properties || {})) {
      if (typeof k === 'string' && k.length <= 60 && v != null && String(v).length <= 250) properties[k] = String(v);
    }
    const key = `${id}|${JSON.stringify(properties)}`;
    const prev = merged.get(key);
    merged.set(key, { variantId: id, quantity: (prev?.quantity || 0) + quantity, properties });
  }
  return { lines: [...merged.values()] };
}

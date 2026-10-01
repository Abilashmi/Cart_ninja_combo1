/**
 * BRIX COD Checkout — pure helpers shared by the server (app/services/cod.server.js),
 * the admin page (app.cod.jsx) and the tests (tests/cod). No DB, no network.
 *
 * COD is India-first: phone numbers are Indian mobiles (+91) and the
 * address uses a 6-digit PIN code.
 */

export const COD_SURFACES = ['drawer', 'product', 'combo'];
export const COD_SOURCES = COD_SURFACES; // where an order was placed from

export const DEFAULT_COD_SETTINGS = Object.freeze({
  enabled: false,
  surfaces: { drawer: true, product: true, combo: true },
  codFee: 0,
  shippingFee: 0,
  freeShippingAbove: 0, // 0 = shippingFee always applies
  minOrder: 0, // 0 = no minimum
  maxOrder: 0, // 0 = no maximum
  requireOtp: true,
  dailyLimitPerPhone: 3,
  blockedPincodes: [],
  excludedProductTags: [],
  allowCoupons: true,
  prepaidNudgeText: '',
  orderTags: ['COD'],
  buttons: {
    drawerText: 'Cash on Delivery',
    productText: 'Buy with Cash on Delivery',
    bg: '#111827',
    color: '#ffffff',
  },
});

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
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
  const buttons = { ...DEFAULT_COD_SETTINGS.buttons, ...(b.buttons || {}) };
  if (p.buttons && typeof p.buttons === 'object') {
    buttons.drawerText = text(p.buttons.drawerText, buttons.drawerText, 60);
    buttons.productText = text(p.buttons.productText, buttons.productText, 60);
    if (HEX_RE.test(p.buttons.bg || '')) buttons.bg = p.buttons.bg;
    if (HEX_RE.test(p.buttons.color || '')) buttons.color = p.buttons.color;
  }
  const has = (key) => Object.prototype.hasOwnProperty.call(p, key);
  const out = {
    enabled: has('enabled') ? Boolean(p.enabled) : Boolean(b.enabled),
    surfaces,
    codFee: has('codFee') ? money(p.codFee, b.codFee) : money(b.codFee),
    shippingFee: has('shippingFee') ? money(p.shippingFee, b.shippingFee) : money(b.shippingFee),
    freeShippingAbove: has('freeShippingAbove') ? money(p.freeShippingAbove, b.freeShippingAbove) : money(b.freeShippingAbove),
    minOrder: has('minOrder') ? money(p.minOrder, b.minOrder) : money(b.minOrder),
    maxOrder: has('maxOrder') ? money(p.maxOrder, b.maxOrder) : money(b.maxOrder),
    requireOtp: has('requireOtp') ? Boolean(p.requireOtp) : Boolean(b.requireOtp),
    dailyLimitPerPhone: int(has('dailyLimitPerPhone') ? p.dailyLimitPerPhone : b.dailyLimitPerPhone, 3, 1, 50),
    blockedPincodes: parsePincodes(has('blockedPincodes') ? p.blockedPincodes : b.blockedPincodes),
    excludedProductTags: parseTags(has('excludedProductTags') ? p.excludedProductTags : b.excludedProductTags),
    allowCoupons: has('allowCoupons') ? Boolean(p.allowCoupons) : b.allowCoupons !== false,
    prepaidNudgeText: has('prepaidNudgeText') ? (typeof p.prepaidNudgeText === 'string' ? p.prepaidNudgeText.trim().slice(0, 140) : '') : String(b.prepaidNudgeText || ''),
    orderTags: parseTags(has('orderTags') ? p.orderTags : b.orderTags),
    buttons,
  };
  return out;
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

/** Shipping + COD fee charged as the order's shipping line. */
export function codCharges(settings, subtotal) {
  const shipping = settings.shippingFee > 0 && !(settings.freeShippingAbove > 0 && subtotal >= settings.freeShippingAbove)
    ? settings.shippingFee
    : 0;
  return { shipping, codFee: settings.codFee, total: money(shipping + settings.codFee) };
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

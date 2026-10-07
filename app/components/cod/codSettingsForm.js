// Form state for the COD customizer (app.cod_.customize.jsx):
// settings <-> form fields, validation, and the shared constants.
import {
  isValidCodLogo, isValidDrawerSelector, DEFAULT_COD_SETTINGS, GA4_ID_RE, META_PIXEL_RE,
} from '../../utils/cod.shared';

/* ---------- form state <-> settings ---------- */

const numText = (n) => (n ? String(n) : '');

export function sheetForm(sheet) {
  const sh = { ...DEFAULT_COD_SETTINGS.sheet, ...(sheet || {}) };
  return {
    sheetLogo: sh.logo,
    sheetLogoSize: sh.logoSize,
    sheetUseButton: !sh.accent,
    sheetAccent: sh.accent || '#4f46e5',
    sheetRadius: sh.radius,
    sheetSummary: sh.showSummary,
    sheetTrust: sh.showTrust,
    sheetThanks: sh.thankYouText,
    sheetCoupon: sh.showCoupon,
    sheetCouponLabel: sh.couponLabel,
    sheetCouponOpen: sh.couponOpen,
    sheetOffers: (sh.offers || []).map((o) => ({ code: o.code, text: o.text })),
  };
}

export function productButtonForm(pb) {
  const b = { ...DEFAULT_COD_SETTINGS.productButton, ...(pb || {}) };
  return {
    pbReplaceBuyNow: b.replaceBuyNow,
    pbMarginTop: b.marginTop,
    pbMarginBottom: b.marginBottom,
    pbPaddingY: b.paddingY,
    pbPaddingX: b.paddingX,
    pbRadius: b.radius,
  };
}

export function toForm(s) {
  return {
    enabled: s.enabled,
    drawer: s.surfaces.drawer !== false,
    product: s.surfaces.product !== false,
    combo: s.surfaces.combo !== false,
    drawerPlacement: s.drawerPlacement,
    drawerSelector: s.drawerSelector || '',
    codFeeEnabled: s.codFeeEnabled,
    codFee: numText(s.codFee),
    showCodFee: s.showCodFee !== false,
    codFeeLabel: s.codFeeLabel,
    shippingFee: numText(s.shippingFee),
    freeShippingAbove: numText(s.freeShippingAbove),
    minOrder: numText(s.minOrder),
    maxOrder: numText(s.maxOrder),
    requireOtp: s.requireOtp,
    dailyLimitPerPhone: String(s.dailyLimitPerPhone),
    blockedPincodes: s.blockedPincodes.join(', '),
    excludedProductTags: s.excludedProductTags.join(', '),
    excludedBehavior: s.excludedBehavior,
    allowCoupons: s.allowCoupons,
    prepaidNudgeText: s.prepaidNudgeText,
    orderTags: s.orderTags.join(', '),
    drawerText: s.buttons.drawerText,
    productText: s.buttons.productText,
    bg: s.buttons.bg,
    color: s.buttons.color,
    btnStyle: s.buttons.style || 'filled',
    btnRadius: s.buttons.radius ?? 12,
    ...productButtonForm(s.productButton),
    ...sheetForm(s.sheet),
    ga4Id: s.tracking?.ga4Id || '',
    metaPixelId: s.tracking?.metaPixelId || '',
    metaContentId: s.tracking?.metaContentId || 'shopify',
    dataLayer: s.tracking?.dataLayer !== false,
    // Write-only keys: '' = keep what's saved, a value = replace, null = remove.
    ga4ApiSecret: '',
    metaCapiToken: '',
    metaTestCode: '',
  };
}

export const SECRET_FIELDS = ['ga4ApiSecret', 'metaCapiToken', 'metaTestCode'];

/** Only the keys the merchant typed or removed; the rest keep their saved value. */
export function secretsPatch(f) {
  const patch = {};
  for (const key of SECRET_FIELDS) if (f[key] === null || f[key].trim()) patch[key] = f[key] === null ? null : f[key].trim();
  return patch;
}

export function toSettings(f) {
  return {
    enabled: f.enabled,
    surfaces: { drawer: f.drawer, product: f.product, combo: f.combo },
    drawerPlacement: f.drawerPlacement,
    drawerSelector: f.drawerSelector.trim(),
    codFeeEnabled: f.codFeeEnabled,
    codFee: Number(f.codFee) || 0,
    showCodFee: f.showCodFee,
    codFeeLabel: f.codFeeLabel,
    shippingFee: Number(f.shippingFee) || 0,
    freeShippingAbove: Number(f.freeShippingAbove) || 0,
    minOrder: Number(f.minOrder) || 0,
    maxOrder: Number(f.maxOrder) || 0,
    requireOtp: f.requireOtp,
    dailyLimitPerPhone: Number(f.dailyLimitPerPhone) || 3,
    blockedPincodes: f.blockedPincodes,
    excludedProductTags: f.excludedProductTags,
    excludedBehavior: f.excludedBehavior,
    allowCoupons: f.allowCoupons,
    prepaidNudgeText: f.prepaidNudgeText,
    orderTags: f.orderTags,
    buttons: { drawerText: f.drawerText, productText: f.productText, bg: f.bg, color: f.color, style: f.btnStyle, radius: f.btnRadius },
    productButton: {
      replaceBuyNow: f.pbReplaceBuyNow,
      marginTop: f.pbMarginTop,
      marginBottom: f.pbMarginBottom,
      paddingY: f.pbPaddingY,
      paddingX: f.pbPaddingX,
      radius: f.pbRadius,
    },
    sheet: {
      logo: f.sheetLogo,
      logoSize: f.sheetLogoSize,
      accent: f.sheetUseButton ? '' : f.sheetAccent,
      radius: f.sheetRadius,
      showSummary: f.sheetSummary,
      showTrust: f.sheetTrust,
      thankYouText: f.sheetThanks,
      showCoupon: f.sheetCoupon,
      couponLabel: f.sheetCouponLabel,
      couponOpen: f.sheetCouponOpen,
      offers: f.sheetOffers,
    },
    tracking: {
      ga4Id: f.ga4Id.trim().toUpperCase(),
      metaPixelId: f.metaPixelId.trim(),
      metaContentId: f.metaContentId,
      dataLayer: f.dataLayer,
    },
  };
}

export function formErrors(f) {
  const e = {};
  const money = (key) => { if (f[key] !== '' && !(Number(f[key]) >= 0)) e[key] = 'Enter an amount of 0 or more.'; };
  ['codFee', 'shippingFee', 'freeShippingAbove', 'minOrder', 'maxOrder'].forEach(money);
  if (!e.maxOrder && Number(f.maxOrder) > 0 && Number(f.minOrder) > Number(f.maxOrder)) e.maxOrder = 'Maximum must be more than the minimum.';
  if (f.codFeeEnabled && !e.codFee && !(Number(f.codFee) > 0)) e.codFee = 'Enter the fee amount, or turn the fee off.';
  if (f.codFeeEnabled && !f.codFeeLabel.trim()) e.codFeeLabel = 'Enter the name shoppers see for this fee.';
  const selector = f.drawerSelector.trim();
  if (selector && !isValidDrawerSelector(selector)) e.drawerSelector = 'Use a CSS selector like #CartDrawer-Checkout.';
  else if (selector && typeof document !== 'undefined') {
    try { document.querySelector(selector); } catch { e.drawerSelector = "This isn't a valid CSS selector."; }
  }
  const limit = Number(f.dailyLimitPerPhone);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) e.dailyLimitPerPhone = 'Enter a whole number from 1 to 50.';
  const badPins = f.blockedPincodes.split(/[,\n\s]+/).filter(Boolean).filter((p) => !/^[1-9]\d{5}$/.test(p));
  if (badPins.length) e.blockedPincodes = `These aren't 6-digit PIN codes: ${badPins.slice(0, 5).join(', ')}`;
  const hex = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;
  if (!hex.test(f.bg)) e.bg = 'Use a hex colour like #111827.';
  if (!hex.test(f.color)) e.color = 'Use a hex colour like #ffffff.';
  if (!f.drawerText.trim()) e.drawerText = 'Enter the button text.';
  if (!f.productText.trim()) e.productText = 'Enter the button text.';
  if (f.sheetLogo && !isValidCodLogo(f.sheetLogo)) e.sheetLogo = 'Use an image link that starts with https://, or upload a logo.';
  if (!f.sheetUseButton && !hex.test(f.sheetAccent)) e.sheetAccent = 'Use a hex colour like #4f46e5.';
  if (f.ga4Id.trim() && !GA4_ID_RE.test(f.ga4Id.trim().toUpperCase())) e.ga4Id = 'A Measurement ID looks like G-ABC123XYZ.';
  if (f.metaPixelId.trim() && !META_PIXEL_RE.test(f.metaPixelId.trim())) e.metaPixelId = 'A Pixel ID is a 10 to 20 digit number.';
  for (const key of SECRET_FIELDS) {
    if (typeof f[key] === 'string' && f[key].trim() && !/^[A-Za-z0-9_-]{1,512}$/.test(f[key].trim())) e[key] = 'Paste it again without spaces.';
  }
  return e;
}

// Product page button sizes (settings.productButton), in the order they're shown.
export const PB_SIZES = [
  { key: 'marginTop', field: 'pbMarginTop', label: 'Space above', help: 'Gap between Add to Cart and the COD button.' },
  { key: 'marginBottom', field: 'pbMarginBottom', label: 'Space below', help: 'Gap under the COD button.' },
  { key: 'paddingY', field: 'pbPaddingY', label: 'Padding top and bottom', help: 'Makes the button taller or shorter.' },
  { key: 'paddingX', field: 'pbPaddingX', label: 'Padding left and right', help: 'Room beside the text on narrow screens.' },
  { key: 'radius', field: 'pbRadius', label: 'Corner rounding', help: '0 for square corners.' },
];

export const STYLE_PRESETS = [
  { name: 'Midnight', bg: '#111827', color: '#ffffff' },
  { name: 'Forest', bg: '#0c7a43', color: '#ffffff' },
  { name: 'Ocean', bg: '#1d4ed8', color: '#ffffff' },
  { name: 'Grape', bg: '#6d28d9', color: '#ffffff' },
  { name: 'Rose', bg: '#be185d', color: '#ffffff' },
  { name: 'Sunset', bg: '#c2410c', color: '#ffffff' },
  { name: 'Mint', bg: '#d1fae5', color: '#065f46' },
  { name: 'Sand', bg: '#fdf0d5', color: '#5c3d00' },
];
export const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

export function fullHex(hex) {
  if (!HEX.test(hex)) return '#000000';
  return hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex.toLowerCase();
}

// WCAG contrast ratio between two hex colours.
export function contrastRatio(a, b) {
  const lum = (hex) => {
    const h = fullHex(hex);
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(h.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

export const RADII = [
  { id: 'rounded', label: 'Rounded', r: 14 },
  { id: 'soft', label: 'Soft', r: 7 },
  { id: 'sharp', label: 'Sharp', r: 2 },
];

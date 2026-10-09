/**
 * BRIX product page payment selector (Pay Online / Cash on Delivery) and the
 * prepaid discount it advertises — pure helpers shared by the COD settings
 * sanitizer (cod.shared.js), the admin customizer + preview, the prepaid
 * discount sync (prepaid-discount-shopify.server.js) and the tests.
 * No DB, no network.
 *
 * Mirrored by:
 *   - php_backend/cod_storefront.php  cods_product_payment()  (storefront config)
 *   - extensions/cart-drawer/assets/brix_cod.js  Pay.*        (storefront UI + pricing)
 *
 * The product page only ever SHOWS the expected saving. The real discount is
 * the BRIX prepaid Discount Function (extensions/brix-prepaid-discount), which
 * reads its percentage from an app-owned metafield, never from the browser,
 * and gives nothing to a cart marked `_brixCod`.
 */

// Where the selector goes on the product page. 'app_block' = only inside the
// "Payment options" theme block ([data-brix-pay-slot]); any placement yields
// to that block when the merchant added it.
import { fillPriceTags, hasPriceTags, paymentPriceValues } from './price-tags.shared.js';

export const PAY_PLACEMENTS = [
  'below_price', 'below_variants', 'below_quantity', 'before_purchase_buttons', 'above_buy_now', 'below_add_to_cart', 'app_block',
];
export const PAY_CARD_LAYOUTS = ['horizontal', 'vertical'];
export const PAY_CARD_STYLES = ['border', 'filled', 'minimal'];
export const PAY_SELECTED_STYLES = ['border', 'background', 'radio_border'];
export const PAY_SPACINGS = ['small', 'medium', 'large'];
export const PAY_BANNER_PLACEMENTS = ['above_selector', 'in_online_card', 'below_price'];
export const PAY_METHODS = ['online', 'cod'];

export const PREPAID_PERCENT_MIN = 1;
export const PREPAID_PERCENT_MAX = 50;
export const PAY_RADIUS_MAX = 24;

// Max lengths for merchant text.
export const PAY_TEXT_LIMITS = Object.freeze({
  heading: 60,
  label: 40,
  description: 80,
  buttonText: 60,
  title: 40,
  offerTitle: 80,
  offerDescription: 120,
  minNotMetText: 100,
});

export const DEFAULT_PRODUCT_PAYMENT = Object.freeze({
  // Off until the merchant turns it on, so existing product pages (and the
  // existing product page COD button) stay exactly as they are.
  enabled: false,
  heading: 'Choose payment method', // '' = no heading
  defaultMethod: 'online',
  relabelBuyNow: true, // write "· Save 10%" on Shopify's own Buy it now button
  online: Object.freeze({
    enabled: true,
    label: 'Pay Online',
    description: 'Get instant savings',
    buttonText: 'Buy it now',
    showIcon: true,
  }),
  // The COD button's text is the existing settings.buttons.productText.
  cod: Object.freeze({
    enabled: true,
    label: 'Cash on Delivery',
    description: 'Pay when your order arrives',
    showIcon: true,
  }),
  prepaid: Object.freeze({
    enabled: false,
    percent: 10,
    title: 'Prepaid discount', // the discount's name in Shopify checkout
    minSubtotal: 0, // 0 = no minimum
    showBadge: true, // "Save 10%" badge on the card and the Buy button
    showSavingsAmount: true, // "(save ₹110)" next to the online price
    // {percent} {amount} {min} {price} are filled in for the shopper.
    offerTitle: '{percent}% off when you pay online',
    offerDescription: 'Pay online and save {amount}',
    minNotMetText: 'Get {percent}% off on orders above {min}',
  }),
  layout: Object.freeze({
    placement: 'before_purchase_buttons',
    cardLayout: 'horizontal', // phones always stack
    cardStyle: 'border',
    selectedStyle: 'radio_border',
    radius: 8,
    spacing: 'medium',
    showRadio: true,
    showIcons: true,
    showBanner: true,
    bannerPlacement: 'above_selector',
  }),
  appearance: Object.freeze({
    onlineColor: '#008060',
    codColor: '#111827',
    cardBackground: '#ffffff',
    borderColor: '#d1d5db',
    selectedBackground: '#f0fdf4',
    badgeBackground: '#008060',
    badgeText: '#ffffff',
  }),
});

export const PAY_HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function cleanText(value, fallback, max) {
  if (typeof value !== 'string') return fallback;
  // No control characters; the storefront escapes everything it shows.
  // eslint-disable-next-line no-control-regex
  const t = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return t || fallback;
}

const bool = (value, fallback) => (typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : fallback);
const pickEnum = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** A valid prepaid percentage (1–50, at most 2 decimals), else null. */
export function parsePrepaidPercent(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < PREPAID_PERCENT_MIN || n > PREPAID_PERCENT_MAX) return null;
  return round2(n);
}

/** A non-negative money amount (2 decimals), else null. '' / 0 = no minimum. */
export function parseMinSubtotal(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return round2(n);
}

/**
 * Merge a (possibly partial / untrusted) productPayment patch onto `base`,
 * returning a complete, valid object. Invalid values keep the base value.
 */
export function sanitizeProductPayment(patch, base = DEFAULT_PRODUCT_PAYMENT) {
  const d = DEFAULT_PRODUCT_PAYMENT;
  const b = base && typeof base === 'object' ? base : d;
  const p = patch && typeof patch === 'object' ? patch : {};
  const sub = (key) => ({ ...d[key], ...(b[key] && typeof b[key] === 'object' ? b[key] : {}) });
  const subPatch = (key) => (p[key] && typeof p[key] === 'object' ? p[key] : {});
  const L = PAY_TEXT_LIMITS;

  const online = sub('online');
  const po = subPatch('online');
  const outOnline = {
    enabled: bool(po.enabled, bool(online.enabled, true)),
    label: cleanText(po.label ?? online.label, d.online.label, L.label),
    description: cleanText(po.description ?? online.description, '', L.description),
    buttonText: cleanText(po.buttonText ?? online.buttonText, d.online.buttonText, L.buttonText),
    showIcon: bool(po.showIcon, bool(online.showIcon, true)),
  };

  const cod = sub('cod');
  const pc = subPatch('cod');
  const outCod = {
    enabled: bool(pc.enabled, bool(cod.enabled, true)),
    label: cleanText(pc.label ?? cod.label, d.cod.label, L.label),
    description: cleanText(pc.description ?? cod.description, '', L.description),
    showIcon: bool(pc.showIcon, bool(cod.showIcon, true)),
  };

  const prepaid = sub('prepaid');
  const pp = subPatch('prepaid');
  const basePercent = parsePrepaidPercent(prepaid.percent) ?? d.prepaid.percent;
  const baseMin = parseMinSubtotal(prepaid.minSubtotal) ?? 0;
  const outPrepaid = {
    enabled: bool(pp.enabled, bool(prepaid.enabled, false)),
    percent: 'percent' in pp ? (parsePrepaidPercent(pp.percent) ?? basePercent) : basePercent,
    title: cleanText(pp.title ?? prepaid.title, d.prepaid.title, L.title),
    minSubtotal: 'minSubtotal' in pp ? (parseMinSubtotal(pp.minSubtotal) ?? baseMin) : baseMin,
    showBadge: bool(pp.showBadge, bool(prepaid.showBadge, true)),
    showSavingsAmount: bool(pp.showSavingsAmount, bool(prepaid.showSavingsAmount, true)),
    offerTitle: cleanText(pp.offerTitle ?? prepaid.offerTitle, d.prepaid.offerTitle, L.offerTitle),
    offerDescription: cleanText(pp.offerDescription ?? prepaid.offerDescription, '', L.offerDescription),
    minNotMetText: cleanText(pp.minNotMetText ?? prepaid.minNotMetText, '', L.minNotMetText),
  };

  const layout = sub('layout');
  const pl = subPatch('layout');
  const radius = (value, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && value !== '' && value !== null ? Math.min(PAY_RADIUS_MAX, Math.max(0, n)) : fallback;
  };
  const baseRadius = radius(layout.radius, d.layout.radius);
  const outLayout = {
    placement: pickEnum(pl.placement, PAY_PLACEMENTS, pickEnum(layout.placement, PAY_PLACEMENTS, d.layout.placement)),
    cardLayout: pickEnum(pl.cardLayout, PAY_CARD_LAYOUTS, pickEnum(layout.cardLayout, PAY_CARD_LAYOUTS, d.layout.cardLayout)),
    cardStyle: pickEnum(pl.cardStyle, PAY_CARD_STYLES, pickEnum(layout.cardStyle, PAY_CARD_STYLES, d.layout.cardStyle)),
    selectedStyle: pickEnum(pl.selectedStyle, PAY_SELECTED_STYLES, pickEnum(layout.selectedStyle, PAY_SELECTED_STYLES, d.layout.selectedStyle)),
    radius: 'radius' in pl ? radius(pl.radius, baseRadius) : baseRadius,
    spacing: pickEnum(pl.spacing, PAY_SPACINGS, pickEnum(layout.spacing, PAY_SPACINGS, d.layout.spacing)),
    showRadio: bool(pl.showRadio, bool(layout.showRadio, true)),
    showIcons: bool(pl.showIcons, bool(layout.showIcons, true)),
    showBanner: bool(pl.showBanner, bool(layout.showBanner, true)),
    bannerPlacement: pickEnum(pl.bannerPlacement, PAY_BANNER_PLACEMENTS, pickEnum(layout.bannerPlacement, PAY_BANNER_PLACEMENTS, d.layout.bannerPlacement)),
  };

  const appearance = sub('appearance');
  const pa = subPatch('appearance');
  const outAppearance = {};
  for (const key of Object.keys(d.appearance)) {
    const fallback = PAY_HEX_RE.test(appearance[key] || '') ? appearance[key] : d.appearance[key];
    outAppearance[key] = PAY_HEX_RE.test(pa[key] || '') ? pa[key] : fallback;
  }

  return {
    enabled: bool(p.enabled, bool(b.enabled, false)),
    heading: 'heading' in p ? cleanText(p.heading, '', L.heading) : cleanText(b.heading ?? d.heading, '', L.heading),
    defaultMethod: pickEnum(p.defaultMethod, PAY_METHODS, pickEnum(b.defaultMethod, PAY_METHODS, 'online')),
    relabelBuyNow: bool(p.relabelBuyNow, bool(b.relabelBuyNow, true)),
    online: outOnline,
    cod: outCod,
    prepaid: outPrepaid,
    layout: outLayout,
    appearance: outAppearance,
  };
}

/**
 * Whether the prepaid discount should be live in Shopify checkout: the
 * selector is on, Pay Online is offered, the discount is on, and the plan
 * publishes BRIX COD (`cod_checkout`) to shoppers.
 */
export function prepaidDiscountLive(productPayment, planLive) {
  const pp = productPayment || {};
  return Boolean(planLive && pp.enabled && pp.online?.enabled && pp.prepaid?.enabled && parsePrepaidPercent(pp.prepaid.percent));
}

/**
 * What the shopper sees for one product line (unit price × quantity), as the
 * storefront computes it (brix_cod.js Pay.pricing mirrors this exactly).
 *   prepaid: { percent, minSubtotal } | null   (null = no verified prepaid offer)
 *   currencyMatches: the shopper's currency is the one the minimum is set in.
 *     With a minimum and another currency, no saving is promised (the Function
 *     can't compare them either).
 */
export function productPaymentPricing({ unitPrice, quantity = 1, prepaid = null, codFee = 0, currencyMatches = true }) {
  const qty = Math.max(1, Math.trunc(Number(quantity)) || 1);
  const subtotal = round2((Number(unitPrice) || 0) * qty);
  const percent = prepaid ? parsePrepaidPercent(prepaid.percent) : null;
  const min = prepaid ? Number(prepaid.minSubtotal) || 0 : 0;
  const minMet = min > 0 ? currencyMatches && subtotal >= min : true;
  const qualifies = Boolean(percent) && subtotal > 0 && minMet;
  const savings = qualifies ? round2((subtotal * percent) / 100) : 0;
  const fee = round2(codFee);
  return {
    subtotal,
    percent,
    qualifies,
    minMissing: Boolean(percent) && !minMet,
    savings,
    online: round2(subtotal - savings),
    cod: subtotal,
    codFee: fee,
    codTotal: round2(subtotal + fee),
  };
}

/** Fill {percent} {amount} {min} {price} in merchant text. */
export function fillPaymentText(template, { percent, amount, min, price }) {
  const pct = percent != null ? String(Number(percent)) : '';
  return String(template || '')
    .replace(/\{percent\}/g, pct)
    .replace(/\{amount\}/g, amount != null && amount !== '' ? amount : `${pct}%`)
    .replace(/\{min\}/g, min != null ? min : '')
    .replace(/\{price\}/g, price != null ? price : '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Save 10%" — the badge, and the suffix on the Buy button. */
export function savingsBadge(percent) {
  return `Save ${Number(percent)}%`;
}

/**
 * The online Buy button's text. Never stacks suffixes: always built from the
 * merchant's base text, never from what the button currently says. Text with
 * price tags ("Buy it now {prepaid_price} Prepaid") is filled in with `format`
 * and gets no "· Save 10%" suffix: the merchant wrote what it says.
 */
export function onlineButtonLabel(baseText, pricing, prepaid, format = String) {
  const base = String(baseText || DEFAULT_PRODUCT_PAYMENT.online.buttonText).trim();
  if (hasPriceTags(base)) return fillPriceTags(base, paymentPriceValues(pricing), format);
  if (!pricing?.qualifies || !prepaid?.showBadge) return base;
  return `${base} · ${savingsBadge(pricing.percent)}`;
}

/** Which payment cards show: { online, cod } — both false = no selector at all. */
export function visiblePaymentMethods(productPayment, { codAvailable }) {
  const pp = productPayment || {};
  return {
    online: Boolean(pp.enabled && pp.online?.enabled),
    cod: Boolean(pp.enabled && pp.cod?.enabled && codAvailable),
  };
}

/** The card selected when the page loads: the merchant's default when it is shown, else the other one. */
export function initialPaymentMethod(productPayment, visible) {
  const preferred = productPayment?.defaultMethod === 'cod' ? 'cod' : 'online';
  if (visible[preferred]) return preferred;
  if (visible.online) return 'online';
  if (visible.cod) return 'cod';
  return null;
}

// Card padding / gap per spacing setting, px.
export const PAY_SPACING_PX = Object.freeze({ small: 8, medium: 12, large: 16 });

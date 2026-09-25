/**
 * BRIX Packs — shared (client + server) domain logic.
 *
 * Everything here is pure (no I/O, no React) so the admin builder, the admin
 * list/detail pages, the storefront API and the tests all use the exact same
 * pricing, validation and customization rules. Derived prices are NEVER the
 * source of truth: they are recomputed from the live Shopify variant price
 * every time a Pack is read, previewed, saved or served to the storefront.
 */
import { formatMoney } from './currency.shared.js';

// ─── Constants ───────────────────────────────────────────────────────────────

// Template ids are stored in brix_packs.template — keep them stable.
export const PACK_TEMPLATES = [
  { id: 'same_variant', name: 'Same Variant', description: 'Shoppers pick a quantity of the selected variant. Simple list of offers.', preview: 'Buy 1 · Buy 2 · Buy 3', recommended: 'Best for repeat purchases' },
  { id: 'choose_each_item', name: 'Choose Each Item', description: 'Shoppers pick a real Shopify variant for every item in the Pack.', preview: 'M · S · L', recommended: 'Best for mix and match' },
  { id: 'visual_offer', name: 'Visual Offer', description: 'Large promotional cards with product image and prominent savings.', preview: 'BEST VALUE — Save 12%', recommended: 'Best for promotions' },
];
export const VALID_TEMPLATES = new Set(PACK_TEMPLATES.map((template) => template.id));
export const VALID_STATUSES = new Set(['draft', 'active', 'inactive', 'configuration_error']);
export const DISCOUNT_TYPES = ['none', 'percentage', 'fixed'];
export const MAX_TIERS = 6;
export const MAX_TIER_QUANTITY = 100;

// Line-item property names written by the storefront and read by the
// checkout discount function (extensions/brix-packs-discount).
export const PACK_LINE_PROPERTIES = {
  packId: '_brix_pack_id',
  quantity: '_brix_pack_quantity',
  version: '_brix_pack_version',
  group: '_brix_pack_group',
};

// ─── Shopify ID helpers ──────────────────────────────────────────────────────

const GID_RE = /^gid:\/\/shopify\/[A-Za-z]+\/(\d+)(?:\?.*)?$/;

/** "gid://shopify/Product/123" | 123 | "123" -> "123"; anything else -> null. */
export function toNumericId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return text;
  const match = GID_RE.exec(text);
  return match ? match[1] : null;
}

export function toGid(type, value) {
  const id = toNumericId(value);
  return id ? `gid://shopify/${type}/${id}` : null;
}

/** Exact comparison — 123 never matches 1123 (unlike String#endsWith). */
export function sameShopifyId(a, b) {
  const left = toNumericId(a);
  const right = toNumericId(b);
  return left !== null && right !== null && left === right;
}

// ─── Money ───────────────────────────────────────────────────────────────────

// Currencies Intl doesn't need to be asked about — fast path; anything else
// is resolved through Intl.NumberFormat so we honour ISO 4217 minor units.
export function currencyDecimals(currencyCode) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

export function roundMoney(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

// ─── Tier calculation (single authoritative implementation) ──────────────────

/**
 * Price a Pack tier given the unit price of every item in it. Works in integer
 * minor units so 0.1 + 0.2 style float drift can't leak into prices.
 *
 * Example: unitPrices = [80,80,80], 10% -> subtotal 240, discount 24,
 * price 216, savings 24, effectiveUnitPrice 72.
 */
export function calculateTierFromPrices(unitPrices, tier, decimals = 2) {
  const factor = 10 ** decimals;
  const quantity = Number(tier.quantity);
  const discountType = DISCOUNT_TYPES.includes(tier.discountType) ? tier.discountType : 'none';
  const discountValue = discountType === 'none' ? 0 : Number(tier.discountValue || 0);
  const subtotalMinor = unitPrices.reduce((sum, price) => sum + Math.round((Number(price) + Number.EPSILON) * factor), 0);
  let discountMinor = 0;
  if (discountType === 'percentage') discountMinor = Math.round((subtotalMinor * discountValue) / 100);
  else if (discountType === 'fixed') discountMinor = Math.round((discountValue + Number.EPSILON) * factor);
  discountMinor = Math.min(Math.max(discountMinor, 0), subtotalMinor);
  const priceMinor = subtotalMinor - discountMinor;
  return {
    quantity,
    discountType,
    discountValue,
    baseUnitPrice: unitPrices.length ? unitPrices[0] : 0,
    subtotal: subtotalMinor / factor,
    discountAmount: discountMinor / factor,
    price: priceMinor / factor,
    savings: discountMinor / factor,
    effectiveUnitPrice: quantity > 0 ? Math.round(priceMinor / quantity) / factor : 0,
  };
}

/** Price a tier for `quantity` copies of one variant, with formatted strings. */
export function calculateTier(basePrice, tier, { currencyCode = null, locale } = {}) {
  const decimals = currencyCode ? currencyDecimals(currencyCode) : 2;
  const quantity = Number(tier.quantity);
  const result = calculateTierFromPrices(Array.from({ length: Math.max(0, quantity) }, () => Number(basePrice)), tier, decimals);
  result.baseUnitPrice = Number(basePrice);
  if (!currencyCode) return result;
  const fmt = (value) => formatMoney(value, { currencyCode, locale });
  return {
    ...result,
    formatted: {
      baseUnitPrice: fmt(result.baseUnitPrice),
      subtotal: fmt(result.subtotal),
      discountAmount: fmt(result.discountAmount),
      price: fmt(result.price),
      savings: fmt(result.savings),
      effectiveUnitPrice: fmt(result.effectiveUnitPrice),
    },
  };
}

// ─── Tier normalisation + validation ─────────────────────────────────────────

/** Coerce raw (possibly string-typed, browser-submitted) tiers to a clean shape, sorted by quantity. */
export function normalizeTiers(rawTiers) {
  if (!Array.isArray(rawTiers)) return [];
  const tiers = rawTiers.map((tier) => {
    const quantity = Number(tier?.quantity);
    const discountType = DISCOUNT_TYPES.includes(tier?.discountType) ? tier.discountType : 'none';
    const discountValue = discountType === 'none' ? 0 : Number(tier?.discountValue === '' ? NaN : tier?.discountValue ?? 0);
    const badge = typeof tier?.badge === 'string' ? tier.badge.trim() : '';
    const name = typeof tier?.name === 'string' ? tier.name.trim() : '';
    return { name, quantity, discountType, discountValue, badge };
  });
  return tiers.sort((a, b) => (Number.isFinite(a.quantity) ? a.quantity : Infinity) - (Number.isFinite(b.quantity) ? b.quantity : Infinity));
}

/**
 * Validate tiers (already normalised or raw). Returns { valid, errors } where
 * each error is { index, field, message } — index null means "whole list".
 * Pass basePrice/currencyCode to also reject fixed discounts that would make
 * the Pack price negative.
 */
export function validateTiers(rawTiers, { basePrice = null, currencyCode = null } = {}) {
  const errors = [];
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) {
    return { valid: false, errors: [{ index: null, field: 'tiers', message: 'Add at least one Pack tier.' }] };
  }
  if (rawTiers.length > MAX_TIERS) errors.push({ index: null, field: 'tiers', message: `A Pack can have at most ${MAX_TIERS} tiers.` });
  const seen = new Set();
  let previous = -Infinity;
  rawTiers.forEach((tier, index) => {
    const quantity = Number(tier?.quantity);
    if (tier?.quantity === '' || tier?.quantity === null || tier?.quantity === undefined || !Number.isInteger(quantity) || quantity <= 0) {
      errors.push({ index, field: 'quantity', message: 'Quantity must be a positive whole number.' });
    } else if (quantity > MAX_TIER_QUANTITY) {
      errors.push({ index, field: 'quantity', message: `Quantity cannot exceed ${MAX_TIER_QUANTITY}.` });
    } else {
      if (seen.has(quantity)) errors.push({ index, field: 'quantity', message: 'Each tier needs a unique quantity.' });
      else if (quantity < previous) errors.push({ index, field: 'quantity', message: 'Tiers must be in ascending quantity order.' });
      seen.add(quantity);
      previous = Math.max(previous, quantity);
    }
    const discountType = tier?.discountType ?? 'none';
    if (!DISCOUNT_TYPES.includes(discountType)) {
      errors.push({ index, field: 'discountType', message: 'Choose a valid discount type.' });
      return;
    }
    if (discountType !== 'none') {
      const raw = tier?.discountValue;
      const value = Number(raw);
      if (raw === '' || raw === null || raw === undefined || !Number.isFinite(value)) {
        errors.push({ index, field: 'discountValue', message: 'Enter a discount value.' });
      } else if (value < 0) {
        errors.push({ index, field: 'discountValue', message: 'Discount cannot be negative.' });
      } else if (discountType === 'percentage' && (value <= 0 || value > 100)) {
        errors.push({ index, field: 'discountValue', message: 'Percentage must be greater than 0 and at most 100.' });
      } else if (discountType === 'fixed') {
        if (value <= 0) errors.push({ index, field: 'discountValue', message: 'Fixed discount must be greater than 0.' });
        else if (basePrice !== null && Number.isInteger(quantity) && quantity > 0) {
          const decimals = currencyCode ? currencyDecimals(currencyCode) : 2;
          if (Math.round(value * 10 ** decimals) > Math.round(Number(basePrice) * quantity * 10 ** decimals)) {
            errors.push({ index, field: 'discountValue', message: 'Fixed discount cannot be larger than the Pack subtotal.' });
          }
        }
      }
    }
    if (typeof tier?.badge === 'string' && tier.badge.trim().length > 24) errors.push({ index, field: 'badge', message: 'Badge text must be 24 characters or fewer.' });
    if (typeof tier?.name === 'string' && tier.name.trim().length > 60) errors.push({ index, field: 'name', message: 'Name must be 60 characters or fewer.' });
  });
  return { valid: errors.length === 0, errors };
}

// ─── Customization ───────────────────────────────────────────────────────────

// Only fields the storefront widget (app/routes/packs.js.jsx) actually renders
// live here — a control that has no rendering effect must not be saved.
export const DEFAULT_CUSTOMIZATION = {
  content: { heading: 'Choose Your Pack', subheading: 'Buy more and save more.', cta: 'Add Pack to Cart', promoText: '' },
  savings: { visible: true, mode: 'save_amount' },
  colors: { primary: '#008060', background: '#ffffff', cardBackground: '#ffffff', selectedCard: '#e6f4f1', border: '#dfe3e8', text: '#202223', price: '#202223', discount: '#008060', badge: '#fff4d6', button: '#008060', buttonText: '#ffffff' },
  borders: { radius: 8, width: 1, style: 'solid', shadow: false },
  typography: { headingSize: 20, packTitleSize: 15, priceSize: 18, descriptionSize: 13, fontWeight: 600, alignment: 'left' },
  spacing: { cardPadding: 16, cardGap: 10, sectionSpacing: 20, buttonSpacing: 16 },
  images: { enabled: true, size: 'medium', position: 'top' },
};

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const str = (max) => ({ type: 'string', max });
const num = (min, max) => ({ type: 'number', min, max });
const oneOf = (...values) => ({ type: 'enum', values });
const bool = () => ({ type: 'boolean' });
const color = () => ({ type: 'color' });

export const CUSTOMIZATION_SCHEMA = {
  content: { heading: str(80), subheading: str(160), cta: str(40), promoText: str(160) },
  savings: { visible: bool(), mode: oneOf('save_amount', 'save_percent') },
  colors: Object.fromEntries(Object.keys(DEFAULT_CUSTOMIZATION.colors).map((key) => [key, color()])),
  borders: { radius: num(0, 32), width: num(0, 6), style: oneOf('solid', 'dashed', 'dotted'), shadow: bool() },
  typography: { headingSize: num(12, 40), packTitleSize: num(11, 28), priceSize: num(12, 36), descriptionSize: num(10, 24), fontWeight: oneOf(400, 500, 600, 700), alignment: oneOf('left', 'center', 'right') },
  spacing: { cardPadding: num(4, 40), cardGap: num(0, 32), sectionSpacing: num(0, 60), buttonSpacing: num(0, 40) },
  images: { enabled: bool(), size: oneOf('small', 'medium', 'large'), position: oneOf('top', 'left') },
};

export function defaultCustomization() {
  return JSON.parse(JSON.stringify(DEFAULT_CUSTOMIZATION));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a (possibly partial) customization object against the schema.
 * Unknown groups/keys are dropped; wrong types / out-of-range values are
 * reported. Returns { value, errors } where `value` only contains valid fields.
 */
export function sanitizeCustomization(input) {
  const errors = [];
  const value = {};
  if (input === undefined || input === null) return { value, errors };
  if (!isPlainObject(input)) return { value, errors: ['Customization must be an object.'] };
  for (const [group, fields] of Object.entries(CUSTOMIZATION_SCHEMA)) {
    if (input[group] === undefined) continue;
    if (!isPlainObject(input[group])) { errors.push(`Customization "${group}" must be an object.`); continue; }
    for (const [key, rule] of Object.entries(fields)) {
      const raw = input[group][key];
      if (raw === undefined) continue;
      const label = `${group}.${key}`;
      let parsed;
      if (rule.type === 'string') {
        if (typeof raw !== 'string') { errors.push(`${label} must be text.`); continue; }
        if (raw.length > rule.max) { errors.push(`${label} must be ${rule.max} characters or fewer.`); continue; }
        parsed = raw;
      } else if (rule.type === 'color') {
        if (typeof raw !== 'string' || !HEX.test(raw.trim())) { errors.push(`${label} must be a hex color like #008060.`); continue; }
        parsed = raw.trim();
      } else if (rule.type === 'number') {
        const n = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
        if (!Number.isFinite(n) || n < rule.min || n > rule.max) { errors.push(`${label} must be between ${rule.min} and ${rule.max}.`); continue; }
        parsed = n;
      } else if (rule.type === 'boolean') {
        if (typeof raw !== 'boolean') { errors.push(`${label} must be true or false.`); continue; }
        parsed = raw;
      } else if (rule.type === 'enum') {
        const candidate = typeof rule.values[0] === 'number' ? Number(raw) : raw;
        if (!rule.values.includes(candidate)) { errors.push(`${label} must be one of: ${rule.values.join(', ')}.`); continue; }
        parsed = candidate;
      }
      value[group] = value[group] || {};
      value[group][key] = parsed;
    }
  }
  return { value, errors };
}

/**
 * Deep-merge customization layers group by group, key by key. Later layers
 * override earlier ones only for keys they actually contain, so changing the
 * colors never drops typography/spacing/etc. Always starts from the defaults.
 */
export function mergeCustomization(...layers) {
  const merged = defaultCustomization();
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    for (const group of Object.keys(CUSTOMIZATION_SCHEMA)) {
      if (!isPlainObject(layer[group])) continue;
      for (const key of Object.keys(CUSTOMIZATION_SCHEMA[group])) {
        if (layer[group][key] !== undefined) merged[group][key] = layer[group][key];
      }
    }
  }
  return merged;
}

// ─── Misc display helpers ────────────────────────────────────────────────────

export function tierLabel(tier) {
  return tier.name || `Buy ${tier.quantity}`;
}

/** "Buy 1 – Buy 3 · save up to 10%" style one-liner for list pages. */
export function summarizeTiers(tiers, calc) {
  if (!tiers?.length) return 'No tiers';
  const percents = tiers.filter((tier) => tier.discountType === 'percentage').map((tier) => Number(tier.discountValue));
  const best = calc?.length ? Math.max(...calc.map((item) => item.subtotal > 0 ? (item.savings / item.subtotal) * 100 : 0)) : Math.max(0, ...percents);
  const range = tiers.length > 1 ? `${tiers[0].quantity}–${tiers[tiers.length - 1].quantity} items` : `${tiers[0].quantity} item${tiers[0].quantity === 1 ? '' : 's'}`;
  return best > 0 ? `${range} · save up to ${Math.round(best * 10) / 10}%` : range;
}

// ─── Plan gating ─────────────────────────────────────────────────────────────

/**
 * Decide the status a save may actually persist. `requested` comes from the
 * browser and is only a request: activating needs planState === 'enabled'
 * (the shop's real plan, resolved server-side). 'keep' preserves the stored
 * status, but an already-active Pack on a shop that has since lost the plan is
 * parked as 'inactive' instead of silently staying live.
 * Returns { status } or { error: 'invalid_status' | 'plan_restricted' }.
 */
export function resolveSaveStatus({ requested, existingStatus = null, planState }) {
  if (!['draft', 'active', 'keep'].includes(requested)) return { error: 'invalid_status' };
  let status = requested === 'keep' ? (existingStatus || 'draft') : requested;
  if (status === 'active' && planState !== 'enabled') {
    if (requested === 'active') return { error: 'plan_restricted' };
    status = 'inactive';
  }
  return { status };
}

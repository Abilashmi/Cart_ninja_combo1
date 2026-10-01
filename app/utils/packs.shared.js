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
// Customer-facing Pack types. `template` (stored) stays the source of truth
// for rendering/behavior family: Standard = same_variant (or visual_offer,
// its image-card layout), Mix & Match = choose_each_item. `pack_type` (also
// stored, see below) is the authoritative merchant-facing axis the Pack
// belongs to a *product* on — same_variant vs mix_match — and always keeps
// `template` in sync: mix_match forces template='choose_each_item'.
export const PACK_TYPES = [
  { id: 'same_variant', name: 'Same Variant', templates: ['same_variant', 'visual_offer'], defaultTemplate: 'same_variant', description: 'Customer buys multiple quantities of the same selected variant.', example: 'Black / Medium × 3' },
  { id: 'mix_match', name: 'Mix & Match', templates: ['choose_each_item'], defaultTemplate: 'choose_each_item', description: 'Customer can combine different variants in one Pack.', example: 'Black / Medium + White / Small + Blue / Medium' },
];
export const VALID_PACK_TYPES = new Set(PACK_TYPES.map((type) => type.id));
export const packTypeOf = (template) => PACK_TYPES.find((type) => type.templates.includes(template)) || PACK_TYPES[0];

// A Pack belongs to a Shopify product first, then declares which of that
// product's variants it applies to: every variant ('all'), or a merchant-
// curated subset ('selected'). Replaces the old "exactly one variant" model.
export const VARIANT_SCOPES = ['all', 'selected'];
export const VALID_VARIANT_SCOPES = new Set(VARIANT_SCOPES);

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

// ─── Variant coverage (pack_type + variant_scope + allowed_variant_ids) ───────

/** Coerce a raw (browser-submitted) list of variant ids to a deduped numeric-string array. */
export function normalizeVariantIds(rawIds) {
  if (!Array.isArray(rawIds)) return [];
  const seen = new Set();
  for (const raw of rawIds) {
    const id = toNumericId(raw);
    if (id) seen.add(id);
  }
  return [...seen];
}

/**
 * Validate how a Pack covers its product's variants, given the product's
 * REAL variant ids (from Shopify — never trust the browser's own list).
 * Returns { valid, errors, allowedVariantIds } where allowedVariantIds is the
 * normalised, product-scoped list to persist ('all' scope stores [] — it is
 * resolved against the live variant list on every read instead of a snapshot
 * that would silently go stale when the merchant adds a new variant).
 */
export function validateVariantCoverage({ packType, variantScope, allowedVariantIds }, productVariantIds) {
  const errors = [];
  if (!VALID_PACK_TYPES.has(packType)) errors.push({ field: 'packType', message: 'Choose a valid Pack type.' });
  if (!VALID_VARIANT_SCOPES.has(variantScope)) errors.push({ field: 'variantScope', message: 'Choose a valid variant scope.' });
  if (errors.length) return { valid: false, errors, allowedVariantIds: [] };

  const productIds = new Set(productVariantIds.map((id) => toNumericId(id)).filter(Boolean));
  if (variantScope === 'all') {
    if (productIds.size === 0) errors.push({ field: 'variantScope', message: 'This product has no variants to apply the Pack to.' });
    return { valid: errors.length === 0, errors, allowedVariantIds: [] };
  }

  const requested = normalizeVariantIds(allowedVariantIds);
  const foreign = requested.filter((id) => !productIds.has(id));
  if (foreign.length) errors.push({ field: 'allowedVariantIds', message: 'One or more selected variants do not belong to this product.' });
  const owned = requested.filter((id) => productIds.has(id));
  if (owned.length === 0) {
    errors.push({ field: 'allowedVariantIds', message: packType === 'mix_match' ? 'Select at least one variant customers can choose from.' : 'Select at least one variant this Pack applies to.' });
  }
  return { valid: errors.length === 0, errors, allowedVariantIds: owned };
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
  // showBuyNow: the widget's own Buy Now button (checks out only the Pack, in a
  // cart of its own). While it's on, the theme's Buy it now button is hidden.
  content: { heading: 'Choose Your Pack', subheading: 'Buy more and save more.', cta: 'Add Pack to Cart', promoText: '', buyNow: 'Buy Now', showBuyNow: true },
  savings: { visible: true, mode: 'save_amount', label: 'Save' },
  colors: { primary: '#008060', background: '#ffffff', cardBackground: '#ffffff', selectedCard: '#e6f4f1', border: '#dfe3e8', text: '#202223', price: '#202223', discount: '#008060', badge: '#fff4d6', button: '#008060', buttonText: '#ffffff' },
  borders: { radius: 8, width: 1, style: 'solid', shadow: false },
  typography: { headingSize: 20, packTitleSize: 15, priceSize: 18, descriptionSize: 13, fontWeight: 600, alignment: 'left' },
  spacing: { cardPadding: 18, cardGap: 12, sectionSpacing: 20, buttonSpacing: 16 },
  // Add to Cart + Buy Now buttons. Add to Cart's fill/text stay colors.button /
  // colors.buttonText. Packs saved before this group existed get it derived
  // from their colors (see mergeCustomization), so their look doesn't change.
  buttons: {
    layout: 'side_by_side', order: 'add_first', radius: 8, fontSize: 15, fontWeight: 700, paddingY: 13, borderWidth: 2, uppercase: false,
    addBorder: '#008060', buyNowBackground: '#ffffff', buyNowText: '#008060', buyNowBorder: '#008060',
  },
  images: { enabled: true, size: 'medium', position: 'top' },
  design: { preset: 'stacked' },
  // Where the storefront widget sits: right below the product price, or in a
  // "BRIX Packs position" app block the merchant places in the theme editor.
  placement: { position: 'below_price' },
};

// Layout presets. Each id is a structurally different layout, rendered by
// PackPreview.jsx and packs_widget.js (see their layoutOf): 'tabs' = pack tabs
// over one panel, 'stacked' = one card of rows where the chosen row opens its
// pickers, 'visual' = pack tabs + one photo picker per item. `style` only
// nudges shape/spacing to suit the layout — never colors, so switching layouts
// keeps the merchant's palette (content, savings and Pack behaviour are never
// touched either).
export const PACK_DESIGNS = [
  { id: 'tabs', name: 'Pack tabs', description: 'Packs side by side as tabs; the chosen pack’s variants and price show below.', style: {
    borders: { radius: 10 }, spacing: { cardPadding: 14, cardGap: 8 } } },
  { id: 'stacked', name: 'Stacked packs', description: 'Packs stacked in one card; the chosen pack opens to pick its variants.', style: {
    borders: { radius: 10 } } },
  { id: 'visual', name: 'Visual picker', description: 'One picker per item with the variant photo — made for Mix & Match.', style: {
    borders: { radius: 12 }, spacing: { cardPadding: 16, cardGap: 10 } } },
];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const str = (max) => ({ type: 'string', max });
const num = (min, max) => ({ type: 'number', min, max });
const oneOf = (...values) => ({ type: 'enum', values });
const bool = () => ({ type: 'boolean' });
const color = () => ({ type: 'color' });

export const CUSTOMIZATION_SCHEMA = {
  content: { heading: str(80), subheading: str(160), cta: str(40), promoText: str(160), buyNow: str(40), showBuyNow: bool() },
  savings: { visible: bool(), mode: oneOf('save_amount', 'save_percent'), label: str(24) },
  colors: Object.fromEntries(Object.keys(DEFAULT_CUSTOMIZATION.colors).map((key) => [key, color()])),
  borders: { radius: num(0, 32), width: num(0, 6), style: oneOf('solid', 'dashed', 'dotted'), shadow: bool() },
  typography: { headingSize: num(12, 40), packTitleSize: num(11, 28), priceSize: num(12, 36), descriptionSize: num(10, 24), fontWeight: oneOf(400, 500, 600, 700), alignment: oneOf('left', 'center', 'right') },
  spacing: { cardPadding: num(4, 40), cardGap: num(0, 32), sectionSpacing: num(0, 60), buttonSpacing: num(0, 40) },
  buttons: {
    layout: oneOf('side_by_side', 'stacked'), order: oneOf('add_first', 'buy_first'), radius: num(0, 40), fontSize: num(11, 24), fontWeight: oneOf(400, 500, 600, 700),
    paddingY: num(6, 24), borderWidth: num(0, 4), uppercase: bool(), addBorder: color(), buyNowBackground: color(), buyNowText: color(), buyNowBorder: color(),
  },
  images: { enabled: bool(), size: oneOf('small', 'medium', 'large'), position: oneOf('top', 'left') },
  design: { preset: oneOf(...PACK_DESIGNS.map((design) => design.id)) },
  placement: { position: oneOf('below_price', 'custom') },
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
// Layouts that were removed, mapped to their closest current layout so Packs
// saved with them keep working (also mirrored in packs_widget.js layoutOf,
// which reads raw saved customization from the PHP endpoint).
export const LEGACY_DESIGN_MAP = { classic: 'stacked', highlight: 'tabs', premium: 'tabs' };
// Placements that were removed (next to the buy buttons) now show below the price.
const LEGACY_PLACEMENTS = new Set(['above_buttons', 'below_buttons']);

export function sanitizeCustomization(input) {
  const errors = [];
  const value = {};
  if (input === undefined || input === null) return { value, errors };
  if (!isPlainObject(input)) return { value, errors: ['Customization must be an object.'] };
  const legacy = isPlainObject(input.design) && LEGACY_DESIGN_MAP[input.design.preset];
  if (legacy) input = { ...input, design: { ...input.design, preset: legacy } };
  if (isPlainObject(input.placement) && LEGACY_PLACEMENTS.has(input.placement.position)) input = { ...input, placement: { ...input.placement, position: 'below_price' } };
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
  let hasButtons = false;
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    if (isPlainObject(layer.buttons)) hasButtons = true;
    for (const group of Object.keys(CUSTOMIZATION_SCHEMA)) {
      if (!isPlainObject(layer[group])) continue;
      for (const key of Object.keys(CUSTOMIZATION_SCHEMA[group])) {
        if (layer[group][key] !== undefined) merged[group][key] = layer[group][key];
      }
    }
  }
  if (!hasButtons) merged.buttons = { ...merged.buttons, ...legacyButtonColors(merged) };
  return merged;
}

// Saved before the `buttons` group existed: Buy Now was an outline in the
// Add to Cart color on the card background, both using the card corner radius.
// Mirrored in packs_widget.js buttonVars (it reads raw saved customization).
function legacyButtonColors(custom) {
  const button = custom.colors.button;
  return { addBorder: button, buyNowBackground: custom.colors.cardBackground, buyNowText: button, buyNowBorder: button, radius: custom.borders.radius };
}

/**
 * Restyle `customization` with a design preset: colors/borders/typography/spacing/buttons
 * reset to defaults + the preset's style; content, savings and images are kept.
 * Also serves as "Reset to default" for the styling groups.
 */
export function applyDesign(customization, designId) {
  const design = PACK_DESIGNS.find((item) => item.id === designId) || PACK_DESIGNS[0];
  const current = mergeCustomization(customization);
  const next = { ...current, design: { preset: design.id } };
  for (const group of ['colors', 'borders', 'typography', 'spacing', 'buttons']) {
    next[group] = { ...DEFAULT_CUSTOMIZATION[group], ...(design.style[group] || {}) };
  }
  return next;
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

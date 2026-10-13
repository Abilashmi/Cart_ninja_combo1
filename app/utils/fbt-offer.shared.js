// FBT "buy all together" offer: which rules carry an offer, the config the
// checkout Function trusts (extensions/brix-fbt-discount), and the text the
// widget shows. Pure, so it is unit-tested (tests/fbt-offer).
//
// The offer applies when the cart holds the product being viewed (one of
// the rule's trigger products) AND every recommended product of that rule;
// then one unit of each gets the discount. A rule shown on every product
// page (no trigger products) needs only its recommended products.
//
// Widget offer: fbt_widget_settings.offer_* (all rules, manual and AI).
// Per rule (manual rules): fbt_rules.offer_mode = widget (default) | none |
// percentage | fixed_amount, with offer_value.

export const FBT_OFFER_TYPES = ['percentage', 'fixed_amount'];
export const FBT_RULE_OFFER_MODES = ['widget', 'none', 'percentage', 'fixed_amount'];
export const FBT_OFFER_TEXT_DEFAULT = 'Buy all {count} together and save {discount}';
export const FBT_OFFER_MAX_PERCENT = 90;
export const FBT_OFFER_MAX_PRODUCTS = 10;
// Shopify passes the metafield to the Function; keep it well under its size limit.
export const FBT_OFFER_CONFIG_MAX_BYTES = 9000;

export const DEFAULT_FBT_OFFER = Object.freeze({
  enabled: false,
  type: 'percentage',
  value: 10,
  text: FBT_OFFER_TEXT_DEFAULT,
});

function numericId(value) {
  const m = /(\d+)$/.exec(String(value ?? ''));
  return m ? m[1] : null;
}

function cleanValue(type, value) {
  const n = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(n) || n <= 0) return null;
  if (type === 'percentage') return Math.min(n, FBT_OFFER_MAX_PERCENT);
  return Math.min(n, 1_000_000);
}

/** The widget offer from a settings row / form patch, always valid. */
export function sanitizeFbtOffer(raw = {}, base = DEFAULT_FBT_OFFER) {
  const type = FBT_OFFER_TYPES.includes(raw.type) ? raw.type : base.type;
  const value = cleanValue(type, raw.value ?? base.value) ?? cleanValue(type, base.value) ?? 10;
  const text = String(raw.text ?? base.text ?? '').replace(/[<>]/g, '').trim().slice(0, 120) || FBT_OFFER_TEXT_DEFAULT;
  return { enabled: raw.enabled === undefined ? Boolean(base.enabled) : Boolean(Number(raw.enabled) || raw.enabled === true), type, value, text };
}

/** A rule's own offer setting, always valid. */
export function sanitizeRuleOffer(mode, value) {
  const m = FBT_RULE_OFFER_MODES.includes(mode) ? mode : 'widget';
  if (m === 'percentage' || m === 'fixed_amount') {
    const v = cleanValue(m, value);
    return v ? { mode: m, value: v } : { mode: 'widget', value: 0 };
  }
  return { mode: m, value: 0 };
}

/** { type, value } a rule really offers, or null. rule: { offerMode, offerValue }. */
export function effectiveOffer(rule, widgetOffer) {
  const own = sanitizeRuleOffer(rule?.offerMode, rule?.offerValue);
  if (own.mode === 'none') return null;
  if (own.mode === 'percentage' || own.mode === 'fixed_amount') return { type: own.mode, value: own.value };
  return widgetOffer?.enabled ? { type: widgetOffer.type, value: widgetOffer.value } : null;
}

/**
 * The Function config: one set per rule with an offer.
 * rules: [{ id, displayScope, triggerProducts: [{id}], fbtProducts: [{id}], offerMode, offerValue }]
 * Returns { config, included: [ruleId], skipped: [{ id, reason }] }.
 * config = { version: 1, currency, sets: [{ id, t: [productId], o: [productId], k: 'p'|'f', v }] }
 */
export function buildFbtOfferConfig(widgetOffer, rules, currency = null) {
  const config = { version: 1, currency: currency || null, sets: [] };
  const included = [];
  const skipped = [];
  let size = JSON.stringify(config).length;
  for (const rule of rules || []) {
    const offer = effectiveOffer(rule, widgetOffer);
    if (!offer) continue;
    const id = String(rule.id);
    const all = rule.displayScope === 'all';
    const t = all ? [] : [...new Set((rule.triggerProducts || []).map((p) => numericId(p?.id ?? p)).filter(Boolean))];
    const o = [...new Set((rule.fbtProducts || []).map((p) => numericId(p?.id ?? p)).filter(Boolean))].filter((x) => !t.includes(x));
    if (!o.length) { skipped.push({ id, reason: 'no_products' }); continue; }
    if (!all && !t.length) { skipped.push({ id, reason: 'no_trigger' }); continue; }
    if (o.length > FBT_OFFER_MAX_PRODUCTS) { skipped.push({ id, reason: 'too_many_products' }); continue; }
    const set = { id, t, o, k: offer.type === 'percentage' ? 'p' : 'f', v: offer.value };
    const add = JSON.stringify(set).length + 1;
    if (size + add > FBT_OFFER_CONFIG_MAX_BYTES) { skipped.push({ id, reason: 'too_big' }); continue; }
    config.sets.push(set);
    size += add;
    included.push(id);
  }
  return { config, included, skipped };
}

/** "10%" or "₹100". */
export function formatOfferDiscount(offer, symbol = '') {
  if (!offer) return '';
  if (offer.type === 'percentage') return `${Number(offer.value)}%`;
  const v = Number(offer.value);
  return `${symbol}${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

/** The widget text with {count} (products incl. the one viewed) and {discount}. */
export function fbtOfferText(text, { count, offer, symbol = '' }) {
  return String(text || FBT_OFFER_TEXT_DEFAULT)
    .replace(/\{\{?\s*count\s*\}?\}/g, String(count))
    .replace(/\{\{?\s*discount\s*\}?\}/g, formatOfferDiscount(offer, symbol));
}

/**
 * The storefront condition (fbt_widget.condition) with each rule's live
 * offer: { type, value, text } on rules in `liveIds` (sets the Function
 * really has, discount verified ACTIVE), removed from every other rule.
 */
export function withConditionOffers(condition, rulesById, widgetOffer, liveIds) {
  const live = new Set((liveIds || []).map(String));
  return (Array.isArray(condition) ? condition : []).map((entry) => {
    const rest = { ...(entry || {}) };
    delete rest.offer;
    const id = String(entry?.id ?? '');
    const rule = rulesById.get(id);
    const offer = live.has(id) && rule ? effectiveOffer(rule, widgetOffer) : null;
    return offer ? { ...rest, offer: { ...offer, text: widgetOffer?.text || FBT_OFFER_TEXT_DEFAULT } } : rest;
  });
}

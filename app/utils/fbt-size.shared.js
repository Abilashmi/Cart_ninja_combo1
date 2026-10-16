// FBT "Match the shopper's size" (AI-Powered mode): the size picked on the
// product page decides which size of each recommended product is offered,
// and products without that size in stock are hidden (or marked). Pure, so
// it is unit-tested (tests/fbt-offer/fbt-size.test.mjs); the storefront
// widget (extensions/cart-drawer/assets/fbt_widget_render.js) carries the
// same functions (ES5), keep the two in step.

// Option names treated as the size when the merchant names none.
const SIZE_NAME_RE = /size|age|year|yrs/i;

/**
 * Which option (0-2) is the size: the merchant's option name when given,
 * else the first named like Size / Age / Years. -1 = none (no matching).
 */
export function sizeOptionIndex(optionNames, preferred = '') {
  const names = (optionNames || []).map((n) => String(typeof n === 'string' ? n : n?.name || '').trim());
  const want = String(preferred || '').trim().toLowerCase();
  if (want) return names.findIndex((n) => n.toLowerCase() === want);
  return names.findIndex((n) => SIZE_NAME_RE.test(n));
}

/**
 * A size value, comparable across spellings: "12 Years", "12Y", "12 yrs",
 * "11-12 Y" → { lo, hi, unit: 'y' }; "6-12 Months", "6M" → unit 'm';
 * no number ("M", "XL", "Free size") → { text }.
 */
export function parseSize(value) {
  const s = String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length) return { text: s.replace(/[^a-z0-9]/g, '') };
  const unit = /\d\s*(m|mo|mos|mon|mth|mths|month|months)\b/.test(s) || /\bmonths?\b/.test(s) ? 'm'
    : /\d\s*(y|yr|yrs|year|years)\b/.test(s) || /\b(years?|yrs?)\b/.test(s) ? 'y' : '';
  return { lo: Math.min(...nums), hi: Math.max(...nums), unit };
}

/** 2 = the same size, 1 = overlapping ("11-12 Y" holds 12 Years), 0 = no. */
export function sizeScore(a, b) {
  if (!a || !b) return 0;
  if (a.text != null || b.text != null) return a.text != null && a.text === b.text ? 2 : 0;
  if (a.unit && b.unit && a.unit !== b.unit) return 0;
  if (a.lo === b.lo && a.hi === b.hi) return 2;
  return a.lo <= b.hi && b.lo <= a.hi ? 1 : 0;
}

/**
 * The variant of a recommended product for the shopper's size.
 *   product: { optionNames, variants: [{ id, available, opts: [o1, o2, o3] }], liveVariantId }
 *   pageSize: the size value picked on the page ("12 Years")
 * Returns { status: 'match', variant } (in stock, closest size; same other
 * options as the product's default when possible), { status: 'missing' }
 * (has sizes, none in stock for this one) or { status: 'none' } (no size option: leave it).
 */
export function pickSizeVariant(product, pageSize, preferredName = '') {
  const idx = sizeOptionIndex(product?.optionNames, preferredName);
  const want = parseSize(pageSize);
  if (idx < 0 || !want) return { status: 'none' };
  const variants = product.variants || [];
  const base = variants.find((v) => v.id === product.liveVariantId) || null;
  let best = null;
  let bestScore = 0;
  for (const v of variants) {
    if (!v.available) continue;
    let score = sizeScore(parseSize(v.opts?.[idx]), want) * 10;
    if (!score) continue;
    // Same colour / style as the product's default, when there is one.
    if (base) for (let i = 0; i < 3; i++) if (i !== idx && (v.opts?.[i] ?? null) === (base.opts?.[i] ?? null)) score += 1;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best ? { status: 'match', variant: best } : { status: 'missing' };
}

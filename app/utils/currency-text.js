// Forces currency symbols in AI-composed text to the store's own currency.
//
// The model drifts to whatever symbol its prompt examples or the merchant's own
// wording used (e.g. "₹3,000" on a USD store). This is the deterministic
// backstop, applied both to what BRIX says and to text it is about to save
// (milestone descriptions, announcements), so the wrong symbol can't reach the
// merchant or the storefront. Only unambiguous symbols are touched, and only
// when a digit follows — never letters like "R"/"kr" that appear inside words.
import { getCurrencySymbol } from './currency.shared';

// symbol -> whether it is unambiguous enough to swap on sight
const FOREIGN_SYMBOLS = ['₹', '€', '£', '¥', '₩', '₺', '₽', '฿', '₱', '₫', '₦', '₨', '৳', '﷼'];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const AMOUNT_AHEAD = String.raw`(?=\s?\d)`;

export function localizeCurrencySymbols(text, { symbol, code } = {}) {
  if (typeof text !== 'string' || !text) return text;
  const target = symbol || getCurrencySymbol(code);
  if (!target) return text;
  const out = target + (/[A-Za-z]$/.test(target) ? ' ' : '');
  const swap = (re) => { text = text.replace(re, () => out); };

  for (const s of FOREIGN_SYMBOLS) {
    if (s !== target) swap(new RegExp(`${escapeRe(s)}\\s?${AMOUNT_AHEAD}`, 'g'));
  }
  // A bare "$" (or prefixed one like A$/US$) on a store whose currency isn't a dollar currency.
  if (!target.endsWith('$')) swap(new RegExp(`(?<![A-Za-z$])(?:[A-Z]{1,2})?\\$\\s?${AMOUNT_AHEAD}`, 'g'));
  return text;
}

// Same, recursively over an object/array of tool arguments (strings only —
// numbers, booleans and keys are left exactly as they are).
export function localizeCurrencyDeep(value, opts) {
  if (typeof value === 'string') return localizeCurrencySymbols(value, opts);
  if (Array.isArray(value)) return value.map((v) => localizeCurrencyDeep(v, opts));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localizeCurrencyDeep(v, opts)]));
  }
  return value;
}

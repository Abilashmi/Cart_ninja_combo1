// Partial COD: the shopper pays a small advance online in Shopify's own
// checkout and the rest on delivery. Shared by the admin page, the server
// (services/partial-cod.server.js) and, as plain numbers, the storefront
// popup (extensions/cart-drawer/assets/brix_cod.js partialSplit).
//
// How it works: BRIX makes a one-time Shopify discount code worth the order
// total minus the advance, so Shopify checkout charges only the advance. When
// the order comes in (orders/create), BRIX adds the balance back to the order
// as a "Balance payable on delivery" line, so Shopify shows it as Partially
// paid, and tags it partial-cod.

export const PARTIAL_COD_MODES = ['fixed', 'percent'];
export const PARTIAL_COD_LIMITS = Object.freeze({ amount: [1, 100000], percent: [1, 90] });
export const PARTIAL_COD_CODE_PREFIX = 'BRIX-PARTIAL-COD';
// Cart attribute on the Shopify checkout of a Partial COD order. The BRIX
// payment customization (extensions/brix-partial-cod-payment) hides Cash on
// Delivery while it is set, so the advance is always paid online.
export const PARTIAL_COD_ATTRIBUTE = '_brix_partial_cod';
export const PARTIAL_COD_TAGS = ['partial-cod', 'BRIX-COD'];
export const PARTIAL_COD_BALANCE_TITLE = 'Balance payable on delivery';

export const DEFAULT_PARTIAL_COD = Object.freeze({
  enabled: false,
  mode: 'fixed', // fixed: `amount` (₹) | percent: `percent` % of the order total
  amount: 50,
  percent: 10,
  // Offered only for order totals in this range (0 = no limit).
  minOrder: 0,
  maxOrder: 0,
  // Only part payment: where Partial COD is offered, full Cash on Delivery
  // isn't (the popup shows only Part payment, the server refuses a full COD
  // order). Orders outside the range above keep normal COD.
  only: false,
});

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 100) / 100));
}

function money(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : fallback;
}

export function sanitizePartialCod(patch, base = DEFAULT_PARTIAL_COD) {
  const b = { ...DEFAULT_PARTIAL_COD, ...(base && typeof base === 'object' ? base : {}) };
  const p = patch && typeof patch === 'object' ? patch : {};
  const has = (key) => Object.prototype.hasOwnProperty.call(p, key);
  const out = {
    enabled: has('enabled') ? Boolean(p.enabled) : Boolean(b.enabled),
    mode: PARTIAL_COD_MODES.includes(has('mode') ? p.mode : b.mode) ? (has('mode') ? p.mode : b.mode) : 'fixed',
    amount: num(has('amount') ? p.amount : b.amount, DEFAULT_PARTIAL_COD.amount, ...PARTIAL_COD_LIMITS.amount),
    percent: num(has('percent') ? p.percent : b.percent, DEFAULT_PARTIAL_COD.percent, ...PARTIAL_COD_LIMITS.percent),
    minOrder: money(has('minOrder') ? p.minOrder : b.minOrder, 0),
    maxOrder: money(has('maxOrder') ? p.maxOrder : b.maxOrder, 0),
    only: has('only') ? Boolean(p.only) : Boolean(b.only),
  };
  if (out.maxOrder > 0 && out.maxOrder < out.minOrder) out.maxOrder = out.minOrder;
  return out;
}

/**
 * The advance and the balance for an order `total` (shop currency), or null
 * when Partial COD isn't on offer for it: switched off, outside the order
 * range, or an advance that would cover the whole order. The advance is in
 * whole rupees (a percentage rounds up), at least ₹1.
 */
export function partialCodSplit(config, total) {
  const cfg = config && typeof config === 'object' ? config : null;
  const t = Number(total);
  if (!cfg || !cfg.enabled || !Number.isFinite(t) || t <= 0) return null;
  if (Number(cfg.minOrder) > 0 && t < Number(cfg.minOrder)) return null;
  if (Number(cfg.maxOrder) > 0 && t > Number(cfg.maxOrder)) return null;
  const raw = cfg.mode === 'percent' ? (t * Number(cfg.percent)) / 100 : Number(cfg.amount);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const advance = Math.max(1, Math.ceil(raw - 1e-9));
  if (advance >= t) return null;
  return { advance, balance: Math.round((t - advance) * 100) / 100 };
}

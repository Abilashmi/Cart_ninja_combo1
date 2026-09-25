import { formatMoney } from './currency.shared';

// formatMoney, but a whole amount drops its ".00" ("$3,000.00" -> "$3,000").
// Only the trailing two-digit decimal part is removed, never a thousands group
// ("3,000" must not become "3").
const TRAILING_ZERO_DECIMALS_RE = /[.,]00(?=\D*$)/;

export function formatMoneyWhole(value, options) {
  const out = formatMoney(value, options);
  return Number.isInteger(Number(value)) ? out.replace(TRAILING_ZERO_DECIMALS_RE, '') : out;
}

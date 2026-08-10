import React from 'react';
import { formatMoney as formatMoneyShared, getLocaleForCurrency } from '../utils/currency.shared';

/**
 * CurrencyContext provides currency symbol, code, locale and a bound
 * formatMoney() to all components — the one central money formatter
 * (Intl.NumberFormat under the hood, see currency.shared.js).
 */
const DEFAULTS = { symbol: '$', code: 'USD', locale: 'en-US' };

const CurrencyContext = React.createContext({
  ...DEFAULTS,
  formatMoney: (amount) => formatMoneyShared(amount, { currencyCode: DEFAULTS.code, locale: DEFAULTS.locale }),
});

export const useCurrency = () => {
  const context = React.useContext(CurrencyContext);
  if (!context) {
    console.warn('[Currency] useCurrency called outside of CurrencyProvider, using defaults');
    return { ...DEFAULTS, formatMoney: (amount) => formatMoneyShared(amount, { currencyCode: DEFAULTS.code, locale: DEFAULTS.locale }) };
  }
  return context;
};

export const CurrencyProvider = ({ children, symbol = '$', code = 'USD', locale }) => {
  const effectiveLocale = locale || getLocaleForCurrency(code);
  const value = {
    symbol,
    code,
    locale: effectiveLocale,
    formatMoney: (amount) => formatMoneyShared(amount, { currencyCode: code, locale: effectiveLocale }),
  };
  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
};

export default CurrencyContext;

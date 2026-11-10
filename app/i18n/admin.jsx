/* eslint-disable react/prop-types -- internal component props; JS codebase does not use PropTypes */
/**
 * Admin text in the merchant's language (Account → Language). app.jsx's
 * loader picks the language and sends that language's admin.* texts with
 * English filled in (app/i18n/admin.server.js); pages call useT():
 *   const t = useT();  t('admin.nav.home')  t('admin.home.orders', { count: 3 })
 * A key missing everywhere shows the key itself, so tests catch it
 * (tests/i18n/admin.test.mjs checks every t('admin…') used exists in en.json).
 */
import { createContext, useContext, useMemo } from 'react';
import { createTranslator } from './i18n.shared.js';

const EMPTY = { locale: 'en', t: (key) => String(key) };
const I18nContext = createContext(EMPTY);

export function I18nProvider({ locale, messages, children }) {
  const value = useMemo(() => ({ locale: locale || 'en', t: createTranslator([messages || {}], locale || 'en') }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** t(key, vars) for the admin's language. */
export function useT() {
  return useContext(I18nContext).t;
}

/** The admin's language code ('en', 'hi', …), e.g. for dates and numbers. */
export function useAdminLocale() {
  return useContext(I18nContext).locale;
}

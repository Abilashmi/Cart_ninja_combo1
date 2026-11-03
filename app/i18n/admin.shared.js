// Admin language rules shared by the server (admin.server.js) and the tests:
// which languages the admin offers and which one a merchant gets.
import { BETA_LOCALES, DEFAULT_LOCALE, LOCALES } from './config.js';
import { normalizeLocale, baseLanguage } from './i18n.shared.js';

// Beta languages (right-to-left Arabic) stay out of the admin until checked there too.
export const ADMIN_LOCALES = LOCALES.filter((l) => !BETA_LOCALES.includes(l));
export const ADMIN_LANGUAGE_CHOICES = ['auto', ...ADMIN_LOCALES];

// Each language's own name, shown in the picker whatever the admin's language.
export const LANGUAGE_NAMES = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', es: 'Español', ar: 'العربية' };

export const isAdminKey = (key) => key.startsWith('admin.') || key.startsWith('error.admin.');

/** The admin's language: the saved choice, else Shopify's admin language when BRIX has it, else English. */
export function resolveAdminLocale({ saved, shopifyLocale } = {}) {
  if (saved && saved !== 'auto' && ADMIN_LOCALES.includes(saved)) return saved;
  const asked = baseLanguage(normalizeLocale(shopifyLocale || ''));
  return ADMIN_LOCALES.includes(asked) ? asked : DEFAULT_LOCALE;
}

/** One language's admin texts from full catalogues ({ en: {...}, hi: {...} }), English filling any gap. */
export function pickAdminMessages(catalogs, locale) {
  const only = (cat) => Object.fromEntries(Object.entries(cat || {}).filter(([k]) => isAdminKey(k)));
  const en = only(catalogs[DEFAULT_LOCALE]);
  return locale === DEFAULT_LOCALE ? en : { ...en, ...only(catalogs[locale]) };
}

// Which languages BRIX has catalogues for. `en` is the only hand-written file;
// every other locale is AI-drafted into app/i18n/locales/<locale>.json and
// tracked in app/i18n/meta/<locale>.json until a person reviews it.
export const DEFAULT_LOCALE = 'en';

// Launch set. Arabic is beta until the right-to-left browser checks pass and
// a native reviewer signs off.
export const LOCALES = ['en', 'hi', 'ta', 'es', 'ar'];
export const BETA_LOCALES = ['ar'];

// Keys must start with one of these.
export const KEY_NAMESPACES = ['storefront.', 'admin.', 'error.', 'server.'];

// Keys whose translated text may contain "<" (none yet). Everything else is
// plain text, so a "<" in a translation fails validation.
export const HTML_ALLOWED_KEYS = [];

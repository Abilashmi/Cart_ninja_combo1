/**
 * Language of the BRIX admin (app/i18n/admin.jsx draws it).
 *
 * The merchant picks it on Account → Language: one of ADMIN_LOCALES, or
 * 'auto' = the language Shopify's admin is in (the `locale` query parameter
 * Shopify adds when it loads the app), English when BRIX doesn't have it.
 * Shopify's admin has no Hindi or Tamil, so those are only reachable by
 * picking them here. Kept like price display: an app-data metafield on the
 * app installation (brix.language = { admin }).
 */
import en from './en.json';
import hi from './locales/hi.json';
import ta from './locales/ta.json';
import es from './locales/es.json';
import ar from './locales/ar.json';
import { ADMIN_LANGUAGE_CHOICES, pickAdminMessages } from './admin.shared.js';

export { ADMIN_LOCALES, ADMIN_LANGUAGE_CHOICES, LANGUAGE_NAMES, resolveAdminLocale } from './admin.shared.js';

export const LANGUAGE_NAMESPACE = 'brix';
export const LANGUAGE_KEY = 'language';

const CATALOGS = { en, hi, ta, es, ar };
const messageCache = new Map();

/** Admin texts for one language, English filled in for any key it lacks. */
export function adminMessages(locale) {
  if (!messageCache.has(locale)) messageCache.set(locale, pickAdminMessages(CATALOGS, locale));
  return messageCache.get(locale);
}

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await res.json();
  if (json?.errors && (Array.isArray(json.errors) ? json.errors.length : true)) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

/** The saved choice ('auto' when never set or unreadable). */
export async function getAdminLanguage(admin) {
  try {
    const data = await gql(admin, `#graphql
      query BrixLanguage {
        currentAppInstallation { metafield(namespace: "${LANGUAGE_NAMESPACE}", key: "${LANGUAGE_KEY}") { jsonValue } }
      }`);
    const value = data?.currentAppInstallation?.metafield?.jsonValue?.admin;
    return ADMIN_LANGUAGE_CHOICES.includes(value) ? value : 'auto';
  } catch (error) {
    console.error('[admin-language] read failed:', String(error?.message || error).slice(0, 200));
    return 'auto';
  }
}

/** Saves the choice; throws when Shopify refuses it or the value isn't a choice. */
export async function saveAdminLanguage(admin, value) {
  if (!ADMIN_LANGUAGE_CHOICES.includes(value)) throw new Error('Unknown language.');
  const owner = await gql(admin, '#graphql\nquery BrixInstallationId { currentAppInstallation { id } }');
  const data = await gql(admin, `#graphql
    mutation BrixLanguageSave($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }`, {
    metafields: [{
      ownerId: owner.currentAppInstallation.id,
      namespace: LANGUAGE_NAMESPACE,
      key: LANGUAGE_KEY,
      type: 'json',
      value: JSON.stringify({ admin: value }),
    }],
  });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors[0].message);
  return value;
}

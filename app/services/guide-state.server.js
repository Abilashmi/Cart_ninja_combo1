/**
 * Guided setup progress for one store (utils/guide.shared.js describes the
 * state). Kept like Account → Language and Price display: an app-data
 * metafield on the app installation (brix.onboarding), read and written with
 * the merchant's own admin session, so a store only ever reaches its own
 * state and no database table is needed. Never written for a store that
 * doesn't use the guide.
 */
import { applyGuidePatch, sanitizeGuideState } from '../utils/guide.shared.js';

export const GUIDE_NAMESPACE = 'brix';
export const GUIDE_KEY = 'onboarding';

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await res.json();
  if (json?.errors && (Array.isArray(json.errors) ? json.errors.length : true)) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

async function readRaw(admin) {
  const data = await gql(admin, `#graphql
    query BrixGuideState {
      currentAppInstallation { id metafield(namespace: "${GUIDE_NAMESPACE}", key: "${GUIDE_KEY}") { jsonValue } }
    }`);
  const install = data?.currentAppInstallation;
  if (!install?.id) throw new Error('App installation not found.');
  const value = install.metafield?.jsonValue;
  return { ownerId: install.id, value: value && typeof value === 'object' ? value : null };
}

/** The saved state, or null when the store never saved one (or it can't be read). */
export async function getGuideState(admin) {
  try {
    const { value } = await readRaw(admin);
    return value ? sanitizeGuideState(value) : null;
  } catch (error) {
    console.error('[guide-state] read failed:', String(error?.message || error).slice(0, 200));
    return null;
  }
}

/**
 * Applies `patch` (an object, or a function of the saved state returning one)
 * onto the saved state and saves the result; returns it. Throws when the
 * state can't be read (so a patch never overwrites progress it didn't see)
 * or Shopify refuses the write. `trusted` = the server's own check that a
 * feature is set up (only then can a tour become "completed").
 */
export async function saveGuidePatch(admin, patch, { trusted = false, now = new Date() } = {}) {
  const { ownerId, value } = await readRaw(admin);
  const resolved = typeof patch === 'function' ? patch(sanitizeGuideState(value)) : patch;
  const next = applyGuidePatch(value, resolved, { trusted, now });
  const data = await gql(admin, `#graphql
    mutation BrixGuideSave($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }`, {
    metafields: [{ ownerId, namespace: GUIDE_NAMESPACE, key: GUIDE_KEY, type: 'json', value: JSON.stringify(next) }],
  });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors[0].message);
  return next;
}

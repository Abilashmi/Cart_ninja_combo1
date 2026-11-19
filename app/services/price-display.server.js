/**
 * Store-wide display settings for every BRIX widget on the storefront (cart
 * drawer, COD buttons, FBT, Coupon Banner, Packs, combo pages):
 * - `wholePrices` = show prices as whole amounts (₹595, not ₹594.70). Display
 *   only: checkout and BRIX COD orders charge the exact price, and the COD
 *   popup's bill stays exact.
 * - `font` = one font for all of them ('' = the theme's own font, the
 *   default), from the list in utils/brix-font.shared.js; saved with its
 *   Google query and CSS stack for snippets/brix-font.liquid.
 *
 * Kept in an app-data metafield (on the app installation), which theme app
 * extension Liquid reads directly as app.metafields.brix.display — the app
 * embed and the FBT / Packs blocks print wholePrices as
 * window.__brixWholePrices and render brix-font with it, so no storefront
 * request is needed. Each save keeps the other setting.
 */
import { sanitizeBrixFont } from '../utils/brix-font.shared.js';

export const PRICE_DISPLAY_NAMESPACE = 'brix';
export const PRICE_DISPLAY_KEY = 'display';

async function gql(admin, query, variables) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await res.json();
  if (json?.errors && (Array.isArray(json.errors) ? json.errors.length : true)) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  }
  return json.data;
}

function clean(value) {
  return { wholePrices: value?.wholePrices === true, font: sanitizeBrixFont(value?.font).font };
}

async function readDisplay(admin) {
  const data = await gql(admin, `#graphql
    query BrixPriceDisplay {
      currentAppInstallation { metafield(namespace: "${PRICE_DISPLAY_NAMESPACE}", key: "${PRICE_DISPLAY_KEY}") { jsonValue } }
    }`);
  return clean(data?.currentAppInstallation?.metafield?.jsonValue);
}

/** { wholePrices, font } — off / theme font when never set or unreadable. */
export async function getPriceDisplay(admin) {
  try {
    return await readDisplay(admin);
  } catch (error) {
    console.error('[price-display] read failed:', String(error?.message || error).slice(0, 200));
    return clean(null);
  }
}

/**
 * Saves what the patch has ({ wholePrices } and / or { font }), keeping the
 * other saved setting; throws when Shopify refuses it. A font not on the list
 * = the theme's font.
 */
export async function savePriceDisplay(admin, patch = {}) {
  // Unreadable = refuse: saving one setting must never reset the other.
  const current = await readDisplay(admin);
  const next = clean({
    wholePrices: 'wholePrices' in patch ? patch.wholePrices : current.wholePrices,
    font: 'font' in patch ? patch.font : current.font,
  });
  const owner = await gql(admin, '#graphql\nquery BrixInstallationId { currentAppInstallation { id } }');
  const data = await gql(admin, `#graphql
    mutation BrixPriceDisplaySave($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message code } }
    }`, {
    metafields: [{
      ownerId: owner.currentAppInstallation.id,
      namespace: PRICE_DISPLAY_NAMESPACE,
      key: PRICE_DISPLAY_KEY,
      type: 'json',
      value: JSON.stringify({ wholePrices: next.wholePrices, ...sanitizeBrixFont(next.font) }),
    }],
  });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors[0].message);
  return next;
}

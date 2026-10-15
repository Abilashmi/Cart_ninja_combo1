/**
 * Store-wide price display for every BRIX widget on the storefront (cart
 * drawer, COD buttons, FBT, Packs, combo pages): `wholePrices` = show prices
 * as whole amounts (₹595, not ₹594.70). Display only: checkout and BRIX COD
 * orders charge the exact price, and the COD popup's bill stays exact.
 *
 * Kept in an app-data metafield (on the app installation), which theme app
 * extension Liquid reads directly as app.metafields.brix.display — the app
 * embed and the FBT / Packs blocks print it as window.__brixWholePrices, so
 * no storefront request is needed.
 */
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

/** { wholePrices } — false when never set or unreadable. */
export async function getPriceDisplay(admin) {
  try {
    const data = await gql(admin, `#graphql
      query BrixPriceDisplay {
        currentAppInstallation { metafield(namespace: "${PRICE_DISPLAY_NAMESPACE}", key: "${PRICE_DISPLAY_KEY}") { jsonValue } }
      }`);
    const value = data?.currentAppInstallation?.metafield?.jsonValue;
    return { wholePrices: value?.wholePrices === true };
  } catch (error) {
    console.error('[price-display] read failed:', String(error?.message || error).slice(0, 200));
    return { wholePrices: false };
  }
}

/** Saves the setting; throws when Shopify refuses it. */
export async function savePriceDisplay(admin, { wholePrices }) {
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
      value: JSON.stringify({ wholePrices: wholePrices === true }),
    }],
  });
  const errors = data?.metafieldsSet?.userErrors || [];
  if (errors.length) throw new Error(errors[0].message);
  return { wholePrices: wholePrices === true };
}

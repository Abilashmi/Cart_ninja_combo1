import { authenticate } from '../shopify.server';
import { resolveCollectionIds } from '../services/combo-weight-shopify.server';
import { comboCollectionHandles, normalizeWeightPricing, toGrams } from '../utils/combo-weight.shared.js';

/**
 * POST /api/combo-weight-audit  { config }  (the builder's current combo config)
 * → { success, checked, missing: [{ productId, variantId, title, variantTitle, adminUrl }], truncated }
 *
 * Lists the variants of a weight combo's qualifying products that have no
 * Shopify weight — those don't count toward the box (and can't unlock a tier),
 * so the merchant can fix them before shoppers notice.
 */
const PAGE = 50;
const MAX_PRODUCTS_PER_COLLECTION = 250;

const VARIANT_FIELDS = 'id title inventoryItem { measurement { weight { value unit } } }';

const numeric = (gid) => String(gid || '').split('/').pop();

function collectMissing(product, out, seen) {
  if (!product?.id || seen.has(product.id)) return 0;
  seen.add(product.id);
  let checked = 0;
  for (const variant of product.variants?.nodes || []) {
    checked += 1;
    const weight = variant.inventoryItem?.measurement?.weight;
    if (toGrams(weight?.value, weight?.unit)) continue;
    out.push({
      productId: product.id,
      variantId: variant.id,
      title: product.title,
      variantTitle: variant.title && variant.title !== 'Default Title' ? variant.title : '',
      adminUrl: `shopify://admin/products/${numeric(product.id)}/variants/${numeric(variant.id)}`,
    });
  }
  return checked;
}

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const config = body?.config && typeof body.config === 'object' ? body.config : {};
  const { value: pricing } = normalizeWeightPricing(config.weight_pricing);

  try {
    let collectionIds = [];
    let productIds = [];
    if (pricing.qualify.mode === 'selected') {
      collectionIds = pricing.qualify.collection_ids;
      productIds = pricing.qualify.product_ids;
    } else {
      collectionIds = Object.values(await resolveCollectionIds(admin, comboCollectionHandles(config)));
    }

    const missing = [];
    const seen = new Set();
    let checked = 0;
    let truncated = false;

    for (const collectionId of collectionIds) {
      let after = null;
      let fetched = 0;
      for (;;) {
        const res = await admin.graphql(`#graphql
          query ComboWeightAuditCollection($id: ID!, $after: String) {
            collection(id: $id) {
              products(first: ${PAGE}, after: $after) {
                pageInfo { hasNextPage endCursor }
                nodes { id title variants(first: 25) { nodes { ${VARIANT_FIELDS} } } }
              }
            }
          }`, { variables: { id: collectionId, after } });
        const json = await res.json();
        const products = json.data?.collection?.products;
        for (const product of products?.nodes || []) checked += collectMissing(product, missing, seen);
        fetched += products?.nodes?.length || 0;
        if (!products?.pageInfo?.hasNextPage) break;
        if (fetched >= MAX_PRODUCTS_PER_COLLECTION) { truncated = true; break; }
        after = products.pageInfo.endCursor;
      }
    }

    for (let start = 0; start < productIds.length; start += PAGE) {
      const res = await admin.graphql(`#graphql
        query ComboWeightAuditProducts($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Product { id title variants(first: 25) { nodes { ${VARIANT_FIELDS} } } } }
        }`, { variables: { ids: productIds.slice(start, start + PAGE) } });
      const json = await res.json();
      for (const product of json.data?.nodes || []) checked += collectMissing(product, missing, seen);
    }

    return Response.json({ success: true, checked, missing, truncated });
  } catch (error) {
    console.error('[combo-weight-audit] failed:', String(error?.message || error).slice(0, 200));
    return Response.json({ success: false, error: 'Could not check product weights. Please try again.' }, { status: 502 });
  }
}

export function loader() {
  return Response.json({ success: false, error: 'POST only.' }, { status: 405 });
}

import { authenticate } from '../shopify.server';
import { toGrams } from '../utils/combo-weight.shared.js';

// Variants (with Shopify weights) let the builder preview add real variants
// and price weight-priced boxes (The Weight Box / weight pricing).
const PRODUCT_FRAGMENT = `
  fragment ProductInfo on Product {
    id
    title
    handle
    featuredImage { url altText width height }
    priceRangeV2 { minVariantPrice { amount currencyCode } }
    variants(first: 10) { nodes { id title price availableForSale image { url } inventoryItem { measurement { weight { value unit } } } } }
  }
`;

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const singleHandle = url.searchParams.get('handle');
  const handlesParam = url.searchParams.get('handles');

  // Single handle: return flat array (used by preview fetcher)
  if (singleHandle) {
    try {
      const res = await admin.graphql(`
        query GetCollectionByHandle($handle: String!) {
          collectionByHandle(handle: $handle) {
            products(first: 50) {
              edges {
                node { ...ProductInfo }
              }
            }
          }
        }
        ${PRODUCT_FRAGMENT}
      `, { variables: { handle: singleHandle } });

      const json = await res.json();
      const collection = json.data?.collectionByHandle;
      const edges = collection?.products?.edges || [];
      const products = edges.map(edge => formatProduct(edge.node));
      return Response.json(products);
    } catch (err) {
      console.error(`[api.products] Error:`, err);
      return Response.json([]);
    }
  }

  // Multiple handles: return object keyed by handle (used by step fetcher)
  const handles = handlesParam ? handlesParam.split(',').map(s => s.trim()).filter(Boolean) : [];

  if (handles.length === 0) {
    return Response.json({});
  }

  const result = {};
  for (const h of handles) {
    try {
      const res = await admin.graphql(`
        query GetCollectionByHandle($handle: String!) {
          collectionByHandle(handle: $handle) {
            products(first: 50) {
              edges {
                node { ...ProductInfo }
              }
            }
          }
        }
        ${PRODUCT_FRAGMENT}
      `, { variables: { handle: h } });

      const json = await res.json();
      const collection = json.data?.collectionByHandle;
      const edges = collection?.products?.edges || [];
      result[h] = edges.map(edge => formatProduct(edge.node));
    } catch (err) {
      console.error(`[api.products] Error fetching "${h}":`, err);
      result[h] = [];
    }
  }

  return Response.json(result);
}

function formatProduct(node) {
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    image: node.featuredImage ? {
      url: node.featuredImage.url,
      altText: node.featuredImage.altText,
      width: node.featuredImage.width,
      height: node.featuredImage.height,
    } : null,
    price: node.priceRangeV2?.minVariantPrice?.amount || '0.00',
    currency: node.priceRangeV2?.minVariantPrice?.currencyCode || 'USD',
    variants: (node.variants?.nodes || []).map((v) => ({
      id: v.id,
      title: v.title,
      price: v.price,
      available: v.availableForSale !== false,
      image: v.image ? { src: v.image.url } : null,
      grams: toGrams(v.inventoryItem?.measurement?.weight?.value, v.inventoryItem?.measurement?.weight?.unit),
    })),
  };
}

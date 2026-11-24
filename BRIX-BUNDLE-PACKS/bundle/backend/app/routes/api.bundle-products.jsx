import { authenticate } from '../shopify.server';

const PRODUCT_FRAGMENT = `
  fragment ProductInfo on Product {
    id
    title
    handle
    featuredImage { url altText width height }
    priceRangeV2 { minVariantPrice { amount currencyCode } }
  }
`;

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const collectionIdsParam = url.searchParams.get('collectionIds');

  if (!collectionIdsParam) {
    return Response.json({ success: true, products: [] });
  }

  const collectionIds = collectionIdsParam.split(',').map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const products = [];

  for (const collectionId of collectionIds) {
    try {
      let cursor = null;
      let hasNextPage = true;

      while (hasNextPage) {
        const query = `
          query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
            collection(id: $id) {
              products(first: $first, after: $after) {
                edges {
                  cursor
                  node { ...ProductInfo }
                }
                pageInfo { hasNextPage }
              }
            }
          }
          ${PRODUCT_FRAGMENT}
        `;

        const res = await admin.graphql(query, {
          variables: {
            id: collectionId.startsWith('gid://') ? collectionId : `gid://shopify/Collection/${collectionId}`,
            first: 50,
            after: cursor,
          },
        });

        const json = await res.json();
        const collection = json.data?.collection;
        if (!collection) break;

        const edges = collection.products?.edges || [];
        for (const edge of edges) {
          const p = edge.node;
          const gid = p.id;
          if (seen.has(gid)) continue;
          seen.add(gid);
          products.push({
            id: gid,
            title: p.title,
            handle: p.handle,
            image: p.featuredImage ? {
              url: p.featuredImage.url,
              altText: p.featuredImage.altText,
              width: p.featuredImage.width,
              height: p.featuredImage.height,
            } : null,
            price: p.priceRangeV2?.minVariantPrice?.amount || '0.00',
            currency: p.priceRangeV2?.minVariantPrice?.currencyCode || 'USD',
          });
        }

        cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
        hasNextPage = collection.products?.pageInfo?.hasNextPage && cursor != null;
      }
    } catch (err) {
      console.error(`[bundle-products] Error fetching collection ${collectionId}:`, err);
    }
  }

  return Response.json({ success: true, products });
}

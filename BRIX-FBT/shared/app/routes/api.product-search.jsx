import { authenticate } from '../shopify.server';

// Product search for the admin's "select products" modals (reward products,
// upsell and FBT rules). Those modals used to filter only the first 50
// products of the store, so on a big catalogue (4000+ products) most
// products could never be found or picked.
//   GET ?q=<words>  active products matching every word (prefix match), by relevance
//   GET ?ids=<gid,gid>  those products (picked earlier, outside the first 50)
// Products come back in the editor catalogue's shape.

const MAX_RESULTS = 50;
const MAX_IDS = 100;

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  featuredImage { url }
  variants(first: 25) { nodes { id title price compareAtPrice availableForSale } }
`;

function toProduct(node) {
  const variants = (node.variants?.nodes || []).map((v) => ({ id: v.id, title: v.title, price: v.price, compareAtPrice: v.compareAtPrice || null, available: v.availableForSale !== false }));
  // Like the storefront drawer: the first in-stock variant is the default.
  const pick = variants.find((v) => v.available) || variants[0];
  return {
    id: node.id,
    title: node.title,
    // The FBT rules keep each product's handle (the widget loads it by handle).
    handle: node.handle,
    image: node.featuredImage?.url || '',
    price: pick?.price || '0.00',
    compareAtPrice: pick?.compareAtPrice || null,
    variants,
    available: variants.length ? variants.some((v) => v.available) : true,
    status: node.status || 'ACTIVE',
  };
}

// The shopper-facing words only: Shopify's search syntax characters
// (field:value, quotes, brackets, wildcards) are dropped so a title such as
// "Snowboard: Hydrogen" can't turn into a different query.
export function searchQuery(text) {
  const words = String(text || '').replace(/[:()"'\\*<>{}[\]]/g, ' ').split(/\s+/).filter(Boolean)
    .filter((w) => !/^(AND|OR|NOT)$/i.test(w)).slice(0, 8);
  return words.length ? `(${words.join(' ')}) status:active` : '';
}

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const ids = String(url.searchParams.get('ids') || '').split(',').map((s) => s.trim())
    .filter((id) => /^gid:\/\/shopify\/Product\/\d+$/.test(id)).slice(0, MAX_IDS);
  const query = searchQuery(url.searchParams.get('q'));

  try {
    if (ids.length) {
      const res = await admin.graphql(`#graphql
        query BrixProductsByIds($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { ${PRODUCT_FIELDS} } } }`, { variables: { ids } });
      const json = await res.json();
      return Response.json({ success: true, products: (json.data?.nodes || []).filter((n) => n?.id).map(toProduct) });
    }
    if (!query) return Response.json({ success: true, products: [] });
    const res = await admin.graphql(`#graphql
      query BrixProductSearch($query: String!, $first: Int!) {
        products(first: $first, query: $query, sortKey: RELEVANCE) { nodes { ${PRODUCT_FIELDS} } }
      }`, { variables: { query, first: MAX_RESULTS } });
    const json = await res.json();
    return Response.json({ success: true, products: (json.data?.products?.nodes || []).map(toProduct) });
  } catch (error) {
    console.error('[api.product-search] failed:', String(error?.message || error).slice(0, 300));
    return Response.json({ success: false, products: [] }, { status: 502 });
  }
}

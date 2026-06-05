import { authenticate } from '../shopify.server';
import CartEditorPage from '../components/CartEditorPage';

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const [discountQuery, productsQuery] = await Promise.all([
    admin.graphql(`
      query DiscountList {
        discountNodes(first: 100, reverse: true) {
          edges {
            node {
              id
              discount {
                ... on DiscountCodeBasic {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                }
                ... on DiscountCodeBxgy {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                }
                ... on DiscountCodeFreeShipping {
                  title
                  codes(first: 1) { edges { node { code } } }
                  status
                }
              }
            }
          }
        }
      }
    `),
    admin.graphql(`
      query getProducts {
        products(first: 50) {
          edges {
            node {
              id
              title
              featuredImage { url }
              variants(first: 1) {
                edges {
                  node { price }
                }
              }
            }
          }
        }
      }
    `),
  ]);

  const discountJson = await discountQuery.json();
  const productsJson = await productsQuery.json();

  const coupons = (discountJson.data?.discountNodes?.edges || [])
    .map(({ node }) => {
      const d = node.discount;
      if (!d) return null;
      const code = d.codes?.edges?.[0]?.node?.code || '';
      if (!code) return null;
      return {
        id: node.id,
        code,
        title: d.title || code,
        status: d.status || 'ACTIVE',
      };
    })
    .filter(Boolean)
    .filter((c) => c.status === 'ACTIVE');

  const allProducts = productsJson.data?.products?.edges?.map(({ node }) => ({
    id: node.id,
    title: node.title,
    image: node.featuredImage?.url || "",
    price: node.variants.edges[0]?.node?.price || "0.00",
  })) || [];

  return { coupons, allProducts };
};

export default CartEditorPage;

import { authenticate } from '../shopify.server';
import CartEditorPage from '../components/CartEditorPage';

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const query = `
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
  `;

  try {
    const response = await admin.graphql(query);
    const json = await response.json();

    const coupons = (json.data?.discountNodes?.edges || [])
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

    return { coupons };
  } catch {
    return { coupons: [] };
  }
};

export default CartEditorPage;

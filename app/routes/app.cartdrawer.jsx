import { authenticate } from '../shopify.server';
import CartEditorPage from '../components/CartEditorPage';
import { fetchCartDrawerRecord, persistCartDrawerRecord, truthyFlag } from '../services/ai-agent-actions.server';

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  const [discountQuery, productsQuery, cartRecord] = await Promise.all([
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
    fetchCartDrawerRecord(session.shop),
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

  const drawerEnabled = cartRecord
    ? truthyFlag(cartRecord.cartStatus ?? cartRecord.cart_status)
    : true;

  return { coupons, allProducts, drawerEnabled };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  if (body?.intent === 'toggleDrawerStatus') {
    const enabled = Boolean(body?.enabled);
    const record = (await fetchCartDrawerRecord(shop)) || {};
    record.cartStatus = enabled ? 1 : 0;
    record.cart_status = enabled ? 1 : 0;
    const synced = await persistCartDrawerRecord(shop, record);
    return Response.json({ intent: 'toggleDrawerStatus', success: true, drawerEnabled: enabled, synced });
  }

  return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
};

export default CartEditorPage;

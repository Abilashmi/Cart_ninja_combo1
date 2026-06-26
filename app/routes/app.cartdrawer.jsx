import { authenticate } from '../shopify.server';
import CartEditorPage from '../components/CartEditorPage';
import { fetchCartDrawerRecord, persistCartDrawerRecord, truthyFlag } from '../services/cart-drawer-record.server';
import { getDb } from '../services/db.server';

const PHP_BASE = process.env.PHP_BASE_URL || 'https://int.thecartninja.com';

async function phpGet(endpoint, shop) {
  try {
    const res = await fetch(
      `${PHP_BASE}/${endpoint}?shop=${encodeURIComponent(shop)}`,
      { headers: { 'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '' } }
    );
    const json = await res.json();
    return json?.status === 'success' ? json.data : null;
  } catch {
    return null;
  }
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const db = getDb();

  const [discountQuery, productsQuery, cartRecord, configRows, pbRecord, csRecord, upsellRecord] = await Promise.all([
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
    fetchCartDrawerRecord(shop),
    db.execute('SELECT * FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1', [shop])
      .then(([rows]) => rows[0] || null)
      .catch(() => null),
    phpGet('progress_bar.php', shop),
    phpGet('coupon_slider_settings.php', shop),
    phpGet('upsell_settings.php', shop),
  ]);

  console.log('[loader] shop:', shop);
  console.log('[loader] csRecord:', JSON.stringify(csRecord));
  console.log('[loader] pbRecord:', JSON.stringify(pbRecord));
  console.log('[loader] upsellRecord:', JSON.stringify(upsellRecord));
  console.log('[loader] cartRecord.coupon_status:', cartRecord?.coupon_status);

  const discountJson = await discountQuery.json();
  const productsJson = await productsQuery.json();

  const coupons = (discountJson.data?.discountNodes?.edges || [])
    .map(({ node }) => {
      const d = node.discount;
      if (!d) return null;
      const code = d.codes?.edges?.[0]?.node?.code || '';
      if (!code) return null;
      return { id: node.id, code, title: d.title || code, status: d.status || 'ACTIVE' };
    })
    .filter(Boolean)
    .filter((c) => c.status === 'ACTIVE');

  const allProducts = productsJson.data?.products?.edges?.map(({ node }) => ({
    id: node.id,
    title: node.title,
    image: node.featuredImage?.url || '',
    price: node.variants.edges[0]?.node?.price || '0.00',
  })) || [];

  const drawerEnabled = cartRecord
    ? truthyFlag(cartRecord.cartStatus ?? cartRecord.cart_status)
    : true;

  return {
    coupons,
    allProducts,
    drawerEnabled,
    cartRecord: cartRecord ?? null,
    configRecord: configRows,
    pbRecord: pbRecord ?? null,
    csRecord: csRecord ?? null,
    upsellRecord: upsellRecord ?? null,
    shop,
  };
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

  if (body?.intent === 'saveCartConfig') {
    const existing = (await fetchCartDrawerRecord(shop)) || {};
    const newRecord = {
      ...existing,
      cartStatus: body.cartStatus ?? existing.cartStatus ?? 0,
      cart_status: body.cartStatus ?? existing.cartStatus ?? 0,
      progress_status: body.progress_status ?? existing.progress_status ?? 0,
      progress_data: body.progress_data ?? existing.progress_data ?? null,
      coupon_status: body.coupon_status ?? existing.coupon_status ?? 0,
      coupon_data: body.coupon_data ?? existing.coupon_data ?? null,
      upsell_status: body.upsell_status ?? existing.upsell_status ?? 0,
      upsell_data: body.upsell_data ?? existing.upsell_data ?? null,
      checkoutName: body.checkoutName ?? existing.checkoutName ?? null,
      checkoutFooterText: body.checkoutFooterText ?? existing.checkoutFooterText ?? null,
      customCSS: body.customCSS ?? existing.customCSS ?? null,
      checkout_button_style: body.checkout_button_style ?? existing.checkout_button_style ?? null,
    };
    const result = await persistCartDrawerRecord(shop, newRecord);
    return Response.json({ intent: 'saveCartConfig', success: result.ok });
  }

  return Response.json({ success: false, error: 'Unknown action' }, { status: 400 });
};

export default CartEditorPage;

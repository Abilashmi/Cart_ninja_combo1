// Cart Editor → Checkout Button → "Checkout opens": Shopify checkout or
// Shiprocket checkout for the cart's Checkout (and Pay online / combo pages,
// which read the same per-shop switch, shop_integrations.shiprocket_enabled).
import { authenticate } from '../shopify.server';
import { setShiprocketEnabled } from '../services/shop-integrations.server';

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  let body = {};
  try { body = await request.json(); } catch { /* empty body */ }
  const via = body && body.via;
  if (via !== 'shopify' && via !== 'shiprocket') {
    return Response.json({ success: false, error: 'via must be shopify or shiprocket' }, { status: 400 });
  }
  try {
    await setShiprocketEnabled(session.shop, via === 'shiprocket');
    return Response.json({ success: true, via });
  } catch (error) {
    console.error('[checkout-via] save failed:', session.shop, error.message);
    return Response.json({ success: false, error: 'Could not save the checkout choice.' }, { status: 500 });
  }
};

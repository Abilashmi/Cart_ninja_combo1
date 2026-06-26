import { authenticate } from '../shopify.server';
import { BASE_PHP_URL } from '../utils/api-helpers';

async function callPhp(endpoint, method, shop, body = null) {
  const url = method === 'GET'
    ? `${BASE_PHP_URL}/${endpoint}?shop=${encodeURIComponent(shop)}`
    : `${BASE_PHP_URL}/${endpoint}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const result = await callPhp('cart_drawer_config.php', 'GET', session.shop);
  return Response.json({ success: result.status === 'success', data: result.data });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const body = await request.json();
  console.log('[cart-drawer-config] POST shop:', session.shop, '| is_enabled:', body.is_enabled);
  const result = await callPhp('cart_drawer_config.php', 'POST', session.shop, { shop: session.shop, ...body });
  console.log('[cart-drawer-config] PHP result:', result?.status);
  return Response.json({ success: result.status === 'success', data: result.data });
}

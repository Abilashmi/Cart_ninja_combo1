import { authenticate } from '../shopify.server';

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const phpBase = process.env.PHP_BASE_URL || 'https://int.thecartninja.com';

  let phpResult = null;
  let phpError = null;

  try {
    const res = await fetch(
      `${phpBase}/save_cart_drawer.php?shopdomain=${encodeURIComponent(shop)}`,
      { headers: { 'X-Forge-Secret': process.env.SHOPIFY_API_KEY || '' } }
    );
    phpResult = await res.json();
  } catch (e) {
    phpError = e.message;
  }

  return Response.json({
    shop,
    php_base_url: phpBase,
    php_response: phpResult,
    php_error: phpError,
  });
}

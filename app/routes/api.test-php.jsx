import { authenticate } from '../shopify.server';
import { internalAuthHeaders } from "../utils/internal-auth";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const phpBase = process.env.PHP_BASE_URL || 'https://int.thebrix.io';

  let phpResult = null;
  let phpError = null;

  try {
    const res = await fetch(
      `${phpBase}/save_cart_drawer.php?shopdomain=${encodeURIComponent(shop)}`,
      { headers: { ...internalAuthHeaders() } }
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

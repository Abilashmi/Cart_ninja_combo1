import { authenticate } from "../shopify.server";
import { BASE_PHP_URL } from "../utils/api-helpers";

const PHP_URL = `${BASE_PHP_URL}/shop-redact.php`;

/**
 * Mandatory compliance webhook: shop/redact
 *
 * Triggered 48 hours after a shop owner uninstalls the app.
 * You must permanently delete ALL data stored for this shop.
 *
 * HMAC verification is handled automatically by authenticate.webhook().
 */
export async function action({ request }) {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    const { shop_id, shop_domain } = payload;

    console.log(`[GDPR] shop/redact for shop: ${shop_domain ?? shop} (id: ${shop_id})`);

    // Forward to PHP backend to permanently delete all shop data
    await fetch(PHP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_domain: shop_domain ?? shop,
        shop_id:     shop_id,
      }),
    }).catch(err => console.error("[GDPR] PHP shop/redact failed:", err.message));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[GDPR] shop/redact error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

import { authenticate } from "../shopify.server";
import { BASE_PHP_URL as PHP } from "../utils/api-helpers";

/**
 * POST /webhooks/compliance
 * Handles all 3 mandatory Shopify compliance webhooks:
 *   - customers/data_request
 *   - customers/redact
 *   - shop/redact
 *
 * authenticate.webhook() verifies the HMAC signature automatically.
 * Returns 401 if signature is invalid (Shopify requirement).
 */
export async function action({ request }) {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[Compliance] ${topic} for ${shop}`);

    switch (topic) {
      case "customers/data_request":
        await fetch(`${PHP}/customers-data-request.php`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop_domain:      shop,
            customer_id:      payload.customer?.id,
            customer_email:   payload.customer?.email,
            orders_requested: payload.orders_requested ?? [],
            data_request_id:  payload.data_request?.id,
          }),
        }).catch(e => console.error("[Compliance] data_request PHP error:", e.message));
        break;

      case "customers/redact":
        await fetch(`${PHP}/customers-redact.php`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop_domain:      shop,
            customer_id:      payload.customer?.id,
            customer_email:   payload.customer?.email,
            customer_phone:   payload.customer?.phone ?? null,
            orders_to_redact: payload.orders_to_redact ?? [],
          }),
        }).catch(e => console.error("[Compliance] customers/redact PHP error:", e.message));
        break;

      case "shop/redact":
        await fetch(`${PHP}/shop-redact.php`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop_domain: payload.shop_domain ?? shop,
            shop_id:     payload.shop_id,
          }),
        }).catch(e => console.error("[Compliance] shop/redact PHP error:", e.message));
        break;

      default:
        console.warn(`[Compliance] Unknown topic: ${topic}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // authenticate.webhook throws a Response(401) on invalid HMAC — pass it through
    if (error instanceof Response) return error;
    console.error("[Compliance] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

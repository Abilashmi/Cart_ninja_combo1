import { authenticate } from "../shopify.server";
import { BASE_PHP_URL } from "../utils/api-helpers";

const PHP_URL = `${BASE_PHP_URL}/customers-data-request.php`;

/**
 * Mandatory compliance webhook: customers/data_request
 *
 * Triggered when a customer (or shop owner on their behalf) requests
 * to see what personal data this app has stored about them.
 *
 * Shopify requirement: respond with 200 within 5 seconds.
 * You must retrieve and send the requested data to the shop owner.
 *
 * HMAC verification is handled automatically by authenticate.webhook().
 */
export async function action({ request }) {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    const { customer, orders_requested, data_request } = payload;

    console.log(`[GDPR] customers/data_request for shop: ${shop}`, {
      customer_id: customer?.id,
      customer_email: customer?.email,
      data_request_id: data_request?.id,
      orders_count: orders_requested?.length ?? 0,
    });

    // Forward to PHP backend to retrieve and log the data request
    await fetch(PHP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_domain:      shop,
        customer_id:      customer?.id,
        customer_email:   customer?.email,
        orders_requested: orders_requested ?? [],
        data_request_id:  data_request?.id,
      }),
    }).catch(err => console.error("[GDPR] PHP data_request failed:", err.message));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[GDPR] customers/data_request error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

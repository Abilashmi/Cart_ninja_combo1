import { authenticate } from "../shopify.server";
import { BASE_PHP_URL } from "../utils/api-helpers";

const PHP_URL = `${BASE_PHP_URL}/customers-redact.php`;

/**
 * Mandatory compliance webhook: customers/redact
 *
 * Triggered when a customer requests deletion of their personal data.
 * You must delete or anonymize all stored data for this customer within 30 days.
 *
 * HMAC verification is handled automatically by authenticate.webhook().
 */
export async function action({ request }) {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    const { customer, orders_to_redact } = payload;

    console.log(`[GDPR] customers/redact for shop: ${shop}`, {
      customer_id:    customer?.id,
      customer_email: customer?.email,
      orders_count:   orders_to_redact?.length ?? 0,
    });

    // Forward to PHP backend to delete/anonymize customer data
    await fetch(PHP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_domain:      shop,
        customer_id:      customer?.id,
        customer_email:   customer?.email,
        customer_phone:   customer?.phone ?? null,
        orders_to_redact: orders_to_redact ?? [],
      }),
    }).catch(err => console.error("[GDPR] PHP customers/redact failed:", err.message));

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[GDPR] customers/redact error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

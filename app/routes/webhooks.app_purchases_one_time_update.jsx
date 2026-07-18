import { authenticate } from "../shopify.server";
import { BASE_PHP_URL } from "../utils/api-helpers";

/**
 * Webhook: app_purchases_one_time_update
 * Triggered when a one-time charge status changes (pending → charged, declined, etc)
 */
export async function action({ request }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { topic, shop, payload } = await authenticate.webhook(request);

    if (!shop) {
      console.error("[Webhook] No shop found");
      return new Response("Unauthorized", { status: 401 });
    }

    console.log(`[Webhook] app_purchases_one_time_update for ${shop}:`, payload);

    const { id, status, name, price, decorated_return_url, cancelled_at } = payload;

    // ===== HANDLE CHARGE STATUS UPDATES =====
    if (status === "accepted") {
      console.log(`[Webhook] Charge ${id} accepted for ${shop}`);
      // Charge was approved by customer, will be charged soon
      // You can send a notification or log this
    }

    if (status === "declined") {
      console.log(`[Webhook] Charge ${id} declined for ${shop}`);
      // Charge was declined - update billing_charges status to 'failed' via PHP
      await updateChargeStatusInPHP(shop, "failed");
    }

    if (status === "expired") {
      console.log(`[Webhook] Charge ${id} expired for ${shop}`);
      // Charge expired without being confirmed
      await updateChargeStatusInPHP(shop, "failed");
    }

    if (cancelled_at) {
      console.log(`[Webhook] Charge ${id} cancelled for ${shop}`);
      // Charge was cancelled
      await updateChargeStatusInPHP(shop, "failed");
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // Return 200 even on internal errors — Shopify retries non-2xx webhook
    // responses aggressively, and a transient PHP-backend hiccup here
    // shouldn't trigger days of retries for a charge-status update that
    // isn't safety-critical (the merchant's actual charge already happened
    // on Shopify's side regardless of whether this sync succeeds).
    console.error("[Webhook] Error processing charge update:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Helper: Update charge status in PHP backend
 */
async function updateChargeStatusInPHP(shop, status) {
  try {
    const response = await fetch(
      `${BASE_PHP_URL}/update-charge-status.php`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_domain: shop,
          date: new Date().toISOString().split("T")[0],
          status: status,
        }),
      }
    );

    const data = await response.json();
    console.log("[Webhook] PHP update response:", data);
  } catch (error) {
    console.error("[Webhook] Failed to update PHP charge status:", error);
  }
}

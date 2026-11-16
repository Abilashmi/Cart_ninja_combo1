import { authenticate } from "../shopify.server";
import sessionDb from "../session-db.server";
import { afterResponse } from "../services/webhook-queue.server";
import { recordDataRequest, redactCustomer, redactShop } from "../services/compliance.server";

/**
 * POST /webhooks/compliance (shopify.app.toml compliance_topics):
 * customers/data_request, customers/redact, shop/redact.
 *
 * authenticate.webhook() checks Shopify's HMAC (401 if wrong). We answer at
 * once and do the work after (services/compliance.server.js, with retries).
 */
export async function action({ request }) {
  try {
    const { topic, shop, payload } = await authenticate.webhook(request);
    console.log(`[Compliance] ${topic} for ${shop}`);

    switch (topic) {
      case "customers/data_request":
      case "CUSTOMERS_DATA_REQUEST":
        afterResponse(`compliance ${topic} ${shop}`, () => recordDataRequest(shop, payload)
          .catch((e) => console.error("[Compliance] data_request gave up:", e.message)));
        break;
      case "customers/redact":
      case "CUSTOMERS_REDACT":
        afterResponse(`compliance ${topic} ${shop}`, () => redactCustomer(shop, payload)
          .catch((e) => console.error("[Compliance] customers/redact gave up:", e.message)));
        break;
      case "shop/redact":
      case "SHOP_REDACT":
        afterResponse(`compliance ${topic} ${shop}`, () => redactShop(payload?.shop_domain || shop, { sessions: sessionDb })
          .catch((e) => console.error("[Compliance] shop/redact gave up:", e.message)));
        break;
      default:
        console.warn(`[Compliance] Unknown topic: ${topic}`);
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    // authenticate.webhook throws a Response(401) on invalid HMAC: pass it through.
    if (error instanceof Response) return error;
    console.error("[Compliance] Error:", error.message);
    return new Response(JSON.stringify({ error: "Webhook failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

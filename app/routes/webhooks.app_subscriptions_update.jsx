import { authenticate } from "../shopify.server";
import { BASE_PHP_URL } from "../utils/api-helpers";
import { confirmPlanFromWebhook } from "../services/plan-permissions.server";

const PHP_URL = `${BASE_PHP_URL}/update-subscription-status.php`;

/**
 * Webhook: app_subscriptions/update
 * Triggered when a subscription status changes.
 * Resolves the shop's canonical plan_key (promoting the pending_plan_key
 * recorded by app.subscribe.jsx's action when the subscription becomes
 * active) and syncs status to PHP backend so it's available there too.
 */
export async function action({ request }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { shop, body } = await authenticate.webhook(request);

    if (!shop) {
      console.error("[Webhook] No shop found");
      return new Response("Unauthorized", { status: 401 });
    }

    const payload = JSON.parse(body);
    const { id, status, name, billing_on, cancelled_on, trial_ends_on, activated_on } = payload;

    console.log(`[Webhook] app_subscriptions/update for ${shop}: status=${status}, plan=${name}`);

    const planKey = await confirmPlanFromWebhook(shop, status);

    // Sync to PHP backend (mirrors plan_key/subscription fields there too)
    await syncSubscriptionToPHP({
      shop_domain:          shop,
      subscription_id:      id,
      subscription_status:  status,
      plan_name:            name,
      plan_key:             planKey,
      trial_ends_on:        trial_ends_on  || null,
      billing_on:           billing_on     || null,
    });

    return new Response(JSON.stringify({ success: true, plan_key: planKey }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function syncSubscriptionToPHP(data) {
  try {
    const res = await fetch(PHP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    console.log("[Webhook] PHP sync:", result);
  } catch (err) {
    console.error("[Webhook] PHP sync failed:", err.message);
  }
}

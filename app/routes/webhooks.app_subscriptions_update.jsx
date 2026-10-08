import { authenticate } from "../shopify.server";
import { BASE_PHP_URL } from "../utils/api-helpers";
import { confirmPlanFromWebhook } from "../services/plan-permissions.server";
import { loadWeightTemplates, syncComboWeightDiscount } from "../services/combo-weight-shopify.server";

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
    const { shop, payload, admin } = await authenticate.webhook(request);

    if (!shop) {
      console.error("[Webhook] No shop found");
      return new Response("Unauthorized", { status: 401 });
    }

    console.log(`[Webhook] app_subscriptions/update raw payload for ${shop}:`, JSON.stringify(payload));

    // Shopify's app_subscriptions/update payload nests the subscription
    // under `app_subscription` (snake_case fields) rather than at the top
    // level — verified via the raw payload log above.
    const sub = payload.app_subscription || payload;
    const { admin_graphql_api_id: id, name, status, billing_on, trial_ends_on, plan_handle } = sub;

    console.log(`[Webhook] app_subscriptions/update for ${shop}: status=${status}, plan=${name}, plan_handle=${plan_handle}`);

    const planKey = await confirmPlanFromWebhook(shop, status, plan_handle);

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

    // Weight-priced combos are Pro only: a plan change turns their checkout
    // discount on or off. Never throws; skipped for shops without any.
    await syncWeightCombosForPlan(shop, admin);

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

async function syncWeightCombosForPlan(shop, admin) {
  if (!admin) return;
  try {
    if (!(await loadWeightTemplates(shop)).length) return;
    const result = await syncComboWeightDiscount(admin, shop);
    console.log(`[Webhook] combo weight pricing for ${shop}: ${result.state}`);
  } catch (err) {
    console.error("[Webhook] combo weight sync failed:", err.message);
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

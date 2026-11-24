import { authenticate } from "../shopify.server";
import { BASE_PHP_URL } from "../utils/api-helpers";
import { confirmPlanFromWebhook } from "../services/plan-permissions.server";
import { normalizeBillingInterval } from "../config/plans";
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

    const { interval, otherActive } = await readSubscriptionContext(admin, id, sub.interval);
    const planKey = await confirmPlanFromWebhook(shop, status, plan_handle, { interval, otherActive });

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

// The subscription's billing interval (monthly | annual: a yearly plan bills
// no usage, see billsUsage in app/config/plans.js) and whether the shop has
// another ACTIVE subscription than this one (a plan being replaced). From
// the payload when it says, else from the Admin API; never throws.
async function readSubscriptionContext(admin, id, payloadInterval) {
  let interval = payloadInterval ? normalizeBillingInterval(payloadInterval) : null;
  let otherActive = false;
  if (!admin) return { interval, otherActive };
  try {
    const res = await admin.graphql(`
      query SubscriptionContext($id: ID!) {
        node(id: $id) {
          ... on AppSubscription {
            lineItems { plan { pricingDetails { __typename ... on AppRecurringPricing { interval } } } }
          }
        }
        currentAppInstallation { activeSubscriptions { id status } }
      }
    `, { variables: { id } });
    const data = await res.json();
    const recurring = (data.data?.node?.lineItems || [])
      .find((li) => li.plan?.pricingDetails?.__typename === 'AppRecurringPricing');
    if (!interval) interval = normalizeBillingInterval(recurring?.plan?.pricingDetails?.interval);
    otherActive = (data.data?.currentAppInstallation?.activeSubscriptions || [])
      .some((s) => s.id !== id && String(s.status || '').toUpperCase() === 'ACTIVE');
  } catch (err) {
    console.error("[Webhook] subscription context failed:", err.message);
  }
  return { interval, otherActive };
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

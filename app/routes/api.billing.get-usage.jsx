import { authenticate } from "../shopify.server";
import { getTodayUsage } from "../services/billing.server";

/**
 * GET /api/billing/get-usage
 * Returns today's order usage + overage against the shop's plan cap,
 * read directly from analytics_daily_rollup (Node-native — no PHP hop).
 */
export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const today = await getTodayUsage(shop);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          today,
          has_overage: today.overage_orders > 0,
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("[Billing] get-usage error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error",
        details: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

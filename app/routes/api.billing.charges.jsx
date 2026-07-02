import { authenticate } from "../shopify.server";
import { getChargeHistory } from "../services/billing.server";

/**
 * GET /api/billing/charges
 * Fetches overage charge history directly from order_overage_charges
 * (Node-native — no PHP hop).
 */
export async function loader({ request }) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get("days") || "30", 10);

    const history = await getChargeHistory(shop, days);

    return new Response(
      JSON.stringify({
        success: true,
        data: { history },
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
    console.error("[Billing] charges error:", error);
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

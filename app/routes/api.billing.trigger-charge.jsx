import { authenticate } from "../shopify.server";
import { chargeOverageForToday } from "../services/billing.server";

/**
 * POST /api/billing/trigger-charge
 * Manual/ad-hoc trigger for today's overage charge (the "Record Usage
 * Charge" button on the Billing dashboard). The real daily charge already
 * runs automatically via the scheduler (see app/services/scheduler.server.js).
 */
export async function action({ request }) {
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "POST only" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    const result = await chargeOverageForToday(admin, shop);

    if (result.skipped) {
      return new Response(
        JSON.stringify({ success: false, error: result.reason || "Nothing to charge" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!result.success) {
      return new Response(
        JSON.stringify({ success: false, error: result.error || "Charge failed" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Usage charge of $${result.chargeAmount.toFixed(2)} recorded`,
        usage_record_id: result.usageRecordId,
        amount: result.chargeAmount,
        overage_orders: result.overageOrders,
        shop,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Billing] trigger-charge error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", details: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

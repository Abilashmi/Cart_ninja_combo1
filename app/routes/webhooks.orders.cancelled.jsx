import { authenticate } from "../shopify.server";
import { getDb } from "../services/db.server";
import { upsertOrderFromPayload } from "../services/order-ingest.server";
import { applyOrderDelta } from "../services/analytics-aggregator.server";

// Reverses the revenue counted at orders/paid when a previously-paid order is
// cancelled. Idempotent: only applies the negative delta once, on the
// transition into cancelled (checked via the prior row's cancelled_at/status).
export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const db = getDb();
  try {
    const orderId = String(payload.id);
    const [existing] = await db.execute(
      `SELECT financial_status, cancelled_at, total_price, is_billable FROM store_orders WHERE shop_domain = ? AND order_id = ?`,
      [shop, orderId]
    );
    const wasAlreadyCancelled = existing.length > 0 && existing[0].cancelled_at !== null;
    const wasCountedAsRevenue = existing.length > 0 && existing[0].financial_status === "paid";
    const wasBillable = existing.length > 0 && Number(existing[0].is_billable) === 1;

    const { dateStr, revenue } = await upsertOrderFromPayload(db, shop, payload);

    if (wasCountedAsRevenue && !wasAlreadyCancelled) {
      await applyOrderDelta(shop, dateStr, -revenue, -1, wasBillable ? -1 : 0);
    }
  } catch (error) {
    console.error("[Webhook orders/cancelled] Failed to record cancellation:", error.message);
  }

  return new Response();
};

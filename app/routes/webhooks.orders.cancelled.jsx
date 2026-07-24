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
      `SELECT cancelled_at, total_price, is_billable, is_fbt_order, is_combo_order, revenue_counted FROM store_orders WHERE shop_domain = ? AND order_id = ?`,
      [shop, orderId]
    );
    const wasAlreadyCancelled = existing.length > 0 && existing[0].cancelled_at !== null;
    // Checked against revenue_counted, not financial_status — see
    // webhooks.orders.paid.jsx for why financial_status alone can't be
    // trusted to mean "a delta was actually applied for this order".
    const wasCountedAsRevenue = existing.length > 0 && Number(existing[0].revenue_counted) === 1;
    const wasBillable = existing.length > 0 && Number(existing[0].is_billable) === 1;
    const wasFbtOrder = existing.length > 0 && Number(existing[0].is_fbt_order) === 1;
    const wasComboOrder = existing.length > 0 && Number(existing[0].is_combo_order) === 1;

    const { dateStr, revenue } = await upsertOrderFromPayload(db, shop, payload);

    if (wasCountedAsRevenue && !wasAlreadyCancelled) {
      await applyOrderDelta(shop, dateStr, -revenue, -1, wasBillable ? -1 : 0, wasFbtOrder ? -1 : 0, wasComboOrder ? -1 : 0);
    }
  } catch (error) {
    console.error("[Webhook orders/cancelled] Failed to record cancellation:", error.message);
  }

  return new Response();
};

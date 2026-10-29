import { authenticate } from "../shopify.server";
import { afterResponse } from "../services/webhook-queue.server";
import { getDb } from "../services/db.server";
import { applyOrderDelta } from "../services/analytics-aggregator.server";

function refundAmount(payload) {
  const transactions = Array.isArray(payload.transactions) ? payload.transactions : [];
  return transactions.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
}

// Reduces the revenue counted for the refunded order's original day (net
// revenue reporting: total_price - refunded_amount). Applied against the
// order's created_at_shopify date, matching where the revenue was originally
// recognized at orders/paid.
export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  // Answer Shopify at once; the DB work runs right after (webhook-queue.server.js).
  afterResponse(`webhook ${topic} ${shop}`, () => handle(shop, payload));
  return new Response();
};

async function handle(shop, payload) {
  const db = getDb();
  try {
    const orderId = String(payload.order_id);
    const amount = refundAmount(payload);
    if (amount <= 0) return;

    const [rows] = await db.execute(
      `SELECT created_at_shopify, financial_status FROM store_orders WHERE shop_domain = ? AND order_id = ?`,
      [shop, orderId]
    );
    if (rows.length === 0) return;

    await db.execute(
      `UPDATE store_orders SET refunded_amount = refunded_amount + ? WHERE shop_domain = ? AND order_id = ?`,
      [amount, shop, orderId]
    );

    if (rows[0].financial_status === "paid") {
      const dateStr = new Date(rows[0].created_at_shopify).toISOString().slice(0, 10);
      await applyOrderDelta(shop, dateStr, -amount, 0);
    }
  } catch (error) {
    console.error("[Webhook refunds/create] Failed to record refund:", error.message);
  }
}

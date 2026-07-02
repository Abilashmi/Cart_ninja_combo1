import { authenticate } from "../shopify.server";
import { getDb } from "../services/db.server";
import { ensureAnalyticsTables } from "../services/analytics-schema.server";
import { applyCartActivityDelta } from "../services/analytics-aggregator.server";

// Best-effort signal only (see R1 in the analytics plan) — carts/* webhook
// firing reliability is unproven in this codebase; never treat this as the
// sole source for a headline KPI.
export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const db = getDb();
  try {
    await ensureAnalyticsTables(db);
    const cartToken = String(payload.token || payload.id || "");
    if (!cartToken) return new Response();

    const items = Array.isArray(payload.line_items || payload.items) ? (payload.line_items || payload.items) : [];
    const totalPrice = parseFloat(payload.total_price) || 0;

    await db.execute(
      `INSERT INTO cart_activity_events
         (shop_domain, cart_token, event_type, item_count, total_price, currency, created_at_shopify)
       VALUES (?, ?, 'create', ?, ?, ?, ?)`,
      [
        shop, cartToken, items.length, totalPrice, payload.currency || null,
        payload.created_at ? new Date(payload.created_at).toISOString().slice(0, 19).replace("T", " ") : null,
      ]
    );

    const dateStr = new Date().toISOString().slice(0, 10);
    await applyCartActivityDelta(shop, dateStr, "cart_create_count", 1);
  } catch (error) {
    console.error("[Webhook carts/create] Failed to record cart activity:", error.message);
  }

  return new Response();
};

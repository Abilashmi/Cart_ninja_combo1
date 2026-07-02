import { authenticate } from "../shopify.server";
import { getDb } from "../services/db.server";
import { upsertOrderFromPayload } from "../services/order-ingest.server";

// Refreshes totals/status/line items on edit. Does not apply a rollup delta
// directly (an edited total could move revenue up or down after it was
// already counted at orders/paid) — the 15-minute reconciliation job in
// scheduler.server.js recomputes analytics_daily_rollup from store_orders,
// which corrects any drift this introduces.
export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const db = getDb();
  try {
    await upsertOrderFromPayload(db, shop, payload);
  } catch (error) {
    console.error("[Webhook orders/updated] Failed to upsert order:", error.message);
  }

  return new Response();
};

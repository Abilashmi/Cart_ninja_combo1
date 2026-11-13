import { authenticate, unauthenticated } from "../shopify.server";
import { afterResponse } from "../services/webhook-queue.server";
import { getDb } from "../services/db.server";
import { upsertOrderFromPayload } from "../services/order-ingest.server";
import { countBillableOrder } from "../services/billable-orders.server";
import { completePartialCodOrder } from "../services/partial-cod.server";

// Order/line-item capture, plus the order's count toward the plan's monthly
// orders — no revenue applied to the rollup here.
// financial_status at create time is typically 'pending'; orders/paid is the
// authoritative "revenue realized" signal (see webhooks.orders.paid.jsx).
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
    const { dateStr } = await upsertOrderFromPayload(db, shop, payload);
    // Every order counts toward the plan's monthly orders as soon as it comes in.
    await countBillableOrder(db, shop, payload, dateStr);
  } catch (error) {
    console.error("[Webhook orders/create] Failed to upsert order:", error.message);
  }
  // Partial COD: add the balance back and tag the order (services/partial-cod.server.js).
  try {
    await completePartialCodOrder(shop, payload, { getAdmin: async () => (await unauthenticated.admin(shop)).admin });
  } catch (error) {
    console.error("[Webhook orders/create] Partial COD failed:", error.message);
  }
}

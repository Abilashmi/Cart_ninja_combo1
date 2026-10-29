import { authenticate } from "../shopify.server";
import { getDb } from "../services/db.server";
import { upsertOrderFromPayload } from "../services/order-ingest.server";
import { countBillableOrder } from "../services/billable-orders.server";

// Order/line-item capture, plus the order's count toward the plan's monthly
// orders — no revenue applied to the rollup here.
// financial_status at create time is typically 'pending'; orders/paid is the
// authoritative "revenue realized" signal (see webhooks.orders.paid.jsx).
export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const db = getDb();
  try {
    const { dateStr } = await upsertOrderFromPayload(db, shop, payload);
    // Every order counts toward the plan's monthly orders as soon as it comes in.
    await countBillableOrder(db, shop, payload, dateStr);
  } catch (error) {
    console.error("[Webhook orders/create] Failed to upsert order:", error.message);
  }

  return new Response();
};

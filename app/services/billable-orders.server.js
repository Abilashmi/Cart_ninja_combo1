import { applyOrderDelta } from "./analytics-aggregator.server";

// The orders a plan's monthly limit counts (store_orders.is_billable →
// analytics_daily_rollup.billable_order_count): every order the store gets,
// not only the ones a BRIX feature touched, COD and prepaid alike. Counted
// once, when the order first comes in (orders/create; orders/paid too, in
// case create was missed), on the day it was placed. Test orders never count;
// a cancelled one stops counting (webhooks.orders.cancelled.jsx, and
// reconcileDailyRollup, which counts is_billable rows not cancelled).
// The conditional UPDATE makes two webhooks racing on one order count it once.
export async function countBillableOrder(db, shop, payload, dateStr) {
  if (payload.test || payload.cancelled_at) return false;
  const [result] = await db.execute(
    `UPDATE store_orders SET is_billable = 1
     WHERE shop_domain = ? AND order_id = ? AND is_billable = 0 AND is_test = 0 AND cancelled_at IS NULL`,
    [shop, String(payload.id)]
  );
  if (!result?.affectedRows) return false;
  await applyOrderDelta(shop, dateStr, 0, 0, 1);
  return true;
}

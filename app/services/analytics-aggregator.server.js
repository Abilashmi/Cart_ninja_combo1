import { getDb } from "./db.server";
import { ensureAnalyticsTables } from "./analytics-schema.server";

function todayStr(date = new Date()) {
  return date.toISOString().split("T")[0];
}

// ─── Incremental apply (called directly from order/cart webhooks for
// near-real-time numbers). Click counts and visitor counts arrive via the
// PHP-side click/session-ping endpoints (outside Node's call path), so they
// are only folded into the rollup by reconcileDailyRollup() below — that job
// runs every 15 minutes (see scheduler.server.js), which is an acceptable lag
// for those two fields.

export async function applyOrderDelta(shop, dateStr, revenueDelta, orderCountDelta, billableOrderCountDelta = 0, fbtOrderCountDelta = 0, comboOrderCountDelta = 0) {
  const db = getDb();
  await ensureAnalyticsTables(db);
  await db.execute(
    `INSERT INTO analytics_daily_rollup (shop_domain, date, revenue, order_count, billable_order_count, fbt_order_count, combo_order_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       revenue = revenue + VALUES(revenue),
       order_count = order_count + VALUES(order_count),
       billable_order_count = billable_order_count + VALUES(billable_order_count),
       fbt_order_count = fbt_order_count + VALUES(fbt_order_count),
       combo_order_count = combo_order_count + VALUES(combo_order_count)`,
    [shop, dateStr, revenueDelta, orderCountDelta, billableOrderCountDelta, fbtOrderCountDelta, comboOrderCountDelta]
  );
}

const CART_ACTIVITY_FIELDS = new Set(["cart_create_count", "cart_update_count"]);

export async function applyCartActivityDelta(shop, dateStr, field, delta = 1) {
  if (!CART_ACTIVITY_FIELDS.has(field)) {
    throw new Error(`applyCartActivityDelta: unsupported field ${field}`);
  }
  const db = getDb();
  await ensureAnalyticsTables(db);
  await db.execute(
    `INSERT INTO analytics_daily_rollup (shop_domain, date, ${field})
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE ${field} = ${field} + VALUES(${field})`,
    [shop, dateStr, delta]
  );
}

// ─── Reconciliation (full recompute from raw tables, corrects drift from
// missed/retried webhooks and folds in click/visitor data written by PHP).

export async function reconcileDailyRollup(shopDomain, { days = 3 } = {}) {
  const db = getDb();
  await ensureAnalyticsTables(db);

  const [orderRows] = await db.execute(
    `SELECT DATE(created_at_shopify) AS date,
            COALESCE(SUM(CASE WHEN cancelled_at IS NULL THEN total_price - refunded_amount ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN cancelled_at IS NULL THEN 1 ELSE 0 END), 0) AS order_count,
            COALESCE(SUM(CASE WHEN cancelled_at IS NULL AND is_billable = 1 THEN 1 ELSE 0 END), 0) AS billable_order_count,
            COALESCE(SUM(CASE WHEN cancelled_at IS NULL AND is_billable = 1 AND is_fbt_order = 1 THEN 1 ELSE 0 END), 0) AS fbt_order_count,
            COALESCE(SUM(CASE WHEN cancelled_at IS NULL AND is_billable = 1 AND is_combo_order = 1 THEN 1 ELSE 0 END), 0) AS combo_order_count
     FROM store_orders
     WHERE shop_domain = ? AND created_at_shopify >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at_shopify)`,
    [shopDomain, days]
  );

  const [clickRows] = await db.execute(
    `SELECT DATE(created_at) AS date,
            COALESCE(SUM(CASE WHEN LOWER(event_type) LIKE '%upsell%' THEN revenue ELSE 0 END), 0) AS upsell_revenue,
            COALESCE(SUM(CASE WHEN LOWER(event_type) LIKE '%upsell%' THEN 1 ELSE 0 END), 0) AS upsell_click_count,
            COALESCE(SUM(CASE WHEN LOWER(event_type) LIKE '%checkout%' THEN 1 ELSE 0 END), 0) AS checkout_click_count,
            COALESCE(SUM(CASE WHEN LOWER(event_type) LIKE '%coupon%' THEN 1 ELSE 0 END), 0) AS coupon_click_count
     FROM cart_click_events
     WHERE domain = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)`,
    [shopDomain, days]
  );

  const [bundleRows] = await db.execute(
    `SELECT DATE(recorded_at) AS date,
            COALESCE(SUM(revenue), 0) AS bundle_revenue,
            COUNT(*) AS bundle_order_count
     FROM combo_analytics
     WHERE shop_domain = ? AND event_type = 'order' AND recorded_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(recorded_at)`,
    [shopDomain, days]
  );

  const [visitorRows] = await db.execute(
    `SELECT DATE(first_seen_at) AS date, COUNT(DISTINCT session_id) AS visitor_count
     FROM analytics_sessions
     WHERE shop_domain = ? AND first_seen_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(first_seen_at)`,
    [shopDomain, days]
  );

  const [cartRows] = await db.execute(
    `SELECT DATE(created_at) AS date,
            COALESCE(SUM(CASE WHEN event_type = 'create' THEN 1 ELSE 0 END), 0) AS cart_create_count,
            COALESCE(SUM(CASE WHEN event_type = 'update' THEN 1 ELSE 0 END), 0) AS cart_update_count
     FROM cart_activity_events
     WHERE shop_domain = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at)`,
    [shopDomain, days]
  );

  const byDate = new Map();
  const dateKey = (d) => (d instanceof Date ? todayStr(d) : String(d));
  const bucket = (d) => {
    const key = dateKey(d);
    if (!byDate.has(key)) {
      byDate.set(key, {
        revenue: 0, order_count: 0, billable_order_count: 0, fbt_order_count: 0, combo_order_count: 0,
        upsell_revenue: 0, coupon_applied_count: 0,
        checkout_click_count: 0, coupon_click_count: 0, upsell_click_count: 0,
        bundle_revenue: 0, bundle_order_count: 0, visitor_count: 0,
        cart_create_count: 0, cart_update_count: 0,
      });
    }
    return byDate.get(key);
  };

  for (const r of orderRows) {
    const b = bucket(r.date);
    b.revenue = parseFloat(r.revenue) || 0;
    b.order_count = Number(r.order_count) || 0;
    b.billable_order_count = Number(r.billable_order_count) || 0;
    b.fbt_order_count = Number(r.fbt_order_count) || 0;
    b.combo_order_count = Number(r.combo_order_count) || 0;
  }
  for (const r of clickRows) {
    const b = bucket(r.date);
    b.upsell_revenue = parseFloat(r.upsell_revenue) || 0;
    b.upsell_click_count = Number(r.upsell_click_count) || 0;
    b.checkout_click_count = Number(r.checkout_click_count) || 0;
    b.coupon_click_count = Number(r.coupon_click_count) || 0;
    // Mirrors php_backend's existing semantics: a coupon-type click event is
    // also treated as a coupon "applied" count (no separate applied signal exists yet).
    b.coupon_applied_count = Number(r.coupon_click_count) || 0;
  }
  for (const r of bundleRows) {
    const b = bucket(r.date);
    b.bundle_revenue = parseFloat(r.bundle_revenue) || 0;
    b.bundle_order_count = Number(r.bundle_order_count) || 0;
  }
  for (const r of visitorRows) {
    bucket(r.date).visitor_count = Number(r.visitor_count) || 0;
  }
  for (const r of cartRows) {
    const b = bucket(r.date);
    b.cart_create_count = Number(r.cart_create_count) || 0;
    b.cart_update_count = Number(r.cart_update_count) || 0;
  }

  for (const [date, m] of byDate.entries()) {
    await db.execute(
      `INSERT INTO analytics_daily_rollup
         (shop_domain, date, revenue, order_count, billable_order_count, fbt_order_count, combo_order_count,
          upsell_revenue, coupon_applied_count,
          checkout_click_count, coupon_click_count, upsell_click_count, bundle_revenue,
          bundle_order_count, visitor_count, cart_create_count, cart_update_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         revenue = VALUES(revenue), order_count = VALUES(order_count), billable_order_count = VALUES(billable_order_count),
         fbt_order_count = VALUES(fbt_order_count), combo_order_count = VALUES(combo_order_count),
         upsell_revenue = VALUES(upsell_revenue), coupon_applied_count = VALUES(coupon_applied_count),
         checkout_click_count = VALUES(checkout_click_count), coupon_click_count = VALUES(coupon_click_count),
         upsell_click_count = VALUES(upsell_click_count), bundle_revenue = VALUES(bundle_revenue),
         bundle_order_count = VALUES(bundle_order_count), visitor_count = VALUES(visitor_count),
         cart_create_count = VALUES(cart_create_count), cart_update_count = VALUES(cart_update_count)`,
      [
        shopDomain, date, m.revenue, m.order_count, m.billable_order_count, m.fbt_order_count, m.combo_order_count,
        m.upsell_revenue, m.coupon_applied_count,
        m.checkout_click_count, m.coupon_click_count, m.upsell_click_count, m.bundle_revenue,
        m.bundle_order_count, m.visitor_count, m.cart_create_count, m.cart_update_count,
      ]
    );
  }

  return byDate.size;
}

export async function reconcileAllShops({ days = 3 } = {}) {
  const db = getDb();
  const [shops] = await db.execute(
    `SELECT DISTINCT shop_domain FROM store_orders
     UNION SELECT DISTINCT domain AS shop_domain FROM cart_click_events WHERE domain IS NOT NULL
     UNION SELECT DISTINCT shop_domain FROM combo_analytics`
  );

  let count = 0;
  for (const row of shops) {
    const shop = row.shop_domain;
    if (!shop) continue;
    try {
      await reconcileDailyRollup(shop, { days });
      count += 1;
    } catch (error) {
      console.error(`[analytics-aggregator] reconcile failed for ${shop}:`, error.message);
    }
  }
  return count;
}

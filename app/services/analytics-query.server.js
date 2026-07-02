import { getDb } from "./db.server";
import { ensureAnalyticsTables } from "./analytics-schema.server";
import { safeDivide } from "../utils/analytics.shared";

function toDayList(startDate, endDate) {
  const days = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const last = new Date(`${endDate}T00:00:00`);
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function deriveMetrics(totals) {
  const aov = safeDivide(totals.revenue, totals.order_count);
  const conversion_rate = safeDivide(totals.order_count, totals.visitor_count) * 100;
  const checkout_rate = safeDivide(totals.checkout_click_count, totals.visitor_count) * 100;
  return { ...totals, aov, conversion_rate, checkout_rate };
}

export async function getPeriodTotals(shop, startDate, endDate) {
  const db = getDb();
  await ensureAnalyticsTables(db);
  const [rows] = await db.execute(
    `SELECT
       COALESCE(SUM(revenue), 0) AS revenue,
       COALESCE(SUM(order_count), 0) AS order_count,
       COALESCE(SUM(upsell_revenue), 0) AS upsell_revenue,
       COALESCE(SUM(coupon_applied_count), 0) AS coupon_applied_count,
       COALESCE(SUM(checkout_click_count), 0) AS checkout_click_count,
       COALESCE(SUM(coupon_click_count), 0) AS coupon_click_count,
       COALESCE(SUM(upsell_click_count), 0) AS upsell_click_count,
       COALESCE(SUM(bundle_revenue), 0) AS bundle_revenue,
       COALESCE(SUM(bundle_order_count), 0) AS bundle_order_count,
       COALESCE(SUM(visitor_count), 0) AS visitor_count,
       COALESCE(SUM(cart_create_count), 0) AS cart_create_count,
       COALESCE(SUM(cart_update_count), 0) AS cart_update_count
     FROM analytics_daily_rollup
     WHERE shop_domain = ? AND date BETWEEN ? AND ?`,
    [shop, startDate, endDate]
  );

  const row = rows[0] || {};
  const totals = {
    revenue: parseFloat(row.revenue) || 0,
    order_count: Number(row.order_count) || 0,
    upsell_revenue: parseFloat(row.upsell_revenue) || 0,
    coupon_applied_count: Number(row.coupon_applied_count) || 0,
    checkout_click_count: Number(row.checkout_click_count) || 0,
    coupon_click_count: Number(row.coupon_click_count) || 0,
    upsell_click_count: Number(row.upsell_click_count) || 0,
    bundle_revenue: parseFloat(row.bundle_revenue) || 0,
    bundle_order_count: Number(row.bundle_order_count) || 0,
    visitor_count: Number(row.visitor_count) || 0,
    cart_create_count: Number(row.cart_create_count) || 0,
    cart_update_count: Number(row.cart_update_count) || 0,
  };

  return deriveMetrics(totals);
}

export async function getDailyChart(shop, startDate, endDate) {
  const db = getDb();
  await ensureAnalyticsTables(db);
  const [rows] = await db.execute(
    `SELECT * FROM analytics_daily_rollup WHERE shop_domain = ? AND date BETWEEN ? AND ? ORDER BY date ASC`,
    [shop, startDate, endDate]
  );

  const byDate = new Map();
  for (const r of rows) {
    const dateStr = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date);
    byDate.set(dateStr, r);
  }

  return toDayList(startDate, endDate).map((dateStr) => {
    const r = byDate.get(dateStr);
    if (!r) {
      return {
        date: dateStr, revenue: 0, upsell: 0, coupons: 0,
        checkoutClicks: 0, couponClicks: 0, upsellClicks: 0,
        convRate: 0, checkoutRate: 0, visitors: 0, orders: 0, aov: 0,
        bundleRevenue: 0, cartCreates: 0, cartUpdates: 0,
      };
    }
    const visitors = Number(r.visitor_count) || 0;
    const orderCount = Number(r.order_count) || 0;
    const dayRevenue = parseFloat(r.revenue) || 0;
    const checkoutClicks = Number(r.checkout_click_count) || 0;
    return {
      date: dateStr,
      revenue: dayRevenue,
      upsell: parseFloat(r.upsell_revenue) || 0,
      coupons: Number(r.coupon_applied_count) || 0,
      checkoutClicks,
      couponClicks: Number(r.coupon_click_count) || 0,
      upsellClicks: Number(r.upsell_click_count) || 0,
      convRate: visitors > 0 ? Math.round((orderCount / visitors) * 1000) / 10 : 0,
      checkoutRate: visitors > 0 ? Math.round((checkoutClicks / visitors) * 1000) / 10 : 0,
      visitors,
      orders: orderCount,
      aov: orderCount > 0 ? Math.round((dayRevenue / orderCount) * 100) / 100 : 0,
      bundleRevenue: parseFloat(r.bundle_revenue) || 0,
      cartCreates: Number(r.cart_create_count) || 0,
      cartUpdates: Number(r.cart_update_count) || 0,
    };
  });
}

export async function getTopProducts(shop, startDate, endDate, limit = 10) {
  const db = getDb();
  await ensureAnalyticsTables(db);
  const [rows] = await db.execute(
    `SELECT
       li.product_id,
       COALESCE(NULLIF(MAX(li.product_title), ''), CONCAT('Product #', li.product_id)) AS name,
       COALESCE(SUM(li.line_revenue), 0) AS revenue,
       COALESCE(SUM(li.quantity), 0) AS units_sold,
       COUNT(DISTINCT li.order_id) AS order_count
     FROM store_order_line_items li
     JOIN store_orders o ON o.shop_domain = li.shop_domain AND o.order_id = li.order_id
     WHERE li.shop_domain = ? AND o.cancelled_at IS NULL
       AND li.created_at_shopify BETWEEN ? AND ?
       AND li.product_id IS NOT NULL
     GROUP BY li.product_id
     ORDER BY revenue DESC
     LIMIT ?`,
    [shop, `${startDate} 00:00:00`, `${endDate} 23:59:59`, limit]
  );

  return rows.map((r) => ({
    product_id: r.product_id,
    name: r.name,
    revenue: parseFloat(r.revenue) || 0,
    units_sold: Number(r.units_sold) || 0,
    order_count: Number(r.order_count) || 0,
  }));
}

export async function getTopCollections(shop, startDate, endDate, limit = 10) {
  const db = getDb();
  await ensureAnalyticsTables(db);
  const [rows] = await db.execute(
    `SELECT
       c.collection_id,
       COALESCE(NULLIF(MAX(c.collection_title), ''), CONCAT('Collection #', c.collection_id)) AS title,
       COALESCE(SUM(li.line_revenue), 0) AS revenue,
       COALESCE(SUM(li.quantity), 0) AS units_sold,
       COUNT(DISTINCT li.order_id) AS order_count
     FROM store_order_line_item_collections c
     JOIN store_order_line_items li ON li.shop_domain = c.shop_domain AND li.line_item_id = c.line_item_id
     JOIN store_orders o ON o.shop_domain = li.shop_domain AND o.order_id = li.order_id
     WHERE c.shop_domain = ? AND o.cancelled_at IS NULL
       AND li.created_at_shopify BETWEEN ? AND ?
     GROUP BY c.collection_id
     ORDER BY revenue DESC
     LIMIT ?`,
    [shop, `${startDate} 00:00:00`, `${endDate} 23:59:59`, limit]
  );

  return rows.map((r) => ({
    collection_id: r.collection_id,
    title: r.title,
    revenue: parseFloat(r.revenue) || 0,
    units_sold: Number(r.units_sold) || 0,
    order_count: Number(r.order_count) || 0,
  }));
}

export async function getFunnel(shop, startDate, endDate) {
  const totals = await getPeriodTotals(shop, startDate, endDate);
  const visitors = totals.visitor_count;
  const cartCreates = totals.cart_create_count;
  const checkoutClicks = totals.checkout_click_count;
  const orders = totals.order_count;

  return {
    visitors,
    cart_creates: cartCreates,
    checkout_clicks: checkoutClicks,
    orders,
    rates: {
      visitor_to_cart: Math.round(safeDivide(cartCreates, visitors) * 1000) / 10,
      cart_to_checkout: Math.round(safeDivide(checkoutClicks, cartCreates) * 1000) / 10,
      checkout_to_order: Math.round(safeDivide(orders, checkoutClicks) * 1000) / 10,
    },
  };
}

export async function getRecentActivity(shop, limit = 20) {
  const db = getDb();
  await ensureAnalyticsTables(db);

  const [orderRows] = await db.execute(
    `SELECT order_id AS ref_id, total_price AS amount, created_at_shopify AS occurred_at, 'order' AS kind
     FROM store_orders
     WHERE shop_domain = ? AND financial_status = 'paid'
     ORDER BY created_at_shopify DESC
     LIMIT ?`,
    [shop, limit]
  );

  const [bundleRows] = await db.execute(
    `SELECT template_id AS ref_id, revenue AS amount, recorded_at AS occurred_at, 'bundle_order' AS kind
     FROM combo_analytics
     WHERE shop_domain = ? AND event_type = 'order'
     ORDER BY recorded_at DESC
     LIMIT ?`,
    [shop, limit]
  );

  return [...orderRows, ...bundleRows]
    .map((r) => ({
      kind: r.kind,
      ref_id: r.ref_id,
      amount: parseFloat(r.amount) || 0,
      occurred_at: r.occurred_at instanceof Date ? r.occurred_at.toISOString() : String(r.occurred_at),
    }))
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
    .slice(0, limit);
}

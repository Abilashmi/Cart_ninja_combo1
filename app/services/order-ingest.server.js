import { ensureAnalyticsTables } from "./analytics-schema.server";

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

// Shared by webhooks.orders.create/updated/paid/cancelled.jsx — upserts the
// order header + line items from a standard Shopify order webhook payload.
// Returns { dateStr, revenue, isNewOrder } for the caller to feed into
// analytics-aggregator.server.js's applyOrderDelta().
export async function upsertOrderFromPayload(db, shop, payload, { financialStatusOverride } = {}) {
  await ensureAnalyticsTables(db);

  const orderId = String(payload.id);
  const financialStatus = financialStatusOverride || payload.financial_status || "pending";
  const totalPrice = toNum(payload.current_total_price ?? payload.total_price ?? 0);
  const subtotalPrice = toNum(payload.current_subtotal_price ?? payload.subtotal_price ?? 0);
  const totalDiscounts = toNum(payload.current_total_discounts ?? payload.total_discounts ?? 0);
  const totalTax = toNum(payload.current_total_tax ?? payload.total_tax ?? 0);
  const createdAtShopify = payload.created_at
    ? new Date(payload.created_at).toISOString().slice(0, 19).replace("T", " ")
    : new Date().toISOString().slice(0, 19).replace("T", " ");
  const cancelledAt = payload.cancelled_at
    ? new Date(payload.cancelled_at).toISOString().slice(0, 19).replace("T", " ")
    : null;

  const [existingRows] = await db.execute(
    `SELECT id FROM store_orders WHERE shop_domain = ? AND order_id = ?`,
    [shop, orderId]
  );
  const isNewOrder = existingRows.length === 0;

  await db.execute(
    `INSERT INTO store_orders
       (shop_domain, order_id, order_number, financial_status, fulfillment_status,
        currency, subtotal_price, total_discounts, total_tax, total_price,
        cancelled_at, is_test, created_at_shopify)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       order_number = VALUES(order_number),
       financial_status = VALUES(financial_status),
       fulfillment_status = VALUES(fulfillment_status),
       subtotal_price = VALUES(subtotal_price),
       total_discounts = VALUES(total_discounts),
       total_tax = VALUES(total_tax),
       total_price = VALUES(total_price),
       cancelled_at = VALUES(cancelled_at)`,
    [
      shop, orderId, payload.order_number ? String(payload.order_number) : null,
      financialStatus, payload.fulfillment_status || null,
      payload.currency || "USD", subtotalPrice, totalDiscounts, totalTax, totalPrice,
      cancelledAt, payload.test ? 1 : 0, createdAtShopify,
    ]
  );

  const lineItems = Array.isArray(payload.line_items) ? payload.line_items : [];
  for (const item of lineItems) {
    await db.execute(
      `INSERT INTO store_order_line_items
         (shop_domain, order_id, line_item_id, product_id, variant_id, product_title,
          sku, quantity, price, total_discount, line_revenue, created_at_shopify)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         quantity = VALUES(quantity), price = VALUES(price),
         total_discount = VALUES(total_discount), line_revenue = VALUES(line_revenue)`,
      [
        shop, orderId, String(item.id),
        item.product_id ? String(item.product_id) : null,
        item.variant_id ? String(item.variant_id) : null,
        item.title || item.name || "",
        item.sku || null,
        Number(item.quantity) || 0,
        toNum(item.price),
        toNum(item.total_discount),
        toNum(item.price) * (Number(item.quantity) || 0) - toNum(item.total_discount),
        createdAtShopify,
      ]
    );
  }

  return {
    dateStr: createdAtShopify.slice(0, 10),
    revenue: totalPrice,
    isNewOrder,
    cancelled: Boolean(cancelledAt),
  };
}

import { authenticate } from "../shopify.server";
import { getDb } from "../services/db.server";
import { upsertOrderFromPayload } from "../services/order-ingest.server";
import { applyOrderDelta } from "../services/analytics-aggregator.server";

// Stores every paid order's revenue against the local MySQL DB (same DB used
// by db.server.js / getDb()). This is the local, dev-time source of truth for
// the store-wide Revenue/AOV/Conversion Rate cards in app/routes/app._index.jsx
// (via app/routes/api.analytics.jsx) until that's shifted onto the production
// PHP backend's own order sync. No code change is needed to "go to production" —
// this webhook runs the same way there, against whatever DB_HOST/DB_NAME env
// vars the deployed app is configured with.
function comboSourceFromAttrs(payload) {
  const noteAttributes = payload.note_attributes || [];
  return noteAttributes.find((a) => a.name === "combo_source")?.value;
}

async function ensureStoreOrderEventsTable(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS store_order_events (
      id INT NOT NULL AUTO_INCREMENT,
      shop_domain VARCHAR(255) NOT NULL,
      order_id VARCHAR(64) NOT NULL,
      revenue DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_shop_order (shop_domain, order_id),
      INDEX idx_shop (shop_domain),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

// Records revenue against the Combo Forge template that generated an order,
// using the combo_source / combo_template_id note attributes set by the
// checkout redirect in app/routes/preview.$templateId.jsx.
export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const db = getDb();
  const revenue = parseFloat(payload.current_total_price ?? payload.total_price ?? 0) || 0;

  try {
    await ensureStoreOrderEventsTable(db);
    await db.execute(
      `INSERT INTO store_order_events (shop_domain, order_id, revenue) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE revenue = VALUES(revenue)`,
      [shop, String(payload.id), revenue]
    );
  } catch (error) {
    console.error("[Webhook orders/paid] Failed to record store order event:", error.message);
  }

  // New normalized path (app/services/order-ingest.server.js +
  // analytics-aggregator.server.js) — supersedes store_order_events above,
  // which stays write-only for one release cycle as a rollback safety net.
  try {
    const [existing] = await db.execute(
      `SELECT financial_status FROM store_orders WHERE shop_domain = ? AND order_id = ?`,
      [shop, String(payload.id)]
    );
    const alreadyCountedAsPaid = existing.length > 0 && existing[0].financial_status === "paid";

    const { dateStr, revenue: orderRevenue } = await upsertOrderFromPayload(db, shop, payload, {
      financialStatusOverride: "paid",
    });

    // Only orders placed while the cart drawer was enabled count toward the
    // plan's order cap — stamped once here (orders/paid is the one place
    // that also applies the rollup delta), not re-evaluated on later
    // orders/updated webhooks for the same order.
    const [drawerRows] = await db.execute(
      `SELECT cartStatus FROM cart_drawer WHERE shop = ? LIMIT 1`,
      [shop]
    );
    const isBillable = drawerRows.length > 0 && Number(drawerRows[0].cartStatus) === 1;

    // Reporting-only source tags — an order can carry both. They never
    // change what gets charged (that's still driven solely by is_billable /
    // billable_order_count); they just say which feature(s) touched it.
    const isFbtOrder = (Array.isArray(payload.line_items) ? payload.line_items : []).some((item) => {
      const props = item.properties;
      if (!props) return false;
      const entries = Array.isArray(props) ? props : Object.entries(props).map(([name, value]) => ({ name, value }));
      return entries.some((p) => (p.name === "_brix_source" || p.name === "_brix_fbt") && p.value === "fbt");
    });
    const isComboOrder = comboSourceFromAttrs(payload) === "ComboForge";

    await db.execute(
      `UPDATE store_orders SET is_billable = ?, is_fbt_order = ?, is_combo_order = ? WHERE shop_domain = ? AND order_id = ?`,
      [isBillable ? 1 : 0, isFbtOrder ? 1 : 0, isComboOrder ? 1 : 0, shop, String(payload.id)]
    );

    if (!alreadyCountedAsPaid) {
      await applyOrderDelta(shop, dateStr, orderRevenue, 1, isBillable ? 1 : 0, isFbtOrder ? 1 : 0, isComboOrder ? 1 : 0);
    }
  } catch (error) {
    console.error("[Webhook orders/paid] Failed to record store_orders/rollup:", error.message);
  }

  try {
    const noteAttributes = payload.note_attributes || [];
    const getAttr = (name) => noteAttributes.find((a) => a.name === name)?.value;

    const comboSource = comboSourceFromAttrs(payload);
    const templateId = getAttr("combo_template_id");

    if (comboSource === "ComboForge" && templateId) {
      await db.execute(
        `INSERT INTO combo_analytics (shop_domain, template_id, event_type, revenue) VALUES (?, ?, 'order', ?)`,
        [shop, Number(templateId), revenue]
      );
    }
  } catch (error) {
    console.error("[Webhook orders/paid] Failed to record combo analytics:", error.message);
  }

  return new Response();
};

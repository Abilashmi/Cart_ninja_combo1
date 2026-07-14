import { getDb } from './db.server';
import { ensureAnalyticsTables } from './analytics-schema.server';
import { getTopProducts } from './analytics-query.server';

function todayMinusYears(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

// Real basket analysis: which two products most often appear together in the
// same (non-cancelled) order. `a.product_id < b.product_id` is a plain
// string-dedup trick (not a numeric ordering claim) so each pair is only
// counted once regardless of line-item insertion order.
async function getTopCoPurchasedPair(shop, startDate, endDate) {
  const db = getDb();
  await ensureAnalyticsTables(db);
  const [rows] = await db.execute(
    `SELECT a.product_id AS product_a, b.product_id AS product_b,
            COUNT(DISTINCT a.order_id) AS co_count
     FROM store_order_line_items a
     JOIN store_order_line_items b
       ON a.shop_domain = b.shop_domain AND a.order_id = b.order_id AND a.product_id < b.product_id
     JOIN store_orders o ON o.shop_domain = a.shop_domain AND o.order_id = a.order_id
     WHERE a.shop_domain = ? AND o.cancelled_at IS NULL
       AND a.product_id IS NOT NULL AND b.product_id IS NOT NULL
       AND a.created_at_shopify BETWEEN ? AND ?
     GROUP BY a.product_id, b.product_id
     ORDER BY co_count DESC
     LIMIT 1`,
    [shop, `${startDate} 00:00:00`, `${endDate} 23:59:59`]
  );
  if (!rows.length || Number(rows[0].co_count) < 1) return null;
  return { productA: rows[0].product_a, productB: rows[0].product_b };
}

// Real, data-driven trigger/offer pair for the "choose the best upsell for
// me" auto-recommendation flow — never a fabricated/random pick.
// Returns:
//   { status: 'found', trigger: {id, title}, offer: {id, title}, basis }
//   { status: 'insufficient-data' }  — honest failure, caller must not fake a pair
export async function getBestUpsellPair(shop) {
  const startDate = todayMinusYears(2);
  const endDate = new Date().toISOString().slice(0, 10);

  const topProducts = await getTopProducts(shop, startDate, endDate, 10);
  if (topProducts.length < 2) return { status: 'insufficient-data' };

  const rankOf = (productId) => topProducts.findIndex(p => String(p.product_id) === String(productId));
  const titleOf = (productId) => topProducts.find(p => String(p.product_id) === String(productId))?.name;

  const pair = await getTopCoPurchasedPair(shop, startDate, endDate);
  if (pair) {
    const rankA = rankOf(pair.productA);
    const rankB = rankOf(pair.productB);
    // Whichever side ranks higher among best-sellers (lower index = more
    // popular) is more likely to already be in the cart, so it becomes the
    // trigger. If neither is in the top-10 list (rare), fall back to A/B as-is.
    const [triggerId, offerId] = (rankA !== -1 && (rankB === -1 || rankA <= rankB))
      ? [pair.productA, pair.productB]
      : [pair.productB, pair.productA];
    const triggerTitle = titleOf(triggerId) || `Product #${triggerId}`;
    const offerTitle = titleOf(offerId) || `Product #${offerId}`;
    return {
      status: 'found',
      trigger: { id: triggerId, title: triggerTitle },
      offer: { id: offerId, title: offerTitle },
      basis: 'co-purchase',
    };
  }

  // Fallback: no real co-purchase pair found (too few multi-item orders) —
  // still real revenue data, just not true basket analysis.
  return {
    status: 'found',
    trigger: { id: topProducts[0].product_id, title: topProducts[0].name },
    offer: { id: topProducts[1].product_id, title: topProducts[1].name },
    basis: 'best-seller',
  };
}

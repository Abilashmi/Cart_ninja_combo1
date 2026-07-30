import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { saveCouponSliderSettings } from '../services/cart-config-writes.server';

function parseSelectedCoupons(row) {
  if (!row) return row;
  try {
    row.selected_coupons = row.selected_coupons
      ? JSON.parse(row.selected_coupons)
      : [];
  } catch {
    row.selected_coupons = [];
  }
  return row;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  const [rows] = await db.execute(
    'SELECT * FROM coupon_slider_settings WHERE shop_domain = ? LIMIT 1',
    [session.shop]
  );
  const data = parseSelectedCoupons(rows[0] || null);
  return Response.json({ success: !!data, data });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  const planKey = await getShopPlan(shop);
  const data = await saveCouponSliderSettings(shop, planKey, body);
  return Response.json({ success: true, data });
}

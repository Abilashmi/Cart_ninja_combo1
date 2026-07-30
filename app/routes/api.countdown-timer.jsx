import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { saveCountdownTimerSettings, ensureCountdownTimerColumns } from '../services/cart-config-writes.server';

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  try {
    // The countdown_* columns self-heal on first write (saveCountdownTimerSettings)
    // — a shop that's never saved countdown settings yet has no such columns,
    // and an explicit-column SELECT against a nonexistent column throws
    // ("Unknown column"), not just returns null. Ensure the schema before
    // reading, not only before writing.
    await ensureCountdownTimerColumns(db);
    const [rows] = await db.execute(
      'SELECT countdown_enabled, countdown_mode, countdown_hours, countdown_minutes, countdown_label, countdown_expired_label, countdown_bg_color, countdown_text_color, countdown_accent_color, countdown_show_on_products, countdown_show_on_coupons, countdown_coupon_code, countdown_coupon_mode FROM cart_drawer_config WHERE shop_domain = ? LIMIT 1',
      [session.shop]
    );
    const row = rows[0];
    const data = row
      ? {
          enabled: !!row.countdown_enabled,
          mode: row.countdown_mode,
          hours: row.countdown_hours,
          minutes: row.countdown_minutes,
          label: row.countdown_label,
          expiredLabel: row.countdown_expired_label,
          bgColor: row.countdown_bg_color,
          textColor: row.countdown_text_color,
          accentColor: row.countdown_accent_color,
          showOnProducts: !!row.countdown_show_on_products,
          showOnCoupons: !!row.countdown_show_on_coupons,
          couponCode: row.countdown_coupon_code,
          couponMode: row.countdown_coupon_mode,
        }
      : null;
    return Response.json({ success: true, data });
  } catch (error) {
    console.error('[countdown-timer] loader DB error:', error.message);
    return Response.json({ success: false, error: 'Failed to load countdown timer settings' }, { status: 502 });
  }
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  try {
    const planKey = await getShopPlan(shop);
    const data = await saveCountdownTimerSettings(shop, planKey, body);
    return Response.json({ success: true, data });
  } catch (error) {
    console.error('[countdown-timer] action DB error:', error.message);
    return Response.json({ success: false, error: 'Failed to save countdown timer settings' }, { status: 502 });
  }
}

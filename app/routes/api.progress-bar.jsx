import { authenticate } from '../shopify.server';
import { getDb } from '../services/db.server';
import { getShopPlan } from '../services/plan-permissions.server';
import { saveProgressBarSettings } from '../services/cart-config-writes.server';

async function fetchProgressBar(db, shop) {
  const [rows] = await db.execute(
    'SELECT * FROM progress_bar_settings WHERE shop_domain = ? LIMIT 1', [shop]
  );
  const settings = rows[0] || null;
  if (!settings) return null;
  const [tierRows] = await db.execute(
    'SELECT * FROM progress_bar_tiers WHERE settings_id = ? AND is_active = 1 ORDER BY sort_order ASC',
    [settings.id]
  );
  settings.tiers = tierRows.map((t) => ({
    ...t,
    reward_products: t.reward_products
      ? (typeof t.reward_products === 'string'
          ? (() => { try { return JSON.parse(t.reward_products); } catch { return []; } })()
          : t.reward_products)
      : [],
  }));
  return settings;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const db = getDb();
  const data = await fetchProgressBar(db, session.shop).catch(() => null);
  return Response.json({ success: !!data, data });
}

export async function action({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const body = await request.json();

  // The manual editor's full save always sends the complete `tiers` array
  // (a delete-and-reinsert-all is the correct behavior here — it owns the
  // whole ladder), matching this route's historical behavior exactly.
  const planKey = await getShopPlan(shop);
  const data = await saveProgressBarSettings(shop, planKey, { ...body, tiers: body.tiers ?? [] });
  return Response.json({ success: true, data });
}
